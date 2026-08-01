/**
 * Phase 0, step 4: fixture ingest.
 *
 * Populates `fixtures`. Does not touch `player_gameweeks` — that is step 5.
 *
 * Run: npm run ingest:fixtures   (requires ingest:dimensions to have run)
 *
 * Two source paths, per rule 14:
 *
 *   Read path, 2018-19..2025-26  -> fixtures.csv, straight across.
 *   Derived path, 2016-17..2017-18 -> merged_gw.csv, because upstream
 *   publishes no fixtures.csv for those two seasons.
 *
 * The derived path has no second source to check it against, which is exactly
 * why `validate()` below runs it over the eight seasons that DO have a
 * fixtures.csv and diffs the two. Only the read path's output is inserted for
 * those seasons; the derivation there is a test, not a fallback. Passing it is
 * what earns the right to trust the derivation for 2016-17 and 2017-18.
 *
 * Same shape as ingest-dimensions.ts: idempotent via ON CONFLICT DO UPDATE
 * (never delete-and-reinsert, because fixtures.id is the FK target for
 * player_gameweeks in step 5), and all-or-nothing in one transaction.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));
// server/src/ingest -> server/src -> server -> repo root
const RAW_DIR = join(here, '..', '..', '..', 'data', 'raw');

const SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
  '2024-25',
  '2025-26',
] as const;

type Season = (typeof SEASONS)[number];

/** Rule 14: upstream publishes no fixtures.csv before this. */
const DERIVED_SEASONS: readonly Season[] = ['2016-17', '2017-18'];

/** merged_gw.csv is latin1 for these; UTF-8 afterwards. */
const LATIN1_GW_SEASONS: readonly Season[] = ['2016-17', '2017-18', '2018-19'];

const EXPECTED_PER_SEASON = 380;
const EXPECTED_TOTAL = EXPECTED_PER_SEASON * SEASONS.length;

/**
 * The single known disagreement between merged_gw and fixtures.csv.
 *
 * 2021-22 fixture 263: merged_gw says 15:00, fixtures.csv says 15:30. Teams,
 * round and score all agree; only the kickoff differs, by 30 minutes, in 1
 * fixture out of 3040. It affects nothing that gets inserted — 2021-22 comes
 * from the read path. See CLAUDE.md rule 14.
 *
 * Deliberately narrow. A diff on any other field, or a kickoff diff on any
 * other fixture, is a hard failure.
 */
const KNOWN_KICKOFF_DIFFS = [{ season: '2021-22', fpl_fixture_id: 263 }] as const;

// ---------------------------------------------------------------- parsing
// Same conventions as ingest-dimensions.ts.

/** A parsed CSV row. Every absent value is null, never '' and never 'None'. */
type Row = Record<string, string | null>;

/**
 * Rule 18: exactly the empty string and the literal 'None' become null.
 * Applied here even though both sources are verified clean, so the rule holds
 * uniformly across every ingest rather than per-file.
 */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'None') return null;
  return trimmed;
}

async function readCsv(path: string, encoding = 'utf-8'): Promise<Row[]> {
  const text = new TextDecoder(encoding).decode(await readFile(path));
  const records = parse(text, { columns: true, bom: true }) as Record<string, string>[];
  return records.map((record) => {
    const row: Row = {};
    for (const [key, value] of Object.entries(record)) row[key] = normalise(value);
    return row;
  });
}

function reqStr(row: Row, column: string, where: string): string {
  const value = row[column];
  if (value === null || value === undefined) {
    throw new Error(`${where}: required column '${column}' is empty`);
  }
  return value;
}

function reqInt(row: Row, column: string, where: string): number {
  const raw = reqStr(row, column, where);
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${where}: column '${column}' is not an integer: ${raw}`);
  }
  return value;
}

function optInt(row: Row, column: string): number | null {
  const raw = row[column];
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`column '${column}' is not an integer: ${raw}`);
  return value;
}

// ------------------------------------------------------------ build layer
// Pure: reads CSVs, produces rows, asserts. Season-scoped FPL team ids
// throughout; resolution to internal team_id happens in the write layer.

interface FixtureRow {
  season: Season;
  fpl_fixture_id: number;
  gw: number;
  home_fpl_team_id: number;
  away_fpl_team_id: number;
  kickoff_time: string;
  finished: boolean;
  home_score: number | null;
  away_score: number | null;
  home_difficulty: number | null;
  away_difficulty: number | null;
}

function gwPath(season: Season): string {
  return join(RAW_DIR, season, 'gws', 'merged_gw.csv');
}

function gwEncoding(season: Season): string {
  return LATIN1_GW_SEASONS.includes(season) ? 'latin1' : 'utf-8';
}

/** Read path: fixtures.csv, 2018-19 onward. */
async function readFixturesCsv(season: Season): Promise<FixtureRow[]> {
  const where = `${season}/fixtures.csv`;
  const rows = await readCsv(join(RAW_DIR, season, 'fixtures.csv'));
  return rows.map((r) => ({
    season,
    fpl_fixture_id: reqInt(r, 'id', where),
    gw: reqInt(r, 'event', where),
    home_fpl_team_id: reqInt(r, 'team_h', where),
    away_fpl_team_id: reqInt(r, 'team_a', where),
    kickoff_time: reqStr(r, 'kickoff_time', where),
    finished: reqStr(r, 'finished', where) === 'True',
    home_score: optInt(r, 'team_h_score'),
    away_score: optInt(r, 'team_a_score'),
    home_difficulty: optInt(r, 'team_h_difficulty'),
    away_difficulty: optInt(r, 'team_a_difficulty'),
  }));
}

/**
 * Derived path: reconstruct fixtures from merged_gw.csv.
 *
 * Home and away come from `was_home` + `opponent_team` and nothing else:
 *
 *   was_home = true  -> the player is the home side, so opponent_team is AWAY
 *   was_home = false -> the player is the away side, so opponent_team is HOME
 *
 * `players_raw.team` is deliberately NOT used. Rule 17 establishes that
 * players_raw.csv is an end-of-season snapshot, so a January transfer records
 * the player under his new club for fixtures he actually played for his old
 * one. That makes was_home + players_raw.team internally inconsistent on 32 to
 * 124 fixtures per season, correct only by majority vote — and majority voting
 * has no failure mode, it just silently picks whichever side has more rows.
 * opponent_team is a property of the match, not of the player, so no snapshot
 * staleness can reach it. See CLAUDE.md rule 14.
 *
 * Rule 12: a postponed fixture appears under both its original and its played
 * round. The group with the greatest kickoff_time is the real one, and carries
 * the real round and score.
 */
async function deriveFixtures(season: Season): Promise<FixtureRow[]> {
  const where = `${season}/gws/merged_gw.csv`;
  const rows = await readCsv(gwPath(season), gwEncoding(season));

  const homeSides = new Map<number, Set<number>>();
  const awaySides = new Map<number, Set<number>>();
  const latest = new Map<
    number,
    { kickoff: string; gw: number; home_score: number | null; away_score: number | null }
  >();

  for (const r of rows) {
    const fixture = reqInt(r, 'fixture', where);
    const opponent = reqInt(r, 'opponent_team', where);
    const wasHome = reqStr(r, 'was_home', where) === 'True';
    const kickoff = reqStr(r, 'kickoff_time', where);

    const side = wasHome ? awaySides : homeSides;
    let set = side.get(fixture);
    if (!set) side.set(fixture, (set = new Set()));
    set.add(opponent);

    const current = latest.get(fixture);
    if (!current || kickoff > current.kickoff) {
      latest.set(fixture, {
        kickoff,
        gw: reqInt(r, 'round', where),
        home_score: optInt(r, 'team_h_score'),
        away_score: optInt(r, 'team_a_score'),
      });
    }
  }

  const derived: FixtureRow[] = [];
  for (const [fixture, best] of [...latest.entries()].sort((a, b) => a[0] - b[0])) {
    // Hard failure, not a warning: each side must be exactly one team.
    const home = only(homeSides.get(fixture), season, fixture, 'home');
    const away = only(awaySides.get(fixture), season, fixture, 'away');
    derived.push({
      season,
      fpl_fixture_id: fixture,
      gw: best.gw,
      home_fpl_team_id: home,
      away_fpl_team_id: away,
      kickoff_time: best.kickoff,
      // Both derived seasons are complete, and merged_gw only ever contains
      // matches that were played.
      finished: true,
      home_score: best.home_score,
      away_score: best.away_score,
      // Rule 14: difficulty ratings do not exist without a fixtures.csv.
      home_difficulty: null,
      away_difficulty: null,
    });
  }
  return derived;
}

function only(set: Set<number> | undefined, season: string, fixture: number, side: string): number {
  if (!set || set.size !== 1) {
    throw new Error(
      `${season} fixture ${fixture}: ${side} side resolved to ` +
        `${set ? [...set].join('/') : 'nothing'} — expected exactly one team`
    );
  }
  return [...set][0];
}

// -------------------------------------------------------------- validation

const DIFF_FIELDS = [
  'home_fpl_team_id',
  'away_fpl_team_id',
  'home_score',
  'away_score',
  'gw',
  'kickoff_time',
] as const;

interface SeasonDiff {
  season: Season;
  derived: number;
  actual: number;
  diffs: number;
  allowed: number;
  detail: string[];
}

/**
 * Run the derived path against every season that also has a fixtures.csv and
 * diff the two. This is the justification for trusting the derivation on the
 * two seasons that have no second source, so it runs BEFORE the transaction
 * opens: a validation failure must write nothing at all.
 *
 * Comparing season-scoped FPL team ids is equivalent to comparing resolved
 * team_ids — resolution is a per-season bijection applied to both sides, so it
 * cancels out. That every id resolves is asserted separately in the write
 * layer.
 */
async function validate(): Promise<SeasonDiff[]> {
  assertAllowlistShape();

  const results: SeasonDiff[] = [];
  for (const season of SEASONS) {
    if (DERIVED_SEASONS.includes(season)) continue;

    const derived = new Map((await deriveFixtures(season)).map((f) => [f.fpl_fixture_id, f]));
    const actual = new Map((await readFixturesCsv(season)).map((f) => [f.fpl_fixture_id, f]));

    const detail: string[] = [];
    let diffs = 0;
    let allowed = 0;

    for (const id of new Set([...derived.keys(), ...actual.keys()])) {
      const d = derived.get(id);
      const a = actual.get(id);
      if (!d || !a) {
        diffs++;
        detail.push(`fixture ${id}: present in ${d ? 'merged_gw' : 'fixtures.csv'} only`);
        continue;
      }
      const bad = DIFF_FIELDS.filter((f) => d[f] !== a[f]);
      if (bad.length === 0) continue;

      const onlyKickoff = bad.length === 1 && bad[0] === 'kickoff_time';
      if (onlyKickoff && isKnownKickoffDiff(season, id)) {
        allowed++;
        continue;
      }
      diffs++;
      detail.push(
        `fixture ${id}: ${bad.map((f) => `${f} derived=${d[f]} csv=${a[f]}`).join(', ')}`
      );
    }
    results.push({ season, derived: derived.size, actual: actual.size, diffs, allowed, detail });
  }

  const failing = results.filter((r) => r.diffs > 0);
  if (failing.length > 0) {
    throw new Error(
      'derived path disagrees with fixtures.csv:\n' +
        failing
          .map((r) => `  ${r.season}: ${r.diffs} diff(s)\n${r.detail.map((d) => `    ${d}`).join('\n')}`)
          .join('\n')
    );
  }

  // The allowlist must be used. If upstream fixes the data the entry is stale
  // and should be deleted, so say so loudly rather than carrying it forever.
  const totalAllowed = results.reduce((n, r) => n + r.allowed, 0);
  if (totalAllowed !== KNOWN_KICKOFF_DIFFS.length) {
    throw new Error(
      `KNOWN_KICKOFF_DIFFS has ${KNOWN_KICKOFF_DIFFS.length} entry/entries but ${totalAllowed} ` +
        `were used — upstream data changed. Remove the stale entry.`
    );
  }
  return results;
}

function isKnownKickoffDiff(season: string, fixtureId: number): boolean {
  return KNOWN_KICKOFF_DIFFS.some(
    (k) => k.season === season && k.fpl_fixture_id === fixtureId
  );
}

/**
 * Pin the allowlist's exact contents, so a second discrepancy appearing later
 * has to be argued for rather than quietly appended.
 */
function assertAllowlistShape(): void {
  const expected = [{ season: '2021-22', fpl_fixture_id: 263 }];
  const actual = KNOWN_KICKOFF_DIFFS.map((k) => ({
    season: k.season as string,
    fpl_fixture_id: k.fpl_fixture_id as number,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `KNOWN_KICKOFF_DIFFS must contain exactly ${JSON.stringify(expected)}, ` +
        `found ${JSON.stringify(actual)}`
    );
  }
}

// ------------------------------------------------------------ write layer

/** Chunked so a multi-row INSERT never approaches the 65535 parameter cap. */
async function insertChunked(
  client: PoolClient,
  rows: unknown[][],
  columnsPerRow: number,
  sqlFor: (valuesClause: string) => string,
  chunkSize = 500
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valuesClause = chunk
      .map(
        (_, r) =>
          `(${Array.from({ length: columnsPerRow }, (_, c) => `$${r * columnsPerRow + c + 1}`).join(',')})`
      )
      .join(',');
    await client.query(sqlFor(valuesClause), chunk.flat());
  }
}

/**
 * Rule 2/4: team ids in both sources are season-scoped and are reassigned every
 * season. team_seasons holds the mapping; nothing raw is ever inserted.
 */
async function teamIdMap(client: PoolClient): Promise<Map<string, number>> {
  const { rows } = await client.query<{ season: string; fpl_team_id: number; team_id: number }>(
    'SELECT season, fpl_team_id, team_id FROM team_seasons'
  );
  if (rows.length !== 200) {
    throw new Error(
      `team_seasons has ${rows.length} rows, expected 200. ` +
        `Run 'npm run ingest:dimensions' first — step 4 depends on step 3.`
    );
  }
  return new Map(rows.map((r) => [`${r.season}:${r.fpl_team_id}`, r.team_id]));
}

async function write(client: PoolClient, fixtures: FixtureRow[]): Promise<void> {
  const teams = await teamIdMap(client);
  const resolve = (season: string, fplTeamId: number, side: string): number => {
    const id = teams.get(`${season}:${fplTeamId}`);
    if (id === undefined) {
      throw new Error(`${season}: no team_seasons row for ${side} fpl_team_id ${fplTeamId}`);
    }
    return id;
  };

  await insertChunked(
    client,
    fixtures.map((f) => [
      f.season,
      f.fpl_fixture_id,
      f.gw,
      resolve(f.season, f.home_fpl_team_id, 'home'),
      resolve(f.season, f.away_fpl_team_id, 'away'),
      f.kickoff_time,
      f.finished,
      f.home_score,
      f.away_score,
      f.home_difficulty,
      f.away_difficulty,
    ]),
    11,
    (v) => `INSERT INTO fixtures
              (season, fpl_fixture_id, gw, home_team_id, away_team_id, kickoff_time,
               finished, home_score, away_score, home_difficulty, away_difficulty)
            VALUES ${v}
            ON CONFLICT (season, fpl_fixture_id) DO UPDATE SET
              gw = EXCLUDED.gw,
              home_team_id = EXCLUDED.home_team_id,
              away_team_id = EXCLUDED.away_team_id,
              kickoff_time = EXCLUDED.kickoff_time,
              finished = EXCLUDED.finished,
              home_score = EXCLUDED.home_score,
              away_score = EXCLUDED.away_score,
              home_difficulty = EXCLUDED.home_difficulty,
              away_difficulty = EXCLUDED.away_difficulty`
  );
}

// ------------------------------------------------------------- assertions

async function scalar(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

async function assertDatabase(client: PoolClient): Promise<void> {
  const failures: string[] = [];
  const check = async (label: string, sql: string, expected = 0) => {
    const n = await scalar(client, sql);
    if (n !== expected) failures.push(`${label}: got ${n}, expected ${expected}`);
  };

  await check('fixtures total', 'SELECT count(*) AS n FROM fixtures', EXPECTED_TOTAL);
  await check(
    `seasons without exactly ${EXPECTED_PER_SEASON} fixtures`,
    `SELECT count(*) AS n FROM (
       SELECT season FROM fixtures GROUP BY season HAVING count(*) <> ${EXPECTED_PER_SEASON}
     ) x`
  );
  await check(
    'seasons present',
    'SELECT count(DISTINCT season) AS n FROM fixtures',
    SEASONS.length
  );
  await check(
    'rows where home_team_id = away_team_id',
    'SELECT count(*) AS n FROM fixtures WHERE home_team_id = away_team_id'
  );
  await check(
    'rows with only one score set',
    `SELECT count(*) AS n FROM fixtures
      WHERE (home_score IS NULL) <> (away_score IS NULL)`
  );
  await check('rows not finished', 'SELECT count(*) AS n FROM fixtures WHERE NOT finished');
  await check(
    'rows with difficulty on the wrong side of the fixtures.csv boundary',
    `SELECT count(*) AS n FROM fixtures
      WHERE (season IN ('2016-17','2017-18'))
            <> (home_difficulty IS NULL AND away_difficulty IS NULL)`
  );
  await check(
    'rows with exactly one difficulty set',
    `SELECT count(*) AS n FROM fixtures
      WHERE (home_difficulty IS NULL) <> (away_difficulty IS NULL)`
  );
  await check('rows with gw outside 1..47', 'SELECT count(*) AS n FROM fixtures WHERE gw < 1 OR gw > 47');
  await check(
    'team-seasons not playing exactly 19 home and 19 away',
    `SELECT count(*) AS n FROM (
       SELECT season, team_id
         FROM (SELECT season, home_team_id AS team_id, 1 AS h, 0 AS a FROM fixtures
               UNION ALL
               SELECT season, away_team_id,            0,      1      FROM fixtures) s
        GROUP BY season, team_id
       HAVING sum(h) <> 19 OR sum(a) <> 19
     ) x`
  );

  if (failures.length > 0) {
    throw new Error(`post-ingest assertions failed:\n  - ${failures.join('\n  - ')}`);
  }
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const started = Date.now();

  console.log('Validating the derived path against fixtures.csv...');
  const diffs = await validate();
  console.log(`  ${'season'.padEnd(9)} ${'derived'.padStart(7)} ${'csv'.padStart(5)} ${'diffs'.padStart(5)}  allowed`);
  for (const d of diffs) {
    console.log(
      `  ${d.season.padEnd(9)} ${String(d.derived).padStart(7)} ${String(d.actual).padStart(5)} ` +
        `${String(d.diffs).padStart(5)}  ${d.allowed}`
    );
  }
  console.log(
    `  All ${diffs.length} cross-checked seasons agree ` +
      `(${diffs.reduce((n, d) => n + d.allowed, 0)} known kickoff exception(s) allowed).`
  );

  console.log('Building fixture rows...');
  const fixtures: FixtureRow[] = [];
  for (const season of SEASONS) {
    const rows = DERIVED_SEASONS.includes(season)
      ? await deriveFixtures(season)
      : await readFixturesCsv(season);
    const source = DERIVED_SEASONS.includes(season) ? 'derived from merged_gw' : 'fixtures.csv';
    console.log(`  ${season}: ${rows.length} (${source})`);
    fixtures.push(...rows);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await write(client, fixtures);
    await assertDatabase(client);
    await client.query('COMMIT');
    console.log(
      `Committed ${fixtures.length} fixtures in ${((Date.now() - started) / 1000).toFixed(1)}s. ` +
        `All assertions passed.`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err: unknown) => {
    console.error(`\nIngest failed, rolled back. Nothing was written.\n${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(closePool);

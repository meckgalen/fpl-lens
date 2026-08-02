/**
 * Phase 0, step 3: dimension ingest.
 *
 * Populates `teams`, `team_seasons`, `players` and `player_seasons` from
 * `players_raw.csv` and `teams.csv`. Does not touch `fixtures` or
 * `player_gameweeks` — those are steps 4 and 5.
 *
 * Run: npm run ingest:dimensions
 *
 * Two properties this script must have, because everything downstream depends
 * on them:
 *
 *   1. Idempotent. It will be run many times. Re-running must not change a
 *      single surrogate id, because `fixtures` and `player_gameweeks` will
 *      carry those ids as foreign keys. That is why every write is an
 *      ON CONFLICT DO UPDATE upsert and never a delete-and-reinsert: deleting
 *      would renumber the identity columns and silently repoint every fact
 *      row at the wrong player, with no constraint violation to catch it.
 *
 *   2. All-or-nothing. One transaction, assertions inside it. A failed run
 *      leaves the database exactly as it was rather than half-populated.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { SEED_TEAMS } from './seed-teams.js';
import type { CsvRow } from '../types/wire.js';

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

/** Rule 10. Mapped once, here, and never from a `position` string. */
const POSITION_BY_ELEMENT_TYPE: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

/** Rule 11. Assistant Manager elements, 2024-25 only. Not players. */
const ASSISTANT_MANAGER_ELEMENT_TYPE = 5;

const STRENGTH_COLUMNS = [
  'strength_overall_home',
  'strength_overall_away',
  'strength_attack_home',
  'strength_attack_away',
  'strength_defence_home',
  'strength_defence_away',
] as const;

// ---------------------------------------------------------------- parsing

/**
 * A parsed CSV row: every absent value is null, never '' and never 'None'
 * (rule 18). Shared with the other two ingests — the normalisation contract
 * is identical for all three files, so the type recording it should be too.
 */
type Row = CsvRow;

/**
 * Normalise one raw CSV field.
 *
 * Exactly two things become null: the empty string, and the literal 'None'
 * (which is a Python None serialised by the upstream scraper — it appears in
 * `birth_date` for 162 rows in 2024-25 and 19 in 2025-26).
 *
 * Deliberately NOT normalised: '-', 'null', 'NULL', 'nan', 'NaN' and
 * lowercase 'none'. None of them occur anywhere in these two files across all
 * ten seasons, and '-' in particular could be a legitimate value in a name
 * field. Widening this list would be guessing rather than matching the data.
 */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'None') return null;
  return trimmed;
}

/**
 * `players_raw.csv` and `teams.csv` are UTF-8 in all ten seasons. Only
 * `merged_gw.csv` is latin1 for the early ones, and it is not read here.
 */
async function readCsv(path: string): Promise<Row[]> {
  const text = new TextDecoder('utf-8').decode(await readFile(path));
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

function optStr(row: Row, column: string): string | null {
  return row[column] ?? null;
}

// ------------------------------------------------------------ build layer
// Everything below is pure: it reads CSVs and produces the exact row sets to
// be written, asserting as it goes. Nothing touches the database.

interface TeamRow {
  fpl_team_code: number;
  name: string;
  short_name: string;
}

interface TeamSeasonRow {
  fpl_team_code: number;
  season: string;
  fpl_team_id: number;
  strengths: (number | null)[];
}

interface PlayerRow {
  fpl_code: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  opta_code: string | null;
  birth_date: string | null;
}

interface PlayerSeasonRow {
  fpl_code: number;
  season: string;
  fpl_element_id: number;
  fpl_team_code: number;
  position: string;
  start_cost: number;
  end_cost: number;
}

interface Built {
  teams: TeamRow[];
  teamSeasons: TeamSeasonRow[];
  players: PlayerRow[];
  playerSeasons: PlayerSeasonRow[];
  managerCodes: Set<number>;
}

async function build(): Promise<Built> {
  // Seasons are walked oldest to newest throughout, so "last write wins"
  // naturally means "latest season wins".
  const teamNames = new Map<number, TeamRow>();
  const teamSeasons: TeamSeasonRow[] = [];
  const players = new Map<number, PlayerRow>();
  const playerSeasons: PlayerSeasonRow[] = [];
  const managerCodes = new Set<number>();

  // Tracks non-null birth_date / opta_code per player so a genuine
  // cross-season disagreement can be caught rather than silently coalesced.
  const seenImmutable = new Map<number, { birth_date?: string; opta_code?: string }>();

  for (const season of SEASONS) {
    const playersRaw = await readCsv(join(RAW_DIR, season, 'players_raw.csv'));
    const where = `${season}/players_raw.csv`;

    // --- team_seasons + team identity ------------------------------------
    // Every season's season-scoped team id mapping is derivable from
    // players_raw alone (rule 15). teams.csv, where it exists, adds names and
    // strengths.
    const fromPlayers = new Map<number, number>(); // team_code -> season team id
    for (const row of playersRaw) {
      fromPlayers.set(reqInt(row, 'team_code', where), reqInt(row, 'team', where));
    }

    let teamsCsv: Row[] | null = null;
    try {
      teamsCsv = await readCsv(join(RAW_DIR, season, 'teams.csv'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      teamsCsv = null; // 2016-17..2018-19: not published upstream
    }

    if (teamsCsv) {
      const tWhere = `${season}/teams.csv`;
      const fromTeams = new Map<number, number>();
      for (const row of teamsCsv) {
        const code = reqInt(row, 'code', tWhere);
        const id = reqInt(row, 'id', tWhere);
        fromTeams.set(code, id);
        teamNames.set(code, {
          fpl_team_code: code,
          name: reqStr(row, 'name', tWhere),
          short_name: reqStr(row, 'short_name', tWhere),
        });
        teamSeasons.push({
          fpl_team_code: code,
          season,
          fpl_team_id: id,
          strengths: STRENGTH_COLUMNS.map((c) => {
            const v = optStr(row, c);
            return v === null ? null : Number(v);
          }),
        });
      }
      // Tripwire: the two sources must describe the same 20 clubs with the
      // same season-scoped ids. Verified true for all 7 seasons that have
      // both; a mismatch means upstream drifted and the mapping is unsafe.
      assertSameMapping(season, fromTeams, fromPlayers);
    } else {
      for (const [code, id] of fromPlayers) {
        teamSeasons.push({
          fpl_team_code: code,
          season,
          fpl_team_id: id,
          strengths: STRENGTH_COLUMNS.map(() => null), // rule 15
        });
      }
    }

    // --- players + player_seasons ----------------------------------------
    for (const row of playersRaw) {
      const elementType = reqInt(row, 'element_type', where);
      const code = reqInt(row, 'code', where);

      if (elementType === ASSISTANT_MANAGER_ELEMENT_TYPE) {
        managerCodes.add(code); // rule 11: not a player, never inserted
        continue;
      }

      const position = POSITION_BY_ELEMENT_TYPE[elementType];
      if (!position) {
        throw new Error(`${where}: unknown element_type ${elementType} for code ${code}`);
      }

      const optaCode = optStr(row, 'opta_code');
      const birthDate = optStr(row, 'birth_date');
      assertImmutableStable(seenImmutable, code, season, 'birth_date', birthDate);
      assertImmutableStable(seenImmutable, code, season, 'opta_code', optaCode);

      const previous = players.get(code);
      players.set(code, {
        fpl_code: code,
        // Names: strict latest-wins. A rename should win.
        first_name: optStr(row, 'first_name'),
        second_name: optStr(row, 'second_name'),
        web_name: reqStr(row, 'web_name', where),
        // opta_code and birth_date: latest NON-NULL. These two only exist in
        // 2024-25 and 2025-26, and a player present in both can be missing
        // from the newer one. Strict latest-wins discards 10 known birth
        // dates; coalescing recovers them, and the assertion above guarantees
        // there is never a real conflict to resolve.
        opta_code: optaCode ?? previous?.opta_code ?? null,
        birth_date: birthDate ?? previous?.birth_date ?? null,
      });

      const nowCost = reqInt(row, 'now_cost', where);
      playerSeasons.push({
        fpl_code: code,
        season,
        fpl_element_id: reqInt(row, 'id', where),
        fpl_team_code: reqInt(row, 'team_code', where),
        position,
        // Rule 9: raw £0.1m units. cost_change_start is the movement since
        // the season opened, negative when the price fell.
        start_cost: nowCost - reqInt(row, 'cost_change_start', where),
        end_cost: nowCost,
      });
    }
  }

  // --- resolve team names, including the hand-seeded six -------------------
  const allCodes = new Set<number>(teamSeasons.map((t) => t.fpl_team_code));
  const usedSeeds = new Set<number>();
  const teams: TeamRow[] = [];
  for (const code of [...allCodes].sort((a, b) => a - b)) {
    const named = teamNames.get(code);
    if (named) {
      teams.push(named);
      continue;
    }
    const seed = SEED_TEAMS[code];
    if (!seed) {
      throw new Error(
        `team_code ${code} has no teams.csv row in any season and no entry in seed-teams.ts`
      );
    }
    usedSeeds.add(code);
    teams.push({ fpl_team_code: code, ...seed });
  }
  const unusedSeeds = Object.keys(SEED_TEAMS)
    .map(Number)
    .filter((c) => !usedSeeds.has(c));
  if (unusedSeeds.length > 0) {
    throw new Error(
      `seed-teams.ts has unused entries [${unusedSeeds}] — upstream now publishes a ` +
        `teams.csv row for them, which should be preferred. Remove them from the seed.`
    );
  }

  return { teams, teamSeasons, players: [...players.values()], playerSeasons, managerCodes };
}

function assertSameMapping(
  season: string,
  fromTeams: Map<number, number>,
  fromPlayers: Map<number, number>
): void {
  const disagree: string[] = [];
  for (const [code, id] of fromTeams) {
    if (fromPlayers.get(code) !== id) disagree.push(`code ${code}: teams.csv=${id} players_raw=${fromPlayers.get(code)}`);
  }
  for (const code of fromPlayers.keys()) {
    if (!fromTeams.has(code)) disagree.push(`code ${code}: in players_raw but not teams.csv`);
  }
  if (disagree.length > 0) {
    throw new Error(`${season}: teams.csv and players_raw disagree — ${disagree.join('; ')}`);
  }
}

/**
 * birth_date and opta_code are immutable facts about a person. If two seasons
 * carry different non-null values for the same code, one of them is wrong and
 * coalescing would silently pick a winner. Fail instead.
 *
 * This has to run here, at merge time. After the coalesce the losing value no
 * longer exists, so no post-insert SQL check could ever see it.
 */
function assertImmutableStable(
  seen: Map<number, { birth_date?: string; opta_code?: string }>,
  code: number,
  season: string,
  field: 'birth_date' | 'opta_code',
  value: string | null
): void {
  if (value === null) return;
  const entry = seen.get(code) ?? {};
  const previous = entry[field];
  if (previous !== undefined && previous !== value) {
    throw new Error(
      `player code ${code}: ${field} disagrees across seasons — ` +
        `'${previous}' then '${value}' in ${season}`
    );
  }
  entry[field] = value;
  seen.set(code, entry);
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

async function idMap(
  client: PoolClient,
  table: string,
  codeColumn: string
): Promise<Map<number, number>> {
  const { rows } = await client.query<{ id: number; code: number }>(
    `SELECT id, ${codeColumn} AS code FROM ${table}`
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function write(client: PoolClient, built: Built): Promise<void> {
  // --- teams -------------------------------------------------------------
  await insertChunked(
    client,
    built.teams.map((t) => [t.fpl_team_code, t.name, t.short_name]),
    3,
    (v) => `INSERT INTO teams (fpl_team_code, name, short_name) VALUES ${v}
            ON CONFLICT (fpl_team_code) DO UPDATE
            SET name = EXCLUDED.name, short_name = EXCLUDED.short_name`
  );
  const teamIdByCode = await idMap(client, 'teams', 'fpl_team_code');

  // --- team_seasons ------------------------------------------------------
  await insertChunked(
    client,
    built.teamSeasons.map((ts) => {
      const teamId = teamIdByCode.get(ts.fpl_team_code);
      if (!teamId) throw new Error(`unresolved team_code ${ts.fpl_team_code}`);
      return [teamId, ts.season, ts.fpl_team_id, ...ts.strengths];
    }),
    3 + STRENGTH_COLUMNS.length,
    (v) => `INSERT INTO team_seasons
              (team_id, season, fpl_team_id, ${STRENGTH_COLUMNS.join(', ')})
            VALUES ${v}
            ON CONFLICT (team_id, season) DO UPDATE SET
              fpl_team_id = EXCLUDED.fpl_team_id,
              ${STRENGTH_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
  );

  // --- players -----------------------------------------------------------
  await insertChunked(
    client,
    built.players.map((p) => [
      p.fpl_code,
      p.opta_code,
      p.first_name,
      p.second_name,
      p.web_name,
      p.birth_date,
    ]),
    6,
    (v) => `INSERT INTO players
              (fpl_code, opta_code, first_name, second_name, web_name, birth_date)
            VALUES ${v}
            ON CONFLICT (fpl_code) DO UPDATE SET
              opta_code = EXCLUDED.opta_code,
              first_name = EXCLUDED.first_name,
              second_name = EXCLUDED.second_name,
              web_name = EXCLUDED.web_name,
              birth_date = EXCLUDED.birth_date`
  );
  const playerIdByCode = await idMap(client, 'players', 'fpl_code');

  // --- player_seasons ----------------------------------------------------
  await insertChunked(
    client,
    built.playerSeasons.map((ps) => {
      const playerId = playerIdByCode.get(ps.fpl_code);
      if (!playerId) throw new Error(`unresolved player code ${ps.fpl_code}`);
      const teamId = teamIdByCode.get(ps.fpl_team_code);
      if (!teamId) throw new Error(`unresolved team_code ${ps.fpl_team_code}`);
      return [playerId, ps.season, ps.fpl_element_id, teamId, ps.position, ps.start_cost, ps.end_cost];
    }),
    7,
    (v) => `INSERT INTO player_seasons
              (player_id, season, fpl_element_id, team_id, position, start_cost, end_cost)
            VALUES ${v}
            ON CONFLICT (player_id, season) DO UPDATE SET
              fpl_element_id = EXCLUDED.fpl_element_id,
              team_id = EXCLUDED.team_id,
              position = EXCLUDED.position,
              start_cost = EXCLUDED.start_cost,
              end_cost = EXCLUDED.end_cost`
  );
}

// ------------------------------------------------------------- assertions

const EXPECTED = {
  teams: 34,
  team_seasons: 200,
  players: 2623,
  player_seasons: 7338,
} as const;

async function scalar(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

async function assertDatabase(client: PoolClient, built: Built): Promise<void> {
  const failures: string[] = [];

  for (const [table, expected] of Object.entries(EXPECTED)) {
    const actual = await scalar(client, `SELECT count(*) AS n FROM ${table}`);
    if (actual !== expected) failures.push(`${table}: expected ${expected}, got ${actual}`);
  }

  const badSeasons = await client.query<{ season: string; n: string }>(
    `SELECT season, count(*) AS n FROM team_seasons GROUP BY season HAVING count(*) <> 20`
  );
  for (const r of badSeasons.rows) failures.push(`team_seasons ${r.season}: ${r.n} rows, expected 20`);

  const seasonCount = await scalar(client, `SELECT count(DISTINCT season) AS n FROM team_seasons`);
  if (seasonCount !== SEASONS.length) {
    failures.push(`team_seasons covers ${seasonCount} seasons, expected ${SEASONS.length}`);
  }

  // The 'None' sentinel must never survive into a text column.
  const noneRows = await scalar(
    client,
    `SELECT (
       (SELECT count(*) FROM players
         WHERE 'None' IN (first_name, second_name, web_name, opta_code))
     + (SELECT count(*) FROM teams WHERE 'None' IN (name, short_name))
     ) AS n`
  );
  if (noneRows !== 0) failures.push(`${noneRows} row(s) contain the literal 'None'`);

  // Rule 11: no Assistant Manager code may have landed in players.
  if (built.managerCodes.size > 0) {
    const leaked = await scalar(
      client,
      `SELECT count(*) AS n FROM players WHERE fpl_code = ANY($1::int[])`,
      [[...built.managerCodes]]
    );
    if (leaked !== 0) failures.push(`${leaked} Assistant Manager code(s) leaked into players`);
  }

  // Rule 10. The CHECK constraint already enforces this; belt and braces.
  const badPositions = await scalar(
    client,
    `SELECT count(*) AS n FROM player_seasons WHERE position NOT IN ('GK','DEF','MID','FWD')`
  );
  if (badPositions !== 0) failures.push(`${badPositions} player_seasons row(s) have a bad position`);

  if (failures.length > 0) {
    throw new Error(`post-ingest assertions failed:\n  - ${failures.join('\n  - ')}`);
  }
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const started = Date.now();
  console.log('Building dimension rows from CSVs...');
  const built = await build();
  console.log(
    `  teams=${built.teams.length} team_seasons=${built.teamSeasons.length} ` +
      `players=${built.players.length} player_seasons=${built.playerSeasons.length} ` +
      `(excluded ${built.managerCodes.size} Assistant Manager elements)`
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await write(client, built);
    await assertDatabase(client, built);
    await client.query('COMMIT');
    console.log(`Committed in ${((Date.now() - started) / 1000).toFixed(1)}s. All assertions passed.`);
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

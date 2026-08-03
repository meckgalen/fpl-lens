/**
 * Phase 0, step 5: fact ingest.
 *
 * Populates `player_gameweeks` from `gws/merged_gw.csv` for all ten seasons —
 * 253,509 rows. Does not touch any other table.
 *
 * Run: npm run ingest:gameweeks
 *      (requires ingest:dimensions AND ingest:fixtures to have run)
 *
 * This is the step where an ingest silently drops rows, so every row that does
 * not survive has to be accounted for by name and by count:
 *
 *   - 322 rows in 2024-25 are Assistant Manager elements (rule 11). Excluded by
 *     element_type from players_raw.csv, cross-checked against the 'AM' position
 *     string in the gameweek file.
 *   - 59 rows in 2019-20 are the postponed Man City v Arsenal fixture 275,
 *     recorded once under round 29 with 0 minutes and again under round 39 with
 *     the real result (rule 12). The round-39 row wins.
 *   - 10 rows in 2025-26 are byte-identical duplicates belonging to two players
 *     whose display name changed mid-season (rule 12).
 *
 * Nothing else is dropped. Every element, fixture and opponent_team must
 * resolve through the season maps; an unresolved value throws rather than
 * skipping a row.
 *
 * Loading goes through COPY into a temp staging table, then one
 * INSERT ... ON CONFLICT DO UPDATE. Never delete-and-reinsert: `players.id` and
 * `fixtures.id` are foreign key targets, and renumbering them would repoint
 * every fact row at the wrong player with no constraint violation to catch it.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type { PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { pool, closePool } from '../db/pool.js';
import {
  ALL_COLUMNS,
  INT_COLUMNS,
  NULLABLE_INT_COLUMNS,
  NULLABLE_NUM_COLUMNS,
  NUM_COLUMNS,
  UPDATABLE_COLUMNS,
} from './gameweek-columns.js';
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

type Season = (typeof SEASONS)[number];

/** merged_gw.csv is latin1 for these; UTF-8 afterwards. Same as step 4. */
const LATIN1_GW_SEASONS: readonly Season[] = ['2016-17', '2017-18', '2018-19'];

/** Rule 11. Assistant Manager elements, 2024-25 only. Not players. */
const ASSISTANT_MANAGER_ELEMENT_TYPE = '5';

/** The position string those elements carry in the gameweek file. */
const ASSISTANT_MANAGER_POSITION = 'AM';

// ------------------------------------------------------------ expectations
// Every number below was verified against the raw CSVs before this script was
// written. They are pinned rather than computed so that an upstream data change
// fails the ingest instead of being silently absorbed into a new total.

const EXPECTED_ROWS: Record<Season, number> = {
  '2016-17': 23679,
  '2017-18': 22467,
  '2018-19': 21790,
  '2019-20': 22501,
  '2020-21': 24365,
  '2021-22': 25447,
  '2022-23': 26505,
  '2023-24': 29725,
  '2024-25': 27283,
  '2025-26': 29747,
};

const EXPECTED_TOTAL = Object.values(EXPECTED_ROWS).reduce((a, b) => a + b, 0); // 253509

/** Rule 11. Rows dropped because the element is an Assistant Manager. */
const EXPECTED_MANAGER_ROWS: Partial<Record<Season, number>> = { '2024-25': 322 };

/** Rule 12. Rows dropped as the losing half of an (element, fixture) pair. */
const EXPECTED_DUPLICATE_ROWS: Partial<Record<Season, number>> = {
  '2019-20': 59,
  '2025-26': 10,
};

/**
 * 2019-20 ran to round 47 after the Covid suspension. Pinning the count of
 * post-38 rows pins the rule 12 tiebreak: take the round-29 placeholder instead
 * of the round-39 result and this number collapses.
 */
const EXPECTED_GW_OVER_38 = 6004;

/** Every season is 380 matches, and every match must have rows. */
const EXPECTED_FIXTURES_PER_SEASON = 380;

/**
 * 380 matches x 2 sides x 11 players x 90 minutes. Nobody ever hits it —
 * red cards leave a side short and stoppage time is not counted — so this is a
 * band, not a number. Observed shortfall across the ten seasons is 0.13% to
 * 0.52%. More than 1% below is row loss that the pinned counts above cannot
 * catch, because they and the ingest share their derivation.
 */
const IDEAL_MINUTES_PER_SEASON = 380 * 2 * 11 * 90;
const MINUTES_TOLERANCE = 0.01;

// ---------------------------------------------------------------- columns
// The groups drive both the CSV read and the COPY, so the two cannot drift.
//
// They live in ./gameweek-columns.ts since item 5, because this is no longer
// the only writer of player_gameweeks: ingest-live-gameweeks.ts loads the live
// season into the same table, and one table with two private column lists is
// how a stat gets stored by one path and silently dropped by the other.
const COPY_COLUMNS = ALL_COLUMNS;

/**
 * Columns in merged_gw.csv that deliberately get no column, so that a reader
 * asking "where did x go?" finds the answer here rather than by elimination.
 *
 *   xP                     rule 7  — scraped post-match, carries lookahead bias
 *   mng_*                  rule 11 — Assistant Manager chip, 2024-25 only
 *   ea_index               rule 16 — 0 in all 67,936 rows it appears in
 *   element, round,        resolved into player_id, gw, fixture_id and
 *   fixture, opponent_team opponent_team_id — the raw ids are season-scoped
 *   GW                     the gws/ file the row was merged from, not the round
 *                          it was played in. `round` is the one rule 12 means,
 *                          and it is the one that matches fixtures.csv.event in
 *                          every row of every season that has both.
 *   team_h_score,          properties of the fixture, already on `fixtures`
 *   team_a_score
 *   name, position, team   season-level attributes, already on player_seasons
 *   modified,              upstream scraper bookkeeping, not a measurement
 *   transfers_balance      derivable from transfers_in - transfers_out
 *   id, kickoff_time,      not facts about the performance
 *   kickoff_time_formatted
 *   loaned_in, loaned_out  always 0 where present
 */
const EXCLUDED_CSV_COLUMNS = new Set([
  'xP',
  'mng_clean_sheets',
  'mng_draw',
  'mng_goals_scored',
  'mng_loss',
  'mng_underdog_draw',
  'mng_underdog_win',
  'mng_win',
  'ea_index',
  'element',
  'round',
  'GW',
  'fixture',
  'opponent_team',
  'team_h_score',
  'team_a_score',
  'name',
  'position',
  'team',
  'modified',
  'transfers_balance',
  'id',
  'kickoff_time',
  'kickoff_time_formatted',
  'loaned_in',
  'loaned_out',
]);

// ---------------------------------------------------------------- parsing
// Same conventions as ingest-dimensions.ts and ingest-fixtures.ts.

/**
 * A parsed CSV row: every absent value is null, never '' and never 'None'
 * (rule 18). Shared with the other two ingests — the normalisation contract
 * is identical for all three files, so the type recording it should be too.
 */
type Row = CsvRow;

/**
 * Rule 18: exactly the empty string and the literal 'None' become null.
 * merged_gw.csv is verified free of both, in every season; applied anyway so
 * the rule holds uniformly across every ingest rather than per-file.
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

function gwPath(season: Season): string {
  return join(RAW_DIR, season, 'gws', 'merged_gw.csv');
}

function gwEncoding(season: Season): string {
  return LATIN1_GW_SEASONS.includes(season) ? 'latin1' : 'utf-8';
}

// ------------------------------------------------------------ COPY encoding
// Text format. Values here are only integers, decimals, booleans and the season
// literal, so nothing needs escaping — but that is asserted rather than assumed,
// because a stray tab or backslash would shift every later field by one column
// and COPY would report it as a type error in an unrelated place.

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const COPY_UNSAFE = /[\t\n\r\\]/;

/** COPY text format's NULL. The one value allowed to carry a backslash. */
const COPY_NULL = '\\N';

function copyInt(row: Row, column: string, where: string): string {
  return String(reqInt(row, column, where));
}

function copyNum(row: Row, column: string, where: string): string {
  const raw = reqStr(row, column, where);
  if (!DECIMAL.test(raw)) {
    throw new Error(`${where}: column '${column}' is not a decimal: ${raw}`);
  }
  return raw;
}

/**
 * Rule 6. A column the season does not have is NULL, never 0: zero means
 * "generated no chances", NULL means "not measured". `present` is taken from
 * the file's own header, so a column upstream starts publishing is picked up
 * rather than nulled by a stale hardcoded list.
 */
function copyOptional(
  row: Row,
  column: string,
  present: boolean,
  pattern: RegExp,
  where: string
): string {
  if (!present) return COPY_NULL;
  const raw = row[column];
  if (raw === null || raw === undefined) return COPY_NULL;
  if (!pattern.test(raw)) {
    throw new Error(`${where}: column '${column}' is malformed: ${raw}`);
  }
  return raw;
}

// ------------------------------------------------------------- resolution
// Rule 2: element ids and team ids are season-scoped and reassigned every
// season. Nothing raw is ever stored, and nothing joins across seasons.

interface Maps {
  players: Map<string, number>; // `${season}:${fpl_element_id}` -> player_id
  fixtures: Map<string, number>; // `${season}:${fpl_fixture_id}` -> fixture_id
  teams: Map<string, number>; // `${season}:${fpl_team_id}` -> team_id
}

const REQUIRED_PLAYER_SEASONS = 7338;
const REQUIRED_FIXTURES = 3800;
const REQUIRED_TEAM_SEASONS = 200;

/**
 * All three queries are scoped to the ten CSV seasons, and both effects are
 * wanted. The counts stay exact — they are preconditions saying "the two
 * scripts before this one have run", and a lower bound would pass on a
 * half-populated dimension table. And the maps only ever need to resolve ids
 * for the seasons this script reads, so an eleventh season from the live ingest
 * has no business being in them.
 */
async function loadMaps(client: PoolClient): Promise<Maps> {
  const csvSeasons = [...SEASONS];

  const playerSeasons = await client.query<{
    season: string;
    fpl_element_id: number;
    player_id: number;
  }>('SELECT season, fpl_element_id, player_id FROM player_seasons WHERE season = ANY($1)', [
    csvSeasons,
  ]);
  requireRows(playerSeasons.rowCount ?? 0, REQUIRED_PLAYER_SEASONS, 'player_seasons', 'dimensions');

  const fixtures = await client.query<{ season: string; fpl_fixture_id: number; id: number }>(
    'SELECT season, fpl_fixture_id, id FROM fixtures WHERE season = ANY($1)',
    [csvSeasons]
  );
  requireRows(fixtures.rowCount ?? 0, REQUIRED_FIXTURES, 'fixtures', 'fixtures');

  const teamSeasons = await client.query<{ season: string; fpl_team_id: number; team_id: number }>(
    'SELECT season, fpl_team_id, team_id FROM team_seasons WHERE season = ANY($1)',
    [csvSeasons]
  );
  requireRows(teamSeasons.rowCount ?? 0, REQUIRED_TEAM_SEASONS, 'team_seasons', 'dimensions');

  return {
    players: new Map(playerSeasons.rows.map((r) => [`${r.season}:${r.fpl_element_id}`, r.player_id])),
    fixtures: new Map(fixtures.rows.map((r) => [`${r.season}:${r.fpl_fixture_id}`, r.id])),
    teams: new Map(teamSeasons.rows.map((r) => [`${r.season}:${r.fpl_team_id}`, r.team_id])),
  };
}

function requireRows(actual: number, expected: number, table: string, script: string): void {
  if (actual !== expected) {
    throw new Error(
      `${table} has ${actual} rows, expected ${expected}. ` +
        `Run 'npm run ingest:${script}' first — step 5 depends on it.`
    );
  }
}

function resolve(map: Map<string, number>, season: string, id: number, what: string): number {
  const resolved = map.get(`${season}:${id}`);
  if (resolved === undefined) {
    // Never a skipped row. An id that does not resolve means the dimension
    // tables and the gameweek file disagree, and guessing past that is how a
    // player's history ends up attached to somebody else.
    throw new Error(
      `${season}: ${what} ${id} does not resolve. The dimension tables and ` +
        `merged_gw.csv disagree; re-run ingest:dimensions and ingest:fixtures.`
    );
  }
  return resolved;
}

// ------------------------------------------------------------ build layer

interface SeasonBuild {
  season: Season;
  lines: string[];
  built: number;
  managerRows: number;
  duplicateRows: number;
  minutes: number;
  fixtures: number;
}

/**
 * Read one season, exclude, dedup, resolve, and encode to COPY text lines.
 *
 * Done a season at a time so peak memory is one file rather than all ten.
 */
async function buildSeason(season: Season, maps: Maps, managerCodes: Set<number>): Promise<SeasonBuild> {
  const where = `${season}/gws/merged_gw.csv`;

  // --- rule 11: which elements are Assistant Managers, not players ---------
  const playersRaw = await readCsv(join(RAW_DIR, season, 'players_raw.csv'));
  const managerElements = new Set<number>();
  for (const row of playersRaw) {
    if (row['element_type'] === ASSISTANT_MANAGER_ELEMENT_TYPE) {
      managerElements.add(reqInt(row, 'id', `${season}/players_raw.csv`));
      managerCodes.add(reqInt(row, 'code', `${season}/players_raw.csv`));
    }
  }

  const rows = await readCsv(gwPath(season), gwEncoding(season));
  if (rows.length === 0) throw new Error(`${where}: no rows`);

  // Column presence comes from this file's own header (rule 6).
  const header = new Set(Object.keys(rows[0]));
  const unknown = [...header].filter(
    (c) => !EXCLUDED_CSV_COLUMNS.has(c) && !(COPY_COLUMNS as readonly string[]).includes(c)
  );
  if (unknown.length > 0) {
    throw new Error(
      `${where}: unrecognised column(s) [${unknown.join(', ')}]. Upstream added a ` +
        `field — decide whether it is a stat worth storing before ingesting it.`
    );
  }

  // --- exclude managers ----------------------------------------------------
  const kept: Row[] = [];
  let managerRows = 0;
  for (const row of rows) {
    if (managerElements.has(reqInt(row, 'element', where))) {
      managerRows++;
      // Cross-check two independent signals. players_raw.element_type is the
      // authority (rule 10), but if the gameweek file's own position string
      // disagrees then one of the two files is not describing what we think.
      if (header.has('position') && row['position'] !== ASSISTANT_MANAGER_POSITION) {
        throw new Error(
          `${where}: element ${row['element']} is element_type 5 in players_raw ` +
            `but position '${row['position']}' here, expected '${ASSISTANT_MANAGER_POSITION}'`
        );
      }
      continue;
    }
    if (header.has('position') && row['position'] === ASSISTANT_MANAGER_POSITION) {
      throw new Error(
        `${where}: element ${row['element']} has position 'AM' but is not ` +
          `element_type 5 in players_raw — the manager exclusion would miss it`
      );
    }
    kept.push(row);
  }

  // --- rule 12: dedup (element, fixture), greatest kickoff_time wins --------
  const survivors = new Map<string, Row>();
  for (const row of kept) {
    const key = `${reqInt(row, 'element', where)}:${reqInt(row, 'fixture', where)}`;
    const kickoff = reqStr(row, 'kickoff_time', where);
    const current = survivors.get(key);
    // Strictly greater: the first row wins a tie, which is what the ten
    // byte-identical 2025-26 duplicates need and the only case where a tie
    // occurs at all.
    if (!current || kickoff > reqStr(current, 'kickoff_time', where)) survivors.set(key, row);
  }
  const duplicateRows = kept.length - survivors.size;

  // --- encode --------------------------------------------------------------
  const present = (column: string): boolean => header.has(column);
  const lines: string[] = [];
  let minutes = 0;
  const fixtureIds = new Set<number>();

  for (const row of survivors.values()) {
    const fplElementId = reqInt(row, 'element', where);
    const fplFixtureId = reqInt(row, 'fixture', where);
    const fplOpponentId = reqInt(row, 'opponent_team', where);

    const fixtureId = resolve(maps.fixtures, season, fplFixtureId, 'fixture');
    fixtureIds.add(fixtureId);
    minutes += reqInt(row, 'minutes', where);

    const values: string[] = [
      String(resolve(maps.players, season, fplElementId, 'element')),
      String(fixtureId),
      season,
      // Rule 12: the round the match was actually played in, taken from the
      // surviving row rather than from the earliest one.
      copyInt(row, 'round', where),
      reqStr(row, 'was_home', where) === 'True' ? 't' : 'f',
      // Rule 5: never the raw season-scoped opponent id.
      String(resolve(maps.teams, season, fplOpponentId, 'opponent_team')),
      ...INT_COLUMNS.map((c) => copyInt(row, c, where)),
      ...NUM_COLUMNS.map((c) => copyNum(row, c, where)),
      ...NULLABLE_INT_COLUMNS.map((c) => copyOptional(row, c, present(c), INTEGER, where)),
      ...NULLABLE_NUM_COLUMNS.map((c) => copyOptional(row, c, present(c), DECIMAL, where)),
    ];

    const unsafe = values.findIndex((v) => v !== COPY_NULL && COPY_UNSAFE.test(v));
    if (unsafe !== -1) {
      throw new Error(
        `${where}: value for '${COPY_COLUMNS[unsafe]}' needs COPY escaping: ${JSON.stringify(values[unsafe])}`
      );
    }
    lines.push(values.join('\t'));
  }

  // --- assert this season before any of it is written ----------------------
  const failures: string[] = [];
  const expect = (label: string, actual: number, expected: number) => {
    if (actual !== expected) failures.push(`${label}: got ${actual}, expected ${expected}`);
  };
  expect('rows built', lines.length, EXPECTED_ROWS[season]);
  expect('Assistant Manager rows excluded', managerRows, EXPECTED_MANAGER_ROWS[season] ?? 0);
  expect('duplicate rows deduped', duplicateRows, EXPECTED_DUPLICATE_ROWS[season] ?? 0);
  expect('distinct fixtures', fixtureIds.size, EXPECTED_FIXTURES_PER_SEASON);
  if (failures.length > 0) {
    throw new Error(`${season}: build assertions failed:\n  - ${failures.join('\n  - ')}`);
  }

  return {
    season,
    lines,
    built: lines.length,
    managerRows,
    duplicateRows,
    minutes,
    fixtures: fixtureIds.size,
  };
}

// ------------------------------------------------------------ write layer

const STAGE = 'stage_player_gameweeks';

/**
 * LIKE copies the column types and their NOT NULL constraints but no primary
 * key, check or index — which is exactly what a staging table wants. A NULL in
 * a stat that is meant to be present still fails here, during COPY, rather than
 * reaching the real table.
 */
async function createStage(client: PoolClient): Promise<void> {
  await client.query(`CREATE TEMP TABLE ${STAGE} (LIKE player_gameweeks) ON COMMIT DROP`);
}

async function copySeason(client: PoolClient, lines: string[]): Promise<void> {
  const stream = client.query(
    copyFrom(`COPY ${STAGE} (${COPY_COLUMNS.join(', ')}) FROM STDIN`)
  );
  // Batched so the write side sees a few large chunks rather than 25k tiny ones.
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += 2000) {
    chunks.push(lines.slice(i, i + 2000).join('\n') + '\n');
  }
  await pipeline(Readable.from(chunks), stream);
}

async function insertFromStage(client: PoolClient): Promise<number> {
  const columns = COPY_COLUMNS.join(', ');
  const result = await client.query(
    `INSERT INTO player_gameweeks (${columns})
     SELECT ${columns} FROM ${STAGE}
     ON CONFLICT (player_id, fixture_id) DO UPDATE SET
       ${UPDATABLE_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(',\n       ')}`
  );
  return result.rowCount ?? 0;
}

// ------------------------------------------------------------- assertions

async function scalar(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

/** Before the INSERT: the staging table must already be the exact target set. */
async function assertStage(client: PoolClient): Promise<void> {
  const failures: string[] = [];
  const total = await scalar(client, `SELECT count(*) AS n FROM ${STAGE}`);
  if (total !== EXPECTED_TOTAL) failures.push(`staged rows: got ${total}, expected ${EXPECTED_TOTAL}`);

  // A duplicate key here would make ON CONFLICT DO UPDATE fail with "cannot
  // affect row a second time", which is a confusing way to learn that the
  // dedup missed something. Say it plainly instead.
  const distinct = await scalar(
    client,
    `SELECT count(*) AS n FROM (SELECT DISTINCT player_id, fixture_id FROM ${STAGE}) x`
  );
  if (distinct !== total) {
    failures.push(`staged (player_id, fixture_id) pairs: ${distinct} distinct out of ${total} rows`);
  }
  if (failures.length > 0) {
    throw new Error(`staging assertions failed:\n  - ${failures.join('\n  - ')}`);
  }
}

/**
 * Seasons in which each drifting column is measured. Asserted in both
 * directions: NULL everywhere it is absent AND non-NULL everywhere it is
 * present. One-directional checks miss the case that matters most — a column
 * quietly stored as 0 for a season that never measured it.
 */
const MEASURED_IN: Record<string, readonly Season[]> = {
  starts: ['2022-23', '2023-24', '2024-25', '2025-26'],
  expected_goals: ['2022-23', '2023-24', '2024-25', '2025-26'],
  expected_assists: ['2022-23', '2023-24', '2024-25', '2025-26'],
  expected_goal_involvements: ['2022-23', '2023-24', '2024-25', '2025-26'],
  expected_goals_conceded: ['2022-23', '2023-24', '2024-25', '2025-26'],
  tackles: ['2016-17', '2017-18', '2018-19', '2025-26'],
  recoveries: ['2016-17', '2017-18', '2018-19', '2025-26'],
  clearances_blocks_interceptions: ['2016-17', '2017-18', '2018-19', '2025-26'],
  defensive_contribution: ['2025-26'],
  attempted_passes: ['2016-17', '2017-18', '2018-19'],
  big_chances_created: ['2016-17', '2017-18', '2018-19'],
  big_chances_missed: ['2016-17', '2017-18', '2018-19'],
  completed_passes: ['2016-17', '2017-18', '2018-19'],
  dribbles: ['2016-17', '2017-18', '2018-19'],
  errors_leading_to_goal: ['2016-17', '2017-18', '2018-19'],
  errors_leading_to_goal_attempt: ['2016-17', '2017-18', '2018-19'],
  fouls: ['2016-17', '2017-18', '2018-19'],
  key_passes: ['2016-17', '2017-18', '2018-19'],
  offside: ['2016-17', '2017-18', '2018-19'],
  open_play_crosses: ['2016-17', '2017-18', '2018-19'],
  penalties_conceded: ['2016-17', '2017-18', '2018-19'],
  tackled: ['2016-17', '2017-18', '2018-19'],
  target_missed: ['2016-17', '2017-18', '2018-19'],
  winning_goals: ['2016-17', '2017-18', '2018-19'],
};

interface SeasonReport {
  season: string;
  rows: number;
  fixtures: number;
  minutes: number;
}

async function assertDatabase(
  client: PoolClient,
  managerCodes: Set<number>
): Promise<SeasonReport[]> {
  const failures: string[] = [];
  const csvSeasons = [...SEASONS];
  const check = async (label: string, sql: string, expected = 0, params: unknown[] = [csvSeasons]) => {
    const n = await scalar(client, sql, params);
    if (n !== expected) failures.push(`${label}: got ${n}, expected ${expected}`);
  };

  // --- volume ------------------------------------------------------------
  // Every query below is scoped to the ten CSV seasons with `season = ANY($1)`.
  // Item 5 added a second writer to this table — ingest-live-gameweeks.ts loads
  // the live season into it — so `count(*) FROM player_gameweeks` stopped being
  // a statement about this script's work. Scoped rather than loosened to a
  // lower bound: these are exact equalities because that is what catches a
  // dropped row, and a bound wide enough to admit an eleventh season is wide
  // enough to admit a missing match.
  await check(
    'total rows',
    'SELECT count(*) AS n FROM player_gameweeks WHERE season = ANY($1)',
    EXPECTED_TOTAL
  );
  await check(
    'seasons present',
    'SELECT count(DISTINCT season) AS n FROM player_gameweeks WHERE season = ANY($1)',
    SEASONS.length
  );
  const perSeason = await client.query<{ season: string; n: string; fixtures: string; minutes: string }>(
    `SELECT season, count(*) AS n, count(DISTINCT fixture_id) AS fixtures, sum(minutes) AS minutes
       FROM player_gameweeks WHERE season = ANY($1) GROUP BY season ORDER BY season`,
    [csvSeasons]
  );
  const report: SeasonReport[] = perSeason.rows.map((r) => ({
    season: r.season,
    rows: Number(r.n),
    fixtures: Number(r.fixtures),
    minutes: Number(r.minutes),
  }));
  for (const r of report) {
    const expected = EXPECTED_ROWS[r.season as Season];
    if (r.rows !== expected) failures.push(`${r.season} rows: got ${r.rows}, expected ${expected}`);
    if (r.fixtures !== EXPECTED_FIXTURES_PER_SEASON) {
      failures.push(
        `${r.season} distinct fixtures: got ${r.fixtures}, expected ${EXPECTED_FIXTURES_PER_SEASON} ` +
          `— a match with no rows at all means every row for it was lost`
      );
    }
    // A band, not a number: reds and stoppage time make the true total
    // approximate, so only a shortfall past the tolerance is a failure.
    const shortfall = (IDEAL_MINUTES_PER_SEASON - r.minutes) / IDEAL_MINUTES_PER_SEASON;
    if (shortfall > MINUTES_TOLERANCE) {
      failures.push(
        `${r.season} minutes: ${r.minutes} is ${(shortfall * 100).toFixed(2)}% below the ` +
          `${IDEAL_MINUTES_PER_SEASON} ideal, past the ${MINUTES_TOLERANCE * 100}% tolerance — row loss`
      );
    }
  }

  // --- agreement with the fixture ----------------------------------------
  await check(
    'rows disagreeing with their fixture on season or gw',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = ANY($1)
        AND (pg.season <> f.season OR pg.gw IS DISTINCT FROM f.gw)`
  );
  await check(
    'rows whose opponent is neither side of the fixture',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = ANY($1)
        AND pg.opponent_team_id NOT IN (f.home_team_id, f.away_team_id)`
  );
  // The player's own side is the side the opponent is not, so was_home is true
  // exactly when the opponent is the away team.
  await check(
    'rows where was_home disagrees with the fixture',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = ANY($1)
        AND pg.was_home <> (pg.opponent_team_id = f.away_team_id)`
  );
  await check(
    'rows with no matching player_seasons row',
    `SELECT count(*) AS n FROM player_gameweeks pg
       LEFT JOIN player_seasons ps ON ps.player_id = pg.player_id AND ps.season = pg.season
      WHERE pg.season = ANY($1) AND ps.player_id IS NULL`
  );

  // --- rule 6: nullability, in both directions ----------------------------
  for (const [column, seasons] of Object.entries(MEASURED_IN)) {
    await check(
      `rows where ${column} is on the wrong side of its first-appearance boundary`,
      `SELECT count(*) AS n FROM player_gameweeks
        WHERE season = ANY($2)
          AND (season = ANY($1::text[])) <> (${column} IS NOT NULL)`,
      0,
      [seasons, csvSeasons]
    );
  }

  // --- rule 11 ------------------------------------------------------------
  if (managerCodes.size > 0) {
    await check(
      'rows belonging to an Assistant Manager',
      `SELECT count(*) AS n FROM player_gameweeks pg
         JOIN players p ON p.id = pg.player_id
        WHERE pg.season = ANY($2) AND p.fpl_code = ANY($1::int[])`,
      0,
      [[...managerCodes], csvSeasons]
    );
  }

  // --- rule 12 ------------------------------------------------------------
  await check(
    "2019-20 rows in the Covid restart's rounds 39-47",
    // Already scoped by its literal season, so it takes no parameter — and it
    // has to say so, because the default is now the CSV season list and
    // Postgres rejects a parameter a statement has no placeholder for.
    `SELECT count(*) AS n FROM player_gameweeks WHERE season = '2019-20' AND gw > 38`,
    EXPECTED_GW_OVER_38,
    []
  );

  if (failures.length > 0) {
    throw new Error(`post-ingest assertions failed:\n  - ${failures.join('\n  - ')}`);
  }
  return report;
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    const maps = await loadMaps(client);
    const managerCodes = new Set<number>();

    await client.query('BEGIN');
    await createStage(client);

    console.log(
      `  ${'season'.padEnd(9)} ${'rows'.padStart(6)} ${'expected'.padStart(8)} ` +
        `${'managers'.padStart(8)} ${'dupes'.padStart(6)}`
    );
    let staged = 0;
    for (const season of SEASONS) {
      const build = await buildSeason(season, maps, managerCodes);
      await copySeason(client, build.lines);
      staged += build.built;
      console.log(
        `  ${season.padEnd(9)} ${String(build.built).padStart(6)} ` +
          `${String(EXPECTED_ROWS[season]).padStart(8)} ${String(build.managerRows).padStart(8)} ` +
          `${String(build.duplicateRows).padStart(6)}`
      );
    }
    console.log(`  staged ${staged} rows, excluding ${managerCodes.size} Assistant Manager element(s)`);

    await assertStage(client);
    const affected = await insertFromStage(client);
    console.log(`  INSERT ... ON CONFLICT DO UPDATE touched ${affected} rows`);

    const report = await assertDatabase(client, managerCodes);
    await client.query('COMMIT');

    console.log(
      `\n  ${'season'.padEnd(9)} ${'rows'.padStart(6)} ${'fixtures'.padStart(8)} ` +
        `${'minutes'.padStart(8)} ${'vs ideal'.padStart(9)}`
    );
    for (const r of report) {
      const shortfall = ((IDEAL_MINUTES_PER_SEASON - r.minutes) / IDEAL_MINUTES_PER_SEASON) * 100;
      console.log(
        `  ${r.season.padEnd(9)} ${String(r.rows).padStart(6)} ${String(r.fixtures).padStart(8)} ` +
          `${String(r.minutes).padStart(8)} ${`-${shortfall.toFixed(2)}%`.padStart(9)}`
      );
    }
    console.log(
      `  minutes are reported, not pinned: the ${IDEAL_MINUTES_PER_SEASON} ideal is unreachable ` +
        `(red cards, stoppage time).\n  Only a shortfall past ${MINUTES_TOLERANCE * 100}% fails.`
    );
    console.log(
      `\nCommitted ${EXPECTED_TOTAL} player_gameweeks in ${((Date.now() - started) / 1000).toFixed(1)}s. ` +
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

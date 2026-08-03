/**
 * Phase 1, item 5: the incremental gameweek sync.
 *
 * Run: npm run ingest:live-gameweeks
 *
 * Loads match rows for the live season from the official API into
 * `player_gameweeks` — the one table item 4 deliberately did not touch. It is
 * the only thing that clears the two "no matches recorded / no rows yet" empty
 * states, because both are gated on that table being empty rather than on the
 * calendar: playing the matches does not clear them, ingesting them does.
 *
 * ## Where the rows come from, and why not the cheaper endpoint
 *
 * `element-summary/{element_id}/` returns `history[]`: one entry per fixture
 * with the full stat set. That is the shape of `player_gameweeks`, including a
 * double gameweek being two rows, which is the whole point of rule 13. It costs
 * one request per player — 564 a run — and each response carries the player's
 * entire season, so one run ingests every round played so far and there is no
 * "which rounds are new" bookkeeping to get wrong.
 *
 * `event/{gw}/live/` is one request per ROUND rather than per player, which is
 * dramatically cheaper. It is not used, for one reason: **its shape cannot be
 * verified until a round has been played.** Before Gameweek 1 it returns
 * `{"elements": []}`, so whether its `stats` are per fixture or aggregated per
 * round is unknowable, and adopting an unverified shape for the one table
 * rule 13 exists to protect is not a risk worth taking. The cross-check that
 * settles it is written down in CLAUDE.md's Deferred section: element-summary's
 * per-fixture rows, summed per player per round, must equal event/live's
 * per-round stats — and if they do not, one of the two is aggregating a double
 * gameweek. That is the first thing to build once GW1 makes it testable, and if
 * the shapes agree the cheap endpoint becomes viable for routine syncing.
 *
 * ## What "finished" means here
 *
 * Only rows whose fixture has **settled** are written, and settled is
 * `finished AND finished_provisional` — the conjunction. FPL flips those two at
 * different moments, one at roughly full time and the other once the round's
 * bonus is confirmed, and **which is which cannot be established from any
 * season available today**: both are true on all 380 rows of completed 2025-26
 * and false on all 380 of unplayed 2026-27. The conjunction is true only once
 * both have fired, which is the later of the two under either ordering, so it
 * is correct without needing the fact. Writing a row between those moments
 * would store a real-looking 0 bonus that later changes.
 *
 * This is also what makes "safe to run mid-round" precise: settled fixtures are
 * ingested, ones still in play are skipped, and a later run picks them up
 * without touching the rows already there.
 *
 * ## Status
 *
 * **This script has never been run against 2026-27**, because no match has been
 * played. It is verified by replaying 2025-26 through its mapper and comparing
 * against the CSV-loaded rows — see live-gameweeks.test.ts — not by having
 * ingested anything.
 */

import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { getBootstrap, getFixtures, getPlayerDetail } from '../services/fplApi.js';
import { deriveSeason } from './ingest-live-season.js';
import { ALL_COLUMNS, UPDATABLE_COLUMNS } from './gameweek-columns.js';
import {
  SETTLED_SQL,
  buildFixtureRows,
  teamCodesByFplId,
  writeFixtures,
} from './sync-fixtures.js';
import type { WireBootstrap, WireGameweekHistory } from '../types/wire.js';

/**
 * Concurrent requests to the FPL API.
 *
 * 564 sequential requests is several minutes; unbounded parallelism is a
 * hostile way to treat somebody's public API. Five is a compromise that runs in
 * about twenty seconds.
 */
const CONCURRENCY = 5;

/** 2 sides x 11 players x 90 minutes, before substitutions and stoppage. */
const IDEAL_MINUTES_PER_FIXTURE = 2 * 11 * 90;
/** Reds and stoppage time make the ideal unreachable; only a shortfall past this fails. */
const MINUTES_TOLERANCE = 0.02;

// ------------------------------------------------------------- resolution

export interface FixtureInfo {
  fixtureId: number;
  /** NULL while FPL has not assigned a round — see the guard in the build. */
  gw: number | null;
  settled: boolean;
}

export interface SyncMaps {
  /** fpl_element_id -> players.id, for this season only (rule 2). */
  players: Map<number, number>;
  /** fpl_fixture_id -> our fixture, for this season only. */
  fixtures: Map<number, FixtureInfo>;
  /** fpl_team_id -> teams.id, for this season only (rule 5). */
  teams: Map<number, number>;
}

export async function loadSyncMaps(client: PoolClient, season: string): Promise<SyncMaps> {
  const players = await client.query<{ fpl_element_id: number; player_id: number }>(
    'SELECT fpl_element_id, player_id FROM player_seasons WHERE season = $1',
    [season]
  );
  if (players.rowCount === 0) {
    throw new Error(
      `no player_seasons rows for ${season}. Run 'npm run ingest:live' first — the roster ` +
        `has to exist before its matches can be attached to it.`
    );
  }

  const fixtures = await client.query<{
    fpl_fixture_id: number;
    id: number;
    gw: number | null;
    settled: boolean;
  }>(
    `SELECT f.fpl_fixture_id, f.id, f.gw, (${SETTLED_SQL()}) AS settled
       FROM fixtures f WHERE f.season = $1`,
    [season]
  );

  const teams = await client.query<{ fpl_team_id: number; team_id: number }>(
    'SELECT fpl_team_id, team_id FROM team_seasons WHERE season = $1',
    [season]
  );

  return {
    players: new Map(players.rows.map((r) => [r.fpl_element_id, r.player_id])),
    fixtures: new Map(
      fixtures.rows.map((r) => [r.fpl_fixture_id, { fixtureId: r.id, gw: r.gw, settled: r.settled }])
    ),
    teams: new Map(teams.rows.map((r) => [r.fpl_team_id, r.team_id])),
  };
}

// -------------------------------------------------------------- build layer

/** One row of `player_gameweeks`, keyed by column name. */
export type GameweekRow = Record<string, string | number | boolean | null>;

export interface BuiltGameweeks {
  rows: GameweekRow[];
  /** Rows dropped because their fixture has not settled. Reported, not silent. */
  unsettled: number;
  /** Rows dropped by rule 12's dedup. */
  duplicates: number;
}

/**
 * Wire history to rows, for one season.
 *
 * Pure — no database, no network. Everything it needs to resolve is in `maps`,
 * which is what lets the whole of 2025-26 be replayed through it offline.
 */
export function buildGameweekRows(
  season: string,
  histories: Map<number, WireGameweekHistory[]>,
  maps: SyncMaps
): BuiltGameweeks {
  // Rule 12: one row per (element, fixture), the latest kickoff winning.
  // Strictly greater, so the first row wins a tie — the same tiebreak the CSV
  // path uses, and the one the ten byte-identical 2025-26 duplicates need.
  const survivors = new Map<string, { elementId: number; entry: WireGameweekHistory }>();
  let seen = 0;

  for (const [elementId, history] of histories) {
    for (const entry of history) {
      seen++;
      const key = `${elementId}:${entry.fixture}`;
      const current = survivors.get(key);
      if (!current || entry.kickoff_time > current.entry.kickoff_time) {
        survivors.set(key, { elementId, entry });
      }
    }
  }
  const duplicates = seen - survivors.size;

  const rows: GameweekRow[] = [];
  let unsettled = 0;

  for (const { elementId, entry } of survivors.values()) {
    const fixture = maps.fixtures.get(entry.fixture);
    if (!fixture) {
      // Never a skipped row. An id that does not resolve means the fixture
      // table and the feed disagree, and guessing past that is how a
      // performance ends up attached to the wrong match.
      throw new Error(
        `${season}: fixture ${entry.fixture} does not resolve. Fixtures and the live feed ` +
          `disagree; the run refreshes fixtures first, so this means the feed changed underneath it.`
      );
    }

    if (!fixture.settled) {
      unsettled++;
      continue;
    }

    // The guard that matters more than it looks. A fixture with no round is
    // real — FPL nulls `event` on a postponement until a new round is assigned
    // — and match rows attached to one would sit in NO gameweek at all,
    // invisible to every per-round query in the app rather than merely
    // misplaced. Refusing is the only safe answer; the rows arrive on the next
    // run, once FPL has assigned the round.
    if (fixture.gw === null) {
      throw new Error(
        `${season}: fixture ${entry.fixture} has settled but has no round. Rows attached to it ` +
          `would belong to no gameweek. Re-run once FPL has assigned one.`
      );
    }

    const playerId = maps.players.get(elementId);
    if (playerId === undefined) {
      throw new Error(`${season}: element ${elementId} has no player_seasons row`);
    }
    const opponentId = maps.teams.get(entry.opponent_team);
    if (opponentId === undefined) {
      throw new Error(`${season}: opponent team ${entry.opponent_team} does not resolve (rule 5)`);
    }

    rows.push({
      player_id: playerId,
      fixture_id: fixture.fixtureId,
      season,
      // Rule 12: the round the match was actually PLAYED in, which is what the
      // feed's `round` carries. The assertion below checks it against the
      // fixture's own round rather than trusting either alone.
      gw: entry.round,
      was_home: entry.was_home,
      opponent_team_id: opponentId,

      total_points: entry.total_points,
      minutes: entry.minutes,
      goals_scored: entry.goals_scored,
      assists: entry.assists,
      clean_sheets: entry.clean_sheets,
      goals_conceded: entry.goals_conceded,
      own_goals: entry.own_goals,
      penalties_saved: entry.penalties_saved,
      penalties_missed: entry.penalties_missed,
      saves: entry.saves,
      yellow_cards: entry.yellow_cards,
      red_cards: entry.red_cards,
      bonus: entry.bonus,
      bps: entry.bps,
      value: entry.value,
      selected: entry.selected,
      transfers_in: entry.transfers_in,
      transfers_out: entry.transfers_out,

      influence: entry.influence,
      creativity: entry.creativity,
      threat: entry.threat,
      ict_index: entry.ict_index,

      starts: entry.starts,
      tackles: entry.tackles,
      recoveries: entry.recoveries,
      clearances_blocks_interceptions: entry.clearances_blocks_interceptions,
      defensive_contribution: entry.defensive_contribution,

      expected_goals: entry.expected_goals,
      expected_assists: entry.expected_assists,
      expected_goal_involvements: entry.expected_goal_involvements,
      expected_goals_conceded: entry.expected_goals_conceded,

      // Rule 6. The fifteen columns below are the 2016-17..2018-19 Opta feed
      // and appear in no modern source, so they are NULL rather than 0: nobody
      // measured them this season, which is a different fact from a player
      // having made no tackles.
      attempted_passes: null,
      big_chances_created: null,
      big_chances_missed: null,
      completed_passes: null,
      dribbles: null,
      errors_leading_to_goal: null,
      errors_leading_to_goal_attempt: null,
      fouls: null,
      key_passes: null,
      offside: null,
      open_play_crosses: null,
      penalties_conceded: null,
      tackled: null,
      target_missed: null,
      winning_goals: null,
    });
  }

  return { rows, unsettled, duplicates };
}

// -------------------------------------------------------------- write layer

/**
 * Upsert the rows.
 *
 * Never delete-and-reinsert, for the same reason as every other ingest here:
 * `players.id` and `fixtures.id` are foreign key targets, and renumbering them
 * repoints fact rows at the wrong subject with no constraint violation to catch
 * it. The conflict target is `(player_id, fixture_id)` — never `(player_id, gw)`,
 * which a double gameweek breaks (rule 13).
 */
export async function writeGameweekRows(
  client: PoolClient,
  rows: GameweekRow[],
  chunkSize = 400
): Promise<void> {
  if (rows.length === 0) return;

  const columns = [...ALL_COLUMNS];
  const perRow = columns.length;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valuesClause = chunk
      .map(
        (_, r) =>
          `(${Array.from({ length: perRow }, (_, c) => `$${r * perRow + c + 1}`).join(',')})`
      )
      .join(',');
    const params = chunk.flatMap((row) => columns.map((c) => row[c] ?? null));

    await client.query(
      `INSERT INTO player_gameweeks (${columns.join(', ')})
       VALUES ${valuesClause}
       ON CONFLICT (player_id, fixture_id) DO UPDATE SET
         ${UPDATABLE_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      params
    );
  }
}

// --------------------------------------------------------------- assertions

async function scalar(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

export interface RoundReport {
  gw: number;
  rows: number;
  fixtures: number;
  minutes: number;
}

export async function assertSyncedGameweeks(
  client: PoolClient,
  season: string
): Promise<RoundReport[]> {
  const failures: string[] = [];
  const check = async (label: string, sql: string): Promise<void> => {
    const n = await scalar(client, sql, [season]);
    if (n !== 0) failures.push(`${label}: ${n}`);
  };

  await check(
    'rows disagreeing with their fixture on season or round',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = $1 AND (pg.season <> f.season OR pg.gw IS DISTINCT FROM f.gw)`
  );
  await check(
    'rows whose opponent is neither side of the fixture',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = $1 AND pg.opponent_team_id NOT IN (f.home_team_id, f.away_team_id)`
  );
  // The player's own side is the side the opponent is not, so was_home is true
  // exactly when the opponent is the away team.
  await check(
    'rows where was_home disagrees with the fixture',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = $1 AND pg.was_home <> (pg.opponent_team_id = f.away_team_id)`
  );
  // The same expression the write gate uses, deliberately — an assertion that
  // tests less than the thing it guards is a gap waiting for the day the
  // partial-round test gets skipped.
  await check(
    'rows on a fixture that has not settled',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = $1 AND NOT (${SETTLED_SQL()})`
  );
  await check(
    'rows on a fixture with no round',
    `SELECT count(*) AS n FROM player_gameweeks pg
       JOIN fixtures f ON f.id = pg.fixture_id
      WHERE pg.season = $1 AND f.gw IS NULL`
  );
  await check(
    'rows with no player_seasons row for the season',
    `SELECT count(*) AS n FROM player_gameweeks pg
       LEFT JOIN player_seasons ps ON ps.player_id = pg.player_id AND ps.season = pg.season
      WHERE pg.season = $1 AND ps.player_id IS NULL`
  );

  // Volume, derived from the competition rather than from the payload's own
  // count: twenty-two players on the pitch for ninety minutes is 1,980 minutes
  // a match. Reported as a band and never pinned to a number — substitutions
  // are neutral, red cards and stoppage time are not.
  const perRound = await client.query<{ gw: number; rows: string; fixtures: string; minutes: string }>(
    `SELECT gw, count(*) AS rows, count(DISTINCT fixture_id) AS fixtures, sum(minutes) AS minutes
       FROM player_gameweeks WHERE season = $1 GROUP BY gw ORDER BY gw`,
    [season]
  );
  const report: RoundReport[] = perRound.rows.map((r) => ({
    gw: r.gw,
    rows: Number(r.rows),
    fixtures: Number(r.fixtures),
    minutes: Number(r.minutes),
  }));
  for (const r of report) {
    const ideal = r.fixtures * IDEAL_MINUTES_PER_FIXTURE;
    const shortfall = (ideal - r.minutes) / ideal;
    if (shortfall > MINUTES_TOLERANCE) {
      failures.push(
        `round ${r.gw}: ${r.minutes} minutes over ${r.fixtures} fixtures is ` +
          `${(shortfall * 100).toFixed(2)}% below the ${ideal} ideal, past the ` +
          `${MINUTES_TOLERANCE * 100}% tolerance — rows were lost`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`post-sync assertions failed:\n  - ${failures.join('\n  - ')}`);
  }
  return report;
}

// ------------------------------------------------------------------- fetch

/**
 * Every player's history, at a bounded concurrency.
 *
 * **A failed request aborts the run.** Not skipped, not retried past the
 * client's own behaviour: a skipped player is a silently missing set of rows,
 * and nothing downstream would catch it — eleven rows missing from a round of
 * four hundred is well inside the tolerance the minutes band has to allow for
 * red cards. `Promise.all` rejects on the first failure and the transaction
 * never opens.
 */
export async function fetchAllHistories(
  elementIds: number[],
  /**
   * Injectable so the abort behaviour has a test. The default is the real
   * client; the suite passes a stub that fails for one id, because a property
   * whose only evidence is a comment is a property nobody has checked.
   */
  fetchOne: (elementId: number) => Promise<{ history: WireGameweekHistory[] }> = getPlayerDetail
): Promise<Map<number, WireGameweekHistory[]>> {
  const histories = new Map<number, WireGameweekHistory[]>();
  const queue = [...elementIds];

  const worker = async (): Promise<void> => {
    for (;;) {
      const id = queue.pop();
      if (id === undefined) return;
      const summary = await fetchOne(id);
      histories.set(id, summary.history);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return histories;
}

// -------------------------------------------------------------------- main

export interface SyncOutcome {
  built: BuiltGameweeks;
  before: number;
  after: number;
  report: RoundReport[];
}

/**
 * Everything the run does inside one transaction, separated from `main` so it
 * can be tested without the network.
 *
 * **The order of the first two steps is the point, not an optimisation.** Every
 * 2026-27 fixture is `finished: false` from item 4's pre-season load and nothing
 * updates that until the live season ingest runs again — so a sync that read the
 * stored flags without refreshing them first would write **zero rows after
 * Gameweek 1, correctly, for a reason nothing on screen explains**. Refreshing
 * here is what removes the ordering dependency instead of documenting it.
 */
export async function syncSeasonGameweeks(
  client: PoolClient,
  season: string,
  wireFixtures: Parameters<typeof buildFixtureRows>[0],
  teams: Parameters<typeof teamCodesByFplId>[0],
  histories: Map<number, WireGameweekHistory[]>
): Promise<SyncOutcome> {
  await writeFixtures(client, season, buildFixtureRows(wireFixtures, teamCodesByFplId(teams)));

  const maps = await loadSyncMaps(client, season);
  const built = buildGameweekRows(season, histories, maps);

  const before = await scalar(
    client,
    'SELECT count(*) AS n FROM player_gameweeks WHERE season = $1',
    [season]
  );
  await writeGameweekRows(client, built.rows);
  const after = await scalar(
    client,
    'SELECT count(*) AS n FROM player_gameweeks WHERE season = $1',
    [season]
  );

  const report = await assertSyncedGameweeks(client, season);
  return { built, before, after, report };
}

async function main(): Promise<void> {
  const started = Date.now();
  console.log('Fetching the live bootstrap and fixture list...');
  const [bootstrap, wireFixtures] = await Promise.all([getBootstrap(), getFixtures()]);
  const season = deriveSeason(bootstrap.events);

  const elementIds = (bootstrap as WireBootstrap).elements.map((e) => e.id);
  console.log(`Season ${season}: fetching history for ${elementIds.length} players...`);
  const histories = await fetchAllHistories(elementIds);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { built, before, after, report } = await syncSeasonGameweeks(
      client,
      season,
      wireFixtures,
      bootstrap.teams,
      histories
    );
    console.log(
      `Built ${built.rows.length} rows (${built.unsettled} skipped as unsettled, ` +
        `${built.duplicates} deduped by rule 12)`
    );
    await client.query('COMMIT');

    console.log(`\n  GW   rows  fixtures   minutes`);
    for (const r of report) {
      console.log(
        `  ${String(r.gw).padStart(2)}  ${String(r.rows).padStart(5)}  ` +
          `${String(r.fixtures).padStart(8)}  ${String(r.minutes).padStart(8)}`
      );
    }
    console.log(
      after === before
        ? `\nNo new rows: ${after} already stored for ${season}.`
        : `\n${after - before} new rows; ${after} stored for ${season}.`
    );
    console.log(`Committed in ${((Date.now() - started) / 1000).toFixed(1)}s. All assertions passed.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Only when invoked as a script — the test suite imports this module. */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((err: unknown) => {
      console.error(`\nSync failed, rolled back. Nothing was written.\n${(err as Error).message}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}

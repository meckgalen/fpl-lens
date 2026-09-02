/**
 * Phase 1, item 4: the live season ingest.
 *
 * Run: npm run ingest:live
 *
 * Loads one season's clubs, roster, gameweek deadlines and fixtures from the
 * official FPL API — the things a season has before a ball is kicked. It is the
 * first caller of ../services/fplApi.ts, which has existed since step 6 as "the
 * ingestion source for the live season" and until now had no consumer.
 *
 * WHAT THIS DOES NOT WRITE, and the single most important thing about it:
 * `player_gameweeks`. Not one row, ever. A pre-season bootstrap serves LAST
 * season's totals on every element — at the time of writing Saka's element
 * carries minutes 2218, total_points 157 and starts 25, which are exactly his
 * 2025-26 figures, and 400 of the 564 elements carry nonzero stats the same
 * way. Copying those in would produce a new season that looks entirely
 * plausible and is a duplicate of the old one. `buildLiveSeason` therefore
 * reads structural fields only — identity, club, position, price, schedule —
 * and `assertLiveSeason` checks afterwards that the season really does total
 * zero points through the same query the app's player list uses. Per-gameweek
 * data is the incremental sync's job, which is its own item.
 *
 * Everything else follows the three CSV ingests: a pure build that produces the
 * exact row sets, one transaction, assertions inside it, rollback on failure,
 * and ON CONFLICT DO UPDATE everywhere so re-running changes nothing. That last
 * property is not decoration here — the transfer window runs to 31 August and
 * this will be run repeatedly while the roster moves.
 *
 * Two upsert rules that pull in opposite directions, which is why they are
 * stated together:
 *
 *   - `start_cost` is written ONCE, on insert. It is the price the season
 *     opened at. Refreshing it every run would quietly redefine it as "price at
 *     last sync" while leaving the column named start_cost.
 *   - `deadline_time` is upserted on EVERY run. FPL moves deadlines for
 *     postponements and broadcast changes, and a write-once deadline is a
 *     countdown to a time that has already passed.
 *
 * And one thing that is never done: no row is ever deleted. A player who leaves
 * in August disappears from the bootstrap, and his `player_seasons` row stays.
 * It records that he was registered for this season, which remains true; he may
 * already have gameweek rows whose career row would otherwise vanish while the
 * matches themselves remained; and a deleted row cannot be recovered from the
 * feed that no longer mentions him.
 */

import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { getBootstrap, getFixtures } from '../services/fplApi.js';
import { listPlayerTotals } from '../repositories/players.js';
import {
  buildFixtureRows,
  teamCodesByFplId,
  writeFixtures,
  type FixtureRow,
} from './sync-fixtures.js';
import type { WireBootstrap, WireElement, WireEvent, WireFixture, WireTeam } from '../types/wire.js';

/**
 * Rule 10, mapped once. The same table as ingest-dimensions.ts, deliberately
 * copied rather than imported: that module runs its own main() at import time,
 * so importing it to share four lines would run the CSV ingest.
 */
const POSITION_BY_ELEMENT_TYPE: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

const STRENGTH_COLUMNS = [
  'strength_overall_home',
  'strength_overall_away',
  'strength_attack_home',
  'strength_attack_away',
  'strength_defence_home',
  'strength_defence_away',
] as const;

const CLUBS_PER_SEASON = 20;
const ROUNDS_PER_SEASON = 38;
const FIXTURES_PER_SEASON = 380;
const FIXTURES_PER_ROUND = 10;
/** Each club plays every other home and away: 19 + 19. */
const MATCHES_PER_CLUB = 38;
const HOME_MATCHES_PER_CLUB = 19;

/**
 * A squad is 15 registered players at minimum. The ceiling exists to catch a
 * grouping bug that files players under the wrong club, not to police squad
 * size: the observed spread on 3 Sep 2026, the day after the window shut, was
 * 24 (EVE) to 43 (HUL), with TOT on 40. The previous ceiling of 40 was set
 * pre-season and fired on real data as soon as clubs registered their squads.
 * A real mis-grouping shows up as a club with three figures, not 45.
 */
const MIN_SQUAD = 15;
const MAX_SQUAD = 50;

// ------------------------------------------------------------------ parsing

/**
 * Rule 18, applied to a JSON source. The bootstrap sends real nulls rather than
 * the CSV scraper's four-character 'None', so this is currently a no-op on
 * everything but blank strings — which is exactly why the rule says to apply it
 * in every ingest including the clean ones.
 */
function normalise(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'None') return null;
  return trimmed;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`live ingest: ${what} is missing`);
  return value;
}

// ------------------------------------------------------------- season string

/**
 * The season label, derived from the earliest gameweek deadline.
 *
 * The bootstrap carries no season anywhere — not a field, not a header — so it
 * has to come from the calendar it describes. A Premier League season opens in
 * August and closes in May, so the year of GW1's deadline is the opening year
 * and the label is rule 8's '2026-27'.
 *
 * The month test is there for the case where the earliest deadline lands in the
 * back half of a season: any deadline from January to June belongs to a season
 * that opened the previous August. It cannot happen on a full 38-event
 * bootstrap and costs one comparison to be right if it ever does.
 */
export function deriveSeason(events: WireEvent[]): string {
  if (events.length === 0) throw new Error('live ingest: bootstrap has no events');

  let earliest: number | null = null;
  for (const event of events) {
    const deadline = normalise(event.deadline_time);
    if (deadline === null) continue;
    const ms = Date.parse(deadline);
    if (Number.isNaN(ms)) {
      throw new Error(`live ingest: gameweek ${event.id} has an unparseable deadline '${deadline}'`);
    }
    if (earliest === null || ms < earliest) earliest = ms;
  }
  if (earliest === null) {
    throw new Error('live ingest: no event carries a deadline, so the season cannot be derived');
  }

  const opened = new Date(earliest);
  // July is the earliest a season's first deadline has ever fallen; anything
  // from January onward is the tail of a season that opened the year before.
  const startYear = opened.getUTCMonth() >= 6 ? opened.getUTCFullYear() : opened.getUTCFullYear() - 1;
  const endYear = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYear}`;
}

// -------------------------------------------------------------- build layer
// Pure. Reads the two payloads, produces the exact rows to be written, and
// touches no database. Every stat field on an element is ignored here by
// construction — see the file header for why that is the point.

export interface TeamRow {
  fpl_team_code: number;
  name: string;
  short_name: string;
}

export interface TeamSeasonRow {
  fpl_team_code: number;
  fpl_team_id: number;
  strengths: (number | null)[];
}

export interface PlayerRow {
  fpl_code: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  opta_code: string | null;
  birth_date: string | null;
}

export interface PlayerSeasonRow {
  fpl_code: number;
  fpl_element_id: number;
  fpl_team_code: number;
  position: string;
  /** Written once, on insert. See the file header. */
  start_cost: number;
  /** Refreshed every run. */
  now_cost: number;
}

export interface EventRow {
  gw: number;
  deadline_time: string;
}

export type { FixtureRow } from './sync-fixtures.js';

export interface LiveSeason {
  season: string;
  teams: TeamRow[];
  teamSeasons: TeamSeasonRow[];
  players: PlayerRow[];
  playerSeasons: PlayerSeasonRow[];
  events: EventRow[];
  fixtures: FixtureRow[];
  /** Rule 11: element types outside 1-4, excluded and counted rather than dropped silently. */
  excludedCodes: number[];
}

export function buildLiveSeason(bootstrap: WireBootstrap, wireFixtures: WireFixture[]): LiveSeason {
  const season = deriveSeason(bootstrap.events);

  // Season-scoped team id -> permanent team code. Built first and used to
  // resolve every other reference, so nothing season-scoped leaves this
  // function (rules 2 and 5, one layer earlier than usual).
  const codeByTeamId = new Map<number, number>();
  const teams: TeamRow[] = [];
  const teamSeasons: TeamSeasonRow[] = [];

  for (const team of bootstrap.teams as WireTeam[]) {
    codeByTeamId.set(team.id, team.code);
    teams.push({
      fpl_team_code: team.code,
      name: required(normalise(team.name), `name for team code ${team.code}`),
      short_name: required(normalise(team.short_name), `short_name for team code ${team.code}`),
    });
    teamSeasons.push({
      fpl_team_code: team.code,
      fpl_team_id: team.id,
      strengths: STRENGTH_COLUMNS.map((column) => {
        const value = team[column];
        return typeof value === 'number' ? value : null;
      }),
    });
  }

  const players: PlayerRow[] = [];
  const playerSeasons: PlayerSeasonRow[] = [];
  const excludedCodes: number[] = [];

  for (const element of bootstrap.elements as WireElement[]) {
    const position = POSITION_BY_ELEMENT_TYPE[element.element_type];
    if (!position) {
      // Rule 11. 2024-25 shipped element_type 5 for the Assistant Manager chip;
      // those carry permanent codes that would pollute the players dimension
      // and would surface in search. The 2026-27 bootstrap has none, which is
      // not a property of the feed — hence a filter rather than an assumption.
      excludedCodes.push(element.code);
      continue;
    }

    if (!codeByTeamId.has(element.team)) {
      throw new Error(
        `live ingest: element ${element.code} names season team id ${element.team}, ` +
          `which is not in the bootstrap's team list`
      );
    }

    players.push({
      fpl_code: element.code,
      first_name: normalise(element.first_name),
      second_name: normalise(element.second_name),
      web_name: required(normalise(element.web_name), `web_name for code ${element.code}`),
      opta_code: normalise(element.opta_code),
      birth_date: normalise(element.birth_date),
    });

    playerSeasons.push({
      fpl_code: element.code,
      fpl_element_id: element.id,
      fpl_team_code: element.team_code,
      position,
      // Rule 9: raw £0.1m units. The season's opening price, not today's —
      // they are equal only while cost_change_start is still 0, and this value
      // is written once, so getting it from the derivation rather than from
      // now_cost is what makes a first run after GW1 correct too.
      start_cost: element.now_cost - element.cost_change_start,
      now_cost: element.now_cost,
    });
  }

  const events: EventRow[] = bootstrap.events.map((event) => ({
    gw: event.id,
    deadline_time: required(normalise(event.deadline_time), `deadline for gameweek ${event.id}`),
  }));

  // Built by the shared module since item 5, because the gameweek sync writes
  // the same rows and two implementations of one table's columns is how they
  // drift.
  const fixtures = buildFixtureRows(wireFixtures, codeByTeamId);

  return { season, teams, teamSeasons, players, playerSeasons, events, fixtures, excludedCodes };
}

// -------------------------------------------------------------- write layer

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

export async function writeLiveSeason(client: PoolClient, built: LiveSeason): Promise<void> {
  const { season } = built;

  // --- teams ---------------------------------------------------------------
  // Matched on the permanent code, so a promoted club that has been in the
  // league before reuses its existing row and its existing surrogate id: Hull
  // (88) last appeared in 2016-17 and comes back to the same row. Only a club
  // with a genuinely new code inserts one — Coventry (9) is the new one here.
  //
  // DO NOTHING, not DO UPDATE, and this was measured rather than assumed. With
  // an update this ingest renamed Hull to "Hull City" and Ipswich to "Ipswich
  // Town", and the next run of ingest:dimensions renamed them straight back
  // from the CSVs — the two scripts flip-flopping a display name depending on
  // which ran last. It turned career.test.ts red, which is how it was found.
  //
  // A column with two writers and no ordering between them has no owner. Both
  // names are correct, so the tie is broken by making the transient source
  // insert-only: the live feed is re-read every run, the CSV snapshot is
  // written once per season and is what the historical rows are named from.
  // A club that genuinely rebrands is picked up by the CSV path at season end.
  await insertChunked(
    client,
    built.teams.map((t) => [t.fpl_team_code, t.name, t.short_name]),
    3,
    (v) => `INSERT INTO teams (fpl_team_code, name, short_name) VALUES ${v}
            ON CONFLICT (fpl_team_code) DO NOTHING`
  );
  const teamIdByCode = await idMap(client, 'teams', 'fpl_team_code');

  // --- team_seasons --------------------------------------------------------
  // Strengths are refreshed every run: FPL revises them as the season goes on.
  await insertChunked(
    client,
    built.teamSeasons.map((ts) => {
      const teamId = teamIdByCode.get(ts.fpl_team_code);
      if (!teamId) throw new Error(`unresolved team_code ${ts.fpl_team_code}`);
      return [teamId, season, ts.fpl_team_id, ...ts.strengths];
    }),
    3 + STRENGTH_COLUMNS.length,
    (v) => `INSERT INTO team_seasons
              (team_id, season, fpl_team_id, ${STRENGTH_COLUMNS.join(', ')})
            VALUES ${v}
            ON CONFLICT (team_id, season) DO UPDATE SET
              fpl_team_id = EXCLUDED.fpl_team_id,
              ${STRENGTH_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
  );

  // --- players -------------------------------------------------------------
  // DO NOTHING for the same reason as teams above: a player already in the
  // database is named by the CSV backfill, and having both scripts rewrite the
  // same display fields made the stored name depend on which one ran last. The
  // 67 genuinely new players here — new signings and promoted-club squads — are
  // inserted whole, names, opta_code, birth_date and all.
  //
  // The cost, stated because it is a real one: a name or a birth date that
  // arrives on the live feed for a player we already hold does not update until
  // the next CSV refresh. That is a display field going stale for a season,
  // against a stored value that otherwise changes every time either script is
  // invoked. The trade is worth it in that direction and not the other.
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
            ON CONFLICT (fpl_code) DO NOTHING`
  );
  const playerIdByCode = await idMap(client, 'players', 'fpl_code');

  // --- player_seasons ------------------------------------------------------
  // start_cost and end_cost are absent from the SET clause and that absence is
  // the feature. start_cost is the price the season opened at, written on the
  // first sync and never again. end_cost is the price it closed at, which a
  // season in progress does not have — rule 6 says NULL, not today's price
  // wearing the wrong name.
  await insertChunked(
    client,
    built.playerSeasons.map((ps) => {
      const playerId = playerIdByCode.get(ps.fpl_code);
      if (!playerId) throw new Error(`unresolved player code ${ps.fpl_code}`);
      const teamId = teamIdByCode.get(ps.fpl_team_code);
      if (!teamId) throw new Error(`unresolved team_code ${ps.fpl_team_code}`);
      return [playerId, season, ps.fpl_element_id, teamId, ps.position, ps.start_cost, ps.now_cost];
    }),
    7,
    (v) => `INSERT INTO player_seasons
              (player_id, season, fpl_element_id, team_id, position, start_cost, now_cost)
            VALUES ${v}
            ON CONFLICT (player_id, season) DO UPDATE SET
              fpl_element_id = EXCLUDED.fpl_element_id,
              team_id        = EXCLUDED.team_id,
              position       = EXCLUDED.position,
              now_cost       = EXCLUDED.now_cost`
  );

  // --- events --------------------------------------------------------------
  // Upserted, not written once: deadlines move.
  await insertChunked(
    client,
    built.events.map((e) => [season, e.gw, e.deadline_time]),
    3,
    (v) => `INSERT INTO events (season, gw, deadline_time) VALUES ${v}
            ON CONFLICT (season, gw) DO UPDATE
            SET deadline_time = EXCLUDED.deadline_time`
  );

  // --- fixtures ------------------------------------------------------------
  // Delegated to ./sync-fixtures.ts, which the gameweek sync also calls.
  await writeFixtures(client, season, built.fixtures);
}

// ----------------------------------------------------------------- snapshot

/**
 * A content hash of everything this ingest can write, for one season.
 *
 * Re-runnability is the property that matters most here — the roster moves
 * until 31 August and this will be run again and again — and it is not
 * something to assert by intention. Hashing the rows before and after a write
 * turns "changes nothing" into a comparison. Row order is normalised by sorting
 * the text, so an unrelated physical reordering cannot read as a change.
 *
 * `teams` and `players` have no season column, so they are scoped to the codes
 * this payload touches rather than to the whole table.
 */
export async function snapshot(
  client: PoolClient,
  season: string,
  teamCodes: number[],
  playerCodes: number[]
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  // Sequential, not Promise.all: these all run on one client inside the
  // transaction, and pg deprecates overlapping queries on a single client.
  const digest = async (label: string, sql: string, params: unknown[]): Promise<void> => {
    const { rows } = await client.query<{ hash: string | null }>(sql, params);
    hashes[label] = rows[0]?.hash ?? 'empty';
  };

  await digest(
    'teams',
    `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
       FROM (SELECT fpl_team_code, name, short_name FROM teams
              WHERE fpl_team_code = ANY($1::int[])) t`,
    [teamCodes]
  );
  await digest(
    'team_seasons',
    `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
       FROM (SELECT * FROM team_seasons WHERE season = $1) t`,
    [season]
  );
  await digest(
    'players',
    `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
       FROM (SELECT fpl_code, opta_code, first_name, second_name, web_name, birth_date
               FROM players WHERE fpl_code = ANY($1::int[])) t`,
    [playerCodes]
  );
  await digest(
    'player_seasons',
    `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
       FROM (SELECT * FROM player_seasons WHERE season = $1) t`,
    [season]
  );
  await digest(
    'events',
    `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
       FROM (SELECT * FROM events WHERE season = $1) t`,
    [season]
  );
  await digest(
    'fixtures',
    `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
       FROM (SELECT * FROM fixtures WHERE season = $1) t`,
    [season]
  );

  return hashes;
}

// --------------------------------------------------------------- assertions

async function scalar(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

/**
 * The season must not already be over.
 *
 * A completed season belongs to the CSV backfill, which has gameweek-level data
 * the live API cannot serve for it. Running this over one would refresh
 * `now_cost` on rows where NULL is the correct answer. Derived from the stored
 * fixtures rather than from a hardcoded list of the ten, so it stays true as
 * seasons accumulate.
 */
async function assertSeasonNotComplete(client: PoolClient, season: string): Promise<void> {
  const stored = await scalar(
    client,
    'SELECT count(*) AS n FROM fixtures WHERE season = $1',
    [season]
  );
  if (stored === 0) return; // first run for this season

  const unfinished = await scalar(
    client,
    'SELECT count(*) AS n FROM fixtures WHERE season = $1 AND NOT finished',
    [season]
  );
  if (unfinished === 0) {
    throw new Error(
      `${season} is complete — all ${stored} stored fixtures are finished. The live ingest ` +
        `refreshes prices and deadlines for a season in progress; a finished season is the ` +
        `CSV backfill's, and running this over one would set now_cost where NULL is correct.`
    );
  }
}

export async function assertLiveSeason(
  client: PoolClient,
  built: LiveSeason,
  /**
   * `player_gameweeks` rows for this season **before** the write. The check
   * below is that the number did not move; passing it in is what makes that a
   * measurement rather than an assumption.
   */
  gameweekRowsBefore: number
): Promise<void> {
  const { season } = built;
  const failures: string[] = [];

  const check = async (label: string, sql: string, expected: number): Promise<void> => {
    const actual = await scalar(client, sql, [season]);
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  /** How much of this season has been played, which several checks below gate on. */
  const played = await scalar(
    client,
    'SELECT count(*) AS n FROM fixtures WHERE season = $1 AND finished',
    [season]
  );

  await check(
    'team_seasons',
    'SELECT count(*) AS n FROM team_seasons WHERE season = $1',
    CLUBS_PER_SEASON
  );
  await check('fixtures', 'SELECT count(*) AS n FROM fixtures WHERE season = $1', FIXTURES_PER_SEASON);
  await check('events', 'SELECT count(*) AS n FROM events WHERE season = $1', ROUNDS_PER_SEASON);

  // Competition format, derived from how the league works rather than from the
  // count the feed just handed us: 20 clubs playing each other twice is 38
  // matches each, 19 at home. Independent of anything the payload asserts about
  // itself (working agreement: verification must not share its derivation).
  const badClubs = await client.query<{ short_name: string; played: string; home: string }>(
    `SELECT t.short_name,
            count(*) AS played,
            count(*) FILTER (WHERE f.home_team_id = t.id) AS home
       FROM fixtures f
       JOIN teams t ON t.id IN (f.home_team_id, f.away_team_id)
      WHERE f.season = $1
      GROUP BY t.short_name
     HAVING count(*) <> ${MATCHES_PER_CLUB}
         OR count(*) FILTER (WHERE f.home_team_id = t.id) <> ${HOME_MATCHES_PER_CLUB}`,
    [season]
  );
  for (const row of badClubs.rows) {
    failures.push(`${row.short_name}: ${row.played} matches, ${row.home} at home`);
  }

  // PUBLICATION-TIME ONLY. True of a schedule that has just been released and
  // false of a season in progress: 2022-23 lost round 7 to the postponements
  // after the Queen's death, and 2019-20's Covid restart replayed rounds 30-38
  // as 39-47 — both are in this database as counterexamples. It is exactly
  // right for a pre-season ingest, which is why it is here. The incremental
  // sync inherits this script and will have to drop or rewrite it, and if it
  // does not, this is the assertion that will start failing on the first
  // postponement with nothing on screen explaining why.
  // GATED ON THE DATA, not skipped: asserted only while the season has no
  // finished fixture. Item 5 made this necessary — the check is exactly right
  // for a freshly published schedule and false the moment a postponement moves
  // a fixture between rounds, and gating it on "has anything been played" is
  // the only condition that stays true through both. The invariants that
  // survive a played season — 380 fixtures, 38 matches a club, 19 home and 19
  // away — are asserted unconditionally above.
  if (played === 0) {
    const badRounds = await client.query<{ gw: number; n: string; clubs: string }>(
      `SELECT f.gw, count(*) AS n, count(DISTINCT f.home_team_id) + count(DISTINCT f.away_team_id) AS clubs
         FROM fixtures f
        WHERE f.season = $1
        GROUP BY f.gw
       HAVING count(*) <> ${FIXTURES_PER_ROUND}
           OR count(DISTINCT f.home_team_id) + count(DISTINCT f.away_team_id) <> ${CLUBS_PER_SEASON}`,
      [season]
    );
    for (const row of badRounds.rows) {
      failures.push(
        `round ${row.gw}: ${row.n} fixtures across ${row.clubs} clubs — expected ` +
          `${FIXTURES_PER_ROUND} and ${CLUBS_PER_SEASON} (publication-time check)`
      );
    }
  }

  // Nothing here writes match data, and this is what says so out loud.
  //
  // It used to assert the count was zero, which was only ever a proxy for the
  // real claim and stopped being true the day the gameweek sync ran. The claim
  // was always "this script does not write match rows", and comparing the count
  // across the write says exactly that, in every season state.
  const gameweekRowsAfter = await scalar(
    client,
    'SELECT count(*) AS n FROM player_gameweeks WHERE season = $1',
    [season]
  );
  if (gameweekRowsAfter !== gameweekRowsBefore) {
    failures.push(
      `player_gameweeks for ${season} went from ${gameweekRowsBefore} to ${gameweekRowsAfter} ` +
        `rows across this ingest — it writes none, so something copied the bootstrap's ` +
        `carryover totals into the match table`
    );
  }

  // The carryover tripwire, asked through the query the player list actually
  // runs. A pre-season element carries LAST season's totals; if any of them had
  // found their way into a stat column, this is where it would show as a
  // player with points in a season nobody has played.
  //
  // Gated on the same condition, and for the same reason: once real matches are
  // ingested these totals are supposed to be non-zero. Before any are, a single
  // point is evidence of a leak.
  const totals = gameweekRowsAfter === 0 ? await listPlayerTotals(client, season) : [];
  const scoring = totals.filter((p) => p.total_points !== 0 || p.minutes !== 0);
  if (scoring.length > 0) {
    const sample = scoring
      .slice(0, 3)
      .map((p) => `${p.web_name} ${p.total_points}pts/${p.minutes}min`)
      .join(', ');
    failures.push(
      `${scoring.length} players have totals in ${season} before a match has been played ` +
        `(${sample}) — the bootstrap's carryover stats have leaked in`
    );
  }

  // Squad sanity: 20 clubs, a plausible number of players each, and at least
  // one goalkeeper. The floor is 1 rather than 2 because one club currently
  // registers a single keeper, which is legal and would have failed a tidier
  // guess.
  const badSquads = await client.query<{ short_name: string; n: string; gks: string }>(
    `SELECT t.short_name, count(*) AS n, count(*) FILTER (WHERE ps.position = 'GK') AS gks
       FROM player_seasons ps
       JOIN teams t ON t.id = ps.team_id
      WHERE ps.season = $1
      GROUP BY t.short_name
     HAVING count(*) < ${MIN_SQUAD} OR count(*) > ${MAX_SQUAD}
         OR count(*) FILTER (WHERE ps.position = 'GK') < 1`,
    [season]
  );
  for (const row of badSquads.rows) {
    failures.push(`${row.short_name}: ${row.n} players, ${row.gks} goalkeepers`);
  }
  const squadClubs = await scalar(
    client,
    'SELECT count(DISTINCT team_id) AS n FROM player_seasons WHERE season = $1',
    [season]
  );
  if (squadClubs !== CLUBS_PER_SEASON) {
    failures.push(`${squadClubs} clubs have a squad, expected ${CLUBS_PER_SEASON}`);
  }

  // Rule 11: an excluded element type must not have reached the players table.
  if (built.excludedCodes.length > 0) {
    const leaked = await scalar(
      client,
      'SELECT count(*) AS n FROM players WHERE fpl_code = ANY($1::int[])',
      [built.excludedCodes]
    );
    if (leaked !== 0) failures.push(`${leaked} excluded element code(s) leaked into players`);
  }

  // Every price we wrote must be a real one. start_cost is written once, so a
  // null here would be permanent.
  const badCosts = await scalar(
    client,
    `SELECT count(*) AS n FROM player_seasons
      WHERE season = $1 AND (start_cost IS NULL OR now_cost IS NULL OR end_cost IS NOT NULL)`,
    [season]
  );
  if (badCosts !== 0) {
    failures.push(
      `${badCosts} player_seasons row(s) in ${season} have a null start_cost/now_cost or a ` +
        `non-null end_cost — a season in progress has not ended at any price (rule 6)`
    );
  }

  if (failures.length > 0) {
    throw new Error(`post-ingest assertions failed:\n  - ${failures.join('\n  - ')}`);
  }
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const started = Date.now();
  console.log('Fetching the live bootstrap and fixture list...');
  const [bootstrap, wireFixtures] = await Promise.all([getBootstrap(), getFixtures()]);

  const built = buildLiveSeason(bootstrap, wireFixtures);
  console.log(
    `Season ${built.season}: teams=${built.teams.length} players=${built.players.length} ` +
      `events=${built.events.length} fixtures=${built.fixtures.length}` +
      (built.excludedCodes.length > 0
        ? ` (excluded ${built.excludedCodes.length} non-player element(s), rule 11)`
        : '')
  );

  const teamCodes = built.teams.map((t) => t.fpl_team_code);
  const playerCodes = built.players.map((p) => p.fpl_code);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertSeasonNotComplete(client, built.season);

    const before = await snapshot(client, built.season, teamCodes, playerCodes);
    const gameweekRowsBefore = await scalar(
      client,
      'SELECT count(*) AS n FROM player_gameweeks WHERE season = $1',
      [built.season]
    );
    await writeLiveSeason(client, built);
    const after = await snapshot(client, built.season, teamCodes, playerCodes);
    await assertLiveSeason(client, built, gameweekRowsBefore);
    await client.query('COMMIT');

    const changed = Object.keys(after).filter((table) => after[table] !== before[table]);
    console.log(
      changed.length === 0
        ? 'No change: every table this ingest writes is byte-identical to before the run.'
        : `Changed: ${changed.join(', ')}.`
    );
    console.log(`Committed in ${((Date.now() - started) / 1000).toFixed(1)}s. All assertions passed.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Only run when invoked as a script.
 *
 * The three CSV ingests call main() at module scope, which is fine for a file
 * nothing imports. This one is imported by its test suite, and a top-level
 * main() would mean importing it fetched the live API and wrote to the database.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((err: unknown) => {
      console.error(`\nIngest failed, rolled back. Nothing was written.\n${(err as Error).message}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}

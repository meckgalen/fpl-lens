/**
 * Player reads: the bootstrap aggregate, and one player's gameweek history.
 *
 * Two identity rules run through everything here:
 *
 *   - A player is addressed by `players.fpl_code`, never by an FPL element id.
 *     Element ids are season-scoped and reassigned every August, so element 328
 *     is a different person from one season to the next and a URL built on one
 *     silently repoints at rollover. The season-scoped id lives only in
 *     `player_seasons.fpl_element_id`, for the ingest to join on.
 *   - Team ids leaving this layer are `teams.fpl_team_code`, for the same
 *     reason. See ./teams.ts.
 *
 * On the numeric types: node-postgres returns int2/int4 as JS numbers, but
 * int8 (what SUM over an integer column produces) and numeric as strings. Each
 * query below therefore has a `*DbRow` describing what actually comes back, and
 * a mapper that parses it into the domain type. The DbRow types are not
 * exported: nothing outside this file should ever hold one.
 */

import type { Queryable } from '../db/pool.js';
import type { PlayerGameweek, PlayerSeasonTotals, UpcomingFixture } from '../types/domain.js';
import { num, numOrNull, type DbNumeric } from './parse.js';

/** Rule 10's mapping, run backwards for the wire format. */
const ELEMENT_TYPE_BY_POSITION = `CASE ps.position
        WHEN 'GK'  THEN 1
        WHEN 'DEF' THEN 2
        WHEN 'MID' THEN 3
        WHEN 'FWD' THEN 4
      END`;

interface PlayerTotalsDbRow {
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  team: number;
  element_type: number;
  now_cost: number | null;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  bps: number;
  appearances: number;
  /** numeric -> string. */
  influence: DbNumeric;
  creativity: DbNumeric;
  threat: DbNumeric;
  ict_index: DbNumeric;
  points_per_game: DbNumeric;
  /** NULL before 2022-23; sum() of a smallint returns int8, so also a string. */
  starts: DbNumeric | null;
  expected_goals: DbNumeric | null;
  expected_assists: DbNumeric | null;
  expected_goal_involvements: DbNumeric | null;
  photo: string;
}

function toPlayerSeasonTotals(r: PlayerTotalsDbRow): PlayerSeasonTotals {
  return {
    id: r.id,
    first_name: r.first_name,
    second_name: r.second_name,
    web_name: r.web_name,
    team: r.team,
    element_type: r.element_type,
    now_cost: r.now_cost,

    total_points: r.total_points,
    minutes: r.minutes,
    goals_scored: r.goals_scored,
    assists: r.assists,
    clean_sheets: r.clean_sheets,
    bonus: r.bonus,
    bps: r.bps,

    influence: num(r.influence, 'influence'),
    creativity: num(r.creativity, 'creativity'),
    threat: num(r.threat, 'threat'),
    ict_index: num(r.ict_index, 'ict_index'),

    starts: numOrNull(r.starts, 'starts'),
    expected_goals: numOrNull(r.expected_goals, 'expected_goals'),
    expected_assists: numOrNull(r.expected_assists, 'expected_assists'),
    expected_goal_involvements: numOrNull(
      r.expected_goal_involvements,
      'expected_goal_involvements'
    ),

    appearances: r.appearances,
    points_per_game: num(r.points_per_game, 'points_per_game'),

    photo: r.photo,
  };
}

/**
 * Every player of one season with their season totals.
 *
 * LEFT JOIN to `player_gameweeks` on purpose. A player with no gameweek rows
 * still has to appear: that is nobody today, but it is every player during a
 * preseason, and an inner join would return an empty player list at exactly
 * the moment the app looks most broken.
 *
 * COALESCE to 0 is applied only to the columns present in all ten seasons.
 * expected_goals, friends and `starts` are deliberately left NULL where they
 * are NULL — zero would claim the player generated no chances or started no
 * matches, when the truth is that nobody measured before 2022-23 (rule 6).
 *
 * `appearances` is returned outright rather than left to the caller to infer.
 * It used to be recovered on the client by dividing points by points_per_game,
 * which is wrong by an appearance either way on the rounding and reads 0 for a
 * player who appeared and scored nothing.
 *
 * points_per_game divides by appearances (minutes > 0), not by rounds in the
 * season. Rule 13 requires saying which, and this is the one that reproduces
 * the FPL API's own value: Saka 2025-26 is 157/31 = 5.1, where dividing by his
 * 38 rounds would give 4.1.
 *
 * The rounding goes through float8 deliberately. Postgres rounds numeric half
 * away from zero (3.250 -> 3.3), while FPL — computing in Python — rounds half
 * to even (3.250 -> 3.2). Ten players in 2025-26 land exactly on a tie and
 * disagreed before this. round() on a double precision uses rint(), which is
 * half-to-even, so this reproduces the upstream value instead of being a
 * defensible-but-different number. The division stays in numeric so only the
 * tie-break itself sees a float, and to_char pins the one-decimal presentation
 * that rounding is for; the mapper then parses that text to a number.
 *
 * Measured at ~50ms for a full season, so callers run it per request.
 */
export async function listPlayerTotals(
  db: Queryable,
  season: string
): Promise<PlayerSeasonTotals[]> {
  const { rows } = await db.query<PlayerTotalsDbRow>(
    `SELECT p.fpl_code AS id,
            p.first_name,
            p.second_name,
            p.web_name,
            t.fpl_team_code AS team,
            ${ELEMENT_TYPE_BY_POSITION} AS element_type,
            ps.end_cost AS now_cost,

            COALESCE(sum(pg.total_points), 0)::int AS total_points,
            COALESCE(sum(pg.minutes), 0)::int      AS minutes,
            COALESCE(sum(pg.goals_scored), 0)::int AS goals_scored,
            COALESCE(sum(pg.assists), 0)::int      AS assists,
            COALESCE(sum(pg.clean_sheets), 0)::int AS clean_sheets,
            COALESCE(sum(pg.bonus), 0)::int        AS bonus,
            COALESCE(sum(pg.bps), 0)::int          AS bps,

            COALESCE(sum(pg.influence), 0)  AS influence,
            COALESCE(sum(pg.creativity), 0) AS creativity,
            COALESCE(sum(pg.threat), 0)     AS threat,
            COALESCE(sum(pg.ict_index), 0)  AS ict_index,

            sum(pg.starts)                     AS starts,
            sum(pg.expected_goals)             AS expected_goals,
            sum(pg.expected_assists)           AS expected_assists,
            sum(pg.expected_goal_involvements) AS expected_goal_involvements,

            count(*) FILTER (WHERE pg.minutes > 0)::int AS appearances,

            to_char(
              round(
                (COALESCE(
                   sum(pg.total_points)::numeric
                     / NULLIF(count(*) FILTER (WHERE pg.minutes > 0), 0),
                   0
                 ) * 10)::float8
              )::numeric / 10,
              'FM9990.0'
            ) AS points_per_game,

            p.fpl_code || '.jpg' AS photo
       FROM player_seasons ps
       JOIN players p ON p.id = ps.player_id
       JOIN teams t   ON t.id = ps.team_id
       LEFT JOIN player_gameweeks pg
              ON pg.player_id = ps.player_id AND pg.season = ps.season
      WHERE ps.season = $1
      GROUP BY p.fpl_code, p.first_name, p.second_name, p.web_name,
               t.fpl_team_code, ps.position, ps.end_cost
      ORDER BY p.fpl_code`,
    [season]
  );
  return rows.map(toPlayerSeasonTotals);
}

interface GameweekDbRow {
  fixture: number;
  round: number;
  opponent_team: number;
  was_home: boolean;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  bonus: number;
  bps: number;
  influence: DbNumeric;
  creativity: DbNumeric;
  threat: DbNumeric;
  ict_index: DbNumeric;
  expected_goals: DbNumeric | null;
  expected_assists: DbNumeric | null;
  expected_goal_involvements: DbNumeric | null;
  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
}

function toPlayerGameweek(r: GameweekDbRow): PlayerGameweek {
  return {
    fixture: r.fixture,
    round: r.round,
    opponent_team: r.opponent_team,
    was_home: r.was_home,

    total_points: r.total_points,
    minutes: r.minutes,
    goals_scored: r.goals_scored,
    assists: r.assists,
    clean_sheets: r.clean_sheets,
    goals_conceded: r.goals_conceded,
    bonus: r.bonus,
    bps: r.bps,

    influence: num(r.influence, 'influence'),
    creativity: num(r.creativity, 'creativity'),
    threat: num(r.threat, 'threat'),
    ict_index: num(r.ict_index, 'ict_index'),

    expected_goals: numOrNull(r.expected_goals, 'expected_goals'),
    expected_assists: numOrNull(r.expected_assists, 'expected_assists'),
    expected_goal_involvements: numOrNull(
      r.expected_goal_involvements,
      'expected_goal_involvements'
    ),

    value: r.value,
    selected: r.selected,
    transfers_in: r.transfers_in,
    transfers_out: r.transfers_out,
  };
}

/**
 * One player's season, one row per match played.
 *
 * Ordered by round then kickoff, because a double gameweek puts two rows in
 * one round and they should read in the order they were played (rule 13).
 *
 * `fixture` is selected because the round is not a key: keying rows on it
 * collapses a double gameweek into one, which is the exact case rule 13 exists
 * to protect. 2025-26 round 36 and 2019-20 round 39 both have one.
 */
export async function getPlayerHistory(
  db: Queryable,
  fplCode: number,
  season: string
): Promise<PlayerGameweek[]> {
  const { rows } = await db.query<GameweekDbRow>(
    `SELECT pg.fixture_id AS fixture,
            pg.gw AS round,
            opp.fpl_team_code AS opponent_team,
            pg.was_home,
            pg.total_points,
            pg.minutes,
            pg.goals_scored,
            pg.assists,
            pg.clean_sheets,
            pg.goals_conceded,
            pg.bonus,
            pg.bps,
            pg.influence,
            pg.creativity,
            pg.threat,
            pg.ict_index,
            pg.expected_goals,
            pg.expected_assists,
            pg.expected_goal_involvements,
            pg.value,
            pg.selected,
            pg.transfers_in,
            pg.transfers_out
       FROM player_gameweeks pg
       JOIN players p   ON p.id = pg.player_id
       JOIN teams opp   ON opp.id = pg.opponent_team_id
       JOIN fixtures f  ON f.id = pg.fixture_id
      WHERE p.fpl_code = $1 AND pg.season = $2
      ORDER BY pg.gw, f.kickoff_time`,
    [fplCode, season]
  );
  return rows.map(toPlayerGameweek);
}

/**
 * The player's remaining unplayed fixtures in the season.
 *
 * Empty for every completed season, which is all ten of them — the array is
 * kept because the client renders it and because this becomes real as soon as
 * a live season is being ingested.
 *
 * The club comes from `player_seasons.team_id`, which rule 17 warns is the
 * end-of-season snapshot and therefore wrong for asking "who did he play for
 * in gameweek N". Asking "what does he have left to play" is the forward-
 * looking question the snapshot is actually right for.
 */
export async function getPlayerUpcomingFixtures(
  db: Queryable,
  fplCode: number,
  season: string
): Promise<UpcomingFixture[]> {
  const { rows } = await db.query<UpcomingFixture>(
    `SELECT f.gw AS event,
            home.fpl_team_code AS team_h,
            away.fpl_team_code AS team_a,
            (f.home_team_id = ps.team_id) AS is_home,
            CASE WHEN f.home_team_id = ps.team_id
                 THEN f.home_difficulty ELSE f.away_difficulty END AS difficulty
       FROM player_seasons ps
       JOIN players p  ON p.id = ps.player_id
       JOIN fixtures f ON f.season = ps.season
                      AND ps.team_id IN (f.home_team_id, f.away_team_id)
       JOIN teams home ON home.id = f.home_team_id
       JOIN teams away ON away.id = f.away_team_id
      WHERE p.fpl_code = $1 AND ps.season = $2 AND NOT f.finished
      ORDER BY f.gw, f.kickoff_time`,
    [fplCode, season]
  );
  // Every column here is smallint or integer, which the driver already returns
  // as a number. No mapper, because there is nothing to parse.
  return rows;
}

/** Whether the code names a real player at all, so /player/:code can 404. */
export async function playerExists(db: Queryable, fplCode: number): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM players WHERE fpl_code = $1) AS exists',
    [fplCode]
  );
  return rows[0].exists;
}

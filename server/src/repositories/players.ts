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
 * int8 (what SUM over an integer column produces) and numeric as strings. The
 * casts below are chosen so the wire types match what the client already
 * parses — counting stats as numbers, the decimal stats as strings.
 */

import type { Queryable } from '../db/pool.js';

/** Rule 10's mapping, run backwards for the wire format. */
const ELEMENT_TYPE_BY_POSITION = `CASE ps.position
        WHEN 'GK'  THEN 1
        WHEN 'DEF' THEN 2
        WHEN 'MID' THEN 3
        WHEN 'FWD' THEN 4
      END`;

export interface PlayerTotalsRow {
  /** players.fpl_code — permanent. */
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  /** teams.fpl_team_code of the club on the season's end-of-season snapshot (rule 17). */
  team: number;
  element_type: number;
  /** £0.1m units, raw (rule 9). */
  now_cost: number | null;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  bps: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  /** NULL before 2022-23 — not measured, not zero (rule 6). */
  expected_goals: string | null;
  expected_assists: string | null;
  expected_goal_involvements: string | null;
  points_per_game: string;
  photo: string;
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
 * expected_goals and friends are deliberately left NULL where they are NULL —
 * zero would claim the player generated no chances, when the truth is that
 * nobody measured before 2022-23 (rule 6).
 *
 * points_per_game divides by matches the player actually appeared in
 * (minutes > 0), not by rounds in the season. Rule 13 requires saying which,
 * and this is the one that reproduces the FPL API's own value: Saka 2025-26 is
 * 157/31 = 5.1, where dividing by his 38 rounds would give 4.1.
 *
 * The rounding goes through float8 deliberately. Postgres rounds numeric half
 * away from zero (3.250 -> 3.3), while FPL — computing in Python — rounds half
 * to even (3.250 -> 3.2). Ten players in 2025-26 land exactly on a tie and
 * disagreed before this. round() on a double precision uses rint(), which is
 * half-to-even, so this reproduces the upstream value instead of being a
 * defensible-but-different number. The division stays in numeric so only the
 * tie-break itself sees a float.
 *
 * Measured at ~50ms for a full season, so callers run it per request.
 */
export async function listPlayerTotals(
  db: Queryable,
  season: string
): Promise<PlayerTotalsRow[]> {
  const { rows } = await db.query<PlayerTotalsRow>(
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

            sum(pg.expected_goals)              AS expected_goals,
            sum(pg.expected_assists)            AS expected_assists,
            sum(pg.expected_goal_involvements)  AS expected_goal_involvements,

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
  return rows;
}

export interface GameweekRow {
  round: number;
  /** teams.fpl_team_code of the opponent. */
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
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string | null;
  expected_assists: string | null;
  expected_goal_involvements: string | null;
  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
}

/**
 * One player's season, one row per match played.
 *
 * Ordered by round then kickoff, because a double gameweek puts two rows in
 * one round and they should read in the order they were played (rule 13).
 */
export async function getPlayerHistory(
  db: Queryable,
  fplCode: number,
  season: string
): Promise<GameweekRow[]> {
  const { rows } = await db.query<GameweekRow>(
    `SELECT pg.gw AS round,
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
  return rows;
}

export interface UpcomingFixtureRow {
  event: number | null;
  team_h: number;
  team_a: number;
  is_home: boolean;
  difficulty: number | null;
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
): Promise<UpcomingFixtureRow[]> {
  const { rows } = await db.query<UpcomingFixtureRow>(
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
  return rows;
}

/** Whether the code names a real player at all, so /player/:id can 404. */
export async function playerExists(db: Queryable, fplCode: number): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM players WHERE fpl_code = $1) AS exists',
    [fplCode]
  );
  return rows[0].exists;
}

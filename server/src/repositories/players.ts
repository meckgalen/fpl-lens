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
import type {
  PlayerCareerSeason,
  PlayerGameweek,
  PlayerSeasonTotals,
  UpcomingFixture,
} from '../types/domain.js';
import { num, numOrNull, type DbNumeric } from './parse.js';

/** Rule 10's mapping, run backwards for the wire format. */
const ELEMENT_TYPE_BY_POSITION = `CASE ps.position
        WHEN 'GK'  THEN 1
        WHEN 'DEF' THEN 2
        WHEN 'MID' THEN 3
        WHEN 'FWD' THEN 4
      END`;

/**
 * The season aggregate, shared by the bootstrap list and the career list.
 *
 * Two queries summing the same columns over the same table, differing only in
 * what they group by, must not each carry their own copy of the arithmetic.
 * The half-to-even rounding below is the reason: it is easy to paste the
 * division and drop the `::float8`, and the result disagrees with FPL on
 * exactly the rows that land on a .x5 tie — a handful per season, silently.
 *
 * COALESCE to 0 is applied only to columns present in all ten seasons. `starts`
 * and the xG family are left NULL where they are NULL: zero would claim the
 * player started no matches and generated no chances, when the truth is that
 * nobody measured before 2022-23 (rule 6).
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
 */
const SEASON_AGGREGATE = `COALESCE(sum(pg.total_points), 0)::int AS total_points,
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
            ) AS points_per_game`;

/**
 * The stats the season aggregate above does not carry, summed for a career row.
 *
 * Split by nullability, which is a property of the season rather than of the
 * stat: the six above the line exist in all ten seasons and COALESCE to 0
 * legitimately, the ones below do not exist in every season and must stay NULL
 * where they are missing (rule 6). Getting a column on the wrong side of that
 * line produces a table full of plausible zeroes.
 *
 * The defensive trio is the case that reads backwards: `tackles`, `recoveries`
 * and `clearances_blocks_interceptions` were collected in 2016-17 through
 * 2018-19, dropped for six seasons, and collected again in 2025-26. A season in
 * the middle showing 0 tackles would be a claim about the player rather than
 * about the feed.
 */
const CAREER_EXTRA_AGGREGATE = `COALESCE(sum(pg.goals_conceded), 0)::int    AS goals_conceded,
            COALESCE(sum(pg.own_goals), 0)::int         AS own_goals,
            COALESCE(sum(pg.penalties_saved), 0)::int   AS penalties_saved,
            COALESCE(sum(pg.penalties_missed), 0)::int  AS penalties_missed,
            COALESCE(sum(pg.yellow_cards), 0)::int      AS yellow_cards,
            COALESCE(sum(pg.red_cards), 0)::int         AS red_cards,
            COALESCE(sum(pg.saves), 0)::int             AS saves,

            sum(pg.expected_goals_conceded)          AS expected_goals_conceded,
            sum(pg.tackles)                          AS tackles,
            sum(pg.clearances_blocks_interceptions)  AS clearances_blocks_interceptions,
            sum(pg.recoveries)                       AS recoveries,
            sum(pg.defensive_contribution)           AS defensive_contribution`;

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
 * The arithmetic is SEASON_AGGREGATE above — the same expressions the career
 * list sums, so the totals beside a player's name and the totals on his career
 * row cannot disagree. This query deliberately does NOT extend to
 * CAREER_EXTRA_AGGREGATE: the bootstrap runs it for every player in the season
 * on every request, and nothing on the player list renders those columns.
 *
 * `appearances` is returned outright rather than left to the caller to infer.
 * It used to be recovered on the client by dividing points by points_per_game,
 * which is wrong by an appearance either way on the rounding and reads 0 for a
 * player who appeared and scored nothing.
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
            -- The price to show, and the COALESCE is what finally makes this
            -- alias honest. It read end_cost AS now_cost from step 6 until
            -- item 4, which was a small lie on every season: end_cost is the
            -- price a season CLOSED at. now_cost is written by the live ingest
            -- on every run and is NULL on the ten completed seasons --
            -- deliberately not backfilled, since two columns holding one fact
            -- is what this schema avoids -- so NULL here means "that season is
            -- over, ask end_cost" and the fallback is right on every row
            -- without anyone having to know which season they are looking at.
            COALESCE(ps.now_cost, ps.end_cost) AS now_cost,

            ${SEASON_AGGREGATE},

            p.fpl_code || '.jpg' AS photo
       FROM player_seasons ps
       JOIN players p ON p.id = ps.player_id
       JOIN teams t   ON t.id = ps.team_id
       LEFT JOIN player_gameweeks pg
              ON pg.player_id = ps.player_id AND pg.season = ps.season
      WHERE ps.season = $1
      GROUP BY p.fpl_code, p.first_name, p.second_name, p.web_name,
               t.fpl_team_code, ps.position, ps.now_cost, ps.end_cost
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
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  influence: DbNumeric;
  creativity: DbNumeric;
  threat: DbNumeric;
  ict_index: DbNumeric;
  expected_goals: DbNumeric | null;
  expected_assists: DbNumeric | null;
  expected_goal_involvements: DbNumeric | null;
  expected_goals_conceded: DbNumeric | null;
  /**
   * smallint, so the driver hands these back as numbers already — unlike the
   * career row, where the same columns arrive as int8 strings because they have
   * been through sum(). Same names, different parse, on purpose.
   */
  tackles: number | null;
  clearances_blocks_interceptions: number | null;
  recoveries: number | null;
  defensive_contribution: number | null;
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
    own_goals: r.own_goals,
    penalties_saved: r.penalties_saved,
    penalties_missed: r.penalties_missed,
    yellow_cards: r.yellow_cards,
    red_cards: r.red_cards,
    saves: r.saves,
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
    expected_goals_conceded: numOrNull(r.expected_goals_conceded, 'expected_goals_conceded'),

    // Already numbers or null: smallint, straight from the driver. Passed
    // through rather than sent via numOrNull so the parse is not claimed where
    // none happened.
    tackles: r.tackles,
    clearances_blocks_interceptions: r.clearances_blocks_interceptions,
    recoveries: r.recoveries,
    defensive_contribution: r.defensive_contribution,

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
            pg.own_goals,
            pg.penalties_saved,
            pg.penalties_missed,
            pg.yellow_cards,
            pg.red_cards,
            pg.saves,
            pg.bonus,
            pg.bps,
            pg.influence,
            pg.creativity,
            pg.threat,
            pg.ict_index,
            pg.expected_goals,
            pg.expected_assists,
            pg.expected_goal_involvements,
            pg.expected_goals_conceded,
            pg.tackles,
            pg.clearances_blocks_interceptions,
            pg.recoveries,
            pg.defensive_contribution,
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

interface CareerDbRow {
  season: string;
  team: number;
  team_name: string;
  team_short_name: string;
  element_type: number;
  start_cost: number | null;
  end_cost: number | null;
  matches: number;

  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  appearances: number;

  /** numeric -> string. */
  influence: DbNumeric;
  creativity: DbNumeric;
  threat: DbNumeric;
  ict_index: DbNumeric;
  points_per_game: DbNumeric;

  /** sum() of a smallint returns int8, so these are strings too, not numbers. */
  starts: DbNumeric | null;
  expected_goals: DbNumeric | null;
  expected_assists: DbNumeric | null;
  expected_goal_involvements: DbNumeric | null;
  expected_goals_conceded: DbNumeric | null;
  tackles: DbNumeric | null;
  clearances_blocks_interceptions: DbNumeric | null;
  recoveries: DbNumeric | null;
  defensive_contribution: DbNumeric | null;
}

function toPlayerCareerSeason(r: CareerDbRow): PlayerCareerSeason {
  return {
    season: r.season,

    team: r.team,
    team_name: r.team_name,
    team_short_name: r.team_short_name,
    element_type: r.element_type,
    start_cost: r.start_cost,
    end_cost: r.end_cost,

    matches: r.matches,
    appearances: r.appearances,
    points_per_game: num(r.points_per_game, 'points_per_game'),

    total_points: r.total_points,
    minutes: r.minutes,
    goals_scored: r.goals_scored,
    assists: r.assists,
    clean_sheets: r.clean_sheets,
    goals_conceded: r.goals_conceded,
    own_goals: r.own_goals,
    penalties_saved: r.penalties_saved,
    penalties_missed: r.penalties_missed,
    yellow_cards: r.yellow_cards,
    red_cards: r.red_cards,
    saves: r.saves,
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
    expected_goals_conceded: numOrNull(r.expected_goals_conceded, 'expected_goals_conceded'),
    tackles: numOrNull(r.tackles, 'tackles'),
    clearances_blocks_interceptions: numOrNull(
      r.clearances_blocks_interceptions,
      'clearances_blocks_interceptions'
    ),
    recoveries: numOrNull(r.recoveries, 'recoveries'),
    defensive_contribution: numOrNull(r.defensive_contribution, 'defensive_contribution'),
  };
}

/**
 * One player's whole career, one row per season, newest first.
 *
 * This is what the FPL site's "Previous Seasons" table shows and where it
 * stops. Here every row has its gameweeks underneath it — getPlayerHistory for
 * the same code and that row's `season` returns exactly the matches these
 * totals are the sum of.
 *
 * Driven from `player_seasons` with a LEFT JOIN, not from `player_gameweeks`:
 * a season a player is registered for but has not played in yet is a real row
 * with nothing in it, and an inner join would silently omit it. Today no
 * player-season in the ten has zero match rows, so this only matters for a live
 * season — which is the point of writing it now rather than discovering it in
 * August.
 *
 * `matches` is `count(pg.fixture_id)`, never `count(*)`. Over a LEFT JOIN miss
 * `count(*)` counts the outer row and reports 1 match that does not exist,
 * which is exactly the value that would make the empty season above
 * indistinguishable from a one-match one.
 *
 * The club is joined and denormalised onto the row (team_name,
 * team_short_name) because a career crosses clubs that no longer exist in any
 * current season — Middlesbrough, Hull, Sunderland, Cardiff — so no
 * single-season lookup table the caller might hold can name them all.
 *
 * **That club is the end-of-season snapshot (rule 17).** `players_raw.csv` is
 * dumped when the season ends, so a January transfer is recorded under the new
 * club for the whole row. It does not answer "who was he playing for in
 * gameweek N"; the fixture on each PlayerGameweek does, which is what the row
 * expands into.
 *
 * Costs keep their own names. `end_cost AS now_cost`, which the bootstrap does
 * because FPL's shape calls it that, would be a lie on a 2016-17 row.
 */
export async function getPlayerCareer(
  db: Queryable,
  fplCode: number
): Promise<PlayerCareerSeason[]> {
  const { rows } = await db.query<CareerDbRow>(
    `SELECT ps.season,
            t.fpl_team_code AS team,
            t.name          AS team_name,
            t.short_name    AS team_short_name,
            ${ELEMENT_TYPE_BY_POSITION} AS element_type,
            ps.start_cost,
            ps.end_cost,

            count(pg.fixture_id)::int AS matches,

            ${SEASON_AGGREGATE},

            ${CAREER_EXTRA_AGGREGATE}
       FROM player_seasons ps
       JOIN players p ON p.id = ps.player_id
       JOIN teams t   ON t.id = ps.team_id
       LEFT JOIN player_gameweeks pg
              ON pg.player_id = ps.player_id AND pg.season = ps.season
      WHERE p.fpl_code = $1
      GROUP BY ps.season, t.fpl_team_code, t.name, t.short_name,
               ps.position, ps.start_cost, ps.end_cost
      ORDER BY ps.season DESC`,
    [fplCode]
  );
  return rows.map(toPlayerCareerSeason);
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

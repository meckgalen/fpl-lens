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
  PlayerIdentity,
  PlayerSeasonTotals,
  UpcomingFixture,
} from '../types/domain.js';
import { defconHitSql, defconHitCountSql } from './defcon.js';
import { POINT_THRESHOLDS, pointCountSql } from './hauls.js';
import { num, numArray, numOrNull, type DbNumeric } from './parse.js';

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
 * Those columns go through `measuredSum` rather than a bare `sum()`. See the
 * comment on it: a column measured for only part of a season has no honest
 * total, and `sum()` would quietly produce one.
 *
 * points_per_game divides by appearances (minutes > 0), not by rounds in the
 * season. Rule 13 requires saying which, and this is the one that reproduces
 * the FPL API's own value: Saka 2025-26 is 157/31 = 5.1, where dividing by his
 * 38 rounds would give 4.1. Confirmed against FPL's own published figure on
 * 400 of 400 comparable players — see the verify script.
 *
 * **It is sent unrounded, and the rounding happens once on the client.** This
 * used to end in `to_char(round((x * 10)::float8)::numeric / 10, 'FM9990.0')`,
 * which reproduced FPL's half-to-even rounding in SQL. That was correct and it
 * was in the wrong place: it made this the only value in the whole API that
 * crossed the wire pre-formatted, against rule 8, and it meant the same rounding
 * rule existed in two languages — SQL here, `toFixed` in the averages row — free
 * to disagree in the last digit, which they did on 111 player-seasons.
 *
 * The convention itself is unchanged and still matters: Postgres rounds numeric
 * half away from zero (3.250 -> 3.3) while FPL, computing in Python, rounds half
 * to even (3.250 -> 3.2). It now lives in `roundHalfEven` in
 * `client/src/lib/averages.ts`, applied by the one formatter that renders both
 * this number and the averages row. See API identity rule 5.
 */
/**
 * The total of a column that is NULL where it was not measured — NULL unless
 * every contributing row has a value.
 *
 * The distinction this draws, and the whole reason it exists: **missing rows
 * are not missing values.** A blank gameweek, a season still being played and a
 * player who joined in January all produce fewer rows, and summing what is
 * there is exactly right — a season-to-date total is a real number. A column
 * NULL on *some of the rows that exist* is a different thing, and has no honest
 * total at all.
 *
 * A bare `sum()` cannot tell those apart, because it skips NULLs. That was safe
 * while every nullable column was measured for a whole season or for none of
 * it, which was true until item 7: 2022-23 measures `starts` and the expected
 * family from round 16, and the rounds before now store NULL. Summing them
 * would report a fourteen-round-short figure in a cell that looks exactly like
 * a complete one.
 *
 * `count(pg.fixture_id)` rather than `count(*)` because both callers LEFT JOIN
 * `player_gameweeks`: a player-season with no match rows null-extends to one
 * row, where `count(*)` is 1 and `count(fixture_id)` is 0. With no rows both
 * sides are 0 and the result is `sum()` over nothing, which is NULL — the same
 * answer a bare `sum()` gave.
 *
 * **This degrades per player, not per season.** A 2022-23 player who first
 * appeared in round 20 has no holed rows, so his total stays a real number;
 * only the players who actually played through the hole lose theirs. That is
 * the right behaviour, and it is why the column does not simply blank for the
 * whole season.
 */
/**
 * The guard: every row that exists carries a value for this column.
 *
 * **It is sufficient for a sum and insufficient for a count, and the difference
 * is not obvious.** Over a player-season with *no* gameweek rows both sides are
 * 0, so this reads TRUE vacuously — the same vacuous truth item 13 found in the
 * availability predicate. `measuredSum` survives that because `sum()` over zero
 * rows is NULL, so the guard passing changes nothing. A `count(*) FILTER (…)`
 * over zero rows is **0**, so an aggregate built on counting must add
 * `count(pg.fixture_id) > 0` itself. See `defcon_hits` in `listPlayerTotals`,
 * where omitting it gave all 564 players of 2026-27 a confident zero.
 */
const fullyMeasured = (column: string): string =>
  `count(pg.${column}) = count(pg.fixture_id)`;

const measuredSum = (column: string): string =>
  `CASE WHEN ${fullyMeasured(column)} THEN sum(pg.${column}) END`;

const SEASON_AGGREGATE = `COALESCE(sum(pg.total_points), 0)::int AS total_points,
            COALESCE(sum(pg.minutes), 0)::int      AS minutes,
            COALESCE(sum(pg.goals_scored), 0)::int AS goals_scored,
            COALESCE(sum(pg.assists), 0)::int      AS assists,
            COALESCE(sum(pg.clean_sheets), 0)::int AS clean_sheets,
            COALESCE(sum(pg.bonus), 0)::int        AS bonus,
            COALESCE(sum(pg.bps), 0)::int          AS bps,

            -- saves and defensive_contribution moved up from
            -- CAREER_EXTRA_AGGREGATE in item 13, so the Players list can offer
            -- them as selectable columns. They are here rather than in both
            -- places because getPlayerCareer embeds this block AND that one:
            -- two SELECT items with one alias is legal SQL and the driver keeps
            -- whichever arrives last, which is a silent way to have one column
            -- computed by two expressions.
            COALESCE(sum(pg.saves), 0)::int        AS saves,
            ${measuredSum('defensive_contribution')} AS defensive_contribution,

            -- The ICT quartet keeps COALESCE and does NOT go through
            -- measuredSum, which is a deliberate exception rather than an
            -- oversight. It is holed too — 26 fixtures across 2019-20, 2021-22
            -- and 2022-23 — but those holes are whole rounds, so blanking would
            -- cost every player in two seasons their ICT total to correct one
            -- round in thirty-eight. The columns are also NOT NULL in the
            -- schema, so there is nothing here for measuredSum to find. See
            -- CLAUDE.md, Known Issues.
            COALESCE(sum(pg.influence), 0)  AS influence,
            COALESCE(sum(pg.creativity), 0) AS creativity,
            COALESCE(sum(pg.threat), 0)     AS threat,
            COALESCE(sum(pg.ict_index), 0)  AS ict_index,

            ${measuredSum('starts')}                     AS starts,
            ${measuredSum('expected_goals')}             AS expected_goals,
            ${measuredSum('expected_assists')}           AS expected_assists,
            ${measuredSum('expected_goal_involvements')} AS expected_goal_involvements,

            count(*) FILTER (WHERE pg.minutes > 0)::int AS appearances,

            -- Unrounded. The rounding moved to the client, and that is the whole
            -- point rather than a tidy-up: the to_char(round(...)) that used to be
            -- here made this the ONE value in the API arriving pre-formatted, so
            -- the averages row and this number were rounded by two implementations
            -- in two languages and could disagree in the last digit. Now one
            -- formatter produces both and they cannot. See lib/averages.ts, rule 5.
            -- (No backticks in here: this SQL is itself a template literal.)
            COALESCE(
              sum(pg.total_points)::numeric
                / NULLIF(count(*) FILTER (WHERE pg.minutes > 0), 0),
              0
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

            ${measuredSum('expected_goals_conceded')}         AS expected_goals_conceded,
            ${measuredSum('tackles')}                         AS tackles,
            ${measuredSum('clearances_blocks_interceptions')} AS clearances_blocks_interceptions,
            ${measuredSum('recoveries')}                      AS recoveries`;

interface PlayerTotalsDbRow {
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  team: number;
  element_type: number;
  now_cost: number | null;
  start_cost: number | null;
  /** count(pg.fixture_id) — 0 for a registered player with no match rows. */
  matches: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  bps: number;
  saves: number;
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
  defensive_contribution: DbNumeric | null;
  /**
   * Cast to int in the query, so this is a number and not an int8 string —
   * unlike the sums above it. NULL where DC was unmeasured or nothing was
   * played.
   */
  defcon_hits: number | null;
  /**
   * The DCH/St numerator: hits made in fixtures the player started.
   *
   * Nullable for everything `defcon_hits` is nullable for, **and one thing
   * more** — a player-season whose `starts` column is only partly measured has
   * no honest gated count, exactly as `hauls_started` beside it does not.
   */
  defcon_hits_started: number | null;
  /**
   * `number`, not `number | null`, and the COALESCE in the query is the whole
   * reason — a haul count over zero match rows is a real 0, like `goals_scored`
   * beside it. Typing these nullable to match their `_started` siblings below
   * would break the raw pass-through against a non-null domain field, and the
   * reflexive fix for that is a `!` asserting away a null that cannot occur.
   */
  hauls: number;
  floors: number;
  /**
   * Genuinely nullable, unlike the pair above: NULL wherever `starts` is not
   * measured across the whole player-season, and on a player with no match rows
   * at all. Cast to int in the query, so a number rather than an int8 string.
   */
  hauls_started: number | null;
  floors_started: number | null;
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
    start_cost: r.start_cost,
    matches: r.matches,

    total_points: r.total_points,
    minutes: r.minutes,
    goals_scored: r.goals_scored,
    assists: r.assists,
    clean_sheets: r.clean_sheets,
    bonus: r.bonus,
    bps: r.bps,
    saves: r.saves,

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
    defensive_contribution: numOrNull(r.defensive_contribution, 'defensive_contribution'),
    // Already a number or null: cast to int in the query. Passed through rather
    // than sent via numOrNull, so no parse is claimed where none happened.
    defcon_hits: r.defcon_hits,
    defcon_hits_started: r.defcon_hits_started,

    // All four are ::int in the query, so they pass through for the same reason
    // defcon_hits does: numOrNull would claim a parse that did not happen.
    hauls: r.hauls,
    floors: r.floors,
    hauls_started: r.hauls_started,
    floors_started: r.floors_started,

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

            -- The price the season OPENED at, which no COALESCE touches: it is
            -- written once and is complete on all eleven seasons (683/683
            -- through 564/564, range 40-155). It is a different fact from the
            -- one above, which is why the Pts/£ and Pts/£s columns can differ.
            ps.start_cost,

            -- count(pg.fixture_id), never count(*): both sides of this LEFT
            -- JOIN matter here. A registered player with no match rows
            -- null-extends to one row, where count(*) reports 1 match that was
            -- never played -- exactly the value that would make a season with
            -- no matches indistinguishable from one with a single match, which
            -- is the distinction the season-level availability flag turns on.
            count(pg.fixture_id)::int AS matches,

            ${SEASON_AGGREGATE},

            -- How many gameweeks cleared the defensive contribution threshold.
            -- The season total does not answer this: Gabriel's 2025-26 is 277 DC
            -- over 30 starts, 9.2 a start against a defender's 10, and that
            -- average cannot distinguish a player who hits most weeks from one
            -- who almost never does. He hits 11 times in 38.
            --
            -- **Here rather than in SEASON_AGGREGATE, deliberately.** That block
            -- is shared with getPlayerCareer, and the career table has no
            -- availability machinery: it would render this as the no-value
            -- marker for the nine seasons that never measured DC, with nothing
            -- on screen saying why, where the Players list withholds the column
            -- and names the reason. Promoting it means answering availability
            -- for the career table first.
            --
            -- **Both halves of the guard are required.** fullyMeasured alone is
            -- the rule-6 half: no honest count exists over a column measured on
            -- only some of the rows. count(pg.fixture_id) > 0 is the half that
            -- is easy to miss -- over a player with no match rows the first
            -- condition is 0 = 0 and passes, and count(*) FILTER over nothing
            -- returns 0, not NULL. Without it every one of 2026-27's 564
            -- players reads 0 hits on the season the app defaults to. Measured
            -- before the guard was written; see the comment on fullyMeasured.
            (CASE WHEN count(pg.fixture_id) > 0
                   AND ${fullyMeasured('defensive_contribution')}
                  THEN ${defconHitCountSql('pg', 'ps', { startedOnly: false })}
             END)::int AS defcon_hits,

            -- The DCH/St numerator, gated on starts = 1. Item 24.
            --
            -- **The count column above and this one no longer share a
            -- numerator, and that reversal is the whole item.** Item 14 had
            -- them share one deliberately, so that a value above 1 would read
            -- as "hits more often than he starts" rather than as a bug. Item 19
            -- then shipped Pts10+/St with a gated numerator, leaving two
            -- ratios under the same /St suffix with opposite semantics and
            -- nothing on screen distinguishing them. This is the one that
            -- moved, because a numerator drawn from a population the
            -- denominator does not cover is a ratio of two different things.
            --
            -- DCH itself is untouched: a hit off the bench is still a hit. It
            -- is only excluded from a ratio whose denominator is starts.
            --
            -- **THREE guards, where defcon_hits needs two.** The first two are
            -- defcon_hits' own and mean the same thing. fullyMeasured('starts')
            -- is the third and is load-bearing for the reason hauls_started's
            -- is: pg.starts = 1 where starts IS NULL is NULL, so the row falls
            -- out of the FILTER and the count silently undercounts rather than
            -- erroring. It cannot bite today -- DC is measured only in 2025-26,
            -- where starts is measured on every row -- but it is the guard that
            -- would be missing on a season measuring DC and holing starts, and
            -- a guard added only once it bites is a guard added after the wrong
            -- number shipped.
            (CASE WHEN count(pg.fixture_id) > 0
                   AND ${fullyMeasured('defensive_contribution')}
                   AND ${fullyMeasured('starts')}
                  THEN ${defconHitCountSql('pg', 'ps', { startedOnly: true })}
             END)::int AS defcon_hits_started,

            -- Hauls and floors: how many fixtures reached 10 and 4 points. The
            -- rule is stated once, in repositories/hauls.ts. Here rather than in
            -- SEASON_AGGREGATE for the same reason defcon_hits is -- the career
            -- table is out of item 19's scope and has no availability machinery.
            --
            -- **COALESCEd to 0, unlike defcon_hits above, and that is the whole
            -- difference between them.** defcon_hits reads NULL on 2026-27
            -- because defensive_contribution is genuinely unmeasured there.
            -- total_points is NOT NULL in every season, so a haul count has no
            -- unmeasured state: a player with no match rows has hauled zero
            -- times, exactly as he has scored zero goals, and goals_scored above
            -- COALESCEs for that reason. Rule 6 -- 0 is a measurement.
            COALESCE(${pointCountSql('pg', POINT_THRESHOLDS.HAUL, { startedOnly: false })}, 0)::int
              AS hauls,
            COALESCE(${pointCountSql('pg', POINT_THRESHOLDS.FLOOR, { startedOnly: false })}, 0)::int
              AS floors,

            -- The ratio numerators, gated on starts = 1 so Pts10+/St and Pts4+/St are
            -- bounded at 1.00. Since item 24 defcon_hits_started above is gated
            -- the same way and carries the same bound.
            --
            -- **Still two expressions, and they must stay two.** They compare
            -- against different rules -- a points line here, a positional DC
            -- threshold there -- so sharing a fragment would put one rule where
            -- the other belongs. What they share is the startedOnly flag, which
            -- is the part that was inconsistent and is now not.
            --
            -- (No backticks in these comments: this SQL is a template literal.)
            --
            -- **fullyMeasured('starts') is load-bearing and is not the same
            -- guard defcon_hits uses.** pg.starts = 1 where starts IS NULL is
            -- NULL, so the CASE falls to ELSE 0 and the count silently
            -- undercounts instead of erroring -- on 2022-23, whose starts begin
            -- at round 16, an unguarded count reads fourteen rounds of real
            -- appearances as bench appearances (measured: 166 phantom bench
            -- hauls that season).
            --
            -- **count(pg.fixture_id) > 0 is required here too, and the reason it
            -- looked unnecessary is worth writing down.** The argument that
            -- talked item 19 out of it: defcon_hits needs the guard because
            -- count(*) FILTER over zero rows is 0, whereas sum() over zero rows
            -- is NULL, so a sum-based count should null out by itself.
            --
            -- That is true of sum() and false here, because there are not zero
            -- rows. This is a LEFT JOIN, so a player with no match rows
            -- null-extends to exactly ONE grouped row, and sum(CASE ... ELSE 0)
            -- over one null row is a hard 0. Measured before the guard went in:
            -- all 564 players of 2026-27 read hauls_started = 0, which asserts
            -- they started no 10-point fixture rather than that nothing was
            -- played.
            --
            -- So it is item 13's vacuous-truth hole in a THIRD place, and the
            -- shape to remember is that the ELSE, not the aggregate, is what
            -- defeats the null. A sum with no ELSE would have nulled out.
            (CASE WHEN count(pg.fixture_id) > 0
                   AND ${fullyMeasured('starts')}
                  THEN ${pointCountSql('pg', POINT_THRESHOLDS.HAUL, { startedOnly: true })}
             END)::int AS hauls_started,
            (CASE WHEN count(pg.fixture_id) > 0
                   AND ${fullyMeasured('starts')}
                  THEN ${pointCountSql('pg', POINT_THRESHOLDS.FLOOR, { startedOnly: true })}
             END)::int AS floors_started,

            p.fpl_code || '.jpg' AS photo
       FROM player_seasons ps
       JOIN players p ON p.id = ps.player_id
       JOIN teams t   ON t.id = ps.team_id
       LEFT JOIN player_gameweeks pg
              ON pg.player_id = ps.player_id AND pg.season = ps.season
      WHERE ps.season = $1
      GROUP BY p.fpl_code, p.first_name, p.second_name, p.web_name,
               t.fpl_team_code, ps.position, ps.now_cost, ps.end_cost,
               ps.start_cost
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
  /** smallint, so a number already. NULL before 2022-23 and before its GW16. */
  starts: number | null;
  /** The CASE casts to int, so a number. NULL where DC was never measured. */
  defcon_hit: number | null;
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

    // Both already numbers or null — `starts` is a smallint straight from the
    // driver, `defcon_hit` is cast to int in the CASE. Passed through for the
    // same reason the defensive quartet above is.
    starts: r.starts,
    defcon_hit: r.defcon_hit,
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
            pg.transfers_out,

            -- Whether he started, which is the one thing this table could not
            -- say. A row reading 45 minutes is either a start hooked at half
            -- time or a substitute brought on at half time, and those are
            -- different players. 0/1 per row; NULL before 2022-23, and before
            -- round 16 of it, where the source never measured it (rule 6).
            pg.starts,

            -- Whether the gameweek cleared the defensive contribution
            -- threshold. Modelled on clean sheets: a per-gameweek fact whose
            -- season figure is the count of them.
            ${defconHitSql('pg', 'ps')} AS defcon_hit
       FROM player_gameweeks pg
       JOIN players p   ON p.id = pg.player_id
       JOIN teams opp   ON opp.id = pg.opponent_team_id
       JOIN fixtures f  ON f.id = pg.fixture_id

       -- LEFT, not inner, and the two halves of the invariant are not equally
       -- protected. It CANNOT multiply: player_seasons' primary key is
       -- (player_id, season), so at most one row matches -- enforced by a
       -- constraint rather than by luck. It CAN be orphaned: player_gameweeks
       -- has foreign keys to fixtures, teams and players and none to
       -- player_seasons, so a match row with no player-season row is
       -- representable. There are zero today and nothing stops one.
       --
       -- So the failure mode is the whole argument. An inner join DROPS such a
       -- row and the gameweek vanishes from the table with nothing on screen
       -- saying so, which is the quiet-wrong-answer class this project keeps
       -- refusing to ship. A left join yields a NULL position, which falls
       -- through defconHitSql's ELSE-less CASE to NULL and renders the no-value
       -- marker: visible, and rule 6's posture. Pinned by test.
       LEFT JOIN player_seasons ps
              ON ps.player_id = pg.player_id AND ps.season = pg.season
      WHERE p.fpl_code = $1 AND pg.season = $2
      ORDER BY pg.gw, f.kickoff_time`,
    [fplCode, season]
  );
  return rows.map(toPlayerGameweek);
}

interface CareerDbRow {
  season: string;
  /** int2[] from the driver, so already numbers — parsed anyway, see `numArray`. */
  rounds: DbNumeric[] | null;
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
    rounds: numArray(r.rounds, 'rounds'),

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

            -- Every round the SEASON played, not every round this player has a
            -- row in. A correlated subquery rather than a join, so the GROUP BY
            -- below stays the list of scalar columns it already is.
            --
            -- \`gw IS NOT NULL\` matches listEvents. A postponed fixture has its
            -- round nulled until a new one is assigned, and it must neither
            -- invent a round nor remove one that other fixtures still populate.
            (SELECT array_agg(DISTINCT f.gw ORDER BY f.gw)
               FROM fixtures f
              WHERE f.season = ps.season AND f.gw IS NOT NULL) AS rounds,

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

/**
 * Who the player is, with no season involved — or null if the code names
 * nobody, which is the same 404 `playerExists` gives.
 *
 * Every column is from `players` alone. `photo` is derived here the way
 * `listPlayerTotals` derives it and the way FPL builds it (API identity rule
 * 5), so the two cannot drift into different filenames.
 *
 * This is what `/career` returns beside its rows, and it is a replacement for
 * that route's `playerExists` call rather than an addition to it: one query
 * answers "does this player exist" and "who is he" together.
 */
export async function getPlayerIdentity(
  db: Queryable,
  fplCode: number
): Promise<PlayerIdentity | null> {
  const { rows } = await db.query<PlayerIdentity>(
    `SELECT p.fpl_code AS id,
            p.first_name,
            p.second_name,
            p.web_name,
            p.fpl_code || '.jpg' AS photo
       FROM players p
      WHERE p.fpl_code = $1`,
    [fplCode]
  );
  return rows[0] ?? null;
}

/** Whether the code names a real player at all, so /player/:code can 404. */
export async function playerExists(db: Queryable, fplCode: number): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM players WHERE fpl_code = $1) AS exists',
    [fplCode]
  );
  return rows[0].exists;
}

/**
 * Domain types: what this app means, as opposed to what an upstream sent.
 *
 * Three things are true here that are not true of ../types/wire.ts:
 *
 *   1. **Numbers are numbers.** No decimal arrives as a string. Postgres hands
 *      `numeric` back as text and the FPL API sends `'0.57'`; both are parsed
 *      once, in the repository mapper, and never again. A component that calls
 *      parseFloat is a bug.
 *   2. **Ids are permanent codes.** `Player.id` is `players.fpl_code` and every
 *      team id is `teams.fpl_team_code`. Season-scoped FPL ids do not exist in
 *      this file; they stop at the ingest layer, which is what rules 2, 3 and 5
 *      and API identity rules 1 and 2 are for.
 *   3. **Null means "not measured".** A stat that a season never collected is
 *      `null`, never 0 (rule 6). xG starts in 2022-23, `starts` in 2022-23,
 *      difficulty ratings in 2018-19, team strengths in 2019-20. Zero would
 *      claim a measurement nobody took, so the types make the absence
 *      unignorable rather than letting a `?? 0` paper over it.
 *
 * Field names still follow FPL's, deliberately. The split worth having is
 * between string-and-season-scoped and number-and-permanent, which is where
 * every bug in this project has actually lived. Renaming `web_name` to
 * `displayName` on top of that would be churn with a migration cost and no
 * defect it prevents.
 */

/** One player's totals across a single season. The bootstrap list. */
export interface PlayerSeasonTotals {
  /** players.fpl_code — permanent across seasons. */
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  /** teams.fpl_team_code of the club on the end-of-season snapshot (rule 17). */
  team: number;
  /** 1=GK, 2=DEF, 3=MID, 4=FWD (rule 10). */
  element_type: number;
  /** £0.1m units, raw. Divide at the presentation layer only (rule 9). */
  now_cost: number | null;

  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  bps: number;

  influence: number;
  creativity: number;
  threat: number;
  ict_index: number;

  /** NULL before 2022-23 — not measured, not zero (rule 6). */
  starts: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;

  /**
   * Matches the player actually appeared in (minutes > 0), not rounds in the
   * season. Rule 13 makes the distinction mandatory rather than pedantic: a
   * double gameweek is two matches in one round and a blank is none.
   */
  appearances: number;
  /** total_points / appearances. See the repository for the rounding. */
  points_per_game: number;

  photo: string;
}

/** One player's line for one match. A double gameweek gives two in one round. */
export interface PlayerGameweek {
  /**
   * The fixture's surrogate id. Present because `round` is not a key —
   * two rows can share it (rule 13) — and anything keying rows on the round
   * silently collapses a double gameweek.
   */
  fixture: number;
  /** The round the match was actually played in (rule 12). */
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

  influence: number;
  creativity: number;
  threat: number;
  ict_index: number;

  /** NULL before 2022-23 (rule 6). */
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;

  /** £0.1m units at the time of the match (rule 9). */
  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
}

export interface Team {
  /** teams.fpl_team_code — permanent across seasons. */
  id: number;
  name: string;
  short_name: string;
  /** NULL for 2016-17..2018-19: no teams.csv upstream, so no ratings (rule 15). */
  strength_overall_home: number | null;
  strength_overall_away: number | null;
  strength_attack_home: number | null;
  strength_attack_away: number | null;
  strength_defence_home: number | null;
  strength_defence_away: number | null;
}

export interface Fixture {
  /** Our own surrogate key. Permanent, and verified stable across re-ingest. */
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  /** NULL for 2016-17 and 2017-18: no fixtures.csv, so no ratings (rule 14). */
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
  kickoff_time: string | null;
  finished: boolean;
}

/** A player's remaining unplayed fixtures. Empty for a completed season. */
export interface UpcomingFixture {
  event: number | null;
  team_h: number;
  team_a: number;
  is_home: boolean;
  difficulty: number | null;
}

/** A gameweek, derived from the fixtures in it. There is no events table. */
export interface Gameweek {
  /** The round number. Not an index: 2019-20 runs 1-29 then 39-47. */
  id: number;
  name: string;
  finished: boolean;
}

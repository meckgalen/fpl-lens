/**
 * Wire types: the shapes as they arrive from outside, before anything is
 * cleaned up.
 *
 * Two sources feed this app and both are messy in the same two ways — decimals
 * arrive as strings, and identity is season-scoped. Nothing here is what the
 * app means; it is what the upstream sent. The mapping to ../types/domain.ts
 * happens once, at the boundary:
 *
 *   FPL API   -> ../services/fplApi.ts -> ../ingest/*
 *   CSV files -> ../ingest/*
 *   Postgres  -> ../repositories/*     (that layer's own row types)
 *
 * The point of keeping these separate is that `element: 16` and
 * `expected_goals: '0.57'` should be impossible to pass into anything that
 * expects a player id and a number. Rules 2, 3 and 5 are about exactly this,
 * one layer further in.
 */

/**
 * One parsed CSV row, with `'None'` and `''` already normalised to null
 * (rule 18) and nothing else touched. Every value is still a string: the
 * numeric parsing is each ingest's own business, because the right target type
 * differs per column and a wrong guess here would be invisible.
 *
 * Shared by the three ingests, which each declared it separately.
 */
export type CsvRow = Record<string, string | null>;

/**
 * The FPL API shapes below cover the fields we consume, not every field the
 * endpoint returns — the payloads are large and mostly about live entries,
 * leagues and chips. They are deliberately not indexed with
 * `[key: string]: unknown`, so adding a field to a consumer is a compile error
 * here first, where the question "does the API actually send that?" gets asked.
 *
 * Every numeric that FPL serialises as a string is typed `string` here. That is
 * not an oversight to fix; it is the fact this file exists to record.
 */

/** bootstrap-static -> elements[]. `id` is season-scoped (rule 2). */
export interface WireElement {
  /** Season-scoped element id. Reassigned every August. Never store or serve. */
  id: number;
  /** Permanent player code (rule 3). This is the identity that survives. */
  code: number;
  first_name: string;
  second_name: string;
  web_name: string;
  /** Season-scoped team id, 1..20 (rule 2). */
  team: number;
  team_code: number;
  element_type: number;
  now_cost: number;
  /**
   * Movement since the season opened, in £0.1m units, negative when the price
   * has fallen. `now_cost - cost_change_start` is the price the season started
   * at, which is the derivation `player_seasons.start_cost` uses on both ingest
   * paths — the CSV one reads the same field out of players_raw.csv.
   */
  cost_change_start: number;
  /** Only on the live bootstrap and in players_raw.csv from 2024-25 onward. */
  opta_code: string | null;
  birth_date: string | null;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  bonus: number;
  bps: number;
  starts: number;
  /** Live-game fields. These are the five the database has no source for. */
  form: string;
  selected_by_percent: string;
  status: string;
  news: string;
  chance_of_playing_next_round: number | null;
  /** Strings on the wire, every one of them. */
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  points_per_game: string;
  photo: string;
}

/** bootstrap-static -> teams[]. `id` is season-scoped, `code` is permanent. */
export interface WireTeam {
  id: number;
  code: number;
  name: string;
  short_name: string;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

/** bootstrap-static -> events[]. */
export interface WireEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

export interface WireBootstrap {
  elements: WireElement[];
  teams: WireTeam[];
  events: WireEvent[];
  element_types: { id: number; singular_name: string }[];
}

/**
 * element-summary/{id} -> history[]. One row per match played.
 *
 * `element`, `opponent_team` and `fixture` are all season-scoped ids and must
 * be resolved before storage — `opponent_team` especially, since rule 5 exists
 * because storing it raw makes "against team 14" mean a different club each
 * season.
 */
export interface WireGameweekHistory {
  element: number;
  fixture: number;
  opponent_team: number;
  round: number;
  was_home: boolean;
  kickoff_time: string;
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
  starts: number;
  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
  /**
   * Collected 2016-17..2018-19, dropped for six seasons, collected again from
   * 2025-26 — the family that reads backwards (see domain.ts). Present on the
   * live feed today, which is why they are typed unconditionally here: the wire
   * type describes what this season's endpoint sends, and rule 6's nullability
   * is applied when the row is built, not here.
   */
  tackles: number;
  recoveries: number;
  clearances_blocks_interceptions: number;
  defensive_contribution: number;
}

/**
 * element-summary/{id} -> history_past[]. Whole-season totals for previous
 * seasons — the only prior-season data the official API exposes, and the reason
 * the CSV backfill exists. Used to source acceptance values independently of
 * the vaastav files.
 */
export interface WireSeasonPast {
  season_name: string;
  element_code: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  bonus: number;
  bps: number;
  /** Reported as 0 before 2022-23, where we store NULL. That is rule 6, not a
   *  disagreement — see the acceptance test. */
  starts: number;
}

export interface WireElementSummary {
  history: WireGameweekHistory[];
  history_past: WireSeasonPast[];
  fixtures: WireUpcomingFixture[];
}

/** element-summary/{id} -> fixtures[]: what the player has left to play. */
export interface WireUpcomingFixture {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  is_home: boolean;
  difficulty: number;
  kickoff_time: string | null;
}

/** /fixtures/ — team ids here are season-scoped too. */
export interface WireFixture {
  id: number;
  code: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  team_h_difficulty: number;
  team_a_difficulty: number;
  kickoff_time: string | null;
  /**
   * Two flags, not one, and they flip at different moments — one at roughly
   * full time, the other once the round's bonus is confirmed. Which is which
   * cannot be determined from a completed season (both are true on all 380 rows
   * of 2025-26) or from a pre-season one (both false on all 380 of 2026-27), so
   * the gameweek sync gates on the conjunction rather than betting on either.
   */
  finished: boolean;
  finished_provisional: boolean;
}

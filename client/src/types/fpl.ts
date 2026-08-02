/**
 * The shapes the API returns, and the constants the UI renders them with.
 *
 * This file used to mirror the FPL wire format: decimals as strings, nothing
 * nullable, so every consumer called parseFloat by hand and a null reached the
 * DOM as 'NaN' or 'null%'. It now mirrors the server's own domain types
 * (server/src/types/domain.ts), which means two things hold here:
 *
 *   - **Numbers are numbers.** Parsing happens once, in the repository mapper.
 *     A parseFloat in a component is a bug, not a style choice.
 *   - **Null means "not measured".** xG before 2022-23, `starts` before
 *     2022-23, difficulty before 2018-19, and the five live-game fields over
 *     any completed season. Never 0 — 0 asserts a measurement nobody took.
 *     The types force the distinction to be handled; `fmtNum` and `fmtOr`
 *     below are how it is handled.
 *
 * Ids are permanent codes. `Player.id` is the FPL player code and every team
 * id is the FPL team code, so nothing here rots when FPL reshuffles its
 * season-scoped ids each August.
 */

export interface Player {
  /** Permanent player code, not a season-scoped element id. */
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  /** Permanent team code of the club at the end of that season. */
  team: number;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  /** £0.1m units: divide by 10 to display. */
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

  /** null before 2022-23: not measured, not zero. */
  starts: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;

  /** Matches with minutes > 0. Not rounds — a double gameweek is two matches. */
  appearances: number;
  /** total_points / appearances. */
  points_per_game: number;

  photo: string;

  /**
   * Live-game fields. Null over a completed season, and null is all they will
   * be until a live bootstrap sync exists. Rendered with NO_VALUE, never as an
   * empty string or a zero.
   */
  form: string | null;
  selected_by_percent: string | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
}

export interface Team {
  id: number;
  name: string;
  short_name: string;
  /** null for 2016-17..2018-19: no ratings upstream. */
  strength_overall_home: number | null;
  strength_overall_away: number | null;
  strength_attack_home: number | null;
  strength_attack_away: number | null;
  strength_defence_home: number | null;
  strength_defence_away: number | null;
}

export interface GameweekEvent {
  /** The round number. NOT an index: 2019-20 runs 1-29 then 39-47. */
  id: number;
  name: string;
  /** null until a live sync: the deadline is recorded nowhere in the database. */
  deadline_time: string | null;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

/**
 * The stats a match row and a season summary both carry, mirroring
 * server/src/types/domain.ts.
 *
 * Shared so the two shapes cannot drift apart: a column added to the gameweek
 * table and missed on the career row would render as `—` and read as "the
 * season never measured it", which is a claim about the data rather than about
 * the code.
 *
 * Which ones are nullable is a fact about the seasons, not about the stats:
 *
 *   - xG, xA, xGI, xGC: 2022-23 onward.
 *   - tackles, CBI, recoveries: 2016-17 to 2018-19, then nothing for six
 *     seasons, then 2025-26 again. Older seasons have these where newer ones
 *     do not.
 *   - defensive contribution: 2025-26 only.
 *
 * The rest exist in all ten, so 0 in them is a measurement and renders as 0.
 */
interface MatchStats {
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

  influence: number;
  creativity: number;
  threat: number;
  ict_index: number;

  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;
  expected_goals_conceded: number | null;

  tackles: number | null;
  clearances_blocks_interceptions: number | null;
  recoveries: number | null;
  defensive_contribution: number | null;
}

export interface GameweekHistory extends MatchStats {
  /**
   * The fixture's id. This is the row key — `round` is not unique, because a
   * double gameweek puts two matches in one round.
   */
  fixture: number;
  round: number;
  opponent_team: number;
  was_home: boolean;

  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
}

/**
 * One season of a career. Carries its own `season` label, because the response
 * it arrives in spans ten of them and so has no top-level one to borrow.
 *
 * The club is on the row rather than looked up: a career crosses clubs that are
 * in no current season, so no single season's team list can name them all. It
 * is the **end-of-season** club — a January transfer is recorded under the new
 * one for the whole row — so it answers "who did he finish the season at", not
 * "who was he playing for in gameweek N". The expanded rows answer that.
 */
export interface PlayerCareerSeason extends MatchStats {
  season: string;

  team: number;
  team_name: string;
  team_short_name: string;
  element_type: number;
  /** £0.1m units at each end of the season. */
  start_cost: number | null;
  end_cost: number | null;

  /**
   * Match rows in the season, played or not. `matches: 0` means the season has
   * no data for him; `matches: 38, appearances: 0` means he was in the squad
   * all season and never got on. Both look empty and mean opposite things.
   */
  matches: number;
  /** Matches he played (minutes > 0). Not rounds — a double gameweek is two. */
  appearances: number;
  /** null before 2022-23. */
  starts: number | null;
  points_per_game: number;
}

export interface PlayerFixture {
  event: number | null;
  team_a: number;
  team_h: number;
  is_home: boolean;
  difficulty: number | null;
}

export interface Fixture {
  id: number;
  /** FPL's own fixture code, never ingested. */
  code: number | null;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  /** null for 2016-17 and 2017-18: no ratings upstream. */
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
  kickoff_time: string | null;
  finished: boolean;
}

/**
 * Every response names the season it describes. The database holds ten, and a
 * payload from the wrong one is indistinguishable from the right one at a
 * glance — same players, same round numbers, same columns.
 */
export interface BootstrapData {
  season: string;
  players: Player[];
  teams: Team[];
  events: GameweekEvent[];
  positions: { id: number; name: string }[];
}

export interface PlayerDetailData {
  season: string;
  history: GameweekHistory[];
  fixtures: PlayerFixture[];
  /**
   * That season's clubs, so an opponent can be named without borrowing the
   * bootstrap's list — which is the latest season's twenty and cannot name a
   * club relegated years ago.
   */
  teams: Team[];
}

/**
 * A career: every season, newest first, and **no top-level `season`**.
 *
 * Every other response here names the one season it describes. This one
 * describes ten, so the label moves onto the rows: `seasons[].season` is what a
 * consumer must render against. A top-level null would mean something else
 * entirely — null is "not measured" everywhere else in this file.
 */
export interface PlayerCareerData {
  seasons: PlayerCareerSeason[];
}

export interface FixturesData {
  season: string;
  fixtures: Fixture[];
}

// ------------------------------------------------------------- UI constants

export const POSITION_MAP: Record<number, string> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  a: { label: 'Available', color: '#2ecc71' },
  d: { label: 'Doubtful', color: '#f39c12' },
  i: { label: 'Injured', color: '#e74c3c' },
  s: { label: 'Suspended', color: '#e74c3c' },
  u: { label: 'Unavailable', color: '#95a5a6' },
};

/**
 * Availability is a live-game fact. It is null over a completed season, which
 * is not the same as being unavailable — nobody asked the question.
 */
export const UNKNOWN_STATUS = { label: 'Unknown', color: '#95a5a6' };

export function statusOf(code: string | null | undefined) {
  if (!code) return UNKNOWN_STATUS;
  return STATUS_MAP[code] ?? UNKNOWN_STATUS;
}

// Maps FPL status codes to the health buckets the UI dots use.
export function statusBucket(code: string | null | undefined): 'fit' | 'doubt' | 'out' | 'unknown' {
  if (!code) return 'unknown';
  if (code === 'a') return 'fit';
  if (code === 'd') return 'doubt';
  return 'out';
}

/**
 * Rendered where a value genuinely has no source — never where it is zero.
 * Zero means "measured, and it was none"; this means "not measured at all".
 */
export const NO_VALUE = '—';

/**
 * Shown wherever a deadline would go and there is none. Distinct from NO_VALUE
 * because it reads as a date that is not yet known rather than a measurement
 * nobody took, and because all three deadline call sites must agree — they did
 * not, and two of them rendered an expired clock.
 */
export const NO_DEADLINE = 'TBD';

/**
 * Format a number that may be absent. Takes the nullable type rather than
 * accepting anything, so a caller cannot skip the null case: the compiler makes
 * them come through here.
 */
export function fmtNum(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return value.toFixed(digits);
}

/**
 * Cost, in the £0.1m units it is stored in. The division belongs here and
 * nowhere else — it was open-coded at five call sites, each of which had to
 * remember both the factor and the null.
 */
export function fmtPrice(nowCost: number | null | undefined): string {
  if (nowCost === null || nowCost === undefined) return NO_VALUE;
  return `£${(nowCost / 10).toFixed(1)}`;
}

/** Same, for a value rendered as-is with a suffix (ownership, form). */
export function fmtOr(value: string | number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  return `${value}${suffix}`;
}

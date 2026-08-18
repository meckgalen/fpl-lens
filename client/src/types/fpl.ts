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
 *   - **Null means "not measured".** xG before 2022-23 (and before round 16
 *     *of* 2022-23), `starts` on the same boundary, difficulty before 2018-19,
 *     and the five live-game fields over any completed season. Never 0 — 0
 *     asserts a measurement nobody took.
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
  /**
   * What the season opened at, £0.1m units. A different fact from `now_cost`,
   * written once and never revised, which is what lets the two value columns
   * (`Pts/£` and `Pts/£s`) answer two different questions.
   */
  start_cost: number | null;
  /** Match rows in the season — not `appearances`, which requires minutes. */
  matches: number;

  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  bps: number;
  saves: number;

  influence: number;
  creativity: number;
  threat: number;
  ict_index: number;

  /** null before 2022-23, and before round 16 of it: not measured, not zero. */
  starts: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;
  /** null before 2025-26. FPL retro-computed 2024-25 without the components. */
  defensive_contribution: number | null;
  /**
   * How many gameweeks cleared the defensive contribution threshold — the count
   * of `GameweekHistory.defcon_hit`, computed by the server from one rule.
   *
   * null wherever a count would be a lie: DC unmeasured, DC measured on only
   * part of the season, or no match played (every player of 2026-27). The
   * column picker withholds the two columns that read it on exactly those
   * seasons, but the null is still handled where it is divided by.
   */
  defcon_hits: number | null;
  /**
   * The `DCH/St` numerator: hits made in fixtures the player STARTED, which is
   * what bounds that ratio at 1.00 (item 24). `defcon_hits` above counts bench
   * hits too and deliberately still does — the count answers "how often did
   * this happen", the ratio "how reliably when picked".
   *
   * Payload only, with no picker entry, exactly like `hauls_started` below.
   */
  defcon_hits_started: number | null;

  /**
   * How many FIXTURES reached 10 and 4 points. The unit is the fixture, not the
   * gameweek, so a double gameweek can contribute two. Floors include hauls, so
   * `floors >= hauls` always.
   *
   * **Never null, unlike `defcon_hits` above.** They count over `total_points`,
   * which the server holds NOT NULL on every season, so there is no unmeasured
   * state — 0 on a season nobody has played is a real zero, exactly as
   * `goals_scored` is.
   */
  hauls: number;
  floors: number;
  /**
   * The same counts restricted to fixtures the player STARTED — the numerators
   * of Pts10+/St and Pts4+/St, and why those are bounded at 1.00. Since item 24
   * DCH/St is gated the same way — see `defcon_hits_started` above.
   *
   * null where `starts` is unmeasured across the player-season, or no match was
   * played. Nothing renders these directly; the division happens in `perStart`.
   */
  hauls_started: number | null;
  floors_started: number | null;

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
 *   - xG, xA, xGI, xGC: 2022-23 onward — and within 2022-23, from round 16
 *     only, which is where the source starts measuring them. So a 2022-23
 *     season total is `—` for a player who played through rounds 1-15 and a
 *     real number for one who arrived after. Not a bug on either side.
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

  /**
   * Both are here rather than on `MatchStats`, for the reason `starts` has
   * always been: the per-row meaning is not the season meaning. `starts` is 0
   * or 1 here and a count on `Player`/`PlayerCareerSeason`; `defcon_hit` is 0
   * or 1 here and `defcon_hits` is a count. One name over two quantities is
   * exactly what the shared interface exists to prevent.
   */

  /** Started this match: 0 or 1. null before 2022-23 and before its round 16. */
  starts: number | null;
  /**
   * This match cleared the defensive contribution threshold: 0 or 1. null
   * before 2025-26, where DC was never measured. 0 for a goalkeeper, who has no
   * threshold.
   *
   * The **server** decides this. Nothing on the client compares a number to a
   * threshold, so the per-row flag and the season count cannot drift apart.
   */
  defcon_hit: number | null;
}

/**
 * One season of a career. Carries its own `season` label, because the response
 * it arrives in spans eleven of them and so has no top-level one to borrow.
 *
 * It carries no name, code or photo: those are properties of the player rather
 * than of the season, so they sit once on the response as
 * `PlayerCareerData.player` instead of eleven times here.
 *
 * The club is on the row rather than looked up: a career crosses clubs that are
 * in no current season, so no single season's team list can name them all. It
 * is the **end-of-season** club — a January transfer is recorded under the new
 * one for the whole row — so it answers "who did he finish the season at", not
 * "who was he playing for in gameweek N". The expanded rows answer that.
 */
export interface PlayerCareerSeason extends MatchStats {
  season: string;

  /**
   * Every round this SEASON played, ascending — 2019-20 is `[1..29, 39..47]`
   * and 2022-23 is `[1..6, 8..38]`.
   *
   * A property of the season, not of the player, which is what makes it usable
   * as the GW filter's options: a gap here always means the season did not play
   * that round. Built from the player's own rows it would additionally have gaps
   * for weeks he was not in the squad, and the two would be indistinguishable.
   *
   * This is what the round selector reads. It used to come from the bootstrap's
   * events, which only ever describe the *selected* season — fine while one
   * season had filters, wrong the moment every expanded season does.
   */
  rounds: number[];

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
  /**
   * null before 2022-23 — and null for a 2022-23 player who played through
   * rounds 1-15, which the source never measured. See CLAUDE.md, the hole rule.
   */
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
 * Every response names the season it describes. The database holds eleven, and
 * a payload from the wrong one is indistinguishable from the right one at a
 * glance — same players, same round numbers, same columns.
 */
/**
 * Whether a stat column can be shown for a season.
 *
 *   - `full`    every row that season carries a value: render and sort it
 *   - `partial` some rows are NULL, so no honest season total exists
 *   - `none`    no row carries a value
 *
 * `partial` and `none` both mean "do not offer this column". They are two states
 * rather than one because they need two different sentences: `partial` can name
 * the round it starts at, `none` can name the seasons that do have it.
 */
export type ColumnState = 'full' | 'partial' | 'none';

export interface ColumnAvailability {
  /** Matches a `PlayerColumn.key` for the nullable columns. */
  key: string;
  state: ColumnState;
  /**
   * The first round with a value, on a `partial` column only — null otherwise.
   *
   * **Not a promise that every later round is measured.** 2022-23's
   * `expected_goal_involvements` is 16 and is holed again at round 29.
   */
  measured_from: number | null;
}

/**
 * One season's answer, with the empty case lifted to the season.
 *
 * `measured: false` means the season has no match rows at all, and `columns` is
 * then empty: one fact, stated once, rather than the same sentence repeated per
 * column. It is what keeps 2026-27 — the season the app opens on — from claiming
 * to measure everything, since over zero rows "every row has a value" is
 * vacuously true.
 */
export interface SeasonColumnAvailability {
  season: string;
  measured: boolean;
  columns: ColumnAvailability[];
}

/** One (season, column) cell of the cross-season matrix. */
export interface ColumnHistoryRow extends ColumnAvailability {
  season: string;
}

/**
 * `GET /api/columns`. Rows carry their own season — no top-level one, because
 * this response spans all of them.
 */
export interface ColumnHistoryData {
  columns: ColumnHistoryRow[];
}

export interface BootstrapData {
  season: string;
  /**
   * Every season that exists, newest first — the season selector's options.
   *
   * Rendered in the order it arrives. The server decides the ordering (see
   * `listSeasons`), and a client that sorted independently would be a second
   * opinion about something neither end states.
   */
  seasons: string[];
  /**
   * Which stat columns this season can answer for — what the Players list is
   * allowed to render.
   *
   * Covers the five nullable columns the bootstrap aggregate carries and no
   * others. A column absent from `columns` is one the server did not measure
   * here, which is a different thing from one it measured as absent — see
   * `ColumnAvailability`.
   */
  columns: SeasonColumnAvailability;
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
  /**
   * Who the player is, carried once rather than on every row — see
   * `PlayerCareerSeason`, which deliberately holds none of this.
   *
   * Every field is season-independent: the code is permanent, the names are the
   * person's, and `photo` is built from the code. That is what makes it the one
   * thing the detail page can still render when the selected season has no
   * player-season for him.
   */
  player: PlayerIdentity;
  seasons: PlayerCareerSeason[];
}

/** A player with no season attached. See `PlayerCareerData.player`. */
export interface PlayerIdentity {
  /** The permanent player code, same as `Player.id`. */
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  photo: string;
}

export interface FixturesData {
  season: string;
  fixtures: Fixture[];
}

// ------------------------------------------------------- the comparison chart

/**
 * An axis key, which is a `PLAYER_COLUMNS` key.
 *
 * Deliberately the same vocabulary as the Players list — all eleven axes already
 * exist as columns that list can offer, so the two surfaces name the same stat
 * identically. The **caption** is not derived from that key here: it arrives on
 * the threshold (`AxisThreshold.label`), because a radar spoke and a table header
 * have different width budgets and `Sv` against the picker's `S` is the one place
 * they differ. A second label table on this side would be free to disagree.
 */
export type ComparisonAxisKey =
  | 'pts'
  | 'clean_sheets'
  | 'goals'
  | 'minutes'
  | 'ppm'
  | 'defcon_hits_per_start'
  | 'assists'
  | 'pts_per_now'
  | 'expected_goal_involvements'
  | 'bonus'
  | 'saves';

/**
 * `GK`, not `GKP`. The server's four-position vocabulary, which is not the one
 * `POSITION_MAP` above renders — see `ELEMENT_TYPE_OF` in `lib/comparison.ts`,
 * which is the one place the two are translated.
 */
export type ComparisonPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

/**
 * The seasons a threshold was derived from — the label, in API identity rule 7's
 * set form. A ceiling is not a claim about one season but about ten, or about the
 * three that measure xGI, or the one that measures DC.
 */
export interface AxisDerivation {
  seasons: string[];
  cohort: number;
}

export interface AxisThreshold {
  axis: ComparisonAxisKey;
  /** The spoke's caption. Rendered as it arrives; see `ComparisonAxisKey`. */
  label: string;
  floor: number;
  ceiling: number;
  derivedFrom: AxisDerivation;
  /** Present only once an axis has been re-derived: absent on all of them today. */
  supersedes?: { floor: number; ceiling: number; triggeredBy: string };
}

/**
 * `GET /api/comparison-thresholds`. No top-level `season` — this response spans
 * seasons and each threshold carries the set it came from.
 */
export interface ComparisonThresholdsData {
  thresholds: Record<ComparisonPosition, AxisThreshold[]>;
}

/**
 * Axis values, keyed by axis. **Only the axes the response listed appear.**
 *
 * An axis the season cannot answer is absent from this map rather than present
 * and null — so the client drops the spoke and re-spaces, which it could not do
 * from a null it had to interpret. A null that *is* here means rule 6's "not
 * measured" for this player specifically.
 */
export type AxisValues = Partial<Record<ComparisonAxisKey, number | null>>;

export interface ComparisonPlayerValues {
  /** The permanent player code, same as `Player.id`. */
  id: number;
  web_name: string;
  values: AxisValues;
}

export interface ComparisonCohort {
  /** Player-seasons past the 1,200-minute gate. Present even at 0. */
  size: number;
  /**
   * The cohort median per axis, or null where the server withheld it — below its
   * own floor, which it applies so the client never compares a size to a
   * threshold. Null is the ordinary state of a live season until roughly GW14.
   */
  band: AxisValues | null;
}

/**
 * `GET /api/comparison`. One season throughout, so the label is top-level —
 * unlike its sibling above, which spans seasons.
 *
 * Values are **raw**. The scaling against `floor`/`ceiling` happens on this side,
 * in exactly one place, so the frozen ceilings are applied once.
 */
export interface ComparisonData {
  season: string;
  position: ComparisonPosition;
  /** The spokes that exist for this season, in the frozen canonical order. */
  axes: ComparisonAxisKey[];
  cohort: ComparisonCohort;
  players: ComparisonPlayerValues[];
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

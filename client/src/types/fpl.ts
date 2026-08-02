export interface Player {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  now_cost: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  ict_index: string;
  influence: string;
  creativity: string;
  threat: string;
  bonus: number;
  bps: number;
  form: string;
  points_per_game: string;
  selected_by_percent: string;
  status: string;
  chance_of_playing_next_round: number | null;
  news: string;
  photo: string;
}

export interface Team {
  id: number;
  name: string;
  short_name: string;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface GameweekEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

export interface GameweekHistory {
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
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
}

export interface PlayerFixture {
  event: number;
  team_a: number;
  team_h: number;
  is_home: boolean;
  difficulty: number;
}

export interface BootstrapData {
  players: Player[];
  teams: Team[];
  events: GameweekEvent[];
  positions: { id: number; name: string }[];
}

export interface PlayerDetailData {
  history: GameweekHistory[];
  fixtures: PlayerFixture[];
}

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
 * See CLAUDE.md rule 6 and API identity rule 4.
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
 * Format a numeric that may be absent. Returns the placeholder rather than
 * 'NaN', which is what `parseFloat(null).toFixed(2)` produces.
 */
export function fmtNum(value: string | number | null | undefined, digits: number): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n.toFixed(digits) : NO_VALUE;
}

/** Same, for a value rendered as-is with a suffix (ownership, form). */
export function fmtOr(value: string | number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  return `${value}${suffix}`;
}

export interface Fixture {
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
  finished: boolean;
}

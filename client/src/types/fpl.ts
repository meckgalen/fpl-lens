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

// Maps FPL status codes to a 3-bucket health used by UI dots.
export function statusBucket(code: string): 'fit' | 'doubt' | 'out' {
  if (code === 'a') return 'fit';
  if (code === 'd') return 'doubt';
  return 'out';
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

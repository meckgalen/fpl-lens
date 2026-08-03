/**
 * Payload builders for the client suite.
 *
 * The API is mocked at `services/api.ts`, so no test ever sees a response the
 * server actually produced. That makes this file a **second description of the
 * wire shape**, and the explicit return-type annotation on every builder is the
 * only thing tying it to the first one in `../types/fpl`. Add a field to an
 * interface and forget it here and `npx tsc --noEmit` fails; let the return type
 * be inferred from the literal instead and the builders quietly keep producing
 * last month's shape while every test stays green.
 *
 * **The defaults are a measured modern season** — real numbers in the xG family,
 * in the defensive stats, in `starts`. That is deliberate and is not just
 * realism: a test asserting that something renders as "not measured" has to
 * override a default that *was* measured, or it could be passing because the
 * factory happened to agree with it rather than because the component did
 * anything.
 */

import type {
  BootstrapData,
  GameweekEvent,
  GameweekHistory,
  Player,
  PlayerCareerSeason,
  PlayerDetailData,
  Team,
} from '../types/fpl';

export function aTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 3,
    name: 'Arsenal',
    short_name: 'ARS',
    strength_overall_home: 1350,
    strength_overall_away: 1340,
    strength_attack_home: 1330,
    strength_attack_away: 1320,
    strength_defence_home: 1310,
    strength_defence_away: 1300,
    ...overrides,
  };
}

export function aPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 223340,
    first_name: 'Bukayo',
    second_name: 'Saka',
    web_name: 'Saka',
    team: 3,
    element_type: 3,
    now_cost: 100,

    total_points: 157,
    minutes: 2218,
    goals_scored: 7,
    assists: 10,
    clean_sheets: 12,
    bonus: 18,
    bps: 570,

    influence: 700.2,
    creativity: 900.5,
    threat: 800.1,
    ict_index: 240.3,

    starts: 25,
    expected_goals: 7.57,
    expected_assists: 8.12,
    expected_goal_involvements: 15.69,

    appearances: 31,
    points_per_game: 5.1,

    photo: '223340.jpg',

    // Null over a completed season, and null until a live bootstrap sync
    // exists. Defaulting them to a value would hide the placeholder rendering.
    form: null,
    selected_by_percent: null,
    status: null,
    news: null,
    chance_of_playing_next_round: null,
    ...overrides,
  };
}

export function aGameweek(overrides: Partial<GameweekHistory> = {}): GameweekHistory {
  return {
    fixture: 1,
    round: 1,
    opponent_team: 43,
    was_home: true,

    total_points: 6,
    minutes: 90,
    goals_scored: 1,
    assists: 0,
    clean_sheets: 1,
    goals_conceded: 0,
    own_goals: 0,
    penalties_saved: 0,
    penalties_missed: 0,
    yellow_cards: 0,
    red_cards: 0,
    saves: 0,
    bonus: 2,
    bps: 32,

    influence: 24.6,
    creativity: 18.2,
    threat: 31.0,
    ict_index: 7.4,

    expected_goals: 0.41,
    expected_assists: 0.19,
    expected_goal_involvements: 0.6,
    expected_goals_conceded: 0.72,

    tackles: 2,
    clearances_blocks_interceptions: 3,
    recoveries: 5,
    defensive_contribution: 1,

    value: 100,
    selected: 1_500_000,
    transfers_in: 40_000,
    transfers_out: 12_000,
    ...overrides,
  };
}

export function aCareerSeason(
  overrides: Partial<PlayerCareerSeason> = {}
): PlayerCareerSeason {
  return {
    season: '2024-25',

    team: 3,
    team_name: 'Arsenal',
    team_short_name: 'ARS',
    element_type: 3,
    start_cost: 90,
    end_cost: 100,

    matches: 38,
    appearances: 31,
    starts: 25,
    points_per_game: 5.1,

    total_points: 157,
    minutes: 2218,
    goals_scored: 7,
    assists: 10,
    clean_sheets: 12,
    goals_conceded: 16,
    own_goals: 0,
    penalties_saved: 0,
    penalties_missed: 1,
    yellow_cards: 3,
    red_cards: 0,
    saves: 0,
    bonus: 18,
    bps: 570,

    influence: 700.2,
    creativity: 900.5,
    threat: 800.1,
    ict_index: 240.3,

    expected_goals: 7.57,
    expected_assists: 8.12,
    expected_goal_involvements: 15.69,
    expected_goals_conceded: 25.4,

    tackles: 36,
    clearances_blocks_interceptions: 129,
    recoveries: 149,
    defensive_contribution: 12,
    ...overrides,
  };
}

export function anEvent(overrides: Partial<GameweekEvent> = {}): GameweekEvent {
  return {
    id: 1,
    name: 'Gameweek 1',
    // Recorded nowhere in the database, so null is what the API sends.
    deadline_time: null,
    finished: true,
    // False on every event over a completed season — see API identity rule 6.
    is_current: false,
    is_next: false,
    ...overrides,
  };
}

export function aBootstrap(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    season: '2025-26',
    players: [aPlayer()],
    teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
    // Rounds are listed, not counted: 2019-20 runs 1-29 then 39-47. Three is
    // enough for a filter to have something to exclude.
    events: [anEvent({ id: 1 }), anEvent({ id: 2 }), anEvent({ id: 3 })],
    positions: [
      { id: 1, name: 'Goalkeeper' },
      { id: 2, name: 'Defender' },
      { id: 3, name: 'Midfielder' },
      { id: 4, name: 'Forward' },
    ],
    ...overrides,
  };
}

export function aPlayerDetail(overrides: Partial<PlayerDetailData> = {}): PlayerDetailData {
  return {
    season: '2025-26',
    history: [aGameweek()],
    fixtures: [],
    // That season's clubs, not the current twenty — which is the whole reason
    // this key exists on the response.
    teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
    ...overrides,
  };
}

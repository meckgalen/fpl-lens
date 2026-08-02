/**
 * API types: the HTTP response bodies, which are the contract the client
 * consumes.
 *
 * These are the domain types (../types/domain.ts) plus the two things that are
 * true of a response and not of a domain object:
 *
 *   - the season it describes, on every response (API identity rule 7);
 *   - the live-game fields, which are present in the shape and null in the
 *     data, because the database has no source for them (API identity rule 4).
 *
 * The response keeps FPL's field names because the client was built against
 * them and renaming buys nothing. What it does not keep is FPL's identity
 * model: every id here is a permanent code (API identity rule 1).
 */

import type {
  Fixture,
  Gameweek,
  PlayerGameweek,
  PlayerSeasonTotals,
  Team,
  UpcomingFixture,
} from './domain.js';

/**
 * The five fields that describe the live game: who is injured, what the market
 * thinks, when the next deadline is. A completed season has no answer to any of
 * them, and an invented one would be indistinguishable from a real one.
 *
 * They are typed nullable rather than omitted so that the day the live
 * bootstrap sync lands, filling them in is a change of data and not of shape —
 * and so that every consumer has already been forced to handle the null.
 */
export interface LiveOnlyPlayerFields {
  form: string | null;
  selected_by_percent: string | null;
  status: string | null;
  news: string | null;
  chance_of_playing_next_round: number | null;
}

export type ApiPlayer = PlayerSeasonTotals & LiveOnlyPlayerFields;

/** A gameweek as served: derived fields, plus the deadline we cannot know. */
export type ApiEvent = Gameweek & {
  /**
   * ~90 minutes before the round's first kick-off, and recorded nowhere in the
   * database. Null until the live sync (API identity rule 4).
   */
  deadline_time: string | null;
  /**
   * Both false, always, over a completed season. There is no "current" round in
   * a season that ended years ago, and nominating the last one would be a guess
   * dressed as data (API identity rule 6).
   */
  is_current: boolean;
  is_next: boolean;
};

/** A fixture as served, with FPL's permanent fixture code we never ingested. */
export type ApiFixture = Fixture & {
  /** FPL's own fixture code. Not ingested, so null rather than invented. */
  code: number | null;
};

export interface BootstrapResponse {
  /** The season these rows describe (API identity rule 7). */
  season: string;
  players: ApiPlayer[];
  teams: Team[];
  events: ApiEvent[];
  positions: { id: number; name: string }[];
}

export interface PlayerDetailResponse {
  season: string;
  history: PlayerGameweek[];
  fixtures: UpcomingFixture[];
}

export interface FixturesResponse {
  season: string;
  fixtures: ApiFixture[];
}

export interface ErrorResponse {
  error: string;
  /** Listed on an unknown-season 400, so the caller can see the ten that exist. */
  available?: string[];
}

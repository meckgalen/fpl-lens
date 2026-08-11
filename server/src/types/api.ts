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
  ColumnHistoryRow,
  Fixture,
  Gameweek,
  PlayerCareerSeason,
  PlayerGameweek,
  PlayerIdentity,
  PlayerSeasonTotals,
  SeasonColumnAvailability,
  Team,
  UpcomingFixture,
} from './domain.js';
import type { AxisThreshold, ComparisonPosition } from '../comparison/thresholds.js';
import type { ComparisonResult } from '../comparison/cohort.js';

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

/**
 * A gameweek as served.
 *
 * Identical to the domain type since item 4: `deadline_time`, `is_current` and
 * `is_next` used to be added by the route as null/false/false, because nothing
 * in the database could answer them. The live season ingest gave the first two
 * a source and the third a derivation, so the repository answers all three now
 * and the route passes them through. Over a completed season the values are
 * unchanged — no deadlines, so no current or next round (API identity rule 6).
 */
export type ApiEvent = Gameweek;

/** A fixture as served, with FPL's permanent fixture code we never ingested. */
export type ApiFixture = Fixture & {
  /** FPL's own fixture code. Not ingested, so null rather than invented. */
  code: number | null;
};

export interface BootstrapResponse {
  /** The season these rows describe (API identity rule 7). */
  season: string;
  /**
   * Every season that exists, newest first — what the season selector offers.
   *
   * **A manifest here, when `/career` was refused one.** Item 1 rejected a
   * `seasons: string[]` on the career response because each of its rows already
   * carries a season: the manifest would have duplicated what the rows state,
   * and so been able to disagree with them. A bootstrap response is one season
   * throughout. Nothing in it answers "which others exist", so there is nothing
   * for this field to duplicate and nothing for it to contradict.
   *
   * **Not on `PlayerDetailResponse` or `FixturesResponse`, deliberately.** Only
   * the selector needs the list, and the selector lives in the shell, which is
   * driven by bootstrap. The same constant on three payloads is three things
   * that can drift.
   *
   * Ordered by `listSeasons` and re-sorted by nobody. Two orderings would
   * eventually disagree about something neither of them states.
   */
  seasons: string[];
  /**
   * Which stat columns this season can answer for — what the Players list is
   * allowed to render (item 13).
   *
   * **Top-level, because this response is one season throughout** (API identity
   * rule 7's single-season form). It is the same argument as `seasons` above:
   * nothing else in this payload states per-season availability, so there is
   * nothing here to duplicate or contradict. The cross-season matrix, which
   * genuinely spans seasons, is `GET /api/columns` and carries a `season` on
   * every row instead.
   *
   * Derived from rows this response already computes, so it costs no query on
   * ten of the eleven seasons — see `deriveSeasonAvailability`.
   *
   * It covers the nine nullable columns only. Every other stat column is NOT
   * NULL in the schema and is available wherever the season has rows at all, so
   * listing it here would be nine facts and eleven non-facts.
   */
  columns: SeasonColumnAvailability;
  players: ApiPlayer[];
  teams: Team[];
  events: ApiEvent[];
  positions: { id: number; name: string }[];
}

/**
 * `GET /api/columns` — the availability matrix across every season.
 *
 * Rows carrying their own `season`, which is API identity rule 7's many-seasons
 * form and the same shape `PlayerCareerResponse` uses. A `Record<season, …>` map
 * was the obvious alternative and is the manifest that rule refuses: two
 * statements of one fact, free to disagree.
 *
 * This exists for the picker's *reasons* rather than for what renders now.
 * "Not recorded in 2016-17 · recorded from 2022-23" needs to know about seasons
 * other than the one on screen, and `bootstrap.columns` by construction cannot.
 * Nothing blocks on it: every disabled entry already carries a complete, true
 * sentence from the bootstrap alone, and this only appends the pointer clause.
 */
export interface ColumnHistoryResponse {
  columns: ColumnHistoryRow[];
}

export interface PlayerDetailResponse {
  season: string;
  history: PlayerGameweek[];
  fixtures: UpcomingFixture[];
  /**
   * That season's twenty clubs, so `history[].opponent_team` can be named.
   *
   * The bootstrap's team list is the *latest* season's twenty, and the detail
   * page can now show any of the ten: rendering 2016-17 against it prints a
   * bare code wherever the opponent was Middlesbrough, Hull or Sunderland. The
   * lookup travels with the response for the same reason the season label
   * does — a payload has to be readable from itself, not from whatever the
   * client happened to fetch first.
   */
  teams: Team[];
}

/**
 * A player's whole career, one row per season, newest first.
 *
 * **This is the first response that spans seasons, and so the first with no
 * top-level `season` key.** API identity rule 7 requires every piece of data on
 * screen to be labelled with the season it came from; where a response covers
 * one season that label sits at the top, and where it covers ten it sits on
 * each row. A top-level `null` would be worse than nothing: null already means
 * "not measured" throughout this codebase (rule 6), and a second meaning for it
 * is the ambiguity that rule exists to prevent. `seasons[].season` is what a
 * consumer must render against.
 */
export interface PlayerCareerResponse {
  /**
   * Who the player is, carried once rather than on every row — see
   * `PlayerIdentity`, and the note on `PlayerCareerSeason` explaining why the
   * rows deliberately do not repeat it.
   *
   * It is on this response and no other because this is the only one that is
   * about the *player* rather than about a player-season. That makes it the
   * one thing the detail page can still render for a season the player was not
   * in the game for.
   */
  player: PlayerIdentity;
  seasons: PlayerCareerSeason[];
}

export interface FixturesResponse {
  season: string;
  fixtures: ApiFixture[];
}

/**
 * `GET /api/comparison-thresholds` — the frozen axis scales, per position.
 *
 * **The third response that spans seasons**, after `/player/:code/career` and
 * `/columns`, and it follows their rule: no top-level `season`, and every datum
 * carrying the seasons it came from (API identity rule 7). Here the label is
 * `derivedFrom.seasons` rather than a single `season` string, because a
 * threshold is not drawn from one season — it is drawn from ten, or from the
 * three that measure xGI, or from the one that measures DC. That set *is* the
 * label, and a consumer showing an axis is showing a claim about exactly those
 * seasons.
 *
 * **Not on the bootstrap, and the payload size is not the argument.** These are
 * ~5 KB against a bootstrap that is ~1 MB, so the bandwidth would genuinely be
 * free. Three other things are not:
 *
 *   1. **A bootstrap response is one season throughout** — that is the premise
 *      `season`, `seasons` and `columns` all rest on. A block derived from ten
 *      seasons at once has no honest place on it, and putting it there would
 *      make rule 7's single-season form false of its own carrier. This is the
 *      argument that put `/api/columns` on its own route.
 *   2. **The bootstrap is refetched on every season change.** These constants
 *      do not vary by season, so riding along would re-send them on every
 *      switch, forever, to answer a question that has the same answer.
 *   3. **Every page blocks on the bootstrap at mount; one page needs these.**
 *      The bootstrap already runs 23-121 ms depending on season.
 *
 * The cost, stated because it is real: the client has no axis configuration
 * until this lands, so the comparison page needs a loading state rather than
 * rendering axes from a compiled-in constant.
 */
export interface ComparisonThresholdsResponse {
  thresholds: Record<ComparisonPosition, AxisThreshold[]>;
}

/**
 * `GET /api/comparison` — axis values for the players asked for, and the cohort
 * band to read them against.
 *
 * **One season throughout, so the label is top-level** (API identity rule 7's
 * single-season form) — unlike its sibling `/api/comparison-thresholds`, which
 * spans seasons and labels each threshold with the set it came from. The two
 * routes carry their labels at different levels because they are different
 * shapes of answer, which is the rule working rather than an inconsistency.
 *
 * **The band is this season's cohort and never a pooled one**, and that is the
 * decision the DEF structural break forced: 2025-26 introduced defensive
 * contribution points, and a defender's median points went to 95.0 against a
 * 68.5-85 range over the previous nine seasons. A band pooled across ten seasons
 * would render the typical modern defender permanently above it. The *ceilings*
 * stay pooled — a scale wants to be stable across seasons, a band has to
 * describe the population on screen.
 */
export type ComparisonResponse = ComparisonResult;

export interface ErrorResponse {
  error: string;
  /**
   * Listed on an unknown-season 400, so the caller can see the eleven that
   * exist. Same list and same order as `BootstrapResponse.seasons`.
   *
   * It is load-bearing rather than courtesy: the client persists the selected
   * season, and a stored value the database does not have — a fresh clone, a
   * rebuilt container — gets a 400 *before* any bootstrap has arrived to say
   * what the valid seasons are. Without a parseable body the client cannot tell
   * that case from the network being down.
   */
  available?: string[];
}

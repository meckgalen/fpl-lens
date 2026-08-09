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
 *      **The boundary is a round rather than a season in one case**, and it is
 *      the reason these are nullable on a season that "has" them: 2022-23
 *      collects `starts` and the expected family only from **round 16**. The
 *      upstream scraper wrote 0 for rounds 1-15 — a measurement nobody took,
 *      stored as though somebody had — and those cells are NULL since Phase 1
 *      item 7. See `ingest/holes.ts`.
 *
 * Field names still follow FPL's, deliberately. The split worth having is
 * between string-and-season-scoped and number-and-permanent, which is where
 * every bug in this project has actually lived. Renaming `web_name` to
 * `displayName` on top of that would be churn with a migration cost and no
 * defect it prevents.
 */

/**
 * Who a player is, independently of any season.
 *
 * Every field here comes from `players`, which has no season column: the code
 * is permanent (rule 3), the names are the person's, and `photo` is built from
 * the code (API identity rule 5). Nothing on it can be stale with respect to a
 * season, because none of it is a property of one.
 *
 * That is what makes it the right thing to carry on a career response, and the
 * reason the player detail page can name a player for a season he was not in
 * the game for — there is no `PlayerSeasonTotals` for him then, and there does
 * not need to be.
 */
export interface PlayerIdentity {
  /** players.fpl_code — permanent across seasons. */
  id: number;
  first_name: string | null;
  second_name: string | null;
  web_name: string;
  photo: string;
}

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
  /**
   * What the season opened at, £0.1m units — a different fact from `now_cost`,
   * written once and never revised. Complete on all eleven seasons, so the
   * points-per-start-cost column needs no guard.
   */
  start_cost: number | null;
  /**
   * Match rows this player has in the season, which is NOT `appearances`: a
   * benched player has a row and no minutes. It is here so a caller can tell a
   * player with nothing measured from a player measured at zero — the season
   * with no match rows at all is the case that matters (rule 6, one layer up).
   */
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

  /** NULL before 2022-23, and before round 16 of it — not measured, not zero (rule 6). */
  starts: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;
  /** NULL before 2025-26. FPL retro-computed 2024-25 without the components. */
  defensive_contribution: number | null;

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

/**
 * The stats that exist on a match row and on a season's sum of them alike.
 *
 * Split out because the two shapes below have to agree column for column: a
 * stat added to the gameweek table and forgotten in the season summary reads as
 * a real absence rather than as an oversight, and rule 6 means the absence is
 * indistinguishable from "nobody measured it". Sharing the declaration makes
 * that particular divergence impossible.
 *
 * The nullable ones are nullable because the column does not exist in every
 * season. From docs/data-profile.md section 6, verified against the loaded
 * rows rather than assumed:
 *
 *   - `expected_goals_conceded` and the xG family: 2022-23 onward — but within
 *     2022-23, from **round 16 only**. `starts` has the same boundary. The
 *     profile is right that the columns are present all season; it reports
 *     column presence, not column content, and the values before round 16 were
 *     zeros nobody measured. A season total therefore comes back `null` for any
 *     player who played through that stretch (see `measuredSum` in
 *     repositories/players.ts) and a real number for one who did not.
 *   - `tackles`, `clearances_blocks_interceptions`, `recoveries`: 2016-17,
 *     2017-18, 2018-19 — then a six-season gap — then 2025-26. Not a
 *     "modern stats only" family: they are the one group where the OLD seasons
 *     have data the middle ones do not.
 *   - `defensive_contribution`: 2025-26 only.
 *
 * Everything else here is present in all ten and is therefore a number, never
 * null. Zero in those columns is a measurement.
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

  /** NULL before 2022-23, and on its rounds 1-15, which nobody measured (rule 6). */
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goal_involvements: number | null;
  expected_goals_conceded: number | null;

  /** NULL in 2019-20 through 2024-25 — measured before and after, not during. */
  tackles: number | null;
  clearances_blocks_interceptions: number | null;
  recoveries: number | null;
  /** NULL in every season but 2025-26, where the scoring rule was introduced. */
  defensive_contribution: number | null;
}

/** One player's line for one match. A double gameweek gives two in one round. */
export interface PlayerGameweek extends MatchStats {
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

  /** £0.1m units at the time of the match (rule 9). */
  value: number;
  selected: number;
  transfers_in: number;
  transfers_out: number;
}

/**
 * One season of a player's career: the sum of his match rows, plus the
 * season-level attributes that come from `player_seasons`.
 *
 * There is no `id`, name or `photo` here. Those are properties of the player,
 * not of the season, so they are **carried once on the response, not on every
 * row** — `PlayerCareerResponse.player`, a `PlayerIdentity`. Repeating them per
 * row would be eleven copies of one fact with eleven chances to disagree. What
 * is repeated is what genuinely changes between rows: the club, the position
 * and the price.
 *
 * The identity block is the same reasoning reaching its conclusion rather than
 * a reversal of it, and item 8 is where the difference started to matter: it is
 * what lets the detail page name a player for a season he was **not in the game
 * for**. Select 2016-17 while looking at a 2026-27 player and there is no
 * player-season for him at all — no club, no position, no price — but the
 * career, and so the identity, is unaffected by which season is selected.
 *
 * **The club is the END-of-season snapshot (rule 17).** `players_raw.csv` is a
 * bootstrap dump taken when the season finished, so a player who moved in
 * January is recorded under his new club for the whole row. This field cannot
 * answer "who was he playing for in gameweek N" and nothing rendering it may
 * imply that it can — that answer comes from the fixture on each
 * `PlayerGameweek`, which is exactly what the row expands into.
 */
export interface PlayerCareerSeason extends MatchStats {
  /** Rule 8's '2016-17'. This row's own label — see API identity rule 7. */
  season: string;

  /** teams.fpl_team_code of the end-of-season club (rule 17). */
  team: number;
  /**
   * Denormalised deliberately. A career spans clubs outside the current
   * twenty — Middlesbrough, Hull, Sunderland, Cardiff — so a code-to-name map
   * built from any single season cannot resolve them all, and the consumer
   * would print a bare integer for precisely the oldest rows. One row is one
   * season is one club, so there is nothing here to look up.
   */
  team_name: string;
  team_short_name: string;

  /**
   * Every round this SEASON played, ascending — a property of the season, not
   * of the player, and that distinction is the entire point of the field.
   *
   * Derived from `fixtures`, which is what "which rounds exist" has always come
   * from here (`listEvents` LEFT JOINs `events` onto it rather than the other
   * way round). Deriving it instead from the player's own `player_gameweeks`
   * rows would produce a list with two different kinds of gap in it and nothing
   * telling them apart: 2019-20 is missing 30-38 because the season **skipped
   * them** after the Covid restart, and would be missing others because the
   * player was not in the squad. A consumer cannot read one meaning off that.
   *
   * So a gap here always means the same thing — the season did not play that
   * round. 2019-20 is `[1..29, 39..47]` and 2022-23 is `[1..6, 8..38]`.
   *
   * It rides on the row rather than arriving as a manifest beside the rows,
   * which is API identity rule 7: the row already names its season, so the two
   * cannot disagree. A `Record<season, number[]>` on the response would be the
   * shape that rule refused for `season` itself in Phase 1 item 1.
   *
   * `[]` where the season has no fixture carrying a round, which no season in
   * this database is.
   */
  rounds: number[];

  /** 1=GK, 2=DEF, 3=MID, 4=FWD (rule 10). Position is season-level. */
  element_type: number;
  /** £0.1m units, raw (rule 9). Not aliased to `now_cost`: on a 2016-17 row
   *  "now" is nine years ago. */
  start_cost: number | null;
  end_cost: number | null;

  /**
   * Match rows in the season — every fixture his club played that he was
   * listed for, appeared or not.
   *
   * Distinct from `appearances`, and the distinction is the whole reason it
   * exists: `matches = 0` means the season has no data for him yet, while
   * `matches = 38, appearances = 0` means he was in the squad all season and
   * never got on. Both render as an empty-looking table and they mean opposite
   * things.
   */
  matches: number;
  /** Matches he actually played (minutes > 0). Not rounds (rule 13). */
  appearances: number;
  /** NULL before 2022-23, and before round 16 of it — not measured, not zero (rule 6). */
  starts: number | null;
  /** total_points / appearances. See the repository for the rounding. */
  points_per_game: number;
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

/**
 * A gameweek: which rounds exist comes from the fixtures, when they lock comes
 * from `events`.
 *
 * The split is deliberate. `fixtures` stays the authority on which rounds exist
 * — it is the source that has been right about 2019-20 running to 47 and
 * 2022-23 having no round 7 — and `events` only ever adds a deadline to a round
 * already established that way. A second list of rounds could disagree with the
 * first.
 */
export interface Gameweek {
  /** The round number. Not an index: 2019-20 runs 1-29 then 39-47. */
  id: number;
  name: string;
  finished: boolean;
  /**
   * When the round locks. NULL for the ten CSV-backfilled seasons, which have
   * no `events` rows: the deadline is a live-game fact and the historical files
   * do not carry it.
   */
  deadline_time: string | null;
  /**
   * Derived from `deadline_time` against the clock, never stored (API identity
   * rule 6): `is_next` is the earliest round whose deadline is still ahead,
   * `is_current` the latest whose deadline has passed. A season with no
   * deadlines has both false on every round, which is what a completed season
   * has always reported.
   */
  is_current: boolean;
  is_next: boolean;
}

/**
 * Whether a stat column can be shown for a season (item 13).
 *
 *   - `full`    every row that season carries a value: safe to render and sort
 *   - `partial` some rows are NULL, so no honest season total exists
 *   - `none`    no row carries a value
 *
 * `partial` and `none` both mean "do not offer this column", and they are two
 * states rather than one because they need two different sentences: `partial`
 * can name the round it starts at, `none` can name the seasons that do have it.
 */
export type ColumnState = 'full' | 'partial' | 'none';

export interface ColumnAvailability {
  /** A `player_gameweeks` column name — see NULLABLE_COLUMNS. */
  key: string;
  state: ColumnState;
  /**
   * The first round with a value, for a `partial` column only. Null on `full`
   * (it starts at round one by definition) and on `none` (there is no first
   * round), so a number here always means something.
   *
   * **Not a promise that every later round is measured.** 2022-23's
   * `expected_goal_involvements` is 16 and is holed again at round 29.
   */
  measured_from: number | null;
}

/**
 * One season's answer, with the empty case lifted to the season.
 *
 * `measured: false` means the season has no match rows at all — one fact, so it
 * is stated once rather than repeated as nine identical column entries, and
 * `columns` is empty. It is what stops the availability predicate reading TRUE
 * vacuously on 2026-27: over zero rows `count(col) = count(*) = 0` for every
 * column, so the season the app defaults to would otherwise claim to measure
 * everything it holds no data for.
 */
export interface SeasonColumnAvailability {
  season: string;
  measured: boolean;
  columns: ColumnAvailability[];
}

/**
 * One (season, column) cell of the cross-season matrix.
 *
 * Carries its own `season` rather than arriving under a season key, which is API
 * identity rule 7's many-seasons form — the same reason career rows carry theirs.
 */
export interface ColumnHistoryRow extends ColumnAvailability {
  season: string;
}

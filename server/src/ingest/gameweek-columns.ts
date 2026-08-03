/**
 * The columns of `player_gameweeks`, grouped by what their nullability means.
 *
 * Two ingests write this table and they must not drift apart: `ingest-gameweeks.ts`
 * loads the ten CSV-backfilled seasons, and `ingest-live-gameweeks.ts` loads the
 * live one from the official API. One table with two writers and two private
 * column lists is how a stat ends up stored by one path and silently dropped by
 * the other, so the list lives here and both import it.
 *
 * The groups are not cosmetic. They encode rule 6 — a column absent from a
 * season is NULL, never 0 — and which side of that line a column falls on is
 * the difference between "generated no chances" and "nobody measured it".
 *
 * Every name below is identical in `merged_gw.csv`, in the FPL API's
 * `element-summary` history rows, and in the table. That is not a coincidence:
 * the CSV is generated from that endpoint, which is what makes one list able to
 * serve both ingests.
 */

/** Resolved keys. Built, never read from a source: see rules 2, 5 and 12. */
export const KEY_COLUMNS = [
  'player_id',
  'fixture_id',
  'season',
  'gw',
  'was_home',
  'opponent_team_id',
] as const;

/** Integer stats present in all ten CSV seasons. NOT NULL. */
export const INT_COLUMNS = [
  'total_points',
  'minutes',
  'goals_scored',
  'assists',
  'clean_sheets',
  'goals_conceded',
  'own_goals',
  'penalties_saved',
  'penalties_missed',
  'saves',
  'yellow_cards',
  'red_cards',
  'bonus',
  'bps',
  'value',
  'selected',
  'transfers_in',
  'transfers_out',
] as const;

/** Decimal stats present in all ten CSV seasons. NOT NULL. */
export const NUM_COLUMNS = ['influence', 'creativity', 'threat', 'ict_index'] as const;

/**
 * Integer stats missing from at least one season. NULL there, never 0.
 *
 * Two eras sit in this list and a reader should know which is which. `starts`
 * and the defensive quartet are collected today and so arrive on every live
 * row; the fifteen from `attempted_passes` down are the 2016-17..2018-19 Opta
 * feed and appear in no modern source at all, so the live sync writes NULL for
 * every one of them. That is rule 6 working as intended rather than a gap.
 */
export const NULLABLE_INT_COLUMNS = [
  'starts',
  'tackles',
  'recoveries',
  'clearances_blocks_interceptions',
  'defensive_contribution',
  'attempted_passes',
  'big_chances_created',
  'big_chances_missed',
  'completed_passes',
  'dribbles',
  'errors_leading_to_goal',
  'errors_leading_to_goal_attempt',
  'fouls',
  'key_passes',
  'offside',
  'open_play_crosses',
  'penalties_conceded',
  'tackled',
  'target_missed',
  'winning_goals',
] as const;

/** Decimal stats missing from at least one season. */
export const NULLABLE_NUM_COLUMNS = [
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'expected_goals_conceded',
] as const;

export const ALL_COLUMNS = [
  ...KEY_COLUMNS,
  ...INT_COLUMNS,
  ...NUM_COLUMNS,
  ...NULLABLE_INT_COLUMNS,
  ...NULLABLE_NUM_COLUMNS,
] as const;

/** Everything except the conflict target, for a DO UPDATE clause. */
export const UPDATABLE_COLUMNS = ALL_COLUMNS.filter(
  (c) => c !== 'player_id' && c !== 'fixture_id'
);

/**
 * The stat columns the live API supplies per gameweek.
 *
 * Everything in ALL_COLUMNS that is neither a resolved key nor one of the
 * fifteen Opta-era columns no modern source carries. Derived rather than
 * written out, so adding a column to a group above cannot leave this behind.
 */
const OPTA_ERA_ONLY = new Set<string>([
  'attempted_passes',
  'big_chances_created',
  'big_chances_missed',
  'completed_passes',
  'dribbles',
  'errors_leading_to_goal',
  'errors_leading_to_goal_attempt',
  'fouls',
  'key_passes',
  'offside',
  'open_play_crosses',
  'penalties_conceded',
  'tackled',
  'target_missed',
  'winning_goals',
]);

export const LIVE_STAT_COLUMNS = ALL_COLUMNS.filter(
  (c) => !(KEY_COLUMNS as readonly string[]).includes(c) && !OPTA_ERA_ONLY.has(c)
);

export type GameweekColumn = (typeof ALL_COLUMNS)[number];

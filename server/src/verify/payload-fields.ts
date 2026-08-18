/**
 * Every field of the Players-list payload, classified by what a NULL in it
 * would mean. The data half of `verify:columns` part 2.
 *
 * **Driven off `PlayerSeasonTotals`, not off `PLAYER_COLUMNS`, and that is the
 * whole reason the file exists.** The defect that motivated part 2 was
 * `hauls_started` reading `0` for all 564 players of 2026-27, and
 * `hauls_started` has **no picker key** — it is a wire field the client divides
 * with. A map driven off the picker would have missed exactly the bug it was
 * written for. So the unit here is the payload field, and the map is exhaustive
 * over the interface.
 *
 * **It is in `src/verify/` rather than inside `columns-check.ts` so that a
 * compiler sees it.** `server/tsconfig.json` excludes `columns-check.ts` from
 * the program — it imports client code across `rootDir` — so a `satisfies` in
 * that file would be inert, which is the unused-type-alias failure in a new
 * costume. This file imports only types and stays inside the program, so
 * `satisfies Record<keyof PlayerSeasonTotals, FieldRule>` genuinely fails to
 * construct: add a field to `PlayerSeasonTotals` without classifying it here and
 * `npm run build` errors.
 */

import type { PlayerSeasonTotals } from '../types/domain.js';
import type { NullableColumn } from '../repositories/columns.js';

export type FieldRule =
  /**
   * NULL exactly where its inputs are unmeasured **for that player**, and a
   * number everywhere else. Per player rather than per season, because 2022-23
   * measures `starts` from round 16: a player who arrived in January has no
   * holed row and keeps a real total, while one who played through the boundary
   * does not.
   */
  | { kind: 'measured'; inputs: readonly NullableColumn[] }
  /**
   * A number on every row of every season, NULL nowhere.
   *
   * **This list was measured, not read off the query**, which matters because
   * reading is how the original defect got shipped: `listPlayerTotals` over all
   * eleven seasons returns 0 NULLs on each of these 17 fields across all 7,902
   * payload rows. See the item 20 record for the run and for what it found about
   * `points_per_game`.
   */
  | { kind: 'always' }
  /** Not a gameweek measurement, so part 2 has no claim to make about it. */
  | { kind: 'skip'; why: string };

const identity = (what: string): FieldRule => ({ kind: 'skip', why: what });

/**
 * The classification, exhaustive over the payload by construction.
 *
 * `satisfies` rather than a type annotation, so the object keeps its literal
 * type while still being checked for completeness — and so an **extra** key is
 * an error too, not just a missing one.
 */
export const PAYLOAD_FIELDS = {
  // Identity and dimension fields. `now_cost` and `start_cost` are nullable, but
  // for a dimension reason rather than a measurement one: they come from
  // `player_seasons`, not from summing match rows, so "unmeasured" is not what a
  // NULL there means and part 2 would be asserting the wrong thing about them.
  id: identity('players.fpl_code'),
  first_name: identity('players dimension'),
  second_name: identity('players dimension'),
  web_name: identity('players dimension'),
  team: identity('teams.fpl_team_code'),
  element_type: identity('derived from player_seasons.position'),
  photo: identity('derived from fpl_code'),
  now_cost: identity('player_seasons price, not a gameweek measurement'),
  start_cost: identity('player_seasons price, not a gameweek measurement'),

  // Counted or summed over columns that are NOT NULL in every season, so 0 is a
  // measurement rather than an absence (rule 6). `hauls` and `floors` are here
  // deliberately: they read 0 on 2026-27 and nulling them would be the opposite
  // overreach to the one part 2 exists to catch.
  matches: { kind: 'always' },
  total_points: { kind: 'always' },
  minutes: { kind: 'always' },
  goals_scored: { kind: 'always' },
  assists: { kind: 'always' },
  clean_sheets: { kind: 'always' },
  bonus: { kind: 'always' },
  bps: { kind: 'always' },
  saves: { kind: 'always' },
  influence: { kind: 'always' },
  creativity: { kind: 'always' },
  threat: { kind: 'always' },
  ict_index: { kind: 'always' },
  hauls: { kind: 'always' },
  floors: { kind: 'always' },
  appearances: { kind: 'always' },
  // Reads 0, never NULL, for a player who never appeared: the division is
  // NULLIF'd and the outer COALESCE turns it back into 0. Classifying it here
  // PINS that answer. Whether it is the right one is an open question with two
  // coherent readings, recorded in the item 20 file — and if it is ever
  // revisited, the fix is a fourth FieldRule kind, not a loosened assertion.
  points_per_game: { kind: 'always' },

  // The eight fields a season can genuinely fail to measure.
  starts: { kind: 'measured', inputs: ['starts'] },
  expected_goals: { kind: 'measured', inputs: ['expected_goals'] },
  expected_assists: { kind: 'measured', inputs: ['expected_assists'] },
  expected_goal_involvements: {
    kind: 'measured',
    inputs: ['expected_goal_involvements'],
  },
  defensive_contribution: { kind: 'measured', inputs: ['defensive_contribution'] },
  // Derived: the hit count is a count over `defensive_contribution`, so it is
  // unmeasured exactly where that column is.
  defcon_hits: { kind: 'measured', inputs: ['defensive_contribution'] },
  // Derived twice over: a count over `defensive_contribution` that is also
  // gated on `starts = 1`, so it is unmeasured wherever EITHER input is. The
  // extra input is the whole difference from `defcon_hits` above, and it is
  // restated here rather than read off the shipped guard for the reason this
  // file exists — see the header.
  defcon_hits_started: {
    kind: 'measured',
    inputs: ['defensive_contribution', 'starts'],
  },
  // Derived: gated on `starts = 1`, so `starts` is the input and `total_points`
  // — being NOT NULL — can never be the restrictive one. These two are the
  // fields the defect was in.
  hauls_started: { kind: 'measured', inputs: ['starts'] },
  floors_started: { kind: 'measured', inputs: ['starts'] },
} satisfies Record<keyof PlayerSeasonTotals, FieldRule>;

export type PayloadField = keyof typeof PAYLOAD_FIELDS;

const entries = Object.entries(PAYLOAD_FIELDS) as [PayloadField, FieldRule][];

/** The fields a season can fail to measure — part 2's checked set. */
export const MEASURED_FIELDS: PayloadField[] = entries
  .filter(([, r]) => r.kind === 'measured')
  .map(([k]) => k);

/** The fields that must carry a number on every row of every season. */
export const ALWAYS_FIELDS: PayloadField[] = entries
  .filter(([, r]) => r.kind === 'always')
  .map(([k]) => k);

/**
 * Every database column any measured field reads, deduplicated — what the truth
 * query has to count NULLs over.
 *
 * Derived from the map rather than listed again: a second list is a second
 * thing to forget to update, and this one would fail silently by simply never
 * checking the new field's input.
 */
export const TRUTH_COLUMNS: NullableColumn[] = [
  ...new Set(
    entries.flatMap(([, r]) => (r.kind === 'measured' ? [...r.inputs] : []))
  ),
];

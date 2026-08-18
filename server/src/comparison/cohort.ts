/**
 * The comparison chart's data: axis values for the players asked for, and the
 * cohort band to read them against.
 *
 * Step 2 froze the axis *scales* (`thresholds.ts`); this serves the *values*
 * drawn on them. Values are raw and never scaled — the client scales against the
 * thresholds it fetches, so the scaling rule lives in exactly one place and this
 * module never has to know it.
 *
 * **No SQL is written here, and that is the load-bearing property.** Every one
 * of the eleven axes is already a `PLAYER_COLUMNS` key with a query behind it,
 * so this module calls `listPlayerTotals` — the query the Players list uses —
 * and reads fields off its rows. A second SQL expression for PPM or Pts/£ would
 * be a second definition of the stat, free to drift from the one on screen.
 *
 * That reuse is also what decides where the median is computed: see `median`.
 */

import type { Queryable } from '../db/pool.js';
import type { PlayerSeasonTotals, SeasonColumnAvailability } from '../types/domain.js';
import { listPlayerTotals } from '../repositories/players.js';
import { seasonAvailability, type NullableColumn } from '../repositories/columns.js';
import {
  COMPARISON_THRESHOLDS,
  type ComparisonAxisKey,
  type ComparisonPosition,
} from './thresholds.js';

/**
 * The cohort gate, in minutes. The same 1,200 the thresholds were derived over
 * — a band drawn from a different population than the ceilings would put the
 * typical player and the axis maximum on two different footings.
 */
export const COHORT_MINUTES = 1200;

/**
 * Below this many cohort members there is no band, and the server says so by
 * sending `band: null`.
 *
 * **The server applies the floor; the client never compares a number to a
 * threshold.** That is `defcon.ts`'s rule, for `defcon.ts`'s reason: one rule in
 * two languages is free to drift. `size` still travels, so the client can word
 * its own explanation of the absence without having to re-derive the decision.
 *
 * Ten rather than "not empty", because an average over the first three players
 * past 1,200 minutes is those three players. On an in-progress season the cohort
 * is empty until roughly GW14, so this is the ordinary state of a live season's
 * opening months rather than an edge case.
 */
export const COHORT_MIN_SIZE = 10;

const POSITION_BY_ELEMENT_TYPE: Record<number, ComparisonPosition> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

type AxisValue = (p: PlayerSeasonTotals) => number | null;

/**
 * Points per million, over the price this season is priced at.
 *
 * **A second implementation of `client/src/lib/playerColumns.ts`'s
 * `perMillion`, and the duplication is deliberate but not free.** The band
 * forces it: a median of Pts/£ across 109 players cannot be taken on a client
 * that only ever sees the two players it asked for. The alternative — promoting
 * it onto `listPlayerTotals` — would put a derived field on every player row of
 * every bootstrap to save four lines here.
 *
 * **The drift is guarded by a test rather than by this comment**: `cohort.test.ts`
 * asserts this equals what the Players list serves for the same player-season.
 * Item 11's rounding bug was one formula in two languages and surfaced only when
 * the two numbers disagreed on screen; a note recording that risk would not fire.
 *
 * `now_cost` already arrives as `COALESCE(now_cost, end_cost)` from the query —
 * `now_cost` is NULL on every completed season — so the fallback is not repeated
 * here. Null and zero cost both yield null rather than a division result.
 */
export const ptsPerNow: AxisValue = (p) =>
  p.now_cost === null || p.now_cost === 0 ? null : p.total_points / (p.now_cost / 10);

/**
 * Defensive contribution hits per start.
 *
 * **Both operands are guarded, and dropping either guard is silent.** `null / 5`
 * and `4 / null` are `0` in JavaScript, not `NaN` — so an unguarded copy renders
 * a confident `0.00` on the axis for a player whose hit count was never
 * measured, which is rule 6 defeated by a coercion in a value indistinguishable
 * from a real zero. Item 14 found exactly this on the client copy
 * (`playerColumns.ts:110`) and the hazard is identical here.
 *
 * **A zero denominator is null, not 0**, so "made no starts" and "hit none of
 * his starts" stay distinguishable. Not the edge case it sounds: 367 of
 * 2025-26's 841 players have no starts at all.
 *
 * **Both surfaces guard that zero denominator with the same rule**, which item
 * 24 checked rather than assumed: this returns null and `playerColumns.ts`'s
 * `perStart` returns null, so a zero-start player breaks the radar outline over
 * the spoke (rule 19) and renders the no-value marker in the table. The cohort
 * cannot reach the case — but its gate is 1,200 MINUTES rather than a starts
 * floor, so that is a measurement and not a guarantee: the least-started member
 * of the 2025-26 DCH cohort has 13 starts, and no outfield player that season
 * has a hit without a start. Traces are not cohort-gated at all, so the guard
 * is what covers this rather than the gate.
 *
 * **The numerator is the started-only count, and it is bounded at 1.00.**
 * Item 24: `defcon_hits` includes hits won off the bench, so dividing it by
 * starts drew from a population the denominator did not cover. The count column
 * on the Players list still counts every hit; only this ratio is gated.
 *
 * **This axis was outside item 24's stated scope and had to come in anyway.**
 * The brief named the Players column; this is the same quantity under the same
 * `DCH/St` label one page away, and leaving it ungated would have shipped the
 * inconsistency the item exists to remove instead of one surface further along.
 */
export const hitsPerStart: AxisValue = (p) =>
  p.defcon_hits_started === null || p.starts === null || p.starts === 0
    ? null
    : p.defcon_hits_started / p.starts;

/**
 * How each axis is read off a row.
 *
 * Nine of the eleven are a field; two are the quotients above. Nothing here
 * computes a stat from gameweek rows — `measuredSum` and item 14's count guard
 * already ran inside `listPlayerTotals`, so a null arriving here means "not
 * measured" and must be passed through as null (rule 6).
 */
const AXIS_VALUE: Record<ComparisonAxisKey, AxisValue> = {
  pts: (p) => p.total_points,
  clean_sheets: (p) => p.clean_sheets,
  goals: (p) => p.goals_scored,
  minutes: (p) => p.minutes,
  ppm: (p) => p.points_per_game,
  defcon_hits_per_start: hitsPerStart,
  assists: (p) => p.assists,
  pts_per_now: ptsPerNow,
  expected_goal_involvements: (p) => p.expected_goal_involvements,
  bonus: (p) => p.bonus,
  saves: (p) => p.saves,
};

/**
 * The nullable database columns an axis reads. An empty list means the axis is
 * built from NOT NULL columns and is available wherever the season exists.
 *
 * Declared here rather than imported from the client's `dependsOn`, for the
 * reason `verify:columns` declares its `DB_COLUMNS`: this is data *about* the
 * axes, and restating it is what stops the availability answer agreeing with
 * itself. The values it produces are the ones tested.
 */
const AXIS_DEPENDS_ON: Record<ComparisonAxisKey, NullableColumn[]> = {
  pts: [],
  clean_sheets: [],
  goals: [],
  minutes: [],
  ppm: [],
  defcon_hits_per_start: ['defensive_contribution', 'starts'],
  assists: [],
  pts_per_now: [],
  expected_goal_involvements: ['expected_goal_involvements'],
  bonus: [],
  saves: [],
};

/**
 * The median of a cohort, as `percentile_disc` defines it: **an actual member
 * value, and the lower of the two middle ones on an even cohort.**
 *
 * **Computed in TypeScript because of the reuse rule, not by preference.** Doing
 * it in SQL would mean restating all eleven axis expressions in a second place,
 * which is the duplication this whole module exists to avoid. Taking it over the
 * same extractor that produces the player values means one expression per axis
 * feeds both the spoke and the band.
 *
 * **`percentile_disc` rather than `percentile_cont`.** Nine of the eleven axes
 * are integer counts, and interpolating puts the band at 6.5 clean sheets or 2.5
 * goals — a value no player achieved, on a marker whose entire job is to say
 * "here is the typical player". A real member value is defensible and reproduces
 * exactly rather than depending on a rounding convention.
 *
 * The two agree on every odd cohort, so the test that pins this has to use an
 * even one — GK 2025-26, where `cont` is 111 and this returns 109.
 *
 * Nulls are excluded rather than counted as zero: a null is "not measured", and
 * a cohort of nulls has no median at all.
 */
export function median(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  // Postgres takes the value at 1-based position ceil(p * n); for p = 0.5 that
  // is the lower of the two middles when n is even, and the middle when odd.
  return present[Math.ceil(0.5 * present.length) - 1];
}

/** Which axes this position draws that this season can actually answer. */
function axesFor(
  position: ComparisonPosition,
  availability: SeasonColumnAvailability
): ComparisonAxisKey[] {
  const state = new Map(availability.columns.map((c) => [c.key, c.state]));

  return COMPARISON_THRESHOLDS[position]
    .map((t) => t.axis)
    .filter((axis) =>
      // `full` and nothing less. A `partial` column is 2022-23's expected family:
      // a season total short by fourteen rounds, in a spoke indistinguishable
      // from a complete one. Item 13's predicate, applied to a chart.
      AXIS_DEPENDS_ON[axis].every((column) => state.get(column) === 'full')
    );
}

export interface ComparisonPlayer {
  /** `players.fpl_code` — a permanent code, never an element id (rule 1). */
  id: number;
  web_name: string;
  /** Keyed by axis; only the axes in `axes` appear. Null means not measured. */
  values: Partial<Record<ComparisonAxisKey, number | null>>;
}

export interface ComparisonCohort {
  /**
   * Player-seasons past the minutes gate. Always present, including at 0, so a
   * client can say why there is no band rather than inferring it.
   */
  size: number;
  /** Null below `COHORT_MIN_SIZE`. Keyed by axis, as the players are. */
  band: Partial<Record<ComparisonAxisKey, number | null>> | null;
}

export interface ComparisonResult {
  season: string;
  position: ComparisonPosition;
  /**
   * The spokes that exist, in the frozen canonical order. An axis this season
   * cannot answer is **absent here and from every `values` map**, never
   * null-valued, so the client drops the spoke and re-spaces rather than drawing
   * one that means nothing.
   */
  axes: ComparisonAxisKey[];
  cohort: ComparisonCohort;
  players: ComparisonPlayer[];
}

/**
 * A refusal the caller has to turn into a status code.
 *
 * Returned rather than thrown so the logic stays testable without HTTP, and so
 * the route keeps the only knowledge of what an HTTP status means.
 */
export type ComparisonOutcome =
  | { ok: true; result: ComparisonResult }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Everything the comparison chart needs for one season and one position.
 *
 * **One query for the season plus, on one season in eleven, one more for
 * availability.** `seasonAvailability` is handed the rows already in hand, so it
 * costs nothing on the other ten — the same trick the bootstrap uses.
 *
 * A requested player who is not this position is a 400 rather than a spoke drawn
 * on the wrong axis set. Rejecting beats a silent mis-render for the reason
 * `/career` rejects `?season=`.
 */
export async function getComparison(
  db: Queryable,
  season: string,
  position: ComparisonPosition,
  codes: number[]
): Promise<ComparisonOutcome> {
  const totals = await listPlayerTotals(db, season);
  const availability = await seasonAvailability(db, season, totals);
  const axes = axesFor(position, availability);

  const byCode = new Map(totals.map((p) => [p.id, p]));
  const players: ComparisonPlayer[] = [];

  for (const code of codes) {
    const row = byCode.get(code);
    if (row === undefined) {
      return { ok: false, status: 404, error: `No player with code ${code} in ${season}` };
    }
    if (POSITION_BY_ELEMENT_TYPE[row.element_type] !== position) {
      return {
        ok: false,
        status: 400,
        error:
          `${row.web_name} is a ${POSITION_BY_ELEMENT_TYPE[row.element_type]} in ${season}, ` +
          `not a ${position}. A comparison draws one position's axis set.`,
      };
    }
    players.push({ id: row.id, web_name: row.web_name, values: valuesFor(row, axes) });
  }

  const cohort = totals.filter(
    (p) => p.minutes >= COHORT_MINUTES && POSITION_BY_ELEMENT_TYPE[p.element_type] === position
  );

  const band =
    cohort.length < COHORT_MIN_SIZE
      ? null
      : Object.fromEntries(
          axes.map((axis) => [axis, median(cohort.map((p) => AXIS_VALUE[axis](p)))])
        );

  return {
    ok: true,
    result: { season, position, axes, cohort: { size: cohort.length, band }, players },
  };
}

function valuesFor(
  row: PlayerSeasonTotals,
  axes: ComparisonAxisKey[]
): Partial<Record<ComparisonAxisKey, number | null>> {
  return Object.fromEntries(axes.map((axis) => [axis, AXIS_VALUE[axis](row)]));
}

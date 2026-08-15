/**
 * Hauls and floors: how many fixtures cleared a points line.
 *
 * **The second scoring rule the app computes for itself**, after
 * `defcon.ts`, and it gets a module for the same reason: the comparison is
 * ours rather than FPL's, so it is stated once and nothing else states it.
 *
 * **What it buys, which a season total cannot.** Two players on 120 points are
 * indistinguishable on the Players list and are not the same asset. One returns
 * 6 most weeks; the other blanks repeatedly and then scores 15. A haul count
 * and a floor count separate them, and — measured over the 849 player-seasons
 * of the item 19 cohort — haul rate is **not** a redrawing of points per match:
 * r = 0.630 for DEF, 0.467 for GK, 0.806 for MID, 0.809 for FWD. If it were a
 * restatement of PPM these columns would not be worth having.
 *
 * **The unit is the FIXTURE, never the round.** A double gameweek contributes
 * two to every count here and two to the starts denominator; a 6 and a 5 in one
 * round is two floors and no hauls. That is rule 13 — `(player_id, gw)` is not
 * a key — applied to a count.
 *
 * **Floors are inclusive of hauls, not a 4-to-9 band**, so `floors >= hauls`
 * holds on every row. Pinned as an invariant in `hauls.test.ts` rather than
 * left as a comment, because it is the kind of claim a refactor can quietly
 * break.
 */

/**
 * The two points lines, fixed by convention rather than derived from a season.
 *
 * 4 is FPL's appearance-plus-something line; **10 is community usage and is not
 * a number FPL publishes anywhere**. Neither is a statistic, so unlike
 * `DEFCON_THRESHOLDS` — and unlike the comparison thresholds, which record the
 * seasons they were derived from — these are **not re-derived when a season is
 * added**. There is nothing to re-derive them from.
 *
 * **But fixed is not the same as stable in meaning, and the counts are NOT
 * freely comparable across seasons.** What a 4-point match represents moved
 * when defensive contribution points arrived in 2025-26, without the number 4
 * moving: that season records **3,221 floors against roughly 2,650 in every
 * other season in the database**, and the lift appears in exactly the two
 * positions that can earn DC points (DEF and MID) and neither of the two that
 * cannot (GK and FWD). A count is comparable across seasons only as far as
 * FPL's scoring rules are, and those change. Figures:
 * `docs/items/item-19-hauls-and-floors.md`.
 */
export const POINT_THRESHOLDS = { HAUL: 10, FLOOR: 4 } as const;

/**
 * The only legal arguments to `pointCountSql` — `10 | 4`.
 *
 * A bare `number` would let a caller invent a cutoff and get a plausible column
 * back with no compile error. This is a constraint on a real parameter rather
 * than an unused type alias, so it fails to *construct* rather than merely
 * failing to be assignable to something nothing assigns to.
 *
 * **What it does not buy**, so nobody over-reads it: it constrains the *value*,
 * not the *provenance*. A caller can still write the literal `10` without
 * importing `POINT_THRESHOLDS`.
 */
export type PointThreshold = (typeof POINT_THRESHOLDS)[keyof typeof POINT_THRESHOLDS];

/**
 * How many of a player-season's fixtures reached `threshold` points.
 *
 * **A function taking its table alias, not an exported string** — same reason
 * as `defconHitSql`: hardcoding `pg.` couples every caller to that name
 * silently, because SQL inside a template literal is opaque to tsc, so a rename
 * type-checks and fails at runtime. Passing it makes the coupling an argument.
 *
 * **`sum(CASE …)` rather than `count(*) FILTER (…)`.** Over zero rows `sum()`
 * is NULL while `count(*) FILTER` is 0, which is the distinction item 14 turned
 * on.
 *
 * **But do not lean on that to null out an empty player-season — it does not,
 * and item 19 got this wrong before measuring.** The `ELSE 0` means this
 * aggregate returns 0 rather than NULL over any row it sees, and a LEFT JOIN
 * gives a player with no match rows exactly one null-extended row to see. Every
 * caller wanting NULL there must say so with `count(pg.fixture_id) > 0`;
 * `listPlayerTotals` does, and the comment there records what it read without
 * it.
 *
 * **`startedOnly` gates the count on `starts = 1`, and it is the whole
 * difference between the count columns and the ratio numerators.** `Hauls`
 * counts every fixture; `Pts10+/St`'s numerator counts only started ones, which is
 * what bounds that ratio at 1.00. **`DCH/St` does the opposite** — its
 * numerator is ungated and it can exceed 1 — so this is deliberately not the
 * same fragment, and copying between them is a bug in either direction.
 *
 * **A gated count needs the caller to guard on `starts` being fully measured.**
 * `pg.starts = 1` where `starts IS NULL` evaluates to NULL, the `CASE` falls to
 * `ELSE 0`, and the count silently undercounts rather than erroring — 2022-23
 * measures `starts` only from round 16, so an unguarded gated count there reads
 * fourteen rounds of real appearances as bench appearances. The guard lives at
 * the call site because that is where `fullyMeasured` lives; see
 * `listPlayerTotals`.
 *
 * Safe to interpolate: `threshold` is a numeric literal from a compile-time
 * constant, never user input, and a column alias cannot be a bind parameter in
 * Postgres anyway.
 */
export function pointCountSql(
  pg: string,
  threshold: PointThreshold,
  opts: { startedOnly: boolean }
): string {
  const gate = opts.startedOnly ? `${pg}.starts = 1 AND ` : '';
  return `sum(CASE WHEN ${gate}${pg}.total_points >= ${threshold} THEN 1 ELSE 0 END)`;
}

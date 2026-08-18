/**
 * The defensive contribution threshold: whether a gameweek was a "hit".
 *
 * **This is the first scoring rule the app computes for itself.** Everything
 * else on screen is either FPL's own number or arithmetic over FPL's numbers;
 * this one is a comparison we make. That is the reason it gets a module of its
 * own rather than an inline `CASE` at each call site — the same reason
 * `ingest/holes.ts` has one.
 *
 * **What it buys, which the season total cannot.** A season DC total does not
 * say whether the player clears the threshold. Gabriel's 2025-26 is 277 over 30
 * starts — 9.2 a start, just under a defender's 10 — and the total cannot
 * distinguish a player who hits most weeks from one who almost never does.
 * Measured, he hits 11 times in 38 rows.
 *
 * **The server computes the hit; the client never compares a number to a
 * threshold.** The Players list needs a season *count*, which is only
 * computable here — the client sees season totals and never the gameweek rows.
 * If the server counted and the client flagged, one rule would exist in two
 * languages and be free to drift, which is item 11's rounding bug and item 13's
 * `measured_from` duplication. So both the per-row 0/1 and the season count are
 * built from `defconHitSql` below, and nothing else states the rule.
 *
 * **What `defensive_contribution` actually is, measured rather than assumed.**
 * It is a raw action count, not points: 2025-26's 29,747 rows range 0-29 and
 * 5,117 of them carry an odd value, where a points field would be 0 or 2 and
 * nothing else. Its composition is position-dependent and reproduces FPL's
 * published rule exactly on 26,320 of 26,320 outfield rows — defenders count
 * CBIT (tackles + clearances/blocks/interceptions), midfielders and forwards
 * count CBIRT (the same plus recoveries).
 */

/**
 * Defensive contribution thresholds as FPL defined them when the rule was
 * introduced in 2025-26. If a later season changes them this becomes a
 * per-season lookup, and 2025-26 keeps 10/12 whatever the new value is.
 *
 * A named constant rather than a season-keyed table, deliberately: season-key it
 * when there are two values, not before. One value in a map keyed by season is a
 * shape pretending to information it does not have.
 *
 * **Goalkeepers are absent because FPL computes no DC for them**, and that was
 * measured rather than inferred from the rules page. DC is 0 on all 3,427 GK
 * rows of 2025-26 *while the components are not*: keepers recorded 24 tackles,
 * 934 CBI and 6,195 recoveries in those same rows. So the 0 is FPL declining to
 * compute the stat for the position, and there is no keeper threshold to get
 * wrong.
 */
export const DEFCON_THRESHOLDS = { DEF: 10, MID: 12, FWD: 12 } as const;

/**
 * The per-row hit: 1, 0, or NULL where nobody measured.
 *
 * **A function taking its table aliases, not an exported string.** Hardcoding
 * `pg.` and `ps.` would couple every caller to those names silently — a rename
 * type-checks and then fails at runtime, because SQL in a template literal is
 * opaque to tsc. Passing them makes the coupling an argument.
 *
 * **Clause order is load-bearing.** The NULL test comes first, so a 2016-17
 * goalkeeper row — where DC was never measured at all — yields NULL rather than
 * falling into the GK branch's 0. Reversing those two clauses asserts a
 * measurement nobody took, which is rule 6 in one line.
 *
 * **A goalkeeper is 0 rather than NULL.** The column answers "did he score the
 * DC point", and a keeper scored none: true, and consistent with the DC column
 * already reading 0 for keepers. NULL would say "not measured", which is the one
 * meaning it must not carry here, since DC genuinely *is* measured for them and
 * genuinely is zero.
 *
 * **No `ELSE`.** `player_seasons.position` has a CHECK restricting it to
 * GK/DEF/MID/FWD, so the fall-through is unreachable via a stored position — it
 * is reachable only when `position` is NULL, which happens only on a LEFT JOIN
 * miss (see `getPlayerHistory`). NULL is the right answer there and an `ELSE 0`
 * would invent one.
 *
 * The thresholds are interpolated from DEFCON_THRESHOLDS above, so the numbers
 * appear exactly once in the codebase. Safe to interpolate: they are numeric
 * literals from a compile-time constant, never user input, and a column or
 * table alias cannot be a bind parameter in Postgres anyway.
 */
export function defconHitSql(pg: string, ps: string): string {
  const clauses = Object.entries(DEFCON_THRESHOLDS)
    .map(
      ([position, threshold]) =>
        `WHEN ${ps}.position = '${position}' THEN (${pg}.defensive_contribution >= ${threshold})::int`
    )
    .join('\n              ');

  return `CASE
              WHEN ${pg}.defensive_contribution IS NULL THEN NULL
              ${clauses}
              WHEN ${ps}.position = 'GK' THEN 0
            END`;
}

/**
 * How many of a player-season's fixtures were hits.
 *
 * **The structural mirror of `pointCountSql`, and deliberately so.** Item 24
 * gave `DCH/St` a started-only numerator to match `Pts10+/St`, and two count
 * fragments with the same `startedOnly` shape is what stops the two ratios
 * drifting apart again. The threshold itself is never restated here — this
 * wraps `defconHitSql` above, so a change to `DEFCON_THRESHOLDS` cannot reach
 * one aggregate and miss the other.
 *
 * **`count(*) FILTER` rather than `pointCountSql`'s `sum(CASE … ELSE 0)`**, and
 * the difference is not a disagreement. `sum()` over zero rows is NULL where
 * `count(*) FILTER` is 0, but neither caller ever sees zero rows: the LEFT JOIN
 * in `listPlayerTotals` gives a player with no match rows exactly one
 * null-extended row, over which the `ELSE 0` and the `FILTER` both produce a
 * hard 0. So **both forms need the caller's `count(pg.fixture_id) > 0` guard**,
 * and each keeps the form its module already used.
 *
 * **`startedOnly` gates on `starts = 1`, which bounds the ratio at 1.00.** A
 * hit won off the bench is still a hit and still counts in `DCH`; it is only
 * excluded from the numerator of a ratio whose denominator is starts. That was
 * the item 24 defect: 8 bench hits across 2025-26 inflating 8 players' ratios
 * against a denominator that never covered them.
 *
 * **A NULL `starts` is excluded rather than counted.** `pg.starts = 1` is NULL
 * where `starts` is NULL, so `NULL AND …` is NULL and the row is not filtered
 * in. That is the right answer per row and still not sufficient per season —
 * a partly measured `starts` column undercounts silently, so the caller must
 * also guard on `fullyMeasured('starts')`. See `listPlayerTotals`.
 */
export function defconHitCountSql(pg: string, ps: string, opts: { startedOnly: boolean }): string {
  const gate = opts.startedOnly ? `${pg}.starts = 1 AND ` : '';
  return `count(*) FILTER (WHERE ${gate}${defconHitSql(pg, ps)} = 1)`;
}

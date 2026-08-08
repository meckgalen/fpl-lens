/**
 * How the averages row divides, and how the result is rounded.
 *
 * A pure module with no React import, for two reasons. It is imported by the
 * verification script, which runs the shipped code over all 253,509 rows rather
 * than a copy of it — a check that reimplements the arithmetic proves nothing. And
 * it keeps `StatsTable.tsx` a module whose exports are all components, which is what
 * React Fast Refresh requires.
 */

import { NO_VALUE } from '../types/fpl';
import type { GameweekHistory } from '../types/fpl';

/**
 * Round to `digits` decimals, half-to-even.
 *
 * **Explicit, and deliberately not built on `toFixed`.** `toFixed` is not a rounding
 * convention at all — it is whatever binary representation happens to give, so
 * `(1.005).toFixed(2)` is `"1.00"` because 1.005 is not exactly 1.005. Measured
 * across the ten seasons: of the 226 player-seasons whose points-per-appearance
 * lands on an exact `.x5` tie, `toFixed` disagreed with half-to-even on 111 and
 * agreed on 115 — **6 of those agreements by accident**, where the float was not
 * exactly `.x5` and it rounded down onto the right answer for the wrong reason.
 *
 * Half-to-even is FPL's own convention (their Python) and is unbiased. It used to be
 * applied in SQL, which meant the rule existed in two languages and could drift
 * across the boundary; it now happens once, here, and the server sends the quotient
 * unrounded. See API identity rule 5.
 */
export function roundHalfEven(value: number, digits: number): number {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;

  let n: number;
  if (frac > 0.5) n = floor + 1;
  else if (frac < 0.5) n = floor;
  else n = floor % 2 === 0 ? floor : floor + 1;

  return n / scale;
}

/** One decimal, half-to-even, as a string. The presentation every average uses. */
export function fmtAverage(value: number, digits = 1): string {
  return roundHalfEven(value, digits).toFixed(digits);
}

/**
 * `points_per_game`, formatted by **the same function** as the averages row.
 *
 * This is the point of the whole rounding change, so it is worth being blunt about:
 * PPG and the averages row's Pts cell are the same quantity, and they used to be
 * rounded in two languages by two rules. Every consumer of PPG goes through here —
 * the header card, the career table, the Players list and the Dashboard — so they
 * cannot disagree with the row beneath them by construction rather than by care.
 *
 * `fmtNum` is not usable for it any more: it ends in `toFixed`, which is what the
 * averages row used to do and is not a convention (see `roundHalfEven`).
 */
export function fmtPpg(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return fmtAverage(value);
}

/**
 * Which rows an average divides by.
 *
 * A parameter rather than a hardcoded rule, because the deferred per-90 toggle is
 * this same mechanism with a third option. **The strategy yields a divisor, not a
 * count**, which is the part that matters for the seam: per-90 divides by
 * `sum(minutes) / 90`, which is not a row count at all, so a seam that only passed
 * an integer would have forbidden it.
 *
 * Only `per-appearance` ships in this item. `per-fixture` is what the table did
 * before and is kept because it costs one line and documents what changed;
 * `per-90` is deliberately absent rather than stubbed.
 */
export type Normalization = 'per-appearance' | 'per-fixture';

interface Strategy {
  /** Whether a row counts toward the **denominator**. Not toward the numerator. */
  counts: (gw: GameweekHistory) => boolean;
  /** The divisor, given the rows that count and carry a value for this column. */
  divisor: (counted: GameweekHistory[]) => number;
}

const STRATEGIES: Record<Normalization, Strategy> = {
  /**
   * Fixtures the player was actually on the pitch for. `minutes > 0` is FPL's own
   * definition of an appearance and is what `points_per_game` has always divided by
   * (`repositories/players.ts`), which is the disagreement this item exists to end:
   * the averages row said 4.5 while the career row above it said 4.6, of the same
   * quantity, six inches apart.
   *
   * A double gameweek contributes two appearances, which is right and is what FPL
   * reproduces — Saka 2025-26 is 157/31, not 157/38.
   */
  'per-appearance': {
    counts: (gw) => gw.minutes > 0,
    divisor: (rows) => rows.length,
  },
  /** Every row shown, played or not. What the table divided by before this item. */
  'per-fixture': {
    counts: () => true,
    divisor: (rows) => rows.length,
  },
};

export interface ColumnAverage {
  /** The mean, or null where nothing contributed and the cell shows a placeholder. */
  value: number | null;
  /** How many rows it divided by. 0 exactly when `value` is null. */
  denominator: number;
}

/**
 * The average of one column, and the denominator it used.
 *
 * **The two filters do different jobs, and conflating them is a real bug rather than
 * a nicety.** The null filter picks the numerator: a row with no value for this
 * column contributes nothing and is not counted (rule 6 — a 2022-23 xG average must
 * not divide by rounds nobody measured). The played filter picks the **denominator
 * only**: it decides what to divide by, not what to add up.
 *
 * That asymmetry is FPL's own definition — `points_per_game` is the season total
 * over appearances — and the wide verification run is what forced it. Sensible-
 * looking code that filtered the numerator by `minutes > 0` too disagreed with the
 * career row on **7 player-seasons**. FPL counts what happens on a no-minutes row in
 * the season total, so excluding those rows from the numerator makes the averages row
 * disagree with the number printed directly above it — the bug this item exists to
 * remove.
 *
 * **Nine of the 26 averaged columns can be non-zero on such a row**, so this shapes
 * nine averages and not just Pts. Measured over all ten seasons: 19 rows in 18
 * player-seasons — `bps` on 15 (−9 to 4), `total_points` on 14 (−3 to −1),
 * `yellow_cards` on 13, `ict_index` on 3, `influence` / `creativity` /
 * `expected_goals_conceded` on 2 each, `red_cards` / `threat` on 1. Everything else
 * is 0 on every one of them.
 *
 * They are **two disjoint populations** (overlap exactly 0): 14 bookings, which
 * account for the card and points columns and 14 of the 15 BPS rows; and 5 rows
 * carrying attacking or defensive values with no card, which a booking cannot
 * explain — a card's BPS is negative and generates no threat. The cause of those
 * five is **not established and was not chased**: the arithmetic reproduces FPL at
 * 400 of 400 either way. See CLAUDE.md, API identity rule 5.
 *
 * `total_points` is merely the only one printed next to a second number that would
 * expose the disagreement, which is why the PPG cross-check caught it and nothing
 * else would have.
 *
 * The denominator is returned rather than inferred, because the caller needs it for
 * the footnote and because the columns do not agree — 2022-23 holes `starts` and the
 * expected family from round 16, so a player can carry three different denominators
 * across one row.
 */
export function columnAverage(
  rows: GameweekHistory[],
  valueOf: (gw: GameweekHistory) => number | null,
  normalization: Normalization = 'per-appearance'
): ColumnAverage {
  const strategy = STRATEGIES[normalization];

  const measured = rows.filter((gw) => valueOf(gw) !== null);
  const counted = measured.filter(strategy.counts);

  const divisor = strategy.divisor(counted);
  if (divisor === 0) return { value: null, denominator: 0 };

  const total = measured.reduce((sum, gw) => sum + (valueOf(gw) ?? 0), 0);
  return { value: total / divisor, denominator: counted.length };
}

/** How many of the rows shown the player actually appeared in. */
export function appearanceCount(
  rows: GameweekHistory[],
  normalization: Normalization = 'per-appearance'
): number {
  return rows.filter(STRATEGIES[normalization].counts).length;
}

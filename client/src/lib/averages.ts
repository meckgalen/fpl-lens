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
  return fmtQuotient(value, 1);
}

/**
 * A nullable quotient at `digits` places, rounded the one way this app rounds.
 *
 * `fmtPpg` is this at one digit and delegates to it, so nothing about PPG moved
 * — the generalisation exists because item 14's hits-per-start wants two places
 * and **must not reach for `fmtNum`**. `fmtNum` ends in `toFixed`, which is not
 * an implementation of any rounding convention but whatever the binary
 * representation gives; item 11 measured it disagreeing with `roundHalfEven` on
 * 111 of 226 tied player-seasons. Every quotient in this app goes through here.
 *
 * `Number.isFinite` catches the division-by-zero the callers are supposed to
 * have handled themselves. It is a backstop and not the policy: a caller with a
 * zero denominator should return null and say why, so that "no starts" and
 * "hit none of his starts" stay distinguishable.
 */
export function fmtQuotient(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return fmtAverage(value, digits);
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

/* -------------------------------------------------------------------------- */
/*  The footnote                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What the averages footnote says, computed rather than formatted.
 *
 * **Item 11 shipped a range and the range does not communicate.** On Haaland
 * 2022-23 it read "Averages over 23–35 appearances in 38 fixtures", which is
 * true and tells a reader nothing: it spans two groups of columns without
 * naming either, so "23" has no owner and the gap has no explanation. The
 * divergence has exactly one cause in exactly one season — the expected family
 * is not measured before GW16 in 2022-23 — so the groups are named instead:
 *
 *     Averages over 35 appearances in 38 fixtures.
 *     Expected stats over 23, not measured before GW16.
 *
 * The range survives as the fallback for a shape nothing in this database has
 * (three or more distinct denominators), where a two-line sentence has nothing
 * to say and an approximate one at least does not lie.
 */

/** How the main line's appearance count reads. */
export type Appearances =
  | { kind: 'exact'; value: number }
  | { kind: 'range'; min: number; max: number };

export interface DivergentGroup {
  /** What to call it: the group's own name, or its columns listed. */
  label: string;
  /** The denominator those columns rest on. */
  appearances: number;
  /**
   * The round the group starts being measured, or **null** where the unmeasured
   * rows are not a prefix and "before" would misdescribe them.
   */
  from: number | null;
}

export interface FootnoteModel {
  main: Appearances;
  /** The second line, or null when every rendered column agrees. */
  divergent: DivergentGroup | null;
}

/** One averaged column, as the footnote needs to see it. */
export interface FootnoteColumn {
  /** The header label, used when a divergent set has no shared group. */
  label: string;
  /**
   * The group this column belongs to, declared on the column itself.
   *
   * **Read off the column set rather than held as a list of names somewhere
   * else.** A separate list of "the expected columns" is a second description of
   * the same fact, free to fall out of step with the table it describes — which
   * is the objection this codebase applies to duplicated constants everywhere.
   * Inferring the group from the label instead (every expected column starts
   * with `x`) was the other option and is what data rule 10 forbids for
   * `position`: deriving meaning from a display string.
   */
  group?: string;
  /** The average's denominator over the rows shown. 0 means it rendered `—`. */
  denominator: number;
  /** Whether this column carries a value on a given row (rule 6). */
  measured: (gw: GameweekHistory) => boolean;
}

/**
 * Build the footnote.
 *
 * `shown` are the rows the table is displaying, which is what the appearance
 * counts describe. `seasonHistory` is **every** row of the player-season,
 * before filtering, and only the measurement threshold reads it.
 *
 * **That split is the whole reason `seasonHistory` is a parameter.** "Not
 * measured before GW16" is a claim about the season, and reading it off the
 * filtered rows makes it a claim about the filter — a venue filter on a season
 * whose round 16 was away would report the first measured *home* round instead,
 * and say it about the season. A contiguous GW range cannot reach that, because
 * a range showing both measured and unmeasured rows necessarily contains the
 * boundary round; the venue filter is not contiguous and does.
 */
export function buildFootnote(
  columns: readonly FootnoteColumn[],
  seasonHistory: readonly GameweekHistory[]
): FootnoteModel {
  // Only columns that render a number own a denominator. A wholly unmeasured
  // column shows the placeholder, and letting its 0 in would put a floor of zero
  // on every season that has one — which is all of them.
  const rendered = columns.filter((c) => c.denominator > 0);
  if (rendered.length === 0) return { main: { kind: 'exact', value: 0 }, divergent: null };

  const distinct = [...new Set(rendered.map((c) => c.denominator))].sort((a, b) => a - b);
  if (distinct.length === 1) {
    return { main: { kind: 'exact', value: distinct[0] }, divergent: null };
  }
  if (distinct.length > 2) {
    // Nothing in this database produces three, and a two-line sentence has no
    // honest form for it. The range is item 11's wording, kept as the fallback.
    return {
      main: { kind: 'range', min: distinct[0], max: distinct[distinct.length - 1] },
      divergent: null,
    };
  }

  // Two groups. The larger denominator is always the main one, and that is
  // structural rather than a tie-break: a denominator counts rows that were both
  // played and measured, so no column can exceed the fully measured count. The
  // divergent group is the one with a deficit, which is the only group the
  // second line's "not measured" wording describes.
  const [minority, majority] = distinct;
  const divergentColumns = rendered.filter((c) => c.denominator === minority);

  return {
    main: { kind: 'exact', value: majority },
    divergent: {
      label: groupLabel(divergentColumns, rendered),
      appearances: minority,
      from: measurementStart(divergentColumns, seasonHistory),
    },
  };
}

/**
 * Name the divergent set — its group, or failing that its columns.
 *
 * **The exactness check is what stops the name being a lie.** Naming the group
 * whenever the divergent columns merely belong to one would claim "Expected
 * stats" about a season that holed xG alone — which 2022-23 nearly is, since
 * round 29 holes `expected_goal_involvements` and nothing else. So the group is
 * named only when the divergent set is exactly the group's rendered members; a
 * strict subset gets its columns listed and reads "xGI over 22".
 */
function groupLabel(divergent: readonly FootnoteColumn[], rendered: readonly FootnoteColumn[]): string {
  const groups = new Set(divergent.map((c) => c.group));
  const only = [...groups][0];

  if (groups.size === 1 && only !== undefined) {
    const membersRendered = rendered.filter((c) => c.group === only);
    if (membersRendered.length === divergent.length) return only;
  }
  return divergent.map((c) => c.label).join(', ');
}

/**
 * The round the divergent columns start being measured, or null.
 *
 * **A row counts as measured when ANY of the group's columns carries a value,
 * not when all of them do**, and the distinction is load-bearing rather than
 * pedantic. The clause this feeds reads "not measured before GW16", which is a
 * claim about what happens *before* the boundary — that nothing in the group was
 * measured there. It is not a completeness claim about everything after it, and
 * writing it as `every` would quietly turn it into one.
 *
 * Haaland 2022-23 is the case that settles it, from the data rather than from
 * argument. The expected family is NULL on all four columns for rounds 1-15, and
 * `expected_goal_involvements` is *additionally* NULL at round 29 — item 7 holed
 * that one fixture on that one column, and he has a 0-minute row in it. Under
 * `every`, round 29 is an unmeasured row above the boundary, the prefix test
 * fails, and the clause is dropped from the one season it exists to describe.
 * Under `some` the sentence renders and is true: nothing was measured before
 * GW16, and the later hole is a separate fact the sentence never claimed on.
 *
 * Still null where the unmeasured rows are not a prefix at all — a column that
 * stops being measured at the end of a season, or a group holed as a block in
 * the middle. "Before" does not describe those, and printing a round number
 * would assert a boundary that is not where it says it is. The caller drops the
 * clause and keeps the rest of the sentence, which is still true.
 */
function measurementStart(
  divergent: readonly FootnoteColumn[],
  seasonHistory: readonly GameweekHistory[]
): number | null {
  const anyMeasured = (gw: GameweekHistory) => divergent.some((c) => c.measured(gw));

  const measured = seasonHistory.filter(anyMeasured).map((gw) => gw.round);
  const unmeasured = seasonHistory.filter((gw) => !anyMeasured(gw)).map((gw) => gw.round);
  if (measured.length === 0 || unmeasured.length === 0) return null;

  const from = Math.min(...measured);
  return unmeasured.every((round) => round < from) ? from : null;
}

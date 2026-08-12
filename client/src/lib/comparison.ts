/**
 * What the comparison page holds, and how two responses become one chart.
 *
 * **Not a component module.** It lives here rather than in `Comparison.tsx` so
 * that page stays all-components: React Fast Refresh only handles a module whose
 * exports are all components, and one non-component export turns every
 * subsequent edit to the file into a full page reload. Item 9's lesson,
 * `lib/playerColumns.ts`'s precedent.
 *
 * Nothing here scales a value or compares one to a threshold. Session 1 fetches
 * and merges; the geometry is session 2's.
 */

import type {
  AxisThreshold,
  AxisValues,
  ComparisonAxisKey,
  ComparisonData,
  ComparisonPosition,
} from '../types/fpl';

/** The four the chart draws, in the order the page tabs them. */
export const COMPARISON_POSITIONS: ComparisonPosition[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * The one place `element_type` and a comparison position are translated.
 *
 * `POSITION_MAP` in `types/fpl.ts` renders `GKP` for element type 1; the server's
 * position vocabulary says `GK`. Two spellings of one thing already exist, so
 * this maps to the element type rather than through the other string — going via
 * `POSITION_MAP` would need a `GKP`/`GK` special case at every call site.
 */
export const ELEMENT_TYPE_OF: Record<ComparisonPosition, number> = {
  GK: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

/** The position the page opens on. Defenders draw the full ten-axis set. */
export const DEFAULT_POSITION: ComparisonPosition = 'DEF';

/**
 * How many traces the chart will carry.
 *
 * Four rather than a round number: colour is what tells two traces apart, and a
 * clipped vertex is marked with a **shape** because colour is already spoken
 * for. Both budgets run out at about the same place, and a fifth trace would
 * cost legibility on the axis where it matters most — the one everybody is
 * pinned to the outer ring of.
 */
export const MAX_TRACES = 4;

/**
 * What the picker says when it stops offering players — **the reason, not the
 * rule.**
 *
 * Item 13's rule is that an unavailable thing is disabled with its reason on
 * screen, and "maximum 4 traces" restates the limit rather than giving one. What
 * a reader can act on is *why* four: colour is the only thing telling two traces
 * apart, so a fifth is unreadable precisely where it matters, on the axis
 * everybody is clipped to.
 *
 * It lives beside the constant so the sentence and the number move together, and
 * interpolates rather than spelling the number out for the same reason.
 */
export const TRACE_LIMIT_REASON =
  `${MAX_TRACES} traces is as many as colour can tell apart — remove one to add another`;

/**
 * A trace is a **(player, season) pair, never a player.**
 *
 * The page's reason to exist is asking whether 2016-17's best is 2025-26's best,
 * which is a question about two seasons; a chart keyed on player alone can only
 * ever draw the season the shell happens to be on. So the season is half the
 * identity from the start, and a trace added on one season stays pinned to it
 * when the selector moves — that is what makes two seasons reachable on one
 * chart today, with the shell's selector as the only season control there is.
 *
 * `web_name` rides along so a chip can name itself before its values land, and
 * so a trace whose season errored can still say who it was for.
 */
export interface Trace {
  code: number;
  season: string;
  web_name: string;
}

/** Identity, in one place, so the key and the dedupe cannot disagree. */
export const traceKey = (t: Pick<Trace, 'code' | 'season'>): string => `${t.season}:${t.code}`;

export const hasTrace = (traces: Trace[], t: Pick<Trace, 'code' | 'season'>): boolean =>
  traces.some((x) => traceKey(x) === traceKey(t));

/** One season's request: in flight, answered, or refused. */
export type SeasonResult =
  | { state: 'loading' }
  | { state: 'ok'; data: ComparisonData }
  | { state: 'error'; message: string };

/** A trace with its values resolved, or the reason it has none. */
export interface ResolvedTrace {
  trace: Trace;
  /** Null while the season is in flight, or once it has failed. */
  values: AxisValues | null;
  /** Present only when there is nothing to draw, and worded for the chip. */
  problem: string | null;
}

export interface ComparisonView {
  /**
   * The spokes to draw, in the frozen canonical order, **each carrying its own
   * scale**.
   *
   * The order is the threshold list's, which is the canonical one; the filter is
   * the intersection over every season on screen. An axis one season measures
   * and another does not cannot be drawn as a spoke — one trace would reach it
   * and the other would have a hole there, which is the thing the absent-not-null
   * rule exists to prevent, one layer up. With every trace on the selected
   * season, which is the ordinary case, the intersection is that season's own
   * axis list and this changes nothing.
   */
  axes: AxisThreshold[];
  /**
   * Player-seasons past the minutes gate in the **selected** season. Always
   * present, including at 0, so the page can word the absence of a band rather
   * than inferring it.
   */
  cohortSize: number;
  /**
   * The band to draw, already accounting for both reasons it may not exist — so
   * a consumer draws it when it is here and does not when it is not, with no
   * second decision to make.
   *
   * It is the **selected season's** cohort median, never a pooled one and never
   * another season's. A band describes the population on screen; the ceilings
   * are pooled and stable across seasons because a scale has to be. They are
   * different objects, which is what the DEF structural break at 2025-26
   * established.
   */
  band: AxisValues | null;
  /**
   * Why `band` is null **despite the server having sent one**. Null when the
   * band is drawn, and null when the server itself withheld it — that case is
   * read off `cohortSize`, which says how few players there were.
   *
   * One value today. **Traces spanning more than one season have no single
   * band**: each season has its own cohort median, and drawing one of them
   * under two seasons' traces would describe one population and be read as
   * describing both. Two medians is not an average of two medians, and the
   * selected season's is not a neutral choice between them — it is the one that
   * happens to be in the selector. Hiding it is the only honest answer, and it
   * is a reachable state rather than a hypothetical: the shell's selector is the
   * only season control, so a second season is two clicks away.
   */
  bandWithheld: 'spans-seasons' | null;
  traces: ResolvedTrace[];
}

/**
 * Fold the thresholds, the traces and one response per season into the one shape
 * the chart draws from.
 *
 * Returns null until the **selected** season has answered: it owns the band and
 * the canonical axis list, so there is nothing to draw without it. A trace season
 * still in flight is not a reason to render nothing — its chip says so.
 */
export function mergeComparison(
  thresholds: AxisThreshold[],
  selectedSeason: string,
  traces: Trace[],
  results: Map<string, SeasonResult>
): ComparisonView | null {
  const selected = results.get(selectedSeason);
  if (selected === undefined || selected.state !== 'ok') return null;

  // Every season with an answer that something on screen depends on: the
  // selected one for the band, and each trace's own for its values.
  const drawn = new Set([selectedSeason]);
  for (const t of traces) if (results.get(t.season)?.state === 'ok') drawn.add(t.season);

  const answered: ComparisonAxisKey[][] = [];
  for (const season of drawn) {
    const r = results.get(season);
    if (r?.state === 'ok') answered.push(r.data.axes);
  }

  const axes = thresholds.filter((t) => answered.every((list) => list.includes(t.axis)));

  const resolved: ResolvedTrace[] = traces.map((trace) => {
    const result = results.get(trace.season);
    if (result === undefined || result.state === 'loading') {
      return { trace, values: null, problem: null };
    }
    if (result.state === 'error') {
      return { trace, values: null, problem: result.message };
    }
    const row = result.data.players.find((p) => p.id === trace.code);
    if (row === undefined) {
      // Unreachable through the page's own picker, which only offers players the
      // season has. It is not unreachable in general — a trace outlives the
      // season it was added on — so it says what happened rather than vanishing.
      return { trace, values: null, problem: `Not in ${trace.season}.` };
    }
    return { trace, values: row.values, problem: null };
  });

  // The seasons the traces actually sit on — not the seasons in play, which
  // always include the selected one whether anything is drawn from it or not.
  // Zero traces is not "spanning", and neither is four traces on one season.
  const traceSeasons = new Set(traces.map((t) => t.season));
  const bandWithheld = traceSeasons.size > 1 ? ('spans-seasons' as const) : null;

  return {
    axes,
    cohortSize: selected.data.cohort.size,
    band: bandWithheld === null ? selected.data.cohort.band : null,
    bandWithheld,
    traces: resolved,
  };
}

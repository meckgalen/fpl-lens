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
import { columnByKey } from './playerColumns';

/** The four the chart draws, in the order the page tabs them. */
export const COMPARISON_POSITIONS: ComparisonPosition[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * Every axis key, as a runtime list — which `ComparisonAxisKey` alone cannot be,
 * being a type.
 *
 * It exists so `axisDefinition` below can be *proved* total over the union
 * rather than assumed to be, and it is guarded in **both directions** because
 * the two clauses catch opposite mistakes:
 *
 *   - `satisfies` rejects a typo'd or invented key **in this array**.
 *   - `_exhaustive` rejects a union member **missing from it**: a non-empty
 *     `Exclude` makes the annotation `never`, and `true` is not assignable to
 *     `never`.
 *
 * **An unused `type _Exhaustive = … extends never ? true : never` would be
 * inert** — a type alias evaluating to `never` compiles perfectly happily, so
 * the guard has to be something that fails to *construct*. Both clauses were
 * mutation-checked when written; a guard that cannot fail is worse than none,
 * because it advertises a protection nobody re-checks.
 */
export const COMPARISON_AXES = [
  'pts',
  'clean_sheets',
  'goals',
  'minutes',
  'ppm',
  'defcon_hits_per_start',
  'assists',
  'pts_per_now',
  'expected_goal_involvements',
  'bonus',
  'saves',
] as const satisfies readonly ComparisonAxisKey[];

const _exhaustive: Exclude<ComparisonAxisKey, (typeof COMPARISON_AXES)[number]> extends never
  ? true
  : never = true;
void _exhaustive;

/**
 * The definition of an axis, for hover — and **deliberately with no fallback**.
 *
 * The Players list renders `col.description ?? col.title`, which is right there:
 * a header sits in a table that already names the season and the player, so the
 * short name is a reasonable degraded state.
 *
 * Here it would not be. A radar spoke captioned `DCH/St` has nothing beside it,
 * and a tooltip reading "Defensive contribution hits per start" over a caption
 * reading `DCH/St` **looks like a working tooltip while explaining nothing** —
 * a silent no-op, which is the exact failure item 18 set out to fix. So a
 * missing description yields `null` and no tooltip at all, and
 * `comparison.axes.test.ts` proves the null branch is unreachable for the
 * eleven. Do not "fix" this into symmetry with the Players list.
 */
export function axisDefinition(axis: ComparisonAxisKey): string | null {
  return columnByKey(axis)?.description ?? null;
}

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
 * One colour per trace slot, and **the reason `MAX_TRACES` is four is that this
 * list is** — so the two live together and cannot come apart.
 *
 * **Fixed HSL rather than theme tokens.** These carry data identity: the colour
 * on a chip is the promise that the outline of that colour is that player. A
 * token would resolve differently in the two themes, and a legend whose meaning
 * changes with the theme is not a legend. They are mid-lightness so they hold
 * against both the cream background and the near-black one, and they are spread
 * around the wheel rather than picked for prettiness — indigo, amber, teal,
 * magenta — because the whole point is telling four outlines apart where they
 * overlap.
 *
 * The trace's colour is its **position in the list**, not a hash of the player:
 * removing a trace recolours the ones after it, which is the cost of never
 * drawing two traces in colours a hash happened to put next to each other.
 */
export const TRACE_COLORS = [
  'hsl(228 62% 52%)',
  'hsl(28 82% 46%)',
  'hsl(172 62% 34%)',
  'hsl(322 58% 50%)',
];

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
   * The spokes this position has that are **not** drawn, in the same order.
   *
   * On the chart they are simply gone, which is right — a spoke nobody can
   * answer is worse than no spoke. But gone silently is item 13's rule
   * unapplied: an unavailable thing is withheld **with its reason on screen**,
   * and a reader comparing 2016-17 against 2025-26 on eight axes has no way to
   * know two were removed to make that possible. The page names them from
   * `resolveColumn`, which is the picker's own reason function — every axis key
   * is a `PLAYER_COLUMNS` key, so there is no second rule to write.
   */
  absent: AxisThreshold[];
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
   * Two wordings, **one condition**: the band draws only when every trace sits
   * on the selected season. What that rules out is a band describing a
   * population nobody on screen belongs to.
   *
   *   - `spans-seasons` — traces on two or more seasons. Each has its own
   *     cohort median, and the selected season's is not a neutral choice
   *     between them; it is the one that happens to be in the selector.
   *   - `other-season` — every trace on one season, and it is not the selected
   *     one. Not ambiguous like the case above, and worse in a quieter way: a
   *     single median is drawn, from a season with nothing on the chart, under
   *     traces from a season with no median drawn.
   *
   * **The band never follows the traces**, which would fix both by moving the
   * baseline. A baseline that moves when a trace is added is a worse defect
   * than an absent one: the reader would have compared two charts drawn against
   * different populations without either saying so. So the band stays the
   * selected season's cohort or it stays away, and the season control is the
   * selector — which is what asks for it back.
   *
   * Reachable rather than hypothetical, both of them: the shell's selector is
   * the only season control, so a second season is two clicks away.
   */
  bandWithheld: BandWithheld | null;
  traces: ResolvedTrace[];
}

/** Which absence it is, carrying what the sentence has to name. */
export type BandWithheld =
  | { reason: 'spans-seasons'; seasons: number }
  | { reason: 'other-season'; season: string };

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

  const drawable = (t: AxisThreshold) => answered.every((list) => list.includes(t.axis));
  const axes = thresholds.filter(drawable);
  const absent = thresholds.filter((t) => !drawable(t));

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

  // **One condition**: every trace on the selected season, or no band. Zero
  // traces satisfies it vacuously, which is right — the band alone is the page's
  // opening state and describes exactly the season in the selector.
  //
  // Written over the traces rather than over the seasons in play, which always
  // include the selected one whether anything is drawn from it or not and so
  // could never distinguish the two cases below.
  const traceSeasons = new Set(traces.map((t) => t.season));
  const bandWithheld: BandWithheld | null = traces.every((t) => t.season === selectedSeason)
    ? null
    : traceSeasons.size > 1
      ? { reason: 'spans-seasons', seasons: traceSeasons.size }
      : { reason: 'other-season', season: [...traceSeasons][0] };

  return {
    axes,
    absent,
    cohortSize: selected.data.cohort.size,
    band: bandWithheld === null ? selected.data.cohort.band : null,
    bandWithheld,
    traces: resolved,
  };
}

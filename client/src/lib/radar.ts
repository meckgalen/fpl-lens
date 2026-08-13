/**
 * The radar's geometry: where a spoke points, and where a value sits on it.
 *
 * **Separate from the component on purpose, and not only for Fast Refresh.**
 * Every rule worth pinning here is arithmetic — a spoke angle, a non-zero
 * floor, the boundary between clipped and at-the-ceiling — and a rule pinned
 * through rendered SVG is pinned through two layers, one of which (jsdom) does
 * no layout at all. Item 3's lesson pointed the other way, that a class-level
 * assertion cannot see a layout; the same fact says an arithmetic assertion
 * should not be routed through one.
 *
 * Nothing here knows about colour, markers or the DOM. Coordinates are relative
 * to the centre, which the component translates once.
 */

import type { AxisThreshold, AxisValues, ComparisonAxisKey } from '../types/fpl';

/**
 * Ten rings, per the settled design — one per tenth of every axis's range.
 *
 * The rings are the only thing on the chart that says the scale is fixed rather
 * than fitted to whoever is drawn, so the count is a constant rather than
 * something derived from the axis count.
 */
export const RINGS = 10;

export interface Point {
  x: number;
  y: number;
}

/**
 * Spoke `index` of `count`, in radians, from twelve o'clock and clockwise.
 *
 * **Evenly spaced over however many axes there are**, which is what makes a
 * dropped axis a re-spacing rather than a hole: eight spokes are 45° apart and
 * ten are 36°, and neither leaves a gap where the missing one was. The order is
 * the caller's — the canonical threshold order — and is never sorted here.
 */
export function spokeAngle(index: number, count: number): number {
  return -Math.PI / 2 + (2 * Math.PI * index) / count;
}

/** SVG coordinates, so `-π/2` is up: y grows downward. */
export function pointAt(angle: number, radius: number): Point {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Where a value ended up, which is not always where it asked to be.
 *
 *   - `scaled`   — on the axis, between floor and ceiling inclusive.
 *   - `clipped`  — **above** the ceiling, drawn on the outer ring and marked.
 *   - `floored`  — below the floor, drawn at the centre.
 */
export type Placement = 'scaled' | 'clipped' | 'floored';

/**
 * A raw value against its own axis's floor and ceiling.
 *
 * **The floor is not always zero and the scale is not a ratio.** `minutes`
 * floors at the 1,200-minute cohort gate and `ppm` at the cohort's p01, so a
 * defender on exactly 1,200 minutes sits at the **centre** — `v / ceiling` would
 * put him at 35% of the radius and read as a third of a season more than he
 * played. Six of the eleven axes do floor at zero, where the two agree, which is
 * exactly what makes the mistake survivable enough to ship.
 *
 * **At the ceiling exactly is `scaled`, not `clipped`.** A clip mark says the
 * true number is off the chart; on a value equal to the ceiling it is not, and
 * the ceilings are round numbers precisely often enough for this to be hit —
 * `minutes` ceilings at 3,420, which is the maximum the competition can produce.
 */
export function scaleValue(
  value: number,
  floor: number,
  ceiling: number
): { fraction: number; placement: Placement } {
  // A degenerate scale is a wrong threshold rather than a case with a rendering.
  // Drawn at the centre so it is visibly wrong instead of dividing by zero.
  if (!(ceiling > floor)) return { fraction: 0, placement: 'floored' };

  const raw = (value - floor) / (ceiling - floor);
  if (raw > 1) return { fraction: 1, placement: 'clipped' };
  if (raw < 0) return { fraction: 0, placement: 'floored' };
  return { fraction: raw, placement: 'scaled' };
}

export interface Vertex {
  axis: ComparisonAxisKey;
  /** Position in the drawn axis list, which is what fixes the angle. */
  index: number;
  angle: number;
  /** 0 at the centre, 1 on the outer ring. */
  fraction: number;
  placement: Placement;
  /** The **raw** value, so a clipped vertex can still say what it really was. */
  value: number;
  point: Point;
}

/**
 * One vertex per drawn axis, or **null where there is no value**.
 *
 * Null is rule 6's "not measured" and has no position on the scale. It is not
 * zero and must never be drawn as one: a vertex at the centre is what a real
 * zero looks like, and the two are the pair that rule exists to keep apart. The
 * null travels out of here as a null and the renderer breaks the outline over
 * it — see `segments`.
 *
 * A **missing key** and an explicit `null` are the same answer. The server sends
 * neither for an axis the season cannot measure — that axis is absent from the
 * list entirely — so anything missing here is a per-player gap rather than a
 * per-season one.
 */
export function vertices(
  axes: AxisThreshold[],
  values: AxisValues | null,
  radius: number
): (Vertex | null)[] {
  return axes.map((axis, index) => {
    const value = values?.[axis.axis];
    if (value === null || value === undefined) return null;

    const angle = spokeAngle(index, axes.length);
    const { fraction, placement } = scaleValue(value, axis.floor, axis.ceiling);
    return {
      axis: axis.axis,
      index,
      angle,
      fraction,
      placement,
      value,
      point: pointAt(angle, fraction * radius),
    };
  });
}

/**
 * The outline, broken wherever a value is missing.
 *
 * A complete trace is one run of every vertex, which the caller closes. An
 * incomplete one is the maximal runs **between** the gaps, drawn open: the
 * segments either side of a missing axis are simply not there.
 *
 * **The alternative — joining the two neighbours across the gap — was rejected,
 * and it is the one an implementation falls into by filtering the nulls out.**
 * That chord crosses the missing spoke at roughly the average of its
 * neighbours, so "nobody measured this" renders as "about typical here": a
 * plausible number invented by the drawing, which is the failure this project
 * refuses everywhere else. A hole in the outline is the shape of a `—`.
 *
 * The runs are found from the first gap onward so the cycle is not split at
 * index 0: a trace missing only its last axis is one run of n-1, not two.
 */
export function segments(vs: (Vertex | null)[]): { runs: Vertex[][]; closed: boolean } {
  const n = vs.length;
  const firstGap = vs.findIndex((v) => v === null);
  if (n === 0) return { runs: [], closed: false };
  if (firstGap === -1) return { runs: [vs as Vertex[]], closed: true };

  const runs: Vertex[][] = [];
  let current: Vertex[] = [];
  for (let step = 1; step <= n; step++) {
    const v = vs[(firstGap + step) % n];
    if (v === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(v);
    }
  }
  if (current.length > 0) runs.push(current);
  return { runs, closed: false };
}

/** `"x,y x,y"`, for a `points` attribute. */
export function pointsAttr(points: Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/** Two decimals is a tenth of a pixel at this size, and keeps the DOM readable. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The clip marker: a triangle pointing **outward**, centred on the spoke.
 *
 * **A shape rather than a colour**, because colour is already carrying which
 * trace is which — that is the argument behind the four-trace cap, and spending
 * it twice would leave neither job done.
 *
 * `slot` of `of` fans several markers tangentially along the outer ring. Two
 * traces clipping the same axis are clamped to the same point, so their
 * *vertices* coincide correctly and their *markers* would too — one triangle
 * where there are two, with nothing on screen saying so. The fan is at a single
 * radius on purpose: same distance out means same clamped position, so it
 * separates the markers without implying an order between them.
 */
export function clipMarker(angle: number, radius: number, slot: number, of: number): Point[] {
  return triangle(angle + (slot - (of - 1) / 2) * FAN, radius + 3, radius + 11);
}

/**
 * The floor marker: a triangle pointing **inward**, just outside the first ring.
 *
 * The mirror of `clipMarker`, and the direction is what distinguishes them at a
 * glance — one says "the true value is past the outer ring", the other "past the
 * centre". The centre used to mean *at the floor* and *below the floor*
 * identically, which is rule 6's failure one end down: a squad player on 400
 * minutes and a cohort member on exactly 1,200 rendered at the same point, and
 * nothing said which. Not an edge case — the 1,200-minute gate scopes the
 * cohort, not who the picker offers, so anyone outside it is below the Min floor
 * and PPM's p01 floor does the same.
 *
 * **One marker per axis, in a neutral colour, not one per trace**, which is the
 * one place this does not mirror the clip marker. Floored vertices all coincide
 * *at the centre*, so there is no room to fan them apart and no radius at which
 * a fan would stay inside the axis's own sector; a per-trace colour there would
 * promise a distinction the geometry cannot keep. The marker says "vertices here
 * are clamped" and the colour-coded labels beside the caption say which traces
 * and what their true numbers were — the same division of labour the clip case
 * falls back on when two traces clip together.
 */
export function floorMarker(angle: number): Point[] {
  return triangle(angle, FLOOR_MARKER_R + 8, FLOOR_MARKER_R);
}

/** Just outside the innermost ring, so the marker never sits on the centre dot. */
export const FLOOR_MARKER_R = 20;

/** `base` is the flat edge's radius, `tip` the point's — either may be nearer. */
function triangle(angle: number, base: number, tip: number): Point[] {
  const t = pointAt(angle, tip);
  const b = pointAt(angle, base);
  const across = { x: -Math.sin(angle) * 4.5, y: Math.cos(angle) * 4.5 };
  return [t, { x: b.x + across.x, y: b.y + across.y }, { x: b.x - across.x, y: b.y - across.y }];
}

/** ~4.3°, which is about a marker's width apart at the radius the chart draws. */
const FAN = 0.075;

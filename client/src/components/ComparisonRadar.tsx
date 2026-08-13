import type { AxisThreshold } from '../types/fpl';
import { fmtNum } from '../types/fpl';
import { TRACE_COLORS, type ComparisonView } from '../lib/comparison';
import {
  RINGS,
  clipMarker,
  pointAt,
  pointsAttr,
  segments,
  spokeAngle,
  vertices,
  type Vertex,
} from '../lib/radar';

/**
 * The radar itself.
 *
 * Everything it draws comes off `ComparisonView`, which has already decided the
 * axis list, whether there is a band, and what each trace's values are. Nothing
 * here fetches, and nothing here re-derives a rule — in particular the band's
 * absence arrives decided, so this component draws a band when it is handed one
 * and never asks why.
 *
 * The scales it applies are the frozen ones, per axis, and they are applied here
 * and nowhere else. Values cross the wire raw for that reason.
 *
 * **The `radar-*` class names are structural hooks and carry no styling.** An
 * SVG shape has no role and no text, so a test cannot name one the way it names
 * a button; the alternative was matching on the `fill` attribute, which would
 * couple every structural assertion to a colour and break the suite the first
 * time one was adjusted. These name **what a shape is** — this is not item 3's
 * class-level assertion, which claimed something about *appearance* that jsdom
 * cannot see.
 */

/** The outer ring, in user units. The viewBox scales it to whatever fits. */
const R = 150;
const CX = 290;
const CY = 235;

/** Where a caption sits: far enough out to clear a clip marker at `R + 11`. */
const LABEL_R = R + 26;

export function ComparisonRadar({ view }: { view: ComparisonView }) {
  const { axes } = view;

  if (axes.length === 0) {
    // Reachable: two seasons whose measured columns do not overlap would
    // intersect to nothing. It says so rather than drawing an empty disc.
    return (
      <p className="text-sm text-muted-foreground">
        No axis is measured in every season on the chart.
      </p>
    );
  }

  const drawn = view.traces
    .map((resolved, slot) => ({
      resolved,
      color: TRACE_COLORS[slot % TRACE_COLORS.length],
      vs: vertices(axes, resolved.values, R),
    }))
    .filter((t) => t.resolved.values !== null);

  const bandVs = view.band === null ? null : vertices(axes, view.band, R);
  // A band with a gap is not drawn at all rather than drawn across the gap: it
  // is one polygon and a broken fill is not a shape. Unreachable today — the
  // band comes from the selected season, which by construction measures every
  // axis in the intersection — so this is a guard rather than a case.
  const band = bandVs !== null && bandVs.every((v) => v !== null) ? (bandVs as Vertex[]) : null;

  /**
   * Which traces clipped which axis, so several on one spoke can be fanned
   * apart. Two traces above the ceiling land on the same point by definition —
   * that is what clamping means — so without this the second marker is drawn
   * exactly under the first and only one of them exists on screen.
   */
  const clipsByAxis = new Map<number, { color: string; name: string; value: number }[]>();
  for (const t of drawn) {
    for (const v of t.vs) {
      if (v === null || v.placement !== 'clipped') continue;
      const list = clipsByAxis.get(v.index) ?? [];
      list.push({ color: t.color, name: t.resolved.trace.web_name, value: v.value });
      clipsByAxis.set(v.index, list);
    }
  }

  return (
    <svg
      viewBox="0 0 580 500"
      className="w-full h-auto max-w-[580px] mx-auto block"
      // The captions are real text in the DOM, so no `role="img"` — that would
      // hide them from assistive technology to replace them with one sentence.
      aria-label={`${axes.length} axes, ${drawn.length} of ${view.traces.length} players drawn`}
    >
      <g transform={`translate(${CX} ${CY})`}>
        {/* The rings. Ten of them, and they are the only thing on the chart
            saying the scale is fixed rather than fitted to whoever is drawn. */}
        {Array.from({ length: RINGS }, (_, i) => (
          <circle
            key={i}
            className="radar-ring"
            r={(R * (i + 1)) / RINGS}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={i === RINGS - 1 ? 1.4 : 0.7}
          />
        ))}

        {axes.map((axis, i) => {
          const end = pointAt(spokeAngle(i, axes.length), R);
          return (
            <line
              key={axis.axis}
              className="radar-spoke"
              x1={0}
              y1={0}
              x2={end.x}
              y2={end.y}
              stroke="hsl(var(--border))"
              strokeWidth={0.7}
            />
          );
        })}

        {/* The band, first and so underneath: a filled shape rather than a
            third outline, which is what lets it stay on permanently without
            competing with the traces for the same visual channel. */}
        {band !== null && (
          <polygon
            className="radar-band"
            points={pointsAttr(band.map((v) => v.point))}
            fill="hsl(var(--muted-foreground) / 0.16)"
            stroke="none"
          />
        )}

        {drawn.map(({ resolved, color, vs }) => (
          <Trace key={`${resolved.trace.season}:${resolved.trace.code}`} vs={vs} color={color} />
        ))}

        {/* The clip markers last, so a marker is never drawn under an outline. */}
        {[...clipsByAxis].map(([index, clips]) =>
          clips.map((clip, slot) => (
            <polygon
              key={`${index}:${slot}`}
              className="radar-clip"
              points={pointsAttr(clipMarker(spokeAngle(index, axes.length), R, slot, clips.length))}
              fill={clip.color}
            >
              <title>
                {clip.name}: {axes[index].label} {fmt(clip.value)}, above the{' '}
                {axes[index].ceiling} ceiling
              </title>
            </polygon>
          ))
        )}

        {axes.map((axis, i) => (
          <AxisLabel
            key={axis.axis}
            axis={axis}
            angle={spokeAngle(i, axes.length)}
            clips={clipsByAxis.get(i) ?? []}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * One trace: an outline, its vertices, and **a hole wherever a value is
 * missing**.
 *
 * No fill. Four filled polygons over each other is mud, and the band is the one
 * filled shape on the chart precisely so it can be read as the background it is.
 *
 * A complete trace closes; an incomplete one is drawn as open runs, so the
 * missing axis is a visible break rather than a segment across it. Rule 6 in
 * geometry: a null has no position, and a line drawn over it would give it one.
 */
function Trace({ vs, color }: { vs: (Vertex | null)[]; color: string }) {
  const { runs, closed } = segments(vs);

  return (
    <g>
      {runs.map((run, i) =>
        closed ? (
          <polygon
            key={i}
            className="radar-trace"
            points={pointsAttr(run.map((v) => v.point))}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : (
          run.length > 1 && (
            <polyline
              key={i}
              className="radar-trace"
              points={pointsAttr(run.map((v) => v.point))}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )
        )
      )}
      {vs.map(
        (v) =>
          v !== null && (
            // No dot on a missing axis, and none at the centre for one either:
            // a dot at the centre is what a measured zero looks like.
            <circle
              key={v.axis}
              className="radar-vertex"
              cx={v.point.x}
              cy={v.point.y}
              r={2.8}
              fill={color}
            />
          )
      )}
    </g>
  );
}

/**
 * An axis caption, plus **the true number for anything clipped on it**.
 *
 * The clipped values are the case this component exists to get right. Two traces
 * above the same ceiling are drawn at the same point — correctly, both being off
 * the scale — so once the geometry has said "both are past here", the label is
 * the only thing left that can say how far. Each line carries its trace's colour
 * and the triangle its marker is drawn as, so the fan of markers on the ring and
 * the list of numbers beside it can be read against each other.
 */
function AxisLabel({
  axis,
  angle,
  clips,
}: {
  axis: AxisThreshold;
  angle: number;
  clips: { color: string; name: string; value: number }[];
}) {
  const at = pointAt(angle, LABEL_R);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const anchor = Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end';
  // A caption below the chart hangs from its point; one above sits on it.
  const baseline = Math.abs(sin) < 0.3 ? 'middle' : sin > 0 ? 'hanging' : 'auto';

  return (
    <g>
      <text
        x={at.x}
        y={at.y}
        textAnchor={anchor}
        dominantBaseline={baseline}
        className="fill-muted-foreground text-[11px] font-medium"
      >
        {axis.label}
      </text>
      {clips.map((clip, i) => (
        <text
          key={i}
          x={at.x}
          y={at.y + (sin > 0.3 ? 13 : 12) * (i + 1) + (sin < -0.3 ? 2 : 0)}
          textAnchor={anchor}
          dominantBaseline={baseline}
          className="text-[10px] tabular-nums"
          fill={clip.color}
        >
          ▲ {fmt(clip.value)}
        </text>
      ))}
    </g>
  );
}

/** Counts render whole; quotients render to two places. */
const fmt = (v: number): string => fmtNum(v, Number.isInteger(v) ? 0 : 2);

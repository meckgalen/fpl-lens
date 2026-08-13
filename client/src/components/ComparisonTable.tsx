import { NO_VALUE, fmtNum } from '../types/fpl';
import { TRACE_COLORS, traceKey, type ComparisonView } from '../lib/comparison';

/**
 * The numbers behind the chart: one row per axis, one column per trace, plus
 * the band.
 *
 * **It is the legend as much as the read-out**, and that is why it came back
 * rather than a hover. At four traces the radar is at its legibility limit and
 * the only thing tying an outline's colour to a player is the chip row above it;
 * a column headed by the player's name in his own trace colour answers both
 * questions in one place. A hover answers neither on touch, needs a 2.8px dot
 * hit, and shows one number at a time — which cannot answer "18 against 6",
 * the question the page exists for.
 *
 * **The band column carries as much as the player columns.** A filled grey shape
 * can only be compared to by eye; the median it stands for is a number, and this
 * is where it is one.
 *
 * The clamp markers on the chart stay alongside this rather than being replaced
 * by it. They say the one thing a table cannot: that a vertex's position is a
 * lie, and in which direction.
 */
export function ComparisonTable({ view }: { view: ComparisonView }) {
  if (view.axes.length === 0) return null;

  return (
    <div className="overflow-x-auto w-full">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="text-muted-foreground text-left border-b border-border">
            <th className="font-normal py-1.5 pr-4">Axis</th>
            <th className="font-normal py-1.5 pr-4 text-right whitespace-nowrap">Band</th>
            {view.traces.map((r, slot) => (
              <th
                key={traceKey(r.trace)}
                className="font-medium py-1.5 pr-4 text-right whitespace-nowrap"
                // The legend. Same list, same index as the outline's colour, so
                // the promise the chip makes is kept by the same expression.
                style={{ color: TRACE_COLORS[slot % TRACE_COLORS.length] }}
              >
                {r.trace.web_name}{' '}
                <span className="font-normal opacity-70">{r.trace.season}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.axes.map((axis) => (
            <tr key={axis.axis} className="border-t border-border/60">
              <td className="py-1 pr-4 text-foreground whitespace-nowrap">{axis.label}</td>
              <td className="py-1 pr-4 text-right text-muted-foreground">
                {cell(view.band?.[axis.axis] ?? null)}
              </td>
              {view.traces.map((r) => (
                <td key={traceKey(r.trace)} className="py-1 pr-4 text-right text-foreground">
                  {/* Rule 6: a null renders as the no-value marker, never as 0.
                      The chart says the same thing by breaking the outline. */}
                  {r.values === null ? NO_VALUE : cell(r.values[axis.axis] ?? null)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-border text-muted-foreground align-top">
            <td className="py-1 pr-4">Scale</td>
            <td className="py-1 pr-4" colSpan={1 + view.traces.length}>
              {/* The floors and ceilings the spokes are drawn against, so a
                  number in this table can be placed on the chart without
                  opening the thresholds route. */}
              <span className="text-[11px]">
                {view.axes.map((a) => `${a.label} ${a.floor}–${a.ceiling}`).join(' · ')}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Counts render whole and quotients to two places, matching the chart's clamp
 * labels — nine of the eleven axes are integer counts, and `209.00` clean sheets
 * is noise where `209` is a number.
 */
const cell = (v: number | null): string =>
  v === null ? NO_VALUE : fmtNum(v, Number.isInteger(v) ? 0 : 2);

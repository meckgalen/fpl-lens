/**
 * What the radar actually draws, given a `ComparisonView`.
 *
 * The arithmetic is pinned in `lib/radar.test.ts`, against the wrong
 * implementations it would otherwise agree with. What is left for this file is
 * the part that only exists once the shapes are in a document: how many of each
 * there are, which shape a clipped vertex gets, whether an outline closes, and
 * whether the band is underneath.
 *
 * No API mock and no provider: the component takes one prop and fetches
 * nothing, which is the whole reason the merge happens on the page instead.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComparisonRadar } from './ComparisonRadar';
import { aThreshold } from '../test/factories';
import type { AxisThreshold, AxisValues, ComparisonAxisKey } from '../types/fpl';
import type { ComparisonView, ResolvedTrace } from '../lib/comparison';

const KEYS: ComparisonAxisKey[] = [
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
];

/** Real DEF bounds for the two that matter; 0–200 elsewhere so a value reads. */
const BOUNDS: Partial<Record<ComparisonAxisKey, [number, number]>> = {
  minutes: [1200, 3420],
  pts_per_now: [0, 40],
};

const axes = (n: number): AxisThreshold[] =>
  KEYS.slice(0, n).map((axis) => {
    const [floor, ceiling] = BOUNDS[axis] ?? [0, 200];
    return aThreshold({ axis, label: axis, floor, ceiling });
  });

const trace = (name: string, values: AxisValues | null): ResolvedTrace => ({
  trace: { code: name.length, season: '2025-26', web_name: name },
  values,
  problem: null,
});

const view = (overrides: Partial<ComparisonView> = {}): ComparisonView => ({
  axes: axes(10),
  cohortSize: 109,
  band: null,
  bandWithheld: null,
  traces: [],
  ...overrides,
});

const values = (n: number, at: (i: number) => number | null): AxisValues =>
  Object.fromEntries(KEYS.slice(0, n).map((k, i) => [k, at(i)]));

const all = (container: HTMLElement, sel: string) => [...container.querySelectorAll(sel)];

describe('the frame', () => {
  it('draws ten rings whatever the axis count', () => {
    // The rings are the fixed scale made visible, so their number is a property
    // of the scale rather than of whoever happens to be drawn.
    for (const n of [7, 10]) {
      const { container, unmount } = render(<ComparisonRadar view={view({ axes: axes(n) })} />);
      expect(all(container, '.radar-ring')).toHaveLength(10);
      unmount();
    }
  });

  it('re-spaces the spokes when an axis is dropped', () => {
    const ten = render(<ComparisonRadar view={view()} />);
    const tenSpokes = all(ten.container, '.radar-spoke').map((l) => l.getAttribute('x2'));
    ten.unmount();

    const seven = render(<ComparisonRadar view={view({ axes: axes(7) })} />);
    const sevenSpokes = all(seven.container, '.radar-spoke').map((l) => l.getAttribute('x2'));

    expect(tenSpokes).toHaveLength(10);
    expect(sevenSpokes).toHaveLength(7);
    // Not the first seven of the ten. A dropped axis re-spaces the whole wheel
    // rather than leaving the others where they were with a gap between them.
    expect(sevenSpokes[1]).not.toBe(tenSpokes[1]);
  });

  it('captions each spoke from the threshold’s own label', () => {
    render(<ComparisonRadar view={view({ axes: axes(3) })} />);
    // The label travels on the threshold precisely so there is no second table
    // here that could disagree with the picker's.
    expect(screen.getByText('pts')).toBeInTheDocument();
    expect(screen.getByText('goals')).toBeInTheDocument();
  });

  it('says so rather than drawing an empty disc with no axes', () => {
    render(<ComparisonRadar view={view({ axes: [] })} />);
    expect(screen.getByText(/No axis is measured in every season/)).toBeInTheDocument();
  });
});

describe('the band', () => {
  it('is one filled shape, drawn before the traces so it sits underneath', () => {
    const { container } = render(
      <ComparisonRadar
        view={view({
          band: values(10, () => 40),
          traces: [trace('Gabriel', values(10, () => 60))],
        })}
      />
    );

    const shapes = all(container, '.radar-band, .radar-trace');
    expect(shapes).toHaveLength(2);
    // SVG paints in document order, so "under the traces" is "first". A band
    // that competed with the outlines could not stay on permanently.
    expect(shapes[0]).toHaveClass('radar-band');
    expect(shapes[0].getAttribute('fill')).not.toBe('none');
    expect(shapes[1].getAttribute('fill')).toBe('none');
  });

  it('leaves the spokes and the traces when there is none', () => {
    const { container } = render(
      <ComparisonRadar view={view({ traces: [trace('Gabriel', values(10, () => 60))] })} />
    );

    expect(all(container, '.radar-band')).toHaveLength(0);
    expect(all(container, '.radar-spoke')).toHaveLength(10);
    expect(all(container, '.radar-trace')).toHaveLength(1);
  });
});

describe('clamp and mark', () => {
  it('marks a clipped vertex with a shape and prints the true number', () => {
    const { container } = render(
      <ComparisonRadar
        view={view({ traces: [trace('Gabriel', values(10, (i) => (KEYS[i] === 'pts_per_now' ? 44.1 : 10)))] })}
      />
    );

    // The marker is a SHAPE. Colour is already carrying which trace is which —
    // that is the argument behind the four-trace cap — so spending it here too
    // would leave neither job done.
    const marks = all(container, '.radar-clip');
    expect(marks).toHaveLength(1);
    // Its `<title>` is the hover tooltip, and the one place the ceiling it went
    // past is named.
    expect(marks[0].textContent).toBe('Gabriel: pts_per_now 44.10, above the 40 ceiling');
    // And the number itself, beside the axis, because the vertex has been moved.
    expect(screen.getByText('▲ 44.10')).toBeInTheDocument();
  });

  it('does not mark a vertex that is exactly at the ceiling', () => {
    const { container } = render(
      <ComparisonRadar
        view={view({ traces: [trace('Gabriel', values(10, (i) => (KEYS[i] === 'minutes' ? 3420 : 10)))] })}
      />
    );

    // 3,420 is 38 × 90, the maximum the competition can produce and the reason
    // that ceiling is not a rounded p99. An ever-present player hits it exactly,
    // and the mark would claim his true number was off the chart.
    expect(all(container, '.radar-clip')).toHaveLength(0);
  });

  it('separates two traces clipping the SAME axis, and names both numbers', () => {
    const { container } = render(
      <ComparisonRadar
        view={view({
          traces: [
            trace('Gabriel', values(10, (i) => (KEYS[i] === 'pts_per_now' ? 44.1 : 10))),
            trace('Guéhi', values(10, (i) => (KEYS[i] === 'pts_per_now' ? 41.7 : 20))),
          ],
        })}
      />
    );

    // Both are clamped to the same point — that is what clamping means — so the
    // markers would be one triangle on top of another and the labels would be
    // the only thing left telling them apart. Two markers, two numbers.
    const marks = all(container, '.radar-clip');
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute('points')).not.toBe(marks[1].getAttribute('points'));

    expect(screen.getByText('▲ 44.10')).toBeInTheDocument();
    expect(screen.getByText('▲ 41.70')).toBeInTheDocument();
    expect(marks.map((m) => m.textContent)).toEqual([
      'Gabriel: pts_per_now 44.10, above the 40 ceiling',
      'Guéhi: pts_per_now 41.70, above the 40 ceiling',
    ]);
  });
});

describe('a value that is not measured', () => {
  it('breaks the outline rather than closing it through the centre', () => {
    const { container } = render(
      <ComparisonRadar
        view={view({ traces: [trace('Gabriel', values(10, (i) => (i === 3 ? null : 60)))] })}
      />
    );

    // An open polyline, not a closed polygon: rule 6 in geometry. A closed ring
    // over nine points would draw a chord across the missing spoke, and a vertex
    // at the centre would be the measured zero the rule exists to distinguish.
    expect(all(container, 'polygon.radar-trace')).toHaveLength(0);
    expect(all(container, 'polyline.radar-trace')).toHaveLength(1);

    // Nine dots for ten axes. The tenth is not at the centre; it is not there.
    const dots = all(container, '.radar-vertex');
    expect(dots).toHaveLength(9);
    expect(dots.some((d) => d.getAttribute('cx') === '0' && d.getAttribute('cy') === '0')).toBe(
      false
    );
  });

  it('closes a complete trace, so the ordinary case is one polygon', () => {
    const { container } = render(
      <ComparisonRadar view={view({ traces: [trace('Gabriel', values(10, () => 60))] })} />
    );

    expect(all(container, 'polygon.radar-trace')).toHaveLength(1);
    expect(all(container, 'polyline.radar-trace')).toHaveLength(0);
    expect(all(container, '.radar-vertex')).toHaveLength(10);
  });

  it('draws nothing for a trace whose season has not answered', () => {
    const { container } = render(
      <ComparisonRadar view={view({ traces: [trace('Gabriel', null)] })} />
    );

    expect(all(container, '.radar-trace')).toHaveLength(0);
    expect(all(container, '.radar-vertex')).toHaveLength(0);
    // The frame is still there — a trace in flight does not blank the chart.
    expect(all(container, '.radar-spoke')).toHaveLength(10);
  });
});

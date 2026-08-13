/**
 * The radar's geometry, tested as arithmetic.
 *
 * Every rule here has a wrong implementation that renders perfectly plausibly,
 * so each test is written against **what the wrong one would produce** rather
 * than against what the right one does:
 *
 *   - `v / ceiling` instead of `(v - floor) / (ceiling - floor)` is right on six
 *     of the eleven axes and wrong on the two with a real floor.
 *   - `>=` instead of `>` on the clip test marks a value that is exactly at the
 *     ceiling — and `minutes` ceilings at the maximum the competition can
 *     produce, so that is a reachable number rather than a boundary nobody hits.
 *   - filtering the nulls out before drawing joins the two neighbours across the
 *     gap, which puts a line through the missing axis at roughly their average.
 *
 * None of those can be told apart by asserting that a plausible number came
 * out, which is why each test names the impostor.
 */

import { describe, expect, it } from 'vitest';
import { aThreshold } from '../test/factories';
import type { AxisThreshold, AxisValues, ComparisonAxisKey } from '../types/fpl';
import {
  clipMarker,
  floorMarker,
  pointAt,
  scaleValue,
  segments,
  spokeAngle,
  vertices,
} from './radar';

const R = 150;
const TAU = Math.PI * 2;

/** The real defender axis keys, in canonical order. Ten of them. */
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

/** Every axis 0–200, so a fraction is readable; the floor cases say their own. */
const axes = (n: number): AxisThreshold[] =>
  KEYS.slice(0, n).map((axis) => aThreshold({ axis, label: axis }));

/** `i` maps to a value, so a test can hole exactly one axis. */
const valuesBy = (n: number, at: (i: number) => number | null): AxisValues =>
  Object.fromEntries(KEYS.slice(0, n).map((k, i) => [k, at(i)]));

describe('spoke angles', () => {
  it('starts at twelve o’clock however many axes there are', () => {
    for (const n of [7, 8, 10]) {
      expect(spokeAngle(0, n)).toBeCloseTo(-Math.PI / 2, 10);
    }
  });

  it('re-spaces when an axis is dropped, rather than leaving its gap', () => {
    // The load-bearing property. A dropped axis is a seven- or eight-spoke chart
    // evenly divided, not a ten-spoke one with holes — so every spoke after the
    // first sits somewhere different. An implementation that spaced over a fixed
    // eleven and drew a subset would agree on spoke 0 and on nothing else.
    expect(spokeAngle(1, 10) - spokeAngle(0, 10)).toBeCloseTo(TAU / 10, 10);
    expect(spokeAngle(1, 7) - spokeAngle(0, 7)).toBeCloseTo(TAU / 7, 10);

    for (const i of [1, 2, 3, 4, 5, 6]) {
      expect(spokeAngle(i, 7)).not.toBeCloseTo(spokeAngle(i, 10), 3);
    }
  });

  it('closes the circle without doubling a spoke', () => {
    // The last spoke is one step short of a full turn, not on top of the first.
    for (const n of [7, 8, 10]) {
      expect(spokeAngle(n - 1, n) - spokeAngle(0, n)).toBeCloseTo(TAU - TAU / n, 10);
    }
  });

  it('goes clockwise, so the axis order reads the way it is written', () => {
    const second = pointAt(spokeAngle(1, 10), R);
    expect(second.x).toBeGreaterThan(0);
    // SVG y grows downward, so still above the centre one step round from the top.
    expect(second.y).toBeLessThan(0);
  });
});

describe('the scale', () => {
  it('measures from the axis’s own floor, which is not always zero', () => {
    // Min: floor 1,200 (the cohort gate), ceiling 3,420 (38 × 90).
    const at = (v: number) => scaleValue(v, 1200, 3420).fraction;

    // A defender on exactly the gate is at the CENTRE. `v / ceiling` puts him at
    // 0.3509 — a third of a season more than he played, and a number nothing on
    // screen would contradict.
    expect(at(1200)).toBe(0);
    expect(at(1200)).not.toBeCloseTo(1200 / 3420, 3);

    expect(at(3420)).toBe(1);
    expect(at(2310)).toBeCloseTo(0.5, 10);
    // The midpoint under the wrong formula is 1,710, which is inside the axis.
    expect(at(1710)).not.toBeCloseTo(0.5, 3);
  });

  it('is a ratio where the floor is zero, which is why the mistake survives', () => {
    expect(scaleValue(100, 0, 200).fraction).toBeCloseTo(0.5, 10);
    expect(scaleValue(100, 0, 200).fraction).toBeCloseTo(100 / 200, 10);
  });

  it('floors a value below the floor at the centre, and says it did', () => {
    // Reachable, and not rarely: the 1,200-minute gate scopes the COHORT, not
    // the players the picker offers, so most of a squad is below the Min floor.
    expect(scaleValue(600, 1200, 3420)).toEqual({ fraction: 0, placement: 'floored' });
  });

  it('does NOT mark a value that is exactly AT the floor', () => {
    // The mirror of the ceiling boundary, and the mirror of the mutation that
    // catches it: `raw <= 0` in place of `raw < 0` marks a defender on exactly
    // 1,200 minutes as below the gate he just cleared. Virgil's 3,420 confirmed
    // the other end in the browser; this end is the cohort's own threshold, so
    // it is hit by every player who scraped in.
    expect(scaleValue(1200, 1200, 3420)).toEqual({ fraction: 0, placement: 'scaled' });
    expect(scaleValue(0, 0, 200)).toEqual({ fraction: 0, placement: 'scaled' });
  });
});

describe('clamp and mark', () => {
  it('marks a value above the ceiling and clamps it to the outer ring', () => {
    expect(scaleValue(44.1, 0, 40)).toEqual({ fraction: 1, placement: 'clipped' });
  });

  it('does NOT mark a value that is exactly at the ceiling', () => {
    // `>=` rather than `>` is the mutation, and it is not a boundary nobody
    // reaches: `minutes` ceilings at 3,420 because that is the maximum the
    // competition can produce, and an ever-present player hits it exactly.
    expect(scaleValue(40, 0, 40)).toEqual({ fraction: 1, placement: 'scaled' });
    expect(scaleValue(3420, 1200, 3420)).toEqual({ fraction: 1, placement: 'scaled' });
  });

  it('fans several markers on one axis apart, at one radius', () => {
    const angle = spokeAngle(2, 10);
    const alone = clipMarker(angle, R, 0, 1);
    const [first, second] = [clipMarker(angle, R, 0, 2), clipMarker(angle, R, 1, 2)];

    // Two traces above the same ceiling are clamped to the same point — that is
    // what clamping means — so unmarked they would be one triangle where there
    // are two, with nothing on screen saying so.
    expect(first[0].x).not.toBeCloseTo(second[0].x, 1);

    // Same radius, so the fan separates them without implying an order.
    const rOf = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(rOf(first[0])).toBeCloseTo(rOf(second[0]), 6);

    // A lone marker is centred on its spoke rather than offset to one side.
    expect(rOf(alone[0])).toBeCloseTo(R + 11, 6);
    expect(Math.atan2(alone[0].y, alone[0].x)).toBeCloseTo(angle, 6);
  });
});

describe('the floor marker', () => {
  it('points inward, where the clip marker points outward', () => {
    // The direction is the whole distinction: one says the true value is past
    // the outer ring, the other past the centre. Read off the radius of the tip
    // against the radius of the base.
    const angle = spokeAngle(0, 10);
    const rOf = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

    const clip = clipMarker(angle, R, 0, 1);
    const floor = floorMarker(angle);

    // Tip further out than the base for a clip; nearer in for a floor.
    expect(rOf(clip[0])).toBeGreaterThan(rOf(clip[1]));
    expect(rOf(floor[0])).toBeLessThan(rOf(floor[1]));
  });

  it('sits near the centre but never on it', () => {
    // On the centre it would be indistinguishable from a vertex, which is the
    // thing it exists to annotate.
    const floor = floorMarker(spokeAngle(3, 10));
    const tip = Math.hypot(floor[0].x, floor[0].y);
    expect(tip).toBeGreaterThan(0);
    expect(tip).toBeLessThan(R / 4);
  });
});

describe('a value that is not measured', () => {
  const ten = axes(10);

  it('has no vertex at all, rather than one at the centre', () => {
    const vs = vertices(ten, valuesBy(10, (i) => (i === 0 ? null : 40)), R);

    // Rule 6 in geometry. A vertex at the centre is what a measured zero looks
    // like, and those two are the pair the rule exists to keep apart.
    expect(vs[0]).toBeNull();
    expect(vs[3]).not.toBeNull();
    expect(vs[3]!.fraction).toBeCloseTo(40 / 200, 10);
  });

  it('treats a missing key and an explicit null the same way', () => {
    expect(vertices(ten, {}, R).every((v) => v === null)).toBe(true);
  });

  it('breaks the outline over the gap instead of drawing across it', () => {
    const { runs, closed } = segments(
      vertices(ten, valuesBy(10, (i) => (i === 3 ? null : 40)), R)
    );

    expect(closed).toBe(false);
    expect(runs).toHaveLength(1);

    // Nine points, starting after the gap and ending before it. Filtering the
    // nulls out and closing the ring instead would join index 2 to index 4 with
    // a chord across the missing spoke — a line at roughly the average of its
    // neighbours, which reads as "about typical here" for an axis nobody
    // measured. Same nine points, one segment more, and the wrong claim.
    expect(runs[0].map((v) => v.index)).toEqual([4, 5, 6, 7, 8, 9, 0, 1, 2]);
  });

  it('does not split the ring at index 0 when the gap is elsewhere', () => {
    const runsFor = (missing: number) =>
      segments(vertices(ten, valuesBy(10, (i) => (i === missing ? null : 40)), R)).runs;

    expect(runsFor(9).map((r) => r.length)).toEqual([9]);
    expect(runsFor(0).map((r) => r.length)).toEqual([9]);
  });

  it('gives two gaps two runs', () => {
    const { runs } = segments(
      vertices(ten, valuesBy(10, (i) => (i === 2 || i === 6 ? null : 40)), R)
    );

    expect(runs.map((r) => r.map((v) => v.index))).toEqual([
      [3, 4, 5],
      [7, 8, 9, 0, 1],
    ]);
  });

  it('closes a complete trace, so the ordinary case is one polygon', () => {
    const { runs, closed } = segments(vertices(ten, valuesBy(10, () => 40), R));

    expect(closed).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(10);
  });
});

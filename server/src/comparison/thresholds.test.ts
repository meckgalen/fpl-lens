/**
 * The comparison thresholds: structure, not values.
 *
 * **The numbers are checked by `npm run verify:thresholds`, not here**, and the
 * split is deliberate. Pinning a ceiling in a test would restate the constant
 * next to itself — the two copies agree by construction and the pair proves
 * nothing, which is the failure `verify:thresholds`' header describes. That
 * check re-derives from the database instead, and it is not in the suite
 * because it needs the ten complete seasons ingested to say anything.
 *
 * What is left is what a test *can* hold: the shape rules that survive any
 * re-derivation. Canonical order, position membership, and the invariants a
 * threshold has to satisfy to be drawable at all.
 *
 * No database access, so this file needs no synthetic season and no rollback.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARISON_THRESHOLDS,
  RE_DERIVE_BELOW_SEASONS,
  isReDerivable,
  type ComparisonAxisKey,
  type ComparisonPosition,
} from './thresholds.js';

const POSITIONS: ComparisonPosition[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * The canonical order, restated here rather than imported.
 *
 * `AXIS_POOL` is not exported and this is the one place its order is asserted,
 * so importing it would make the test agree with itself. Written out instead:
 * if someone reorders the pool, this is what says so.
 */
const CANONICAL: ComparisonAxisKey[] = [
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
];

describe('the axis sets', () => {
  it('draws 7 for a keeper, 10 for a defender and midfielder, 8 for a forward', () => {
    assert.equal(COMPARISON_THRESHOLDS.GK.length, 7);
    assert.equal(COMPARISON_THRESHOLDS.DEF.length, 10);
    assert.equal(COMPARISON_THRESHOLDS.MID.length, 10);
    assert.equal(COMPARISON_THRESHOLDS.FWD.length, 8);
  });

  it('gives a defender and a midfielder the identical axis set', () => {
    assert.deepEqual(
      COMPARISON_THRESHOLDS.DEF.map((t) => t.axis),
      COMPARISON_THRESHOLDS.MID.map((t) => t.axis)
    );
  });

  it('preserves the canonical relative order in every pruned set', () => {
    for (const position of POSITIONS) {
      const axes = COMPARISON_THRESHOLDS[position].map((t) => t.axis);
      const expected = CANONICAL.filter((a) => axes.includes(a));
      assert.deepEqual(axes, expected, `${position} is out of canonical order`);
    }
  });

  it('gives a keeper no outfield axis, and a forward neither CS nor DCH/St', () => {
    const gk = COMPARISON_THRESHOLDS.GK.map((t) => t.axis);
    for (const axis of ['goals', 'assists', 'expected_goal_involvements', 'defcon_hits_per_start']) {
      assert.ok(!gk.includes(axis as ComparisonAxisKey), `GK should not draw ${axis}`);
    }

    const fwd = COMPARISON_THRESHOLDS.FWD.map((t) => t.axis);
    assert.ok(!fwd.includes('clean_sheets'));
    // Dropped, not unset: 25 of the 28 forwards in the cohort recorded exactly
    // 0.00, so the axis would put nine forwards in ten on the floor.
    assert.ok(!fwd.includes('defcon_hits_per_start'));
  });

  it('gives saves to the keeper alone', () => {
    for (const position of POSITIONS) {
      const has = COMPARISON_THRESHOLDS[position].some((t) => t.axis === 'saves');
      assert.equal(has, position === 'GK', `${position} and saves`);
    }
  });
});

describe('every threshold', () => {
  const all = POSITIONS.flatMap((p) => COMPARISON_THRESHOLDS[p].map((t) => ({ p, t })));

  it('is drawable: a floor strictly below its ceiling', () => {
    for (const { p, t } of all) {
      assert.ok(t.floor < t.ceiling, `${p} ${t.label}: floor ${t.floor} >= ceiling ${t.ceiling}`);
    }
  });

  it('carries the seasons and cohort it was derived from', () => {
    for (const { p, t } of all) {
      assert.ok(t.derivedFrom.seasons.length > 0, `${p} ${t.label} has no derivation seasons`);
      assert.ok(t.derivedFrom.cohort > 0, `${p} ${t.label} has an empty cohort`);
      // Rule 8's format, and oldest first so `seasons[length - 1]` is newest.
      for (const s of t.derivedFrom.seasons) assert.match(s, /^\d{4}-\d{2}$/);
      const sorted = [...t.derivedFrom.seasons].sort();
      assert.deepEqual(t.derivedFrom.seasons, sorted, `${p} ${t.label} seasons are not ascending`);
    }
  });

  it('has not been re-derived yet, so none carries a superseded value', () => {
    for (const { t } of all) assert.equal(t.supersedes, undefined);
  });

  it('floors at 0 except minutes, which floors at the cohort gate, and PPM', () => {
    for (const { p, t } of all) {
      if (t.axis === 'minutes') assert.equal(t.floor, 1200, `${p} minutes floor`);
      else if (t.axis === 'ppm') assert.ok(t.floor > 0, `${p} ppm floor should be the cohort p01`);
      else assert.equal(t.floor, 0, `${p} ${t.label} should floor at 0`);
    }
  });

  it('ceilings minutes at 3,420 on every position — 38 matches of 90', () => {
    for (const position of POSITIONS) {
      const minutes = COMPARISON_THRESHOLDS[position].find((t) => t.axis === 'minutes');
      assert.equal(minutes?.ceiling, 3420);
    }
  });
});

describe('the re-derivation rule', () => {
  it('marks exactly DCH/St and xGI re-derivable, and nothing else', () => {
    for (const position of POSITIONS) {
      for (const t of COMPARISON_THRESHOLDS[position]) {
        const expected =
          t.axis === 'defcon_hits_per_start' || t.axis === 'expected_goal_involvements';
        assert.equal(isReDerivable(t), expected, `${position} ${t.label}`);
      }
    }
  });

  it('draws the line below five seasons', () => {
    assert.equal(RE_DERIVE_BELOW_SEASONS, 5);

    // The two re-derivable axes are re-derivable *because* of their season
    // count, not because they were named. Ten-season axes sit on the other side.
    const dch = COMPARISON_THRESHOLDS.DEF.find((t) => t.axis === 'defcon_hits_per_start')!;
    const xgi = COMPARISON_THRESHOLDS.DEF.find((t) => t.axis === 'expected_goal_involvements')!;
    const pts = COMPARISON_THRESHOLDS.DEF.find((t) => t.axis === 'pts')!;
    assert.equal(dch.derivedFrom.seasons.length, 1);
    assert.equal(xgi.derivedFrom.seasons.length, 3);
    assert.equal(pts.derivedFrom.seasons.length, 10);
  });

  it('excludes 2022-23 from xGI, the season measured only from GW16', () => {
    for (const position of ['DEF', 'MID', 'FWD'] as ComparisonPosition[]) {
      const xgi = COMPARISON_THRESHOLDS[position].find(
        (t) => t.axis === 'expected_goal_involvements'
      )!;
      assert.ok(!xgi.derivedFrom.seasons.includes('2022-23'), `${position} xGI includes 2022-23`);
      assert.deepEqual(xgi.derivedFrom.seasons, ['2023-24', '2024-25', '2025-26']);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { appearanceCount, columnAverage, fmtAverage, fmtPpg, roundHalfEven } from './averages';
import { aGameweek } from '../test/factories';

/**
 * The denominator, on its own.
 *
 * `StatsTable` covers it through the rendered row, which is not the same as testing
 * it: the two filters that make the denominator — played, and non-null for this
 * column — compose, and an implementation applying only one still produces a
 * plausible number in most fixtures. These aim at each filter separately and then at
 * the case where both bite at once.
 */

const played = (over: Partial<Parameters<typeof aGameweek>[0]> = {}) =>
  aGameweek({ minutes: 90, ...over });
const benched = (over: Partial<Parameters<typeof aGameweek>[0]> = {}) =>
  aGameweek({ minutes: 0, total_points: 0, ...over });

const points = (gw: { total_points: number }) => gw.total_points;

describe('columnAverage: the played filter', () => {
  it('excludes a 0-minute row from the denominator', () => {
    // 12 points over two appearances is 6.0, not 4.0 over three rows. This is the
    // reported bug: Tarkowski's 170/38 = 4.5 against a career row saying 170/37.
    const rows = [
      played({ fixture: 1, total_points: 8 }),
      played({ fixture: 2, total_points: 4 }),
      benched({ fixture: 3 }),
    ];

    expect(columnAverage(rows, points)).toEqual({ value: 6, denominator: 2 });
  });

  it('divides by every row under per-fixture, which is what it used to do', () => {
    const rows = [
      played({ fixture: 1, total_points: 8 }),
      played({ fixture: 2, total_points: 4 }),
      benched({ fixture: 3 }),
    ];

    // The old behaviour, kept reachable so the change is a parameter rather than a
    // rewrite — and so this test states what changed.
    expect(columnAverage(rows, points, 'per-fixture')).toEqual({ value: 4, denominator: 3 });
  });

  it('counts both legs of a double gameweek', () => {
    // Rule 13: two rows in one round. FPL counts them as two appearances, which is
    // what reproduces its own points_per_game.
    const rows = [
      played({ fixture: 1, round: 33, total_points: 6 }),
      played({ fixture: 2, round: 33, total_points: 2 }),
    ];

    expect(columnAverage(rows, points)).toEqual({ value: 4, denominator: 2 });
  });
});

describe('columnAverage: the two filters compose', () => {
  /**
   * **The case that separates a correct implementation from a plausible one.** One
   * row is unmeasured and a *different* row is unplayed, so an implementation
   * applying only one of the filters still produces a believable mean.
   *
   * Not synthetic: 2022-23 stores NULL for the expected family before round 16
   * (item 7) while the same players have benched rows all season.
   */
  it('excludes an unmeasured row from the sum and an unplayed row from the count', () => {
    const rows = [
      played({ fixture: 1, expected_goals: 0.6 }),
      played({ fixture: 2, expected_goals: null }),
      benched({ fixture: 3, expected_goals: 0.2 }),
    ];

    const xg = (gw: { expected_goals: number | null }) => gw.expected_goals;

    // Numerator: the two measured rows. Denominator: the one that is measured AND
    // played. The unmeasured row leaves both; the unplayed row leaves only the count.
    expect(columnAverage(rows, xg)).toEqual({ value: 0.8, denominator: 1 });
    expect(columnAverage(rows, xg, 'per-fixture')).toEqual({ value: 0.4, denominator: 2 });
  });

  /**
   * **The bench booking, and the reason the two filters are not symmetric.**
   *
   * A player can take a card without coming on: 0 minutes, −1 point, −3 BPS. There
   * are 14 such rows across the ten seasons (13 yellows and one red at −3 / −9). FPL
   * counts them in the season total, and `points_per_game` is that total over
   * appearances — so the numerator must include a row the denominator does not count.
   *
   * Filtering the numerator by `minutes > 0` as well looks obviously right and is
   * wrong. It disagreed with the career row on 7 player-seasons, and only the wide
   * verification run found it — `total_points` is the only affected column printed
   * beside a second number that could contradict it.
   */
  it('counts a bench yellow card in the sum but not in the denominator', () => {
    const rows = [
      played({ fixture: 1, total_points: 5 }),
      played({ fixture: 2, total_points: 2 }),
      benched({ fixture: 3, total_points: -1, yellow_cards: 1 }),
    ];

    // 6 points over 2 appearances — which is what FPL's own PPG reports.
    expect(columnAverage(rows, points)).toEqual({ value: 3, denominator: 2 });
  });

  /**
   * **And it is not only Pts.** Nine of the 26 averaged columns can be non-zero on a
   * row with no minutes — measured over the ten seasons, 19 such rows in 18
   * player-seasons: `bps` on 15, `total_points` on 14, `yellow_cards` on 13,
   * `ict_index` on 3, `influence`/`creativity`/`xGC` on 2 each, `red_cards`/`threat`
   * on 1.
   *
   * So the same asymmetry shapes nine averages. `total_points` is just the only one
   * printed beside a second number that could expose it, which is why the PPG
   * cross-check found it and nothing else would have. Asserted here so the other
   * eight are observed rather than merely described.
   */
  it('applies the same asymmetry to the other columns a bench row can carry', () => {
    const rows = [
      played({ fixture: 1, yellow_cards: 0, bps: 20, ict_index: 5 }),
      played({ fixture: 2, yellow_cards: 0, bps: 10, ict_index: 3 }),
      // One booking, no minutes: a BPS penalty and an ICT trace, no appearance.
      benched({ fixture: 3, yellow_cards: 1, bps: -3, ict_index: 0.4 }),
    ];

    // Each numerator includes the bench row; each denominator counts 2.
    expect(columnAverage(rows, (gw) => gw.yellow_cards)).toEqual({ value: 0.5, denominator: 2 });
    expect(columnAverage(rows, (gw) => gw.bps)).toEqual({ value: 13.5, denominator: 2 });
    expect(columnAverage(rows, (gw) => gw.ict_index)).toEqual({ value: 4.2, denominator: 2 });
  });

  it('returns null rather than 0 when nothing contributes', () => {
    // Rule 6 on screen: a column nobody measured shows the placeholder, never 0.00.
    const rows = [played({ fixture: 1, tackles: null }), played({ fixture: 2, tackles: null })];
    expect(columnAverage(rows, (gw) => gw.tackles)).toEqual({ value: null, denominator: 0 });
  });

  it('returns null when rows exist but none were played', () => {
    // The never-played case, and the one that makes the footnote's range set empty.
    const rows = [benched({ fixture: 1 }), benched({ fixture: 2 })];
    expect(columnAverage(rows, points)).toEqual({ value: null, denominator: 0 });
    expect(appearanceCount(rows)).toBe(0);
  });
});

describe('roundHalfEven', () => {
  /**
   * The convention FPL computes in and the server used to apply in SQL. Ties are the
   * only place it is visible at all — 226 player-seasons across the ten seasons land
   * on one.
   */
  it('sends a tie to the even digit, in both directions', () => {
    expect(roundHalfEven(2.25, 1)).toBe(2.2);
    expect(roundHalfEven(2.35, 1)).toBe(2.4);
    expect(roundHalfEven(4.25, 1)).toBe(4.2);
    expect(roundHalfEven(3.25, 1)).toBe(3.2);
  });

  it('rounds normally away from a tie', () => {
    expect(roundHalfEven(4.5949, 1)).toBe(4.6);
    expect(roundHalfEven(4.4736, 1)).toBe(4.5);
    expect(roundHalfEven(5.0645, 1)).toBe(5.1);
  });

  /**
   * **Not built on `toFixed`, and this is why.** `toFixed` is not a rounding
   * convention — it is whatever the binary representation gives. Measured over the
   * ten seasons' 226 ties it disagreed with half-to-even on 111 and agreed on 115,
   * six of those by accident. `(1.005).toFixed(2)` is the canonical demonstration.
   */
  it('does not inherit toFixed’s behaviour', () => {
    expect((1.005).toFixed(2)).toBe('1.00');
    expect(roundHalfEven(1.005, 2)).toBe(1);
    // And on a tie that IS exactly representable, they part company.
    expect((2.25).toFixed(1)).toBe('2.3');
    expect(fmtAverage(2.25)).toBe('2.2');
  });
});

describe('fmtPpg', () => {
  it('formats by the same rule as the averages row', () => {
    // The whole point: one function, so PPG and the AVG Pts cell cannot disagree.
    expect(fmtPpg(157 / 31)).toBe(fmtAverage(157 / 31));
    expect(fmtPpg(170 / 37)).toBe('4.6');
    expect(fmtPpg(157 / 31)).toBe('5.1');
  });

  it('renders the placeholder rather than NaN for an absent value', () => {
    expect(fmtPpg(null)).toBe('—');
    expect(fmtPpg(undefined)).toBe('—');
    expect(fmtPpg(Number.NaN)).toBe('—');
  });
});

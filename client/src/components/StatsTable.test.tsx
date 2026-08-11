/**
 * Rule 6, on screen: a null renders as "not measured", a zero renders as zero.
 *
 * The distinction is the reason half this codebase is shaped the way it is —
 * NULL means nobody counted, 0 means they counted and it was none — and until
 * now it existed on the client only as a screenshot in a commit message. The
 * FPL site prints `0.00` for xG in 2018-19. We print `—`, and that difference is
 * the feature.
 *
 * Both rows go in **one table, in one column**, because the failure this catches
 * is a formatter that treats the two the same. Two separate tables, one all-null
 * and one all-zero, would pass against `String(v ?? 0)` just as happily.
 *
 * Cells are found by resolving the column index out of the header row rather
 * than by a fixed offset: there are thirty-one columns and the set has already
 * grown once, so an offset would go stale silently and land the assertion on a
 * neighbour.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import StatsTable from './StatsTable';
import { NO_VALUE } from '../types/fpl';
import { aGameweek, aTeam } from '../test/factories';

const teams = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

/** The index of a column, by its heading. Throws rather than returning -1. */
function columnIndex(label: string): number {
  const headings = Array.from(document.querySelectorAll('thead th')).map((th) =>
    // The sorted column appends a ▴/▾ marker inside the same cell.
    (th.textContent ?? '').replace(/[▴▾]/g, '').trim()
  );
  const i = headings.indexOf(label);
  if (i === -1) throw new Error(`no "${label}" column in: ${headings.join(', ')}`);
  return i;
}

/**
 * The data rows, keyed by the GW cell.
 *
 * The averages row lives in the same `<tbody>` as the matches — it is not a
 * `<tfoot>` — so scoping to `tbody` does not exclude it, and it has to go by
 * name. Leaving it in would be actively misleading here: AVG is computed over
 * the non-null values, so its xG cell reads `0.0` whether the column is half
 * null or entirely zero, and an assertion landing there would pass without
 * distinguishing the two things this file exists to distinguish.
 */
function rowsByGw(): Map<string, string[]> {
  const rows = Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()))
    .filter((cells) => cells[0] !== 'AVG');
  return new Map(rows.map((cells) => [cells[0], cells]));
}

describe('StatsTable: null is not zero', () => {
  it('renders the placeholder for an unmeasured stat and 0.00 for a measured zero', () => {
    render(
      <StatsTable
        history={[
          // Round 1 predates xG. Nobody was counting.
          aGameweek({ fixture: 1, round: 1, expected_goals: null }),
          // Round 2 measured it, and he generated nothing.
          aGameweek({ fixture: 2, round: 2, expected_goals: 0 }),
        ]}
        teams={teams}
      />
    );

    const xg = columnIndex('xG');
    const rows = rowsByGw();

    expect(rows.get('1')?.[xg]).toBe(NO_VALUE);
    expect(rows.get('2')?.[xg]).toBe('0.00');
  });

  it('does the same for the defensive stats, which are null in the opposite direction', () => {
    // tackles/CBI/recoveries were collected 2016-17 to 2018-19, dropped for six
    // seasons, then collected again — so "newer season, more stats" is wrong
    // here, and a formatter special-cased on the xG family alone would miss it.
    render(
      <StatsTable
        history={[
          aGameweek({ fixture: 1, round: 1, tackles: null, recoveries: null }),
          aGameweek({ fixture: 2, round: 2, tackles: 0, recoveries: 0 }),
        ]}
        teams={teams}
      />
    );

    const tck = columnIndex('Tck');
    const rec = columnIndex('R');
    const rows = rowsByGw();

    expect(rows.get('1')?.[tck]).toBe(NO_VALUE);
    expect(rows.get('1')?.[rec]).toBe(NO_VALUE);
    // Counts, so no decimals — the same value formatted two ways would also be
    // a bug, and it is cheaper to notice here than in a column of numbers.
    expect(rows.get('2')?.[tck]).toBe('0');
    expect(rows.get('2')?.[rec]).toBe('0');
  });

  it('renders the two item 14 columns as numbers, with the same null distinction', () => {
    // `St` and `DCH` are the same rule again on two more columns, and both have
    // a real null case: `starts` before 2022-23, `defcon_hit` before 2025-26.
    // A 0 here means "did not start" / "did not clear the threshold" and a
    // placeholder means nobody measured — the difference between a bench
    // appearance and a season that predates the stat.
    render(
      <StatsTable
        history={[
          aGameweek({ fixture: 1, round: 1, starts: null, defcon_hit: null }),
          aGameweek({ fixture: 2, round: 2, starts: 0, defcon_hit: 0 }),
          aGameweek({ fixture: 3, round: 3, starts: 1, defcon_hit: 1 }),
        ]}
        teams={teams}
      />
    );

    const st = columnIndex('St');
    const dch = columnIndex('DCH');
    const rows = rowsByGw();

    expect(rows.get('1')?.[st]).toBe(NO_VALUE);
    expect(rows.get('1')?.[dch]).toBe(NO_VALUE);
    expect(rows.get('2')?.[st]).toBe('0');
    expect(rows.get('2')?.[dch]).toBe('0');
    expect(rows.get('3')?.[st]).toBe('1');
    // A number like CS, not a tick. The brief is explicit about this: the
    // column has to sum by eye down a season.
    expect(rows.get('3')?.[dch]).toBe('1');
  });

  it('puts St beside Min and DCH beside DC, which is what makes either readable', () => {
    // Position is the point of both columns rather than a layout preference.
    // 45 minutes is a start hooked at half time or a substitute brought on at
    // half time, and only the neighbouring column says which; DCH is
    // uninterpretable without the DC count it is a threshold on.
    render(<StatsTable history={[aGameweek()]} teams={teams} />);

    expect(columnIndex('St')).toBe(columnIndex('Min') + 1);
    expect(columnIndex('DCH')).toBe(columnIndex('DC') + 1);
  });

  it('averages DCH but not St, so the 2022-23 footnote keeps naming its group', () => {
    // St is deliberately unaveraged: on 2022-23 `starts` is measured from GW16
    // exactly like the expected family, so an averaged St would join the
    // divergent denominator group and `groupLabel`'s exactness check would fail
    // — "Expected stats over 23" degrading to a list of five column labels.
    //
    // Asserted through the AVG row rather than through the column definition,
    // so it is a statement about what renders.
    render(
      <StatsTable
        history={[
          aGameweek({ fixture: 1, round: 1, starts: 1, defcon_hit: 1 }),
          aGameweek({ fixture: 2, round: 2, starts: 1, defcon_hit: 0 }),
        ]}
        teams={teams}
      />
    );

    const avg = Array.from(document.querySelectorAll('tbody tr'))
      .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()))
      .find((cells) => cells[0] === 'AVG');

    expect(avg?.[columnIndex('St')]).toBe('');
    expect(avg?.[columnIndex('DCH')]).toBe('0.5');
  });

  it('keeps a measured zero distinguishable from the placeholder in the same column', () => {
    // The guard against the assertions above passing for the wrong reason: if
    // NO_VALUE were ever '0' or '0.00', both of them would still be green.
    expect(NO_VALUE).not.toBe('0');
    expect(NO_VALUE).not.toBe('0.00');
  });
});

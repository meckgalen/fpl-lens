/**
 * Sorting a gameweek table without a mouse.
 *
 * `StatsTable` is the reason sortable headers were pulled into this item rather
 * than deferred: it renders inside **every expanded career row**, so fixing the
 * row toggle alone would have let a keyboard user open a season and then not
 * sort the table they had just opened. The gap and the fix are nested, not
 * parallel.
 *
 * Separate from `StatsTable.test.tsx`, which pins rule 6's rendering and is not
 * touched by this item — a component that had to be reshaped to be testable
 * would be a different kind of change from one that was extended.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatsTable from './StatsTable';
import { aGameweek, aTeam } from '../test/factories';

const teams = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

const history = [
  aGameweek({ fixture: 1, round: 1, total_points: 2 }),
  aGameweek({ fixture: 2, round: 2, total_points: 9 }),
  aGameweek({ fixture: 3, round: 3, total_points: 5 }),
];

/** The header button for a column, and the `<th>` that carries its aria-sort. */
function header(label: string) {
  const button = screen.getByRole('button', { name: new RegExp(`^${label}`) });
  const th = button.closest('th');
  if (!th) throw new Error(`${label}'s button is not inside a th`);
  return { button, th };
}

/** The GW cell of each data row, in render order. */
const roundOrder = () =>
  Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '')
    .filter((v) => v !== 'AVG');

describe('StatsTable: the sortable header is a control', () => {
  it('sorts on Enter and reports the direction on the column header', async () => {
    const user = userEvent.setup();
    render(<StatsTable history={history} teams={teams} />);

    const { button, th } = header('Pts');
    // Default sort is GW ascending, so Pts is sortable but not sorted — which
    // is a different statement from "not sortable" and the attribute says which.
    expect(th).toHaveAttribute('aria-sort', 'none');

    button.focus();
    await user.keyboard('{Enter}');

    // First activation of a new column sorts descending, so 9 leads.
    expect(th).toHaveAttribute('aria-sort', 'descending');
    expect(roundOrder()).toEqual(['2', '3', '1']);

    await user.keyboard('{Enter}');
    expect(th).toHaveAttribute('aria-sort', 'ascending');
    expect(roundOrder()).toEqual(['1', '3', '2']);
  });

  it('sorts on Space too', async () => {
    const user = userEvent.setup();
    render(<StatsTable history={history} teams={teams} />);

    const { button, th } = header('Pts');
    button.focus();
    await user.keyboard(' ');
    expect(th).toHaveAttribute('aria-sort', 'descending');
  });

  it('is reachable by Tab, starting at the first column', async () => {
    const user = userEvent.setup();
    render(<StatsTable history={history} teams={teams} />);

    await user.tab();
    expect(document.activeElement).toBe(header('GW').button);
  });
});

describe('StatsTable: the header button fills its cell', () => {
  it('keeps the click target the size it was when the handler sat on the th', () => {
    // The regression this item could easily have shipped: moving `onClick` from
    // the <th> to a button wrapping the label shrinks the mouse target from the
    // padded cell to two or three characters of text, on 31 columns.
    //
    // jsdom does not lay out, so there is no geometry here and this is a
    // tripwire on the classes rather than proof. It is worth having anyway, and
    // worth knowing what it is worth: the first attempt satisfied a version of
    // this test and still collapsed the header row from 40px to 21px in a real
    // browser, because it put `h-10` and `h-full` on the same element and
    // `h-full` won. Only the browser pass caught that. The assertions below are
    // written against the arrangement that fixed it — the **cell** owns the
    // height, the **button** owns the padding — so putting them back on one
    // element fails here too.
    render(<StatsTable history={history} teams={teams} />);
    const { button, th } = header('Pts');

    expect(button.className).toContain('w-full');
    expect(button.className).toContain('h-full');
    expect(button.className).toContain('px-3');

    // The cell keeps its height, or `h-full` has nothing to resolve against.
    expect(th.className).toContain('h-10');
    // And gives up its horizontal padding, or the target is inset by whatever
    // the cell kept.
    expect(th.className).toContain('px-0');
    // Never both on the button: that is the exact pair that collapsed the row.
    expect(button.className).not.toContain('h-10');
  });

  it('leaves the sort arrow out of the accessible name', () => {
    // The ▴/▾ is decorative — direction is carried by aria-sort — so it is
    // aria-hidden. Without that the button would be named "Pts ▾" and the name
    // would change every time the user sorted it.
    render(<StatsTable history={history} teams={teams} />);
    const { button } = header('GW');
    expect(button).toHaveAccessibleName('GW');
    expect(button.textContent).toContain('▴');
  });
});

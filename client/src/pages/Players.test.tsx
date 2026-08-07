/**
 * The second table's disclosure, and the sort headers above it.
 *
 * The point of `DisclosureButton` being shared is that one gesture works
 * identically in both tables, so these are deliberately the same assertions as
 * `CareerTable.test.tsx` rather than a lighter version of them: a shared control
 * that has quietly stopped being shared would pass one file and fail the other,
 * and only if both files ask.
 *
 * The Players list has one thing the career table does not — sortable column
 * headers — so the sort control is pinned here rather than only through
 * `StatsTable`. Both call the same `TableHead`.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Players from './Players';
import { BootstrapContext } from '../lib/bootstrap';
import { aBootstrap, aPlayer, aTeam } from '../test/factories';

const SAKA = aPlayer({ id: 223340, web_name: 'Saka', team: 3, total_points: 157 });
const HAALAND = aPlayer({ id: 223094, web_name: 'Haaland', team: 43, total_points: 140 });

const bootstrap = aBootstrap({
  players: [SAKA, HAALAND],
  teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
});

function renderPlayers() {
  return render(
    <BootstrapContext.Provider value={bootstrap}>
      <Players onOpenDetail={() => {}} />
    </BootstrapContext.Provider>
  );
}

const toggleFor = (name: string) => screen.getByRole('button', { name });

describe('Players: the row toggle behaves exactly like the career one', () => {
  it('names itself with the player and reaches the panel by keyboard', async () => {
    const user = userEvent.setup();
    renderPlayers();

    const toggle = toggleFor('Saka');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const id = toggle.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    const panel = document.getElementById(id!);
    expect(panel).not.toBeNull();
    // The panel really is the one holding this player's detail, not merely an
    // element that happens to carry the id.
    expect(within(panel!).getByText('View gameweek detail →')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes on Space', async () => {
    const user = userEvent.setup();
    renderPlayers();
    const toggle = toggleFor('Haaland');

    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles exactly once per mouse click, with the row handler still present', async () => {
    // Players tracks one open row in a single `expanded` id rather than a Set,
    // so a double toggle lands back on null. Asserting the panel is open after
    // one click is what distinguishes that from the click doing nothing.
    const user = userEvent.setup();
    renderPlayers();

    await user.click(toggleFor('Saka'));
    expect(toggleFor('Saka')).toHaveAttribute('aria-expanded', 'true');
  });

  it('still expands when the row is clicked away from the toggle', async () => {
    const user = userEvent.setup();
    renderPlayers();

    const row = toggleFor('Saka').closest('tr');
    await user.click(within(row!).getByText('MID'));

    expect(toggleFor('Saka')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Players: sorting is reachable without a mouse', () => {
  it('puts a button in the sortable header and reports the direction', async () => {
    const user = userEvent.setup();
    renderPlayers();

    const pts = screen.getByRole('button', { name: /^Pts/ });
    const header = pts.closest('th');
    expect(header).not.toBeNull();

    // The default view is descending on points, and the header says so in the
    // attribute rather than only in the ▾ glyph, which is aria-hidden.
    expect(header).toHaveAttribute('aria-sort', 'descending');

    pts.focus();
    await user.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    // And the sort actually happened: Haaland has fewer points than Saka, so
    // ascending puts him first. Without this the attribute could be a label
    // that moves on its own.
    const names = screen.getAllByRole('button', { name: /Saka|Haaland/ }).map((b) => b.textContent);
    expect(names[0]).toContain('Haaland');
  });

  it('marks the sortable columns that are not the current one', async () => {
    renderPlayers();
    const goals = screen.getByRole('button', { name: /^G$/ });
    expect(goals.closest('th')).toHaveAttribute('aria-sort', 'none');
  });
});

/**
 * The shirt's wiring, pinned here rather than only in `PlayerShirt.test.tsx`.
 * That file proves the component builds a URL from the props it is given; this
 * one proves the list hands it the right ones. A row passing the wrong player's
 * team code would pass every unit test in that file.
 */
describe('Players: the row renders its own club shirt', () => {
  it('keys each row on that player’s permanent team code', () => {
    const { container } = renderPlayers();

    const shirts = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));

    // Saka is Arsenal (3) and Haaland is Man City (43), so the two rows must
    // differ — a hardcoded or captured code would make them identical.
    expect(shirts).toEqual([
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-66.png',
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_43-66.png',
    ]);
  });
});

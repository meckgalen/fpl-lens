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

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Players from './Players';

/**
 * The page fires `fetchColumnHistory` on mount, and without this the suite makes
 * a real `fetch` that jsdom rejects — swallowed by the page's deliberate catch,
 * so it would be invisible rather than absent. Mocked to a promise that never
 * settles: nothing here is about the matrix, and the picker's reasons are
 * complete without it.
 */
vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    fetchColumnHistory: vi.fn(() => new Promise<never>(() => {})),
  };
});
import { BootstrapContext } from '../lib/bootstrap';
import { ROW_STRIPE, Z_HEADER, Z_PINNED, Z_PINNED_HEADER } from '../lib/rowSurface';
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

    // Anchored at both ends, like `/^G$/` below. Item 13's picker adds `Pts/£`
    // and `Pts/£s`, so an unanchored /^Pts/ matches three headers.
    const pts = screen.getByRole('button', { name: /^Pts$/ });
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

/**
 * The sticky header and the pinned Player column, asserted here as well as in
 * `TableSurface.test.tsx` for the same reason the disclosure is: `ui/Table` is shared,
 * and a change that quietly stopped applying to this page would pass the StatsTable
 * file and fail nothing.
 *
 * **Same limit as that file.** jsdom does not lay out, so none of this shows that
 * anything sticks or that the column holds its width — only that the code still asks
 * for it. The browser pass is where those claims live.
 */
describe('Players: the header sticks and the Player column is pinned', () => {
  it('makes every header cell sticky to the top', () => {
    renderPlayers();

    for (const th of screen.getByRole('table').querySelectorAll('thead th')) {
      expect(th.className).toContain('sticky');
      expect(th.className).toContain('top-0');
    }
  });

  it('puts the Player header at the corner level and the rest below it', () => {
    renderPlayers();
    const heads = [...screen.getByRole('table').querySelectorAll('thead th')];

    // Index 1 is Player — the only cell pinned on both axes, so the only one that
    // has to sit above both the header row and the pinned body column.
    expect(heads[1]).toHaveTextContent('Player');
    expect(heads[1].className).toContain(Z_PINNED_HEADER);
    expect(heads[0].className).toContain(Z_HEADER);
    expect(heads[2].className).toContain(Z_HEADER);
  });

  /**
   * Capped, not just pinned. Measured at a 2033px table width, this column rendered
   * **495px** for content whose intrinsic width is **131px**, because `table-layout:
   * auto` hands a column whatever slack is going — and a 495px pinned column would eat
   * half the table on the narrow viewport where pinning is the point.
   */
  it('pins the Player column at a capped width, and only that column', () => {
    renderPlayers();
    const row = toggleFor('Saka').closest('tr') as HTMLElement;
    const cells = [...row.querySelectorAll('td')];

    expect(cells[1].className).toContain('sticky');
    expect(cells[1].className).toContain('left-0');
    expect(cells[1].className).toContain('max-w-[11rem]');
    expect(cells[1].className).toContain(Z_PINNED);
    // The shirt cell before it and the Pos cell after it both scroll.
    expect(cells[0].className).not.toContain('sticky');
    expect(cells[2].className).not.toContain('sticky');
  });

  it('has no overflow on the card, which is what lets the header stick to main', () => {
    // `<main>` is this page's scroll container and it is bounded. Any `overflow` on
    // the card would make the card the scrollport instead — an unbounded one, which
    // never scrolls vertically, so the header would silently never stick. It used to
    // be `overflow-hidden`, which was that plus a second bug: hidden is a scroll
    // container with no scrollbar, so below ~800px the right columns were unreachable.
    const { container } = renderPlayers();
    const card = screen.getByRole('table').parentElement as HTMLElement;

    expect(container).toContainElement(card);
    expect(card.className).toContain('bg-card');
    expect(card.className).not.toMatch(/overflow-/);
  });
});

describe('Players: striping survives an open row', () => {
  /**
   * The case DOM parity gets wrong. An open player inserts a sibling `<tr>` into the
   * same `<tbody>`, shifting every row below it by one position — so `nth-child(even)`
   * is green while everything is collapsed and wrong the moment anything is open.
   *
   * Four players, Saka first, and opening him must leave Haaland striped as row 1
   * despite his row now sitting at DOM position 3.
   */
  it('keeps the stripe on the data index, not the DOM position', async () => {
    const user = userEvent.setup();
    const players = [
      SAKA,
      HAALAND,
      aPlayer({ id: 1, web_name: 'Palmer', team: 3, total_points: 130 }),
      aPlayer({ id: 2, web_name: 'Salah', team: 43, total_points: 120 }),
    ];
    render(
      <BootstrapContext.Provider value={aBootstrap({ players, teams: bootstrap.teams })}>
        <Players onOpenDetail={() => {}} />
      </BootstrapContext.Provider>
    );

    const rowFor = (name: string) => toggleFor(name).closest('tr') as HTMLElement;

    await user.click(toggleFor('Saka'));

    // The sibling row is really there, so the parity really has shifted.
    const body = screen.getByRole('table').querySelector('tbody') as HTMLElement;
    expect(body.querySelectorAll('tr')).toHaveLength(5);
    expect(rowFor('Haaland').previousElementSibling).toHaveAttribute(
      'id',
      `player-summary-${SAKA.id}`
    );

    expect(rowFor('Saka').className).not.toContain(ROW_STRIPE);
    expect(rowFor('Haaland').className).toContain(ROW_STRIPE);
    expect(rowFor('Palmer').className).not.toContain(ROW_STRIPE);
    expect(rowFor('Salah').className).toContain(ROW_STRIPE);
  });

  it('gives the open player’s panel its own row’s surface', async () => {
    const user = userEvent.setup();
    renderPlayers();

    // Haaland is index 1, the striped one, so his panel takes the stripe too and the
    // pair reads as one block.
    await user.click(toggleFor('Haaland'));
    const panel = document.getElementById(`player-summary-${HAALAND.id}`) as HTMLElement;

    expect(panel.className).toContain(ROW_STRIPE);
  });
});

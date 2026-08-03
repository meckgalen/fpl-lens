/**
 * The Dashboard's half of the click-through contract.
 *
 * Its three rankings had no click handler at all — not a broken one, none — so
 * the career view item 1 built was reachable only through the Players list. The
 * three are two different shapes (one `<Table>`, two `<div>` lists), which is
 * why all three are asserted rather than one taken as representative.
 *
 * **This pins the Dashboard's half and nothing more.** `App.tsx` is what turns
 * `onOpenDetail` into a detail page, and `App.tsx` has no test — so a mock
 * callback firing here is not evidence that the feature works. The other half is
 * a browser pass, recorded in CLAUDE.md as such rather than left for a green
 * suite to imply.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './Dashboard';
import { BootstrapContext } from '../lib/bootstrap';
import { aBootstrap, aPlayer, aTeam } from '../test/factories';

/**
 * Three players, each top of exactly one ranking and not of the others.
 *
 * They all appear in all three lists — Top Performers takes six and ICT takes
 * seven — so a name does **not** identify a ranking and the queries below are
 * scoped to a card rather than to the document. What the ordering buys is that
 * the first entry of each card is a different player, so clicking the first
 * entry of a card and getting the right one is a claim about that card's wiring.
 *
 * `appearances` clears the 10-match floor the points-per-match list applies.
 */
const POINTS = aPlayer({ id: 1, web_name: 'Toppoints', total_points: 400, points_per_game: 2, ict_index: 10, appearances: 38 });
const PERMATCH = aPlayer({ id: 2, web_name: 'Permatch', total_points: 100, points_per_game: 9.9, ict_index: 20, appearances: 12 });
const ICT = aPlayer({ id: 3, web_name: 'Ictleader', total_points: 200, points_per_game: 1, ict_index: 900, appearances: 30 });

const bootstrap = aBootstrap({
  players: [POINTS, PERMATCH, ICT],
  teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
});

function renderDashboard(onOpenDetail: (p: { id: number }) => void) {
  return render(
    <BootstrapContext.Provider value={bootstrap}>
      {/* The prop App.tsx fills with setDetailPlayer. Asserting against this
          rather than against a handler of the test's own is what makes a second
          route into the detail page fail here. */}
      <Dashboard onOpenDetail={onOpenDetail} />
    </BootstrapContext.Provider>
  );
}

const RANKINGS = [
  ['Top Performers', POINTS],
  ['Best points per match', PERMATCH],
  ['ICT Index Leaders', ICT],
] as const;

/**
 * The card a ranking lives in: up from its title, out of the `CardHeader`, to
 * the `Card`. Structural because there is nothing else to hold onto — the
 * rankings are three unlabelled regions, and giving them landmark roles is a
 * component change this item is not for. It is asserted rather than assumed:
 * a card that did not contain its own title would fail here rather than
 * silently widen the scope back to the document.
 */
function ranking(title: string): HTMLElement {
  const header = screen.getByText(new RegExp(title)).closest('div');
  const card = header?.parentElement;
  if (!card) throw new Error(`no card around "${title}"`);
  expect(within(card).getByText(new RegExp(title))).toBeInTheDocument();
  return card;
}

/** The first player entry in a ranking — every one of them is an OpenPlayerButton. */
const firstEntry = (title: string) =>
  within(ranking(title)).getAllByRole('button', { name: /Toppoints|Permatch|Ictleader/ })[0];

describe('Dashboard: every ranking opens the player it lists', () => {
  for (const [title, player] of RANKINGS) {
    it(`${title}: a mouse click passes that ranking's own player to onOpenDetail`, async () => {
      const user = userEvent.setup();
      const onOpenDetail = vi.fn();
      renderDashboard(onOpenDetail);

      await user.click(firstEntry(title));

      // The player this ranking puts first, not just any player: three lists
      // wired to one hard-coded index would satisfy a call-count assertion, and
      // the three top entries are three different people precisely so that
      // cannot pass.
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
      expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: player.id }));
    });

    it(`${title}: Enter on the focused name does the same`, async () => {
      const user = userEvent.setup();
      const onOpenDetail = vi.fn();
      renderDashboard(onOpenDetail);

      firstEntry(title).focus();
      await user.keyboard('{Enter}');

      expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: player.id }));
    });
  }

  it('puts every ranking entry in the tab order', async () => {
    // The claim the mouse tests cannot make: that these are reachable at all,
    // which is the whole reason they are buttons rather than div onClicks. The
    // Dashboard had no focusable control in its rankings before this item, so
    // one Tab would have landed past all of them.
    const user = userEvent.setup();
    renderDashboard(vi.fn());

    // Three per ranking: the lists slice to 6, 3 and 7, and the pool is 3, so
    // every ranking shows all of them. Nine buttons is every entry on the page.
    const entries = screen.getAllByRole('button', { name: /Toppoints|Permatch|Ictleader/ });
    expect(entries.length).toBe(9);

    await user.tab();
    expect(document.activeElement).toBe(entries[0]);
    await user.tab();
    expect(document.activeElement).toBe(entries[1]);
  });
});

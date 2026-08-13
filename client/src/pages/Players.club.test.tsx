/**
 * The club filter, and the thing it must not do.
 *
 * Item 18 added a fourth control to a bar that already had search, position and
 * the column picker, and the requirement was explicitly that changing one must
 * not reset the others. That is satisfied by construction — every filter is an
 * independent `useState` — so the assertions here are aimed at the two ways it
 * could stop being true: a shared reset effect, and the season-change effect
 * this file's last two tests are about.
 *
 * **Both halves of every filter assertion are named.** A test that only checks
 * the list got shorter passes against a filter that matches nothing, so each one
 * names a player who survives and a player who goes.
 *
 * **The players carry real distinct names**, unlike the shared factory default,
 * because the search half of the compose test is meaningless if every player's
 * `first_name second_name` is the same string.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Players from './Players';

// The page fires `fetchColumnHistory` on mount; see Players.test.tsx for why
// this is mocked to a promise that never settles.
vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    fetchColumnHistory: vi.fn(() => new Promise<never>(() => {})),
  };
});
import { BootstrapContext } from '../lib/bootstrap';
import { aBootstrap, aPlayer, aTeam } from '../test/factories';
import type { BootstrapData } from '../types/fpl';

const ARSENAL = aTeam({ id: 3, name: 'Arsenal', short_name: 'ARS' });
const CITY = aTeam({ id: 43, name: 'Man City', short_name: 'MCI' });
// A club in one season and not the other, which is the case the reset exists
// for: only twenty of the thirty-five clubs stored are in any given season.
const LEEDS = aTeam({ id: 2, name: 'Leeds', short_name: 'LEE' });

const SAKA = aPlayer({
  id: 223340, web_name: 'Saka', first_name: 'Bukayo', second_name: 'Saka',
  team: 3, total_points: 157, goals_scored: 7,
});
const RICE = aPlayer({
  id: 205651, web_name: 'Rice', first_name: 'Declan', second_name: 'Rice',
  team: 3, total_points: 120, goals_scored: 2,
});
const HAALAND = aPlayer({
  id: 223094, web_name: 'Haaland', first_name: 'Erling', second_name: 'Haaland',
  team: 43, total_points: 140, goals_scored: 27,
});
const BAMFORD = aPlayer({
  id: 116535, web_name: 'Bamford', first_name: 'Patrick', second_name: 'Bamford',
  team: 2, total_points: 40, goals_scored: 3,
});

const EVERYONE = [SAKA, RICE, HAALAND, BAMFORD];

const bootstrap = aBootstrap({ players: EVERYONE, teams: [ARSENAL, CITY, LEEDS] });

function renderPlayers(value: BootstrapData = bootstrap) {
  return render(
    <BootstrapContext.Provider value={value}>
      <Players onOpenDetail={() => {}} />
    </BootstrapContext.Provider>
  );
}

/**
 * The rendered player names, in render order.
 *
 * Read off the row disclosures, whose accessible name is the player's name by
 * design. `textContent` rather than the accessible name because the chevron is
 * `aria-hidden` but still in the text — hence `includes` and not `===`. The
 * column picker's own toggle also carries `aria-expanded` and is filtered out by
 * matching no player.
 */
function renderedNames(): string[] {
  return screen
    .getAllByRole('button', { expanded: false })
    .map((el) => EVERYONE.find((p) => (el.textContent ?? '').includes(p.web_name))?.web_name)
    .filter((n): n is string => n !== undefined);
}

const clubSelect = () => screen.getByLabelText('Club');
const searchBox = () => screen.getByPlaceholderText('Search players…');
/** The sort control is the button; `aria-sort` lives on the `<th>` around it. */
const goalsHeader = () => screen.getByRole('columnheader', { name: 'G' });
const goalsSort = () => screen.getByRole('button', { name: 'G' });

describe('the club filter', () => {
  it('keeps that club and drops the others', async () => {
    const user = userEvent.setup();
    renderPlayers();

    expect(renderedNames()).toEqual(expect.arrayContaining(['Saka', 'Haaland', 'Bamford']));

    await user.selectOptions(clubSelect(), '3');

    const names = renderedNames();
    // Both halves: who stays and who goes. "Fewer rows" would also be true of a
    // filter matching nothing at all.
    expect(names).toContain('Saka');
    expect(names).toContain('Rice');
    expect(names).not.toContain('Haaland');
    expect(names).not.toContain('Bamford');
  });

  it('composes with search and a non-default sort without resetting either', async () => {
    const user = userEvent.setup();
    renderPlayers();

    // A sort AWAY from the default (points, descending), so the assertion cannot
    // pass on the order the list already happened to be in. Two clicks: the
    // first selects the column descending, the second flips it.
    await user.click(goalsSort());
    await user.click(goalsSort());
    expect(renderedNames()).toEqual(['Rice', 'Bamford', 'Saka', 'Haaland']);

    await user.selectOptions(clubSelect(), '3');
    // The club filter applied, AND the ascending goals order survived it —
    // Rice's 2 before Saka's 7 is the whole assertion.
    expect(renderedNames()).toEqual(['Rice', 'Saka']);

    await user.type(searchBox(), 'ka');
    expect(renderedNames()).toEqual(['Saka']);

    // None of the three controls was reset by the others.
    expect(searchBox()).toHaveValue('ka');
    expect(goalsHeader()).toHaveAttribute('aria-sort', 'ascending');
    expect(clubSelect()).toHaveValue('3');
  });

  it('keeps the club when the new season still has it', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPlayers();

    await user.selectOptions(clubSelect(), '3');
    expect(clubSelect()).toHaveValue('3');

    // A season that still has Arsenal. Intent survives — the common case, and
    // the reason the reset is conditional rather than unconditional.
    rerender(
      <BootstrapContext.Provider
        value={aBootstrap({ season: '2024-25', players: [SAKA, RICE, HAALAND], teams: [ARSENAL, CITY] })}
      >
        <Players onOpenDetail={() => {}} />
      </BootstrapContext.Provider>
    );

    expect(clubSelect()).toHaveValue('3');
    expect(renderedNames()).not.toContain('Haaland');
  });

  it('resets to All clubs when the new season does not have that club', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPlayers();

    await user.selectOptions(clubSelect(), '2');
    expect(renderedNames()).toEqual(['Bamford']);

    // 2021-22 has no Leeds. Without the reset the select holds a value matching
    // no option — which browsers render blank — over a table filtered to nobody.
    rerender(
      <BootstrapContext.Provider
        value={aBootstrap({ season: '2021-22', players: [SAKA, RICE, HAALAND], teams: [ARSENAL, CITY] })}
      >
        <Players onOpenDetail={() => {}} />
      </BootstrapContext.Provider>
    );

    expect(clubSelect()).toHaveValue('ALL');
    expect(renderedNames()).toEqual(expect.arrayContaining(['Saka', 'Haaland']));
  });
});

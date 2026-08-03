/**
 * Expanding a career row: one request, and one only.
 *
 * This is the item 1 bug, which was found by eye in a network panel and could
 * not have been found any other way. `void loadSeason(season)` sat inside the
 * `setExpanded` updater; React double-invokes updaters under StrictMode
 * precisely to surface side effects hidden in one, and every expand fired two
 * identical requests.
 *
 * ## What this file catches, measured by mutation rather than assumed
 *
 * Each of these was applied to `PlayerDetail.tsx` and the suite run:
 *
 *   call moved back inside the updater  -> GREEN (4 passed)
 *   inFlight ref swapped back to state  -> GREEN (4 passed)
 *   both together (the bug as it was)   -> RED   ("expected 2 to be 1", twice)
 *
 * ## And why that does not mean either half is optional
 *
 * The two mechanisms are not equal in weight. The **ref guard suppresses the
 * symptom**: it is written synchronously before the first `await`, so the second
 * updater invocation finds the season already in flight and returns. The **call
 * sitting outside the updater is what makes the code correct.** React does not
 * promise to invoke an updater exactly twice, and it can discard a render
 * entirely — in which case a fetch has been started for a state change that
 * never committed. None of that is observable from outside the component, so no
 * test here pins it.
 *
 * Read the table as "the outcome is defended twice over", not as "either half is
 * fine". Deleting whichever one is in the way is how this bug comes back.
 *
 * The suite runs under StrictMode because `renderInApp` puts it there, and
 * `test/render.test.tsx` is the check that it is genuinely active — without
 * that, every assertion below would pass while pinning nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import PlayerDetail from './PlayerDetail';
import { renderInApp } from '../test/render';
import {
  aBootstrap,
  aCareerSeason,
  aGameweek,
  aPlayer,
  aPlayerDetail,
  aTeam,
} from '../test/factories';
import { fetchPlayerCareer, fetchPlayerDetail } from '../services/api';

/**
 * Both functions, not just the one under test.
 *
 * `PlayerDetail`'s mount effect runs them under a single `Promise.all`, so a
 * missing career mock rejects it, the component renders its error branch, and no
 * career row is ever drawn. The expand tests would then fail with "unable to
 * find element" — a message about the DOM, pointing at the table, for a problem
 * in this factory.
 */
vi.mock('../services/api', () => ({
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchBootstrap: vi.fn(),
  fetchFixtures: vi.fn(),
}));

const detailMock = vi.mocked(fetchPlayerDetail);
const careerMock = vi.mocked(fetchPlayerCareer);

const CURRENT = '2025-26';
const PREVIOUS = '2020-21';

const SAKA = aPlayer({ id: 223340, first_name: 'Bukayo', second_name: 'Saka', web_name: 'Saka' });
const MAGUIRE = aPlayer({
  id: 95658,
  first_name: 'Harry',
  second_name: 'Maguire',
  web_name: 'Maguire',
  team: 3,
});

const bootstrap = aBootstrap({
  season: CURRENT,
  players: [SAKA, MAGUIRE],
  teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
});

/**
 * A distinct payload for every (player, season) pair.
 *
 * A bare `vi.fn()` returns one response whatever it is called with, which would
 * make the cache-reset test pass on the collapsed row alone — true of any
 * rerender, and silent about whether anything was invalidated. Seasons need
 * separating too, not just players: "This Season" and an expanded previous
 * season are both on screen at once, so a value shared between them cannot say
 * which table it came from.
 *
 * `bps` carries the marker because it is a plain integer that reaches the cell
 * with no formatting in between.
 */
const BPS: Record<number, Record<string, number>> = {
  [SAKA.id]: { [CURRENT]: 5101, [PREVIOUS]: 5102 },
  [MAGUIRE.id]: { [CURRENT]: 5201, [PREVIOUS]: 5202 },
};

const bps = (code: number, season: string) => String(BPS[code][season]);

function detailFor(code: number, season: string) {
  return aPlayerDetail({
    season,
    history: [aGameweek({ fixture: 1, round: 1, bps: BPS[code][season] })],
  });
}

beforeEach(() => {
  detailMock.mockImplementation(async (code, season) => detailFor(code, season));
  careerMock.mockImplementation(async () => ({
    seasons: [
      aCareerSeason({ season: CURRENT, team_short_name: 'ARS' }),
      aCareerSeason({ season: PREVIOUS, team_short_name: 'ARS' }),
    ],
  }));
});

/** How many times a given season was fetched, for any player. */
const callsFor = (season: string) =>
  detailMock.mock.calls.filter(([, s]) => s === season).length;

/**
 * The clickable summary row for a season.
 *
 * `findBy*`, because "Previous Seasons" is drawn only once the career promise
 * resolves — a synchronous query followed by `fireEvent.click` fires before the
 * row exists.
 */
async function seasonRow(season: string) {
  const cell = await screen.findByText(season);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row around the ${season} cell`);
  return row;
}

describe('PlayerDetail: expanding a previous season', () => {
  it('issues exactly one request for the season it opens', async () => {
    renderInApp(<PlayerDetail player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));

    // One, under StrictMode, with the updater invoked twice. Two is the bug.
    expect(callsFor(PREVIOUS)).toBe(1);

    // Counted per season rather than in total, deliberately: StrictMode also
    // double-invokes the mount effect, so the CURRENT season legitimately has
    // two calls and a total-call assertion would be pinning that instead.
    expect(callsFor(CURRENT)).toBeGreaterThanOrEqual(1);
  });

  it('issues no request when the season is reopened after collapsing', async () => {
    renderInApp(<PlayerDetail player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));
    expect(callsFor(PREVIOUS)).toBe(1);

    // Collapse keeps the cached response — that is the whole point of caching
    // per season rather than per open row.
    fireEvent.click(await seasonRow(PREVIOUS));
    expect(screen.queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));
    expect(callsFor(PREVIOUS)).toBe(1);
  });
});

describe('PlayerDetail: the cache does not outlive its player', () => {
  it('drops the previous player’s seasons and refetches for the new one', async () => {
    const { rerender } = renderInApp(<PlayerDetail player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));

    rerender(<PlayerDetail player={MAGUIRE} onBack={() => {}} />);

    // findBy*, not getBy*: the new player's own requests have to settle before
    // anything can be asserted about what is on screen. Checking for an absence
    // before the rerender has resolved passes because nothing has happened yet.
    await screen.findByText(bps(MAGUIRE.id, CURRENT));

    // Expanded state is reset with the cache, so the row comes back collapsed.
    expect(screen.queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();

    // The half that actually catches a cache surviving its player. A stale
    // cache would answer this expand out of Saka's entry, under Maguire's
    // name, without issuing a request — and it would look completely normal.
    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(MAGUIRE.id, PREVIOUS));
    expect(screen.queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();
    expect(screen.queryByText(bps(SAKA.id, CURRENT))).not.toBeInTheDocument();
  });
});

describe('PlayerDetail: the sections', () => {
  it('shows the current season above, and the rest as expandable rows', async () => {
    renderInApp(<PlayerDetail player={SAKA} onBack={() => {}} />, bootstrap);

    // "This Season" is labelled with the season the detail response resolved,
    // and the career table excludes it — it is already above, in full.
    await screen.findByText('This Season');
    const previous = await screen.findByText('Previous Seasons');
    const note = previous.parentElement;
    expect(note?.textContent).toMatch(/1 season/);

    const row = await seasonRow(PREVIOUS);
    expect(within(row).getByText(PREVIOUS)).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: new RegExp(CURRENT) })).toBeNull();
  });
});

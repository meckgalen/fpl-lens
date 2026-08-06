/**
 * The season selector, and the shell state it moves.
 *
 * **`App.tsx` had no test before item 8**, which is why item 3 could only ever
 * pin the Dashboard's half of the click-through contract — the callback firing
 * was not evidence a detail page opened, because nothing rendered `App`. The
 * `detailPlayer` snapshot fix cannot be tested anywhere else either: it is a
 * bug about which object the shell hands down, so the shell has to be running.
 *
 * `App` renders its own `BootstrapContext.Provider`, so these do NOT use
 * `renderInApp` — that helper supplies a provider, which is exactly what is
 * under test here. StrictMode is applied by hand for the same reason
 * `render.tsx` gives: `main.tsx` mounts inside it, and the fetch effect's
 * cancellation guard is only exercised by the double invocation.
 */

import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, fetchBootstrap, fetchPlayerCareer, fetchPlayerDetail } from './services/api';
import type { BootstrapData } from './types/fpl';
import {
  aBootstrap,
  aCareerSeason,
  aGameweek,
  aPlayer,
  aPlayerDetail,
  aTeam,
  anEvent,
  anIdentity,
} from './test/factories';

// All four are listed even where only some are used: `PlayerDetail` fires the
// career and detail fetches together, and an unmocked one rejects into the
// component's error branch, which surfaces as a misleading "unable to find
// element" rather than as the missing mock it is.
vi.mock('./services/api', async () => {
  const actual = await vi.importActual<typeof import('./services/api')>('./services/api');
  return {
    // ApiError is a real class the component does `instanceof` against, so it
    // must be the real one — a mocked constructor would make every 400 look
    // like an ordinary failure and the recovery path would never run.
    ApiError: actual.ApiError,
    fetchBootstrap: vi.fn(),
    fetchPlayerDetail: vi.fn(),
    fetchPlayerCareer: vi.fn(),
    fetchFixtures: vi.fn(),
  };
});

const bootstrapMock = vi.mocked(fetchBootstrap);
const detailMock = vi.mocked(fetchPlayerDetail);
const careerMock = vi.mocked(fetchPlayerCareer);

const LIVE = '2026-27';
const DONE = '2025-26';

const SAKA = aPlayer({ id: 223340, web_name: 'Saka', team: 3 });
const TEAMS = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

/**
 * Per-season marker values, so a stale payload is *visible* rather than merely
 * absent.
 *
 * A mock that returned the same numbers for both seasons would let every
 * assertion below pass against a component that never refetched at all.
 */
const POINTS: Record<string, number> = { [LIVE]: 0, [DONE]: 157 };
/** A second marker, on the gameweek rows, distinct from POINTS so the header
 *  and the table can be told apart when both are on screen. */
const BPS: Record<string, number> = { [LIVE]: 404, [DONE]: 570 };

function bootstrapFor(season: string): BootstrapData {
  return aBootstrap({
    season,
    seasons: [LIVE, DONE],
    players: [aPlayer({ ...SAKA, total_points: POINTS[season], appearances: season === LIVE ? 0 : 31 })],
    teams: TEAMS,
    // Only the live season has a deadline, which is the real shape: the ten
    // CSV-backfilled seasons have no `events` rows at all, so no round of any
    // of them is current or next.
    events:
      season === LIVE
        ? [anEvent({ id: 1, finished: false, is_next: true, deadline_time: '2026-08-21T17:30:00Z' })]
        : [anEvent({ id: 37 }), anEvent({ id: 38 })],
  });
}

/** A fresh, resolvable bootstrap mock keyed on the season asked for. */
function serveSeasons() {
  bootstrapMock.mockImplementation(async (season) => bootstrapFor(season ?? LIVE));
}

function renderApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

/** The selector, by the label beside it — there is no aria-label to assert. */
function seasonSelect(): HTMLSelectElement {
  return screen.getByLabelText('Season') as HTMLSelectElement;
}

beforeEach(() => {
  localStorage.clear();
  serveSeasons();
  detailMock.mockImplementation(async (code, season) =>
    aPlayerDetail({
      season,
      history: [aGameweek({ fixture: 1, round: 1, bps: BPS[season] })],
      teams: TEAMS,
    })
  );
  // Both seasons, so `registeredIn` is true for whichever one is selected. A
  // career missing the selected season is a different state entirely — the one
  // the last test in this file is about.
  careerMock.mockImplementation(async (code) => ({
    player: anIdentity({ id: code }),
    seasons: [
      aCareerSeason({ season: LIVE, team_short_name: 'ARS' }),
      aCareerSeason({ season: DONE, team_short_name: 'ARS' }),
    ],
  }));
});

afterEach(() => {
  localStorage.clear();
});

describe('the season selector', () => {
  it('offers every season the bootstrap lists, in the order it sent them', async () => {
    renderApp();
    await screen.findByText(`Dashboard · ${LIVE}`);

    const options = within(seasonSelect()).getAllByRole('option');
    // Not sorted here. The server decides the ordering and the client renders
    // it; re-sorting in the test would assert against the test's own opinion.
    expect(options.map((o) => o.textContent)).toEqual([LIVE, DONE]);
  });

  it('refetches with the newly chosen season', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText(`Dashboard · ${LIVE}`);

    await user.selectOptions(seasonSelect(), DONE);

    await waitFor(() => expect(bootstrapMock).toHaveBeenCalledWith(DONE));
    await screen.findByText(`Dashboard · ${DONE}`);
  });

  it('keeps the previous season on screen while the new one loads', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText(`Dashboard · ${LIVE}`);

    // Held open, so the in-flight window is observable rather than a race.
    let release!: (b: BootstrapData) => void;
    bootstrapMock.mockImplementationOnce(
      () => new Promise<BootstrapData>((resolve) => (release = resolve))
    );

    await user.selectOptions(seasonSelect(), DONE);

    // The load-bearing assertion: the whole-app loading screen must NOT come
    // back. Nulling `bootstrap` to refetch would unmount the shell — including
    // the selector the user just used — and replace it with this string.
    expect(screen.queryByText('Loading FPL data…')).not.toBeInTheDocument();
    // And what is still on screen is internally consistent: the old season's
    // data under the old season's label, not a mix.
    expect(screen.getByText(`Dashboard · ${LIVE}`)).toBeInTheDocument();

    release(bootstrapFor(DONE));
    await screen.findByText(`Dashboard · ${DONE}`);
  });
});

describe('the persisted season', () => {
  it('stores the season the server served, not the one requested', async () => {
    /*
     * The mock resolves a season other than the one asked for.
     *
     * **Today's server cannot do this** — `resolveSeason` either honours the
     * parameter or 400s, so `requested` and `response.season` are equal on
     * every real path, and writing either one would look identical. Measured:
     * with the assertion written against the ordinary flow, swapping the code
     * to persist `requested` left every test green.
     *
     * So the mock stands in for the one thing that would break it: a server
     * that normalises rather than rejects (accepting '2025-2026' and resolving
     * '2025-26' would do it). The contract being pinned is the client's — the
     * response is the authority on which season you got — and it is worth
     * pinning precisely because nothing in today's data would reveal it broken.
     */
    const user = userEvent.setup();
    renderApp();
    await screen.findByText(`Dashboard · ${LIVE}`);

    bootstrapMock.mockImplementation(async () => bootstrapFor(LIVE));
    await user.selectOptions(seasonSelect(), DONE);

    await waitFor(() => expect(localStorage.getItem('fpl-season')).toBe(LIVE));
  });

  it('sends the stored season on the next load', async () => {
    localStorage.setItem('fpl-season', DONE);
    renderApp();

    await screen.findByText(`Dashboard · ${DONE}`);
    expect(bootstrapMock).toHaveBeenCalledWith(DONE);
  });

  it('recovers from a stored season the database does not have', async () => {
    // The chicken-and-egg case, and it is not hypothetical: the list of valid
    // seasons arrives ON the bootstrap response, so a stored value can only be
    // validated by asking for it. A fresh clone or a rebuilt container is a
    // database with a different season set.
    localStorage.setItem('fpl-season', '2099-00');
    bootstrapMock.mockImplementation(async (season) => {
      if (season === '2099-00') {
        throw new ApiError("Unknown season '2099-00'", 400, [LIVE, DONE]);
      }
      return bootstrapFor(LIVE);
    });

    renderApp();

    // A WORKING app, not a dead one — the whole point of the branch.
    await screen.findByText(`Dashboard · ${LIVE}`);
    expect(bootstrapMock).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(localStorage.getItem('fpl-season')).toBe(LIVE));
  });

  it('does not discard the chosen season when the request merely fails', async () => {
    // The other half of the same branch, and the reason it needs the status
    // rather than just the failure: a blind retry would treat a network blip
    // like an invalid season and silently move the user to a different one.
    localStorage.setItem('fpl-season', DONE);
    bootstrapMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderApp();

    await screen.findByText(/Failed to load FPL data/);
    expect(bootstrapMock).not.toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem('fpl-season')).toBe(DONE);
  });
});

describe('the sidebar deadline block', () => {
  it('is shown when a gameweek is actually next', async () => {
    renderApp();
    await screen.findByText(`Dashboard · ${LIVE}`);

    expect(screen.getAllByText('GW1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deadline').length).toBeGreaterThan(0);
  });

  it('is absent on a season where no gameweek is next', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText(`Dashboard · ${LIVE}`);

    await user.selectOptions(seasonSelect(), DONE);
    await screen.findByText(`Dashboard · ${DONE}`);

    // Not "GW38 / Deadline / TBD", which is what the old fallback chain in
    // nextGameweek produced: a round played in May 2026 announced as upcoming.
    expect(screen.queryByText('Deadline')).not.toBeInTheDocument();
    expect(screen.queryByText('GW38')).not.toBeInTheDocument();
  });
});

describe('an open detail page across a season change', () => {
  /** Open Saka's detail page from the Players list. */
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText(`Dashboard · ${LIVE}`);
    await user.click(screen.getByRole('button', { name: 'Players' }));
    await user.click(await screen.findByRole('button', { name: /Saka/ }));
    await user.click(await screen.findByRole('button', { name: /View gameweek detail/ }));
    await screen.findByText('This Season');
  }

  /**
   * The header's Total Pts tile, read through its own label rather than by
   * walking up the DOM — the card's structure is layout and will move.
   */
  const totalPts = () => screen.getByText('Total Pts').parentElement!.textContent;

  it('re-resolves the player from the new season instead of showing a snapshot', async () => {
    const user = userEvent.setup();
    renderApp();
    await openDetail(user);

    // The live season: no matches played, so no points and a table of one row
    // carrying the live season's marker.
    expect(totalPts()).toContain(String(POINTS[LIVE]));
    expect(screen.getByText(String(BPS[LIVE]))).toBeInTheDocument();

    await user.selectOptions(seasonSelect(), DONE);

    // The header card and the gameweeks must agree about which season they are
    // showing. Before the fix the header kept rendering the `Player` object
    // captured at click time — 2026-27's zeros — while the table below it moved
    // to 2025-26, and nothing on screen said so.
    await waitFor(() => expect(totalPts()).toContain(String(POINTS[DONE])));
    await waitFor(() => expect(screen.getByText(String(BPS[DONE]))).toBeInTheDocument());
    expect(screen.queryByText(String(BPS[LIVE]))).not.toBeInTheDocument();
  });

  it('never claims a finished season is about to start while its rows load', async () => {
    const user = userEvent.setup();
    renderApp();
    await openDetail(user);

    // Held open so the window is observable. The cache is keyed by season and
    // kept across a season change — correctly — so the newly selected season is
    // simply absent from it, and `history` is []. `registeredIn` reads the
    // career, which IS kept and does contain 2025-26, so GameweekSection would
    // be handed "no rows, registered" and print the underway sentence.
    let release!: (d: Awaited<ReturnType<typeof fetchPlayerDetail>>) => void;
    detailMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    await user.selectOptions(seasonSelect(), DONE);
    await waitFor(() => expect(screen.getByText('This Season')).toBeInTheDocument());

    // The load-bearing assertion is the negative one. The failure mode is a
    // plausible sentence about the wrong thing, not a missing one.
    expect(screen.queryByText(/is underway/)).not.toBeInTheDocument();
    // And the positive one, which is what distinguishes this fix from simply
    // resetting the cache — that would also silence the sentence.
    expect(screen.getByText(`Loading ${DONE}…`)).toBeInTheDocument();

    release(
      aPlayerDetail({
        season: DONE,
        history: [aGameweek({ fixture: 1, round: 1, bps: POINTS[DONE] })],
        teams: TEAMS,
      })
    );
    await waitFor(() => expect(screen.queryByText(`Loading ${DONE}…`)).not.toBeInTheDocument());
  });

  it('renders the not-in-the-game state, with a name and no season-scoped values', async () => {
    // A player whose whole career is the live season — a summer signing. Both
    // mocks are set BEFORE the page opens, deliberately: the career keys on the
    // player and is not refetched when the season changes (it is
    // season-independent, which is the point of the effect split), so a career
    // swapped mid-test would never be read.
    bootstrapMock.mockImplementation(async (season) =>
      season === DONE ? aBootstrap({ ...bootstrapFor(DONE), players: [] }) : bootstrapFor(LIVE)
    );
    careerMock.mockImplementation(async (code) => ({
      player: anIdentity({ id: code }),
      seasons: [aCareerSeason({ season: LIVE, team_short_name: 'ARS' })],
    }));

    const user = userEvent.setup();
    renderApp();
    await openDetail(user);

    // 2025-26 without him in it: no player_seasons row, so no Player object at
    // all. This is the empty state item 1 wrote and Known Issues has recorded
    // ever since as unreachable from the UI.
    await user.selectOptions(seasonSelect(), DONE);

    await screen.findByText(/was not in the game in 2025-26/);
    // The name survives, because it comes from the career identity rather than
    // from a player-season.
    expect(screen.getByRole('heading', { name: 'Bukayo Saka' })).toBeInTheDocument();

    // Nothing season-scoped renders — not as a number, and not as the no-value
    // marker either, which would claim we looked and found nothing measured.
    //
    // These seven labels are the ones unique to the header's stat grid.
    // 'Price', 'Starts', 'ICT' and the rest are deliberately not in the list:
    // CareerTable uses them too, and that table is *supposed* to still be here.
    for (const label of ['Total Pts', 'Ownership', 'Form', 'Minutes', 'Goals', 'Assists', 'Bonus']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // And the career table is untouched: it is what the page is still for.
    expect(screen.getByText('Previous Seasons')).toBeInTheDocument();
  });
});

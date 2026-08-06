/**
 * The Fixtures page across a season change.
 *
 * The page had no test before item 8, and it is the one place the round
 * collision is observable: the fetch effect used to key on the round number
 * alone, and two seasons that both end at round 38 produce the same number, so
 * a season change did not refetch and the page kept rendering the previous
 * season's matches under the new season's heading.
 *
 * The provider is supplied by hand and swapped with `rerender` — the page reads
 * its season from context, so a new context value IS a season change as far as
 * it is concerned. That keeps this file about the page rather than about the
 * shell, which App.test.tsx covers.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fixtures from './Fixtures';
import { fetchFixtures } from '../services/api';
import { BootstrapContext } from '../lib/bootstrap';
import type { BootstrapData, Fixture } from '../types/fpl';
import { aBootstrap, aTeam, anEvent } from '../test/factories';

vi.mock('../services/api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchFixtures: vi.fn(),
}));

const fixturesMock = vi.mocked(fetchFixtures);

const EARLIER = '2024-25';
const LATER = '2025-26';

const TEAMS = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

/**
 * Two completed seasons whose rounds both END AT 38.
 *
 * That is the whole point of the fixture. The derived round is the same number
 * in both, so an effect keyed on it alone cannot see the difference — which is
 * precisely the case a season selector makes reachable and the case a test
 * using two differently-shaped seasons would miss.
 */
function completedSeason(season: string): BootstrapData {
  return aBootstrap({
    season,
    seasons: [LATER, EARLIER],
    teams: TEAMS,
    // No deadlines, so no round is current or next — which is true of every
    // CSV-backfilled season and is why the page derives its own display round.
    events: [anEvent({ id: 37 }), anEvent({ id: 38 })],
  });
}

function aFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: 1,
    code: null,
    event: 38,
    team_h: 3,
    team_a: 43,
    team_h_score: 2,
    team_a_score: 1,
    team_h_difficulty: 3,
    team_a_difficulty: 4,
    kickoff_time: '2026-05-24T15:00:00Z',
    finished: true,
    ...overrides,
  };
}

function renderFixtures(bootstrap: BootstrapData) {
  return render(
    <BootstrapContext.Provider value={bootstrap}>
      <Fixtures />
    </BootstrapContext.Provider>
  );
}

beforeEach(() => {
  fixturesMock.mockImplementation(async (event, season) => ({
    season: season ?? LATER,
    fixtures: [aFixture({ event })],
  }));
});

describe('Fixtures across a season change', () => {
  it('sends the season, not just the round', async () => {
    renderFixtures(completedSeason(LATER));

    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(38, LATER));
  });

  it('refetches when the season changes but the round number does not', async () => {
    const { rerender } = renderFixtures(completedSeason(LATER));
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(38, LATER));

    rerender(
      <BootstrapContext.Provider value={completedSeason(EARLIER)}>
        <Fixtures />
      </BootstrapContext.Provider>
    );

    // Both seasons derive round 38. Keyed on the round alone this call never
    // happens and the page silently keeps 2025-26's matches on screen under a
    // 2024-25 heading.
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(38, EARLIER));
  });

  it('clears the previous season’s matches while the new ones load', async () => {
    const { rerender } = renderFixtures(completedSeason(LATER));
    await screen.findByText(`Fixtures · ${LATER}`);

    // Held open so the in-flight window is observable rather than a race.
    fixturesMock.mockImplementationOnce(() => new Promise(() => {}));

    rerender(
      <BootstrapContext.Provider value={completedSeason(EARLIER)}>
        <Fixtures />
      </BootstrapContext.Provider>
    );

    // Stale rows under a new label is the failure this guards: the heading is
    // taken from the response, so leaving the old fixtures mounted would put
    // one season's matches beside another season's name.
    await screen.findByText('Loading fixtures…');
    expect(screen.queryByText('MCI')).not.toBeInTheDocument();
  });
});

describe('Fixtures with no next gameweek', () => {
  it('still shows a round on a season where nothing is upcoming', async () => {
    // `nextGameweek` returns null for every completed season, correctly. The
    // page needs a round anyway, so it derives its own — and this is what pins
    // that the fallback moved here rather than being deleted with the helper's.
    renderFixtures(completedSeason(LATER));

    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(38, LATER));
    expect(screen.getByRole('button', { name: 'GW38 Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GW38 Results' })).toBeInTheDocument();
  });

  it('names a results round even when nothing has been played', async () => {
    /*
     * Found in the browser on 2026-27, not by a test — which is why it is here
     * now. With no round current and none finished, the derived results round
     * was undefined: the effect returned early, the *previous tab's* fixtures
     * stayed mounted, and the heading read "Gameweek ? results" over them.
     * Stale rows under a wrong label, which is worse than the empty round the
     * stricter derivation was trying to avoid.
     */
    const preseason = aBootstrap({
      season: '2026-27',
      seasons: [LATER, EARLIER],
      teams: TEAMS,
      events: [anEvent({ id: 1, finished: false }), anEvent({ id: 2, finished: false })],
    });
    renderFixtures(preseason);

    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(1, '2026-27'));
    expect(screen.getByRole('button', { name: 'GW1 Results' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /GW\? /})).not.toBeInTheDocument();
  });

  it('keeps the tab choice across a season change', async () => {
    const user = userEvent.setup();
    const { rerender } = renderFixtures(completedSeason(LATER));
    await screen.findByText(`Fixtures · ${LATER}`);

    await user.click(screen.getByRole('button', { name: 'GW38 Results' }));
    await screen.findByText(/Gameweek 38 results/);

    rerender(
      <BootstrapContext.Provider value={completedSeason(EARLIER)}>
        <Fixtures />
      </BootstrapContext.Provider>
    );

    // Upcoming-vs-Results is a choice about the page, not about the season, so
    // it survives — unlike the fixtures themselves.
    await screen.findByText(`Fixtures · ${EARLIER}`);
    expect(screen.getByText(/Gameweek 38 results/)).toBeInTheDocument();
  });
});

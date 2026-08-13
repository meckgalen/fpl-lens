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

describe('where the page opens', () => {
  it('opens a completed season on its last round, showing Results', async () => {
    // Every deadline is null on a CSV season, so the rule falls to its second
    // branch: the last FINISHED round. Safe there and only there — that branch
    // is reachable only when no deadline exists, so every round is wholly
    // played or wholly not and `bool_and` cannot mislead.
    renderFixtures(completedSeason(LATER));

    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(38, LATER));
    // The tab is half the rule, and the half most likely to go untested.
    expect(screen.getByRole('button', { name: 'Results' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(await screen.findByText(/Gameweek 38 results/)).toBeInTheDocument();
  });

  it('opens a pre-season on its first round, showing Difficulty', async () => {
    /*
     * 2026-27: 38 rounds, no deadline passed, nothing finished. The third
     * branch. Found in the browser originally as a different bug — with no
     * round current and none finished the derived round was undefined, the
     * effect returned early, and the previous tab's fixtures stayed mounted
     * under a "Gameweek ?" heading.
     */
    const preseason = aBootstrap({
      season: '2026-27',
      seasons: [LATER, EARLIER],
      teams: TEAMS,
      events: [anEvent({ id: 1, finished: false }), anEvent({ id: 2, finished: false })],
    });
    renderFixtures(preseason);

    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(1, '2026-27'));
    expect(screen.getByRole('button', { name: 'Difficulty' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps the view choice across a season change', async () => {
    const user = userEvent.setup();
    const { rerender } = renderFixtures(completedSeason(LATER));
    await screen.findByText(`Fixtures · ${LATER}`);

    await user.click(screen.getByRole('button', { name: 'Difficulty' }));
    await screen.findByText(/difficulty ratings shown per team/);

    rerender(
      <BootstrapContext.Provider value={completedSeason(EARLIER)}>
        <Fixtures />
      </BootstrapContext.Provider>
    );

    // Which view is a choice about the page, not about the season, so it
    // survives — unlike the fixtures themselves.
    await screen.findByText(`Fixtures · ${EARLIER}`);
    expect(screen.getByText(/difficulty ratings shown per team/)).toBeInTheDocument();
  });
});

/**
 * The fixtures a player has left to play.
 *
 * `PlayerDetailData.fixtures` has been served since step 6 and rendered
 * nowhere, for a reason that was correct at the time: over a completed season
 * it is always empty, and every season in the database was completed. Item 4
 * ingested a season that has not started, so it is non-empty for the first
 * time.
 *
 * Both directions are pinned. The one that will still matter in a year is the
 * empty one: ten historical seasons must keep rendering exactly as they did,
 * with no heading for a list with nothing in it.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import PlayerDetail from './PlayerDetail';
import { renderInApp } from '../test/render';
import {
  aBootstrap,
  aCareerSeason,
  aPlayer,
  aPlayerDetail,
  aPlayerFixture,
  aTeam,
  anIdentity,
} from '../test/factories';
import { fetchPlayerCareer, fetchPlayerDetail } from '../services/api';

vi.mock('../services/api', () => ({
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchBootstrap: vi.fn(),
  fetchFixtures: vi.fn(),
}));

const detailMock = vi.mocked(fetchPlayerDetail);
const careerMock = vi.mocked(fetchPlayerCareer);

const SEASON = '2026-27';
const SAKA = aPlayer({ id: 223340, web_name: 'Saka' });

const TEAMS = [
  aTeam(),
  aTeam({ id: 43, name: 'Man City', short_name: 'MCI' }),
  aTeam({ id: 88, name: 'Hull City', short_name: 'HUL' }),
];

/** Six, so the cap at five is visible rather than incidental. */
const SIX_FIXTURES = [
  aPlayerFixture({ event: 1, is_home: true, team_h: 3, team_a: 43, difficulty: 4 }),
  aPlayerFixture({ event: 2, is_home: false, team_h: 88, team_a: 3, difficulty: 2 }),
  aPlayerFixture({ event: 3, is_home: true, team_h: 3, team_a: 88, difficulty: 2 }),
  aPlayerFixture({ event: 4, is_home: false, team_h: 43, team_a: 3, difficulty: 5 }),
  aPlayerFixture({ event: 5, is_home: true, team_h: 3, team_a: 43, difficulty: 4 }),
  aPlayerFixture({ event: 6, is_home: false, team_h: 88, team_a: 3, difficulty: 2 }),
];

function renderDetail(fixtures: typeof SIX_FIXTURES) {
  detailMock.mockResolvedValue(
    aPlayerDetail({ season: SEASON, history: [], fixtures, teams: TEAMS })
  );
  careerMock.mockResolvedValue({
    player: anIdentity(),
    seasons: [aCareerSeason({ season: SEASON, matches: 0, appearances: 0 })],
  });
  return renderInApp(
    <PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />,
    aBootstrap({ season: SEASON, players: [SAKA], teams: TEAMS })
  );
}

/**
 * One fixture chip, found by its round.
 *
 * Scoped rather than queried across the page: three of the six fixtures are
 * against the same club, so a bare `getByText(/MCI/)` matches several chips and
 * proves nothing about which one it found.
 */
const chip = (gw: string) => screen.getByText(gw).parentElement as HTMLElement;

describe('the upcoming fixtures strip', () => {
  it('shows the next five, naming the opponent and the side', async () => {
    renderDetail(SIX_FIXTURES);
    await screen.findByText('Upcoming');

    // Home to Man City: the player's club is team_h, so the opponent is team_a.
    expect(within(chip('GW1')).getByText(/MCI/)).toBeInTheDocument();
    expect(within(chip('GW1')).getByText(/\(H\)/)).toBeInTheDocument();

    // Away at Hull: the player's club is team_a, so the opponent is team_h —
    // and reading that off the wrong side is the mistake worth pinning, because
    // it produces a plausible club name rather than an error.
    expect(within(chip('GW2')).getByText(/HUL/)).toBeInTheDocument();
    expect(within(chip('GW2')).getByText(/\(A\)/)).toBeInTheDocument();

    // Five of six: the sixth round must not be drawn.
    expect(screen.getByText('GW5')).toBeInTheDocument();
    expect(screen.queryByText('GW6')).not.toBeInTheDocument();
  });

  it('says how many are left to play, not just how many it drew', async () => {
    renderDetail(SIX_FIXTURES);
    expect(await screen.findByText('next 5 of 6 left to play')).toBeInTheDocument();
  });

  it('renders nothing at all for a completed season', async () => {
    // Ten seasons in this database have no fixtures left. They looked like this
    // before item 4 and have to keep looking like it: no heading, no empty box.
    renderDetail([]);

    await screen.findByText('This Season');
    expect(screen.queryByText('Upcoming')).not.toBeInTheDocument();
  });

  it('shows each fixture’s own difficulty rating', async () => {
    renderDetail(SIX_FIXTURES);
    await screen.findByText('Upcoming');

    // Per fixture, not one rating for the run: 4 against City, 2 at Hull.
    expect(within(chip('GW1')).getByText('4')).toBeInTheDocument();
    expect(within(chip('GW2')).getByText('2')).toBeInTheDocument();
  });
});

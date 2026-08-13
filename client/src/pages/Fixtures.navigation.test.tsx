/**
 * Gameweek navigation, the Results empty state, and the difficulty restack.
 *
 * Before item 18 exactly one round was reachable: the two tabs each derived a
 * round of their own and there was no control to change either. The three
 * things worth pinning about the replacement:
 *
 *   1. **The round list is the season's own.** Every option and every step comes
 *      from `bootstrap.events`, which `listEvents` derives from `fixtures.gw` —
 *      never a `1..38` loop. Asserted on 2019-20, where the two differ.
 *   2. **Results says why it is empty.** A round nobody has played gets a
 *      sentence, not ten rows of `– – –`.
 *   3. **A difficulty row is not a scoreline.** The old layout put two numbers
 *      either side of a centre, exactly like the results row one tab away.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fixtures from './Fixtures';
import { fetchFixtures } from '../services/api';
import { BootstrapContext } from '../lib/bootstrap';
import type { BootstrapData, Fixture } from '../types/fpl';
import { aBootstrap, aTeam, anEvent, availability } from '../test/factories';

vi.mock('../services/api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchFixtures: vi.fn(),
}));

const fixturesMock = vi.mocked(fetchFixtures);
const TEAMS = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

const aFixture = (o: Partial<Fixture> = {}): Fixture => ({
  id: 1,
  code: null,
  event: 1,
  team_h: 3,
  team_a: 43,
  team_h_score: 2,
  team_a_score: 1,
  team_h_difficulty: 2,
  team_a_difficulty: 5,
  kickoff_time: '2026-05-24T15:00:00Z',
  finished: true,
  ...o,
});

/** 2019-20: 1-29, then 39-47. The nine rounds between were emptied by Covid. */
const COVID = [...Array.from({ length: 29 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => i + 39)];

const covidSeason = (): BootstrapData =>
  aBootstrap({
    season: '2019-20',
    seasons: ['2019-20'],
    teams: TEAMS,
    events: COVID.map((id) => anEvent({ id, name: `Gameweek ${id}`, deadline_time: null, finished: true })),
  });

const renderAt = (bootstrap: BootstrapData) =>
  render(
    <BootstrapContext.Provider value={bootstrap}>
      <Fixtures />
    </BootstrapContext.Provider>
  );

beforeEach(() => {
  fixturesMock.mockResolvedValue({ season: '2019-20', fixtures: [aFixture()] });
});

const roundSelect = () => screen.getByLabelText('Gameweek');

describe('gameweek navigation', () => {
  it('offers the season’s own rounds, gaps included', async () => {
    renderAt(covidSeason());
    await waitFor(() => expect(fixturesMock).toHaveBeenCalled());

    const options = within(roundSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(38);
    // The two that a 1..38 loop gets wrong, in both directions.
    expect(options).toContain('Gameweek 47');
    expect(options).not.toContain('Gameweek 30');
  });

  it('steps across the Covid gap rather than by one', async () => {
    const user = userEvent.setup();
    renderAt(covidSeason());
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(47, '2019-20'));

    // Opens on 47 — the last round, which is NOT the round count (38).
    await user.selectOptions(roundSelect(), '29');
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(29, '2019-20'));

    await user.click(screen.getByRole('button', { name: 'Next gameweek' }));

    // 39, not 30. `round + 1` would ask for a round nobody played.
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(39, '2019-20'));
    expect(fixturesMock).not.toHaveBeenCalledWith(30, '2019-20');
  });

  it('stops at both ends of the season', async () => {
    const user = userEvent.setup();
    renderAt(covidSeason());
    await waitFor(() => expect(fixturesMock).toHaveBeenCalled());

    // Opens on the last round, so forward is already spent.
    expect(screen.getByRole('button', { name: 'Next gameweek' })).toBeDisabled();

    await user.selectOptions(roundSelect(), '1');
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(1, '2019-20'));
    expect(screen.getByRole('button', { name: 'Previous gameweek' })).toBeDisabled();
  });

  it('never asks for a round the new season does not have', async () => {
    // Leaving 2019-20 parked on round 47 for a 38-round season. With the round
    // in state and the re-seed in an effect, there is a render holding the new
    // season with the old round, and the fetch fires for a round that does not
    // exist. The re-seed happens during render precisely so it cannot.
    const { rerender } = renderAt(covidSeason());
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(47, '2019-20'));

    const thirtyEight = aBootstrap({
      season: '2022-23',
      seasons: ['2022-23'],
      teams: TEAMS,
      events: Array.from({ length: 38 }, (_, i) =>
        anEvent({ id: i + 1, name: `Gameweek ${i + 1}`, deadline_time: null, finished: true })
      ),
    });
    rerender(
      <BootstrapContext.Provider value={thirtyEight}>
        <Fixtures />
      </BootstrapContext.Provider>
    );

    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(38, '2022-23'));
    expect(fixturesMock).not.toHaveBeenCalledWith(47, '2022-23');
  });
});

describe('the Results view with nothing played', () => {
  it('uses the season sentence when the whole season is unmeasured', async () => {
    const user = userEvent.setup();
    fixturesMock.mockResolvedValue({
      season: '2026-27',
      fixtures: [aFixture({ finished: false, team_h_score: null, team_a_score: null })],
    });
    renderAt(
      aBootstrap({
        season: '2026-27',
        seasons: ['2026-27'],
        teams: TEAMS,
        // The whole season has no match rows, which is what `measured: false`
        // means and what the picker's sentence is about.
        columns: availability({}, { season: '2026-27', measured: false }),
        events: [anEvent({ id: 1, deadline_time: '2026-08-21T18:30:00Z', finished: false })],
      })
    );
    await waitFor(() => expect(fixturesMock).toHaveBeenCalledWith(1, '2026-27'));

    await user.click(screen.getByRole('button', { name: 'Results' }));

    // The column picker's own words, from the one module they live in.
    expect(await screen.findByText('No matches recorded for 2026-27 yet.')).toBeInTheDocument();
    // And not a row of dashes pretending to be a result.
    expect(screen.queryByText(/– – –/)).not.toBeInTheDocument();
  });

  it('uses the round sentence when the season has been played and this round has not', async () => {
    const user = userEvent.setup();
    fixturesMock.mockResolvedValue({
      season: '2026-27',
      fixtures: [aFixture({ event: 12, finished: false, team_h_score: null, team_a_score: null })],
    });
    renderAt(
      aBootstrap({
        season: '2026-27',
        seasons: ['2026-27'],
        teams: TEAMS,
        // Measured: the season HAS matches, so the season sentence would be
        // false here. Reachable the moment GW1 of 2026-27 is ingested.
        columns: availability({}, { season: '2026-27', measured: true }),
        events: [
          anEvent({ id: 11, deadline_time: '2026-11-01T12:00:00Z', finished: true }),
          anEvent({ id: 12, deadline_time: '2099-01-01T12:00:00Z', finished: false }),
        ],
      })
    );
    await waitFor(() => expect(fixturesMock).toHaveBeenCalled());

    await user.selectOptions(roundSelect(), '12');
    await user.click(screen.getByRole('button', { name: 'Results' }));

    expect(
      await screen.findByText('Gameweek 12 of 2026-27 has not been played yet.')
    ).toBeInTheDocument();
    expect(screen.queryByText('No matches recorded for 2026-27 yet.')).not.toBeInTheDocument();
  });
});

describe('the difficulty row', () => {
  it('stacks each rating under its own club, with no number beside a number', async () => {
    renderAt(covidSeason());
    await waitFor(() => expect(fixturesMock).toHaveBeenCalled());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Difficulty' }));

    /*
     * Anchored on the CLUB, not on the rating: the FDR legend below the card
     * renders a chip for every rating 1-5, so `getByText('2')` matches two
     * nodes. The legend has no club names, which makes the club the thing that
     * identifies a row.
     */
    // `.parentElement`, not `.closest('div')`: the club name has a div of its
    // own, and the block that also holds the bar is one level up.
    const home = (await screen.findByText('ARS')).parentElement as HTMLElement;
    const away = screen.getByText('MCI').parentElement as HTMLElement;

    // Each rating lives in the same block as its own club — which is what
    // "attached to one side" means structurally, and what the old row, with
    // both numbers adjacent in the middle, did not do.
    expect(within(home).getByText('2')).toBeInTheDocument();
    expect(within(home).queryByText('5')).not.toBeInTheDocument();
    expect(within(away).getByText('5')).toBeInTheDocument();
    expect(within(away).queryByText('2')).not.toBeInTheDocument();

    // The middle carries the kickoff time, not a second number. The old centre
    // sat between two adjacent ratings and read as a scoreline separator.
    expect(screen.getByText(/^\d{1,2}[:.]\d{2}/)).toBeInTheDocument();
  });

  it('renders a rated round without ever showing a made-up 3', async () => {
    // 2016-17 and 2017-18 have no fixtures.csv upstream and so no ratings. The
    // bar shows the no-value marker rather than inventing "medium".
    fixturesMock.mockResolvedValue({
      season: '2019-20',
      fixtures: [aFixture({ team_h_difficulty: null, team_a_difficulty: null })],
    });
    renderAt(covidSeason());
    await waitFor(() => expect(fixturesMock).toHaveBeenCalled());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Difficulty' }));

    const home = (await screen.findByText('ARS')).parentElement as HTMLElement;
    expect(within(home).queryByText('3')).not.toBeInTheDocument();
  });
});

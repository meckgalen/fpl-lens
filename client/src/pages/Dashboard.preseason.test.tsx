/**
 * What the Dashboard says before a ball is kicked.
 *
 * Item 4 ingested a season with a roster, a schedule and no matches, and made
 * it the app's default. Without this the three rankings would sort a list of
 * zeroes and present the result as a ranking: six players tied on nothing in
 * whatever order the array arrived, an empty points-per-match list because
 * nobody clears the appearance floor, and seven more zeroes under ICT.
 *
 * **The assertion that matters most here is the negative one.** The message has
 * to state the data — "no matches recorded" — and must not promise Gameweek 1,
 * because there is a window where that promise is false: GW1 is played on 21
 * August, the incremental gameweek sync is a later item, and in between every
 * player has zero appearances while Gameweek 1 is over. A test that only
 * checked "some empty state appears" would stay green through exactly that
 * wording.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from './Dashboard';
import { BootstrapContext } from '../lib/bootstrap';
import { aBootstrap, aPlayer, aTeam, anEvent } from '../test/factories';

const SEASON = '2026-27';

/**
 * A pre-season roster: real players, real prices, nothing played.
 *
 * Every stat is zeroed the way the API returns them for a season with no
 * `player_gameweeks` rows — COALESCE'd to 0, not null, because "nobody has
 * scored yet" is a measurement and rule 6's null is not.
 */
const preSeasonPlayer = (id: number, name: string) =>
  aPlayer({
    id,
    web_name: name,
    total_points: 0,
    minutes: 0,
    goals_scored: 0,
    assists: 0,
    bonus: 0,
    bps: 0,
    ict_index: 0,
    influence: 0,
    creativity: 0,
    threat: 0,
    starts: 0,
    expected_goals: 0,
    expected_assists: 0,
    expected_goal_involvements: 0,
    appearances: 0,
    points_per_game: 0,
  });

const preSeason = aBootstrap({
  season: SEASON,
  players: [preSeasonPlayer(1, 'Alpha'), preSeasonPlayer(2, 'Bravo'), preSeasonPlayer(3, 'Charlie')],
  teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
  events: [
    anEvent({ id: 1, finished: false, is_next: true, deadline_time: '2026-08-21T17:30:00Z' }),
    anEvent({ id: 2, finished: false }),
  ],
});

/** The same squad, one match into the season. */
const underway = aBootstrap({
  ...preSeason,
  players: [
    preSeasonPlayer(1, 'Alpha'),
    { ...preSeasonPlayer(2, 'Bravo'), appearances: 1, total_points: 6, ict_index: 7.4 },
    preSeasonPlayer(3, 'Charlie'),
  ],
});

const renderDashboard = (bootstrap: typeof preSeason) =>
  render(
    <BootstrapContext.Provider value={bootstrap}>
      <Dashboard onOpenDetail={() => {}} />
    </BootstrapContext.Provider>
  );

describe('Dashboard before the season starts', () => {
  it('says so on all three rankings, once each', () => {
    renderDashboard(preSeason);
    expect(screen.getAllByText(`No matches recorded for ${SEASON} yet.`)).toHaveLength(3);
  });

  it('does not promise Gameweek 1, because the gate is about data and not the date', () => {
    // The window this guards: after GW1 is played and before it is ingested,
    // every player still has zero appearances. "Rankings start after Gameweek 1"
    // would then be telling people to wait for something that has happened.
    renderDashboard(preSeason);
    expect(screen.queryByText(/start(s)? after Gameweek/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/once the season is underway/i)).not.toBeInTheDocument();
  });

  it('ranks nobody rather than ranking a table of zeroes', () => {
    renderDashboard(preSeason);
    // Every player is in the payload; none is presented as leading anything.
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('gets out of the way as soon as one match has been recorded', () => {
    // One appearance among three players is enough: the gate is "has anything
    // been played", not "has enough been played to rank well".
    renderDashboard(underway);
    expect(screen.queryByText(/No matches recorded/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Bravo' }).length).toBeGreaterThan(0);
  });

  it('still counts down to the first deadline', () => {
    // The rankings are empty; the season is not. The deadline is the one thing
    // a pre-season Dashboard genuinely has to say.
    renderDashboard(preSeason);
    expect(screen.getByText(/Until GW1 Deadline/)).toBeInTheDocument();
  });
});

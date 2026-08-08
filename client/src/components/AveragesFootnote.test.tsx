/**
 * The footnote, through `StatsTable` — which is where the three cases live.
 *
 * `AveragesNote` renders what it is handed and nothing else, so the interesting
 * logic is the caller's: which numbers to hand it, and whether to render it at all.
 * The unit tests for the note itself are in `TableSurface.test.tsx`.
 *
 * **Every assertion here is on the rendered sentence, never on the element's
 * presence.** The empty-range case fails as
 * "Averages over Infinity appearances in 38 fixtures", which a presence check passes
 * cleanly — so a test that only asked whether a footnote appeared would be green on
 * the one defect this file exists to catch.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsTable from './StatsTable';
import { aGameweek, aTeam } from '../test/factories';

const TEAMS = [aTeam(), aTeam({ id: 43, short_name: 'MCI' })];

const played = (fixture: number, over = {}) =>
  aGameweek({ fixture, round: fixture, minutes: 90, ...over });
const benched = (fixture: number, over = {}) =>
  aGameweek({ fixture, round: fixture, minutes: 0, total_points: 0, ...over });

const footnote = () => screen.queryByText(/^Averages over/);

describe('the denominators agree', () => {
  it('collapses to one number when every row was played', () => {
    render(<StatsTable history={[played(1), played(2), played(3)]} teams={TEAMS} />);
    expect(screen.getByText('Averages over 3 appearances in 3 fixtures')).toBeInTheDocument();
  });

  /**
   * The availability signal the old denominator carried, now stated instead of
   * silently blended into every average. This is Tarkowski's shape: he played 37 of
   * 38, and the difference between 4.5 and 4.6 was exactly that missing fixture.
   */
  it('states appearances and fixtures separately when a fixture was missed', () => {
    render(<StatsTable history={[played(1), played(2), benched(3)]} teams={TEAMS} />);
    expect(screen.getByText('Averages over 2 appearances in 3 fixtures')).toBeInTheDocument();
  });

  /**
   * A column nobody measured has denominator 0 and renders `—`, so it must NOT enter
   * the range. Every one of the ten seasons has such a column — the defensive trio,
   * or the expected family before 2022-23 — so letting them in would put a floor of
   * 0 on all ten and make every season look divergent.
   */
  it('ignores a wholly unmeasured column rather than ranging down to zero', () => {
    render(
      <StatsTable
        history={[played(1, { tackles: null }), played(2, { tackles: null })]}
        teams={TEAMS}
      />
    );
    expect(screen.getByText('Averages over 2 appearances in 2 fixtures')).toBeInTheDocument();
  });
});

describe('the denominators diverge', () => {
  /**
   * 2022-23's shape and nowhere else's: the expected family is NULL before round 16
   * (item 7), so within one player-season the columns rest on different numbers of
   * appearances. Three played rows, one of which never measured xG.
   */
  it('states a range', () => {
    render(
      <StatsTable
        history={[played(1, { expected_goals: null }), played(2), played(3)]}
        teams={TEAMS}
      />
    );
    expect(screen.getByText('Averages over 2–3 appearances in 3 fixtures')).toBeInTheDocument();
  });

  it('carries the per-column detail in the title', () => {
    render(
      <StatsTable
        history={[played(1, { expected_goals: null }), played(2), played(3)]}
        teams={TEAMS}
      />
    );
    const title = footnote()!.getAttribute('title') ?? '';
    expect(title).toContain('xG: 2');
    expect(title).toContain('Pts: 3');
  });

  it('carries no title when they agree, so there is nothing to hover for', () => {
    render(<StatsTable history={[played(1), played(2)]} teams={TEAMS} />);
    expect(footnote()).not.toHaveAttribute('title');
  });
});

describe('the two edge cases the caller owns', () => {
  /**
   * **The empty-range case.** Rows are shown, none was played, so no column renders a
   * number and nothing enters the range — `Math.min()` of an empty array is
   * `Infinity`. Reachable two ways, both the same code path: a player who never
   * played, or a filter window he missed entirely.
   *
   * Asserted as the exact sentence. "Averages over Infinity appearances in 3
   * fixtures" contains "Averages over" and would satisfy any looser check.
   */
  it('says zero appearances rather than Infinity when nothing was played', () => {
    render(<StatsTable history={[benched(1), benched(2), benched(3)]} teams={TEAMS} />);

    expect(screen.getByText('Averages over 0 appearances in 3 fixtures')).toBeInTheDocument();
    expect(footnote()!.textContent).not.toMatch(/Infinity|NaN|-?\d+e/);
  });

  /**
   * No rows at all — the filters excluded everything. There is no denominator to
   * state, and `GameweekSection` prints "None of X's N matches match the selected
   * filters." directly beneath, which says the useful thing. Before item 11 this
   * read "Averages over 0 fixtures".
   */
  it('renders no footnote at all when no rows are shown', () => {
    render(<StatsTable history={[]} teams={TEAMS} />);
    expect(footnote()).not.toBeInTheDocument();
  });
});

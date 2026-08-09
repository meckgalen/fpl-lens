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

/** The second line, which renders only where the denominators diverge. */
const secondLine = () => screen.queryByText(/^(?!Averages over).* over \d/);

describe('the denominators agree', () => {
  it('collapses to one number when every row was played', () => {
    render(<StatsTable history={[played(1), played(2), played(3)]} teams={TEAMS} />);
    expect(screen.getByText('Averages over 3 appearances in 3 fixtures.')).toBeInTheDocument();
    // And nothing else: a group line here would be naming a divergence that does
    // not exist, which is the failure mode the whole two-line form introduces.
    expect(secondLine()).not.toBeInTheDocument();
  });

  /**
   * The availability signal the old denominator carried, now stated instead of
   * silently blended into every average. This is Tarkowski's shape: he played 37 of
   * 38, and the difference between 4.5 and 4.6 was exactly that missing fixture.
   */
  it('states appearances and fixtures separately when a fixture was missed', () => {
    render(<StatsTable history={[played(1), played(2), benched(3)]} teams={TEAMS} />);
    expect(screen.getByText('Averages over 2 appearances in 3 fixtures.')).toBeInTheDocument();
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
    expect(screen.getByText('Averages over 2 appearances in 2 fixtures.')).toBeInTheDocument();
    expect(secondLine()).not.toBeInTheDocument();
  });
});

describe('the denominators diverge', () => {
  /** The whole expected family unmeasured on the early rounds — 2022-23's shape. */
  const noExpected = { expected_goals: null, expected_assists: null, expected_goal_involvements: null, expected_goals_conceded: null };

  /**
   * 2022-23's shape and nowhere else's, in miniature: the expected family is NULL
   * before round 16 (item 7), so within one player-season the columns rest on
   * different numbers of appearances.
   *
   * **This is the case item 11's range could not express.** It printed "Averages
   * over 2–3 appearances in 3 fixtures", which is true and says nothing: 2 has no
   * owner and the gap has no cause. Both are named now.
   */
  it('names the group and where it starts, on a second line', () => {
    render(
      <StatsTable
        history={[played(1, noExpected), played(2), played(3)]}
        teams={TEAMS}
      />
    );

    expect(screen.getByText('Averages over 3 appearances in 3 fixtures.')).toBeInTheDocument();
    expect(screen.getByText('Expected stats over 2, not measured before GW2.')).toBeInTheDocument();

    // The range is gone, not merely supplemented.
    expect(screen.queryByText(/2–3/)).not.toBeInTheDocument();
  });

  /**
   * **The exactness check**, and the reason the group name is not simply "whatever
   * group these columns are in".
   *
   * Only xG is unmeasured here, so the divergent set is a strict subset of the
   * expected family — the other three still rest on 3 appearances. Calling that
   * "Expected stats over 2" would be false about xA, xGI and xGC, which are on
   * screen beside it disagreeing. This is 2022-23 round 29 in miniature, where
   * `expected_goal_involvements` alone is holed.
   */
  it('lists the columns instead when they are only part of a group', () => {
    render(
      <StatsTable
        history={[played(1, { expected_goals: null }), played(2), played(3)]}
        teams={TEAMS}
      />
    );

    expect(screen.getByText('xG over 2, not measured before GW2.')).toBeInTheDocument();
    expect(screen.queryByText(/Expected stats/)).not.toBeInTheDocument();
  });

  /**
   * **The threshold is a claim about the SEASON, so it is read off the unfiltered
   * rows.** This is the assertion the item's brief asked for, and it has to use the
   * venue filter rather than a GW range: a contiguous range that shows both
   * measured and unmeasured rows necessarily contains the boundary round, so it
   * cannot produce the wrong answer. A venue filter is not contiguous in rounds and
   * can.
   *
   * Here the expected family starts at round 2, and round 2 is AWAY. Filter to home
   * fixtures and the first measured row on screen is round 3 — so a threshold taken
   * from the visible rows would print "before GW3" and say it about the season.
   */
  it('reports the season’s threshold, not the first measured row on screen', () => {
    const season = [
      played(1, { ...noExpected, was_home: true }),
      played(2, { was_home: false }),
      played(3, { was_home: true }),
    ];
    // Home only. Round 2 — where the measurement actually begins — is filtered out.
    const shown = season.filter((gw) => gw.was_home);

    render(<StatsTable history={shown} seasonHistory={season} teams={TEAMS} />);

    expect(screen.getByText(/not measured before GW2\./)).toBeInTheDocument();
    expect(screen.queryByText(/before GW3/)).not.toBeInTheDocument();
  });

  /**
   * **Haaland 2022-23's actual shape, which is the season this sentence exists
   * for** — and it is not the clean prefix it looks like.
   *
   * All four columns are NULL for rounds 1-15. Then `expected_goal_involvements`
   * alone is NULL again at round 29, because item 7 holed that one fixture on that
   * one column and he has a 0-minute row in it. So there is an unmeasured cell
   * ABOVE the boundary, and a threshold that required every column to be measured
   * on a row would call round 29 unmeasured, fail the prefix test, and drop the
   * clause from the one season it was written to describe.
   *
   * Found in the browser, not here — the smaller fixtures above all happen to be
   * clean prefixes, and every one of them passes either way.
   *
   * The claim is about what is measured BEFORE the boundary, so a row counts as
   * measured when any of the group does.
   */
  it('reports the boundary even when one column is holed again later', () => {
    render(
      <StatsTable
        history={[
          played(1, noExpected),
          played(2),
          played(3),
          // Round 4: the round-29 shape. Nothing on the pitch, xGI alone unmeasured.
          benched(4, { expected_goal_involvements: null }),
        ]}
        teams={TEAMS}
      />
    );

    expect(screen.getByText(/not measured before GW2\./)).toBeInTheDocument();
  });

  /**
   * A gap that is not a prefix has no "before". The clause is dropped and the rest
   * of the sentence — which is still true — is kept.
   */
  it('drops the clause when the unmeasured rounds are not a prefix', () => {
    render(
      <StatsTable
        history={[played(1), played(2, noExpected), played(3)]}
        teams={TEAMS}
      />
    );

    expect(screen.getByText('Expected stats over 2.')).toBeInTheDocument();
    expect(screen.queryByText(/not measured before/)).not.toBeInTheDocument();
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

    expect(screen.getByText('Averages over 0 appearances in 3 fixtures.')).toBeInTheDocument();
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

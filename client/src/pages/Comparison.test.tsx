/**
 * The comparison page's fetching and state — item 16 step 4, session 1.
 *
 * There is no chart yet, so nothing here asserts geometry. What it pins is the
 * part a chart cannot be built on top of if it is wrong:
 *
 *   1. **The loading state is real.** Serving the thresholds rather than
 *      compiling them in means the page has no axis configuration until they
 *      land. That cost is recorded in item 16 step 2 as accepted and not
 *      optional, so it is pinned here rather than left to be noticed.
 *   2. **A trace is a (player, season) pair.** The season is half the identity,
 *      so a trace added on one season survives a season change and is still
 *      asked for under its own season. A player-keyed implementation passes
 *      every other test in this file and fails these two.
 *   3. **An unavailable axis is dropped, never holed.** Two seasons on one chart
 *      draw the axes both can answer.
 *
 * The provider is supplied by hand and swapped with `rerender`, as
 * `Fixtures.test.tsx` does: the page reads its season from context, so a new
 * context value is a season change as far as it is concerned.
 */

import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Comparison from './Comparison';
import { fetchComparison, fetchComparisonThresholds } from '../services/api';
import { BootstrapContext } from '../lib/bootstrap';
import type { BootstrapData, ComparisonData } from '../types/fpl';
import { aBootstrap, aComparison, aPlayer, aTeam, comparisonThresholds } from '../test/factories';

vi.mock('../services/api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchFixtures: vi.fn(),
  fetchColumnHistory: vi.fn(),
  fetchComparison: vi.fn(),
  fetchComparisonThresholds: vi.fn(),
}));

const thresholdsMock = vi.mocked(fetchComparisonThresholds);
const comparisonMock = vi.mocked(fetchComparison);

const LATER = '2025-26';
const EARLIER = '2016-17';

const GABRIEL = aPlayer({
  id: 226597,
  first_name: 'Gabriel',
  second_name: 'Magalhães',
  web_name: 'Gabriel',
  element_type: 2,
  team: 3,
  total_points: 209,
});

const GUEHI = aPlayer({
  id: 209036,
  first_name: 'Marc',
  second_name: 'Guéhi',
  web_name: 'Guéhi',
  element_type: 2,
  team: 43,
  total_points: 179,
});

/** A midfielder, so the position tabs have something to change to. */
const SAKA = aPlayer({ element_type: 3 });

function season(name: string): BootstrapData {
  return aBootstrap({
    season: name,
    seasons: [LATER, EARLIER],
    teams: [aTeam(), aTeam({ id: 43, name: 'Crystal Palace', short_name: 'CRY' })],
    players: [GABRIEL, GUEHI, SAKA],
  });
}

/**
 * StrictMode, as `main.tsx` mounts it and as `renderInApp` insists on — written
 * out here rather than reused, because these tests swap the provider's value
 * with `rerender` and so need the tree by hand.
 *
 * It is not ceremony on this page: the effect below fires network requests, and
 * StrictMode's double invocation is the one thing that catches a fetch fired
 * from somewhere it should not be. Every call-count assertion in this file is
 * written knowing each effect runs twice.
 */
const tree = (bootstrap: BootstrapData) => (
  <StrictMode>
    <BootstrapContext.Provider value={bootstrap}>
      <Comparison />
    </BootstrapContext.Provider>
  </StrictMode>
);

function renderPage(bootstrap: BootstrapData = season(LATER)) {
  return render(tree(bootstrap));
}

/**
 * A candidate row in the picker, by the name it announces — `Add Gabriel`.
 *
 * Queried by the exact label rather than by a substring of the row's text: the
 * chip's remove control is `Remove Gabriel 2025-26`, so a bare /Gabriel/ matches
 * both and every "no longer offered" assertion would pass on the wrong node.
 */
const candidate = (name: string) => screen.findByRole('button', { name: `Add ${name}` });
const noCandidate = (name: string) => screen.queryByRole('button', { name: `Add ${name}` });

function rerenderAt(rerender: (ui: React.ReactElement) => void, name: string) {
  rerender(tree(season(name)));
}

beforeEach(() => {
  thresholdsMock.mockResolvedValue(comparisonThresholds());
  comparisonMock.mockImplementation(async (s, position, codes): Promise<ComparisonData> => {
    // 2016-17 predates both the expected family and defensive contribution, so
    // it answers eight of the ten defender axes — which is the real shape and
    // the one the axis intersection has to survive.
    const axes = s === EARLIER
      ? aComparison().axes.filter(
          (a) => a !== 'expected_goal_involvements' && a !== 'defcon_hits_per_start'
        )
      : undefined;
    const base = aComparison({ season: s, position, ...(axes ? { axes } : {}) });
    return {
      ...base,
      players: codes.map((code) => ({
        id: code,
        web_name: code === GABRIEL.id ? 'Gabriel' : 'Guéhi',
        values: Object.fromEntries(base.axes.map((a, i) => [a, 100 + i])),
      })),
    };
  });
});

describe('the loading state', () => {
  it('draws no axes until the thresholds land', async () => {
    // Held open, so the window is observable rather than a race. NOT
    // `mockImplementationOnce`: StrictMode invokes the effect twice, so a
    // one-shot mock answers the first call and resolves the second, and the
    // loading state this test exists for never renders.
    thresholdsMock.mockImplementation(() => new Promise(() => {}));
    renderPage();

    // The accepted cost of serving the thresholds, stated as a test: the client
    // has no floors and no ceilings yet, so there is nothing to draw an axis on.
    expect(await screen.findByText('Loading axis scales…')).toBeInTheDocument();
    expect(screen.queryByText('Pts/£')).not.toBeInTheDocument();
  });

  it('waits for the selected season even once the scales are in', async () => {
    comparisonMock.mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(await screen.findByText(`Loading ${LATER}…`)).toBeInTheDocument();
  });

  it('says so rather than showing an empty page when the scales fail', async () => {
    thresholdsMock.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText(/Could not load the axis scales/)).toBeInTheDocument();
  });

  it('asks for the season and position before any player is picked', async () => {
    renderPage();

    // The band alone is a legitimate answer, and is what the page shows first.
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', []));
    expect(await screen.findByText(/median of 109 DEFs past 1,200 minutes/)).toBeInTheDocument();
  });

  it('does not ask for the scales again when the season changes', async () => {
    const { rerender } = renderPage();
    await screen.findByText('Pts/£');
    const onMount = thresholdsMock.mock.calls.length;

    rerenderAt(rerender, EARLIER);
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', []));

    // The thresholds are frozen ACROSS seasons — that is the whole point of
    // them — so the season must not be in this effect's dependencies. The memo
    // in services/api.ts would absorb a second call, which is exactly why the
    // property is pinned here, where the memo is mocked away and cannot hide it.
    expect(thresholdsMock).toHaveBeenCalledTimes(onMount);
  });
});

describe('a trace is a (player, season) pair', () => {
  it('pins a trace to the season it was added on', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await screen.findByText('Pts/£');

    await user.click(await candidate('Gabriel'));
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', [GABRIEL.id]));

    rerenderAt(rerender, EARLIER);

    // The load-bearing assertion. Gabriel was picked on 2025-26 and is still
    // asked for under 2025-26 — a player-keyed trace would be re-requested
    // under 2016-17 here, silently answering a different question with the same
    // name on it. The band's season moves; the trace's does not.
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', []));
    expect(comparisonMock).not.toHaveBeenCalledWith(EARLIER, 'DEF', [GABRIEL.id]);
  });

  it('groups two traces on one season into one request', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Pts/£');

    await user.click(await candidate('Gabriel'));
    await user.click(await candidate('Guéhi'));

    await waitFor(() =>
      expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', [GABRIEL.id, GUEHI.id])
    );
  });

  it('names the season on the chip, because two of them can differ', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await screen.findByText('Pts/£');
    await user.click(await candidate('Gabriel'));

    rerenderAt(rerender, EARLIER);
    await screen.findByText(`Comparison · ${EARLIER}`);

    // API identity rule 7 applied to a control: the label rides on the datum,
    // and here the datum is a trace.
    expect(
      screen.getByRole('button', { name: `Remove Gabriel ${LATER}` })
    ).toBeInTheDocument();
  });

  it('drops the traces when the position changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Pts/£');
    await user.click(await candidate('Gabriel'));
    await screen.findByRole('button', { name: `Remove Gabriel ${LATER}` });

    await user.click(screen.getByRole('button', { name: 'MID' }));

    // The server refuses a player who is not the position asked for — a
    // comparison draws one position's axis set. Keeping them would turn every
    // position change into a 400 nobody asked for.
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(LATER, 'MID', []));
    expect(
      screen.queryByRole('button', { name: `Remove Gabriel ${LATER}` })
    ).not.toBeInTheDocument();
  });
});

describe('the axis set', () => {
  it('drops an axis the SELECTED season cannot answer', async () => {
    const { rerender } = renderPage();
    await screen.findByText('Pts/£');
    // 2025-26 measures everything, so all ten spokes exist.
    expect(screen.getByText('xGI')).toBeInTheDocument();
    expect(screen.getByText('DCH/St')).toBeInTheDocument();

    rerenderAt(rerender, EARLIER);
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', []));

    // 2016-17 predates both, so neither spoke exists. This is the server's rule
    // — absent, never null — arriving unchanged.
    await waitFor(() => expect(screen.queryByText('xGI')).not.toBeInTheDocument());
    expect(screen.queryByText('DCH/St')).not.toBeInTheDocument();
    expect(screen.getByText('Pts/£')).toBeInTheDocument();
  });

  it('drops an axis a TRACE\u2019s season cannot answer, on a season that can', async () => {
    /*
     * The load-bearing direction, and the one an obvious implementation gets
     * wrong. Reading the axis list off the selected season alone passes the test
     * above — 2016-17 is the restrictive season there, so both answers agree —
     * and fails here, where the selected season is the generous one: 2025-26
     * would offer ten spokes and the 2016-17 trace would have a HOLE at xGI and
     * DCH/St, which is exactly what "absent, never null" exists to prevent.
     * Confirmed by mutation: `selected.data.axes` in place of the intersection
     * leaves the test above green and turns this one red.
     */
    const user = userEvent.setup();
    const { rerender } = renderPage(season(EARLIER));
    await screen.findByText('Pts/£');

    await user.click(await candidate('Gabriel'));
    await waitFor(() =>
      expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', [GABRIEL.id])
    );

    rerenderAt(rerender, LATER);
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', []));
    await screen.findByText(`Comparison \u00b7 ${LATER}`);

    // The band is 2025-26's and the trace is 2016-17's, so the spokes are the
    // eight both can answer.
    await waitFor(() => expect(screen.queryByText('xGI')).not.toBeInTheDocument());
    expect(screen.queryByText('DCH/St')).not.toBeInTheDocument();
    expect(screen.getByText('Pts/£')).toBeInTheDocument();
  });

  it('reads its captions off the thresholds, not off a second table', async () => {
    renderPage();

    // `Sv` is the one caption that differs from the Players list's own label for
    // the same column (`S`), which is why the label travels on the threshold.
    await screen.findByText('Pts/£');
    expect(screen.getByText('Min')).toBeInTheDocument();
  });
});

describe('the band', () => {
  it('is suppressed, and says why, when the cohort is too small', async () => {
    comparisonMock.mockImplementation(async (s, position) =>
      aComparison({ season: s, position, cohort: { size: 0, band: null } })
    );
    renderPage(season('2026-27'));

    // 2026-27 has no match rows: the spokes still exist and only the band is
    // missing, which is a live season's ordinary opening state until ~GW14.
    expect(await screen.findByText(/No band · 0 DEFs past 1,200 minutes/)).toBeInTheDocument();
    expect(screen.getByText('Pts/£')).toBeInTheDocument();
  });
});

describe('the picker', () => {
  it('offers only the chosen position, from the selected season', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Pts/£');

    expect(await candidate('Gabriel')).toBeInTheDocument();
    // Saka is a midfielder in this bootstrap.
    expect(noCandidate('Saka')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'MID' }));
    expect(await candidate('Saka')).toBeInTheDocument();
  });

  it('narrows by club', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Pts/£');

    await user.selectOptions(
      screen.getByLabelText('Club'),
      screen.getByRole('option', { name: 'Crystal Palace' })
    );

    expect(await candidate('Guéhi')).toBeInTheDocument();
    expect(noCandidate('Gabriel')).not.toBeInTheDocument();
  });

  it('narrows by name, and drops a player already picked', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Pts/£');

    await user.click(await candidate('Gabriel'));
    // Added, so no longer offered — the same (player, season) pair twice would
    // be two identical traces sharing one key.
    await waitFor(() => expect(noCandidate('Gabriel')).toBeNull());

    await user.type(screen.getByRole('textbox'), 'zzz');
    expect(await screen.findByText(/No DEF matches that search/)).toBeInTheDocument();
  });
});

describe('a season that refuses', () => {
  const REFUSAL = 'Gabriel is a MID in 2016-17, not a DEF.';

  it('marks the trace and keeps the rest of the page', async () => {
    const user = userEvent.setup();
    // The reachable refusal: a player who is a different position in another
    // season. The server rejects rather than drawing him on the wrong axis set.
    comparisonMock.mockImplementation(async (s, position, codes) => {
      if (s === EARLIER && codes.length > 0) throw new Error(REFUSAL);
      return aComparison({ season: s, position });
    });

    const { rerender } = renderPage(season(EARLIER));
    await screen.findByText('Pts/£');
    await user.click(await candidate('Gabriel'));

    // Now the selected season is one that answers, and the trace's is not.
    rerenderAt(rerender, LATER);
    await screen.findByText(`Comparison \u00b7 ${LATER}`);

    // The chip says why it has no values; the axes and the band are still drawn
    // from the selected season, which answered.
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    expect(screen.getByText('Pts/£')).toBeInTheDocument();
  });

  it('says so on the page when it is the SELECTED season that fails', async () => {
    comparisonMock.mockRejectedValue(new Error('the database is down'));
    renderPage();

    // No band and no canonical axis list, so there is nothing to draw. The
    // trace-level wording would leave an empty card with no reason on it.
    expect(
      await screen.findByText(/Could not load 2025-26: the database is down/)
    ).toBeInTheDocument();
  });
});

describe('the trace limit', () => {
  it('stops at four and says so', async () => {
    const user = userEvent.setup();
    const many = aBootstrap({
      season: LATER,
      seasons: [LATER, EARLIER],
      teams: [aTeam()],
      players: Array.from({ length: 6 }, (_, i) =>
        aPlayer({ id: 1000 + i, web_name: `D${i}`, element_type: 2, team: 3 })
      ),
    });
    renderPage(many);
    await screen.findByText('Pts/£');

    for (const n of [0, 1, 2, 3]) {
      await user.click(await candidate(`D${n}`));
    }

    expect(await screen.findByText(/is the limit/)).toBeInTheDocument();
    // Disabled rather than removed, with the reason beside it — item 13's rule
    // for a column a season cannot answer, applied to a control.
    expect(await candidate('D4')).toBeDisabled();
  });
});

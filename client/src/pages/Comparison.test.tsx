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
import {
  aBootstrap,
  aComparison,
  aPlayer,
  aTeam,
  availability,
  comparisonThresholds,
} from '../test/factories';

vi.mock('../services/api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchFixtures: vi.fn(),
  // Held open rather than resolved: the matrix only APPENDS a pointer clause to
  // an absent axis's reason, so the page must be correct without it. A test that
  // resolved it could not tell the two apart.
  fetchColumnHistory: vi.fn(() => new Promise<never>(() => {})),
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
    // The availability has to move WITH the season, or the page reports the
    // wrong reason for a dropped axis and nothing notices — the first draft of
    // this helper left it fixed and the absent-axis test read
    // "Not recorded in every season on the chart" where the truth was
    // "Not recorded in 2016-17".
    columns:
      name === EARLIER
        ? availability(
            { expected_goal_involvements: 'none', defensive_contribution: 'none' },
            { season: name }
          )
        : availability({}, { season: name }),
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
/**
 * The axis captions **on the chart**, which is not the only place they appear.
 *
 * Item 16's values table repeats every caption in its first column, so a bare
 * `getByText('Pts/£')` now matches two nodes — the same collision item 12 hit
 * with "Selected", found the same way. The spokes are what these tests mean, so
 * they say so.
 */
const spokeLabels = () =>
  [...document.querySelectorAll('svg text')].map((t) =>
    // The caption's OWN text, not its descendants'. Item 18 hung a `<title>`
    // child off each caption for the hover definition, and a `<title>` is an
    // element — so `textContent` folds the whole sentence in front of the label
    // and `toContain('xGI')` stops matching. Direct text nodes are what "the
    // caption reads xGI" has always meant; the definition is asserted on its
    // own terms in `ComparisonRadar.test.tsx`.
    [...t.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
  );

/** Waits for the radar itself, which is what "the page is ready" means here. */
const drawn = async () => {
  await waitFor(() => expect(document.querySelector('.radar-spoke')).not.toBeNull());
};

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
    await drawn();
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
    await drawn();

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
    await drawn();

    await user.click(await candidate('Gabriel'));
    await user.click(await candidate('Guéhi'));

    await waitFor(() =>
      expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', [GABRIEL.id, GUEHI.id])
    );
  });

  it('names the season on the chip, because two of them can differ', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await drawn();
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
    await drawn();
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
    await drawn();
    // 2025-26 measures everything, so all ten spokes exist.
    expect(spokeLabels()).toContain('xGI');
    expect(spokeLabels()).toContain('DCH/St');

    rerenderAt(rerender, EARLIER);
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', []));

    // 2016-17 predates both, so neither spoke exists. This is the server's rule
    // — absent, never null — arriving unchanged.
    await waitFor(() => expect(spokeLabels()).not.toContain('xGI'));
    expect(spokeLabels()).not.toContain('DCH/St');
    expect(spokeLabels()).toContain('Pts/£');
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
    await drawn();

    await user.click(await candidate('Gabriel'));
    await waitFor(() =>
      expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', [GABRIEL.id])
    );

    rerenderAt(rerender, LATER);
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', []));
    await screen.findByText(`Comparison \u00b7 ${LATER}`);

    // The band is 2025-26's and the trace is 2016-17's, so the spokes are the
    // eight both can answer.
    await waitFor(() => expect(spokeLabels()).not.toContain('xGI'));
    expect(spokeLabels()).not.toContain('DCH/St');
    expect(spokeLabels()).toContain('Pts/£');

    // And the reason names the intersection rather than the selected season:
    // 2025-26 DOES record xGI, so its own availability cannot explain why the
    // spoke is gone, and a sentence saying "not recorded in 2025-26" would be
    // false. This is the branch `resolveColumn` alone cannot answer.
    const notes = [...document.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(notes.find((t) => t.includes('xGI'))).toContain(
      'Not recorded in every season on the chart.'
    );
  });

  it('reads its captions off the thresholds, not off a second table', async () => {
    renderPage();

    // `Sv` is the one caption that differs from the Players list's own label for
    // the same column (`S`), which is why the label travels on the threshold.
    await drawn();
    expect(spokeLabels()).toContain('Min');
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
    expect(spokeLabels()).toContain('Pts/£');
  });
});

describe('the band, and which season the traces are from', () => {
  /*
   * **One condition: the band draws only when every trace sits on the selected
   * season.** What it rules out is a band describing a population nobody on
   * screen belongs to, which happens two ways — traces on two seasons, where
   * there are two medians and the selector picks between them by accident; and
   * traces all on one season that is not the selected one, where a single
   * median is drawn from a season with nothing on the chart.
   *
   * Reachable rather than hypothetical, both: the shell's selector is the only
   * season control, so either is two clicks away.
   *
   * The band never follows the traces instead. A baseline that moves when a
   * trace is added is worse than an absent one — two charts would have been
   * compared against different populations with neither saying so.
   */
  it('hides the band, and says that is why', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await drawn();
    await user.click(await candidate('Gabriel'));
    await screen.findByText(/median of 109 DEFs/);

    rerenderAt(rerender, EARLIER);
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith(EARLIER, 'DEF', []));
    await user.click(await candidate('Guéhi'));

    expect(await screen.findByText(/span 2 seasons, each with its own median/)).toBeInTheDocument();
    expect(screen.queryByText(/median of 109 DEFs/)).not.toBeInTheDocument();
  });

  it('hides the band when every trace is from a season that is not selected', async () => {
    // One season, so not "spanning" — and still a median from a season with
    // nothing drawn from it, under traces from a season with no median. The
    // quieter of the two failures, and the one a `size > 1` rule misses.
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await drawn();
    await user.click(await candidate('Gabriel'));
    await screen.findByText(/median of 109 DEFs/);

    rerenderAt(rerender, EARLIER);

    expect(
      await screen.findByText(`No band \u00b7 every trace is from ${LATER}, and the band would be ${EARLIER}\u2019s`)
    ).toBeInTheDocument();
  });

  it('keeps the band when two traces share ONE season', async () => {
    // The condition is the number of distinct trace seasons, not the number of
    // traces. Written as `traces.length > 1` this is the test that goes red —
    // and the one above would still pass, so it cannot be the only one.
    const user = userEvent.setup();
    renderPage();
    await drawn();

    await user.click(await candidate('Gabriel'));
    await user.click(await candidate('Guéhi'));
    await waitFor(() =>
      expect(comparisonMock).toHaveBeenCalledWith(LATER, 'DEF', [GABRIEL.id, GUEHI.id])
    );

    expect(await screen.findByText(/median of 109 DEFs/)).toBeInTheDocument();
  });

  it('keeps the band when there are no traces at all', async () => {
    // Zero seasons is not "spanning" either, and this is the page's opening
    // state — the band alone is a legitimate answer.
    renderPage();
    expect(await screen.findByText(/median of 109 DEFs/)).toBeInTheDocument();
  });
});

describe('an axis that is not a spoke', () => {
  it('names it and says why, rather than dropping it silently', async () => {
    const { rerender } = renderPage();
    await drawn();

    rerenderAt(rerender, EARLIER);
    await waitFor(() => expect(spokeLabels()).not.toContain('xGI'));

    /*
     * Item 13's rule on a surface that was dropping axes in silence. A reader
     * comparing 2016-17 with 2025-26 on eight spokes had no way to know two were
     * removed to make that possible.
     *
     * The sentence is `resolveColumn`'s — the picker's own function over the same
     * availability data — because an axis key IS a `PLAYER_COLUMNS` key. Written
     * out here rather than imported, so this cannot agree with itself: a second
     * copy of the RULE is what item 13 forbids, and a second copy of the STRING
     * is what makes the test able to disagree.
     */
    // The label is its own <span>, so the sentence spans two nodes.
    const notes = () =>
      [...document.querySelectorAll('li')].map((li) => li.textContent ?? '');
    await waitFor(() =>
      expect(notes().some((t) => /xGI is not a spoke/.test(t))).toBe(true)
    );
    expect(notes().some((t) => /DCH\/St is not a spoke/.test(t))).toBe(true);
    expect(notes().find((t) => t.includes('xGI'))).toContain(`Not recorded in ${EARLIER}.`);
  });

  it('says nothing when every axis is drawn', async () => {
    renderPage();
    await drawn();

    // 2025-26 answers all ten, so there is nothing to explain and no empty note.
    expect(
      [...document.querySelectorAll('li')].some((li) => /is not a spoke/.test(li.textContent ?? ''))
    ).toBe(false);
  });
});

describe('a season with no matches yet', () => {
  it('says so instead of drawing a target with a dot in the middle', async () => {
    // 2026-27 is what the app resolves to until the first round is ingested, so
    // this is the page's default state for the next four months. Every value is
    // 0 and 0 minutes is below the Min floor, so the chart drew every trace as a
    // point at the centre — honest, and indistinguishable from a broken chart.
    const preseason = aBootstrap({
      ...season('2026-27'),
      season: '2026-27',
      columns: availability({}, { season: '2026-27', measured: false }),
    });
    renderPage(preseason);

    expect(
      await screen.findByText(/No matches recorded for 2026-27 yet/)
    ).toBeInTheDocument();
    // The axes are still named: what the page WILL show is the useful thing to
    // say, and the scales are frozen and already known.
    expect(screen.getByText(/Pts · CS · G · Min/)).toBeInTheDocument();
    expect(document.querySelector('.radar-spoke')).toBeNull();
  });
});

describe('the picker', () => {
  it('offers only the chosen position, from the selected season', async () => {
    const user = userEvent.setup();
    renderPage();
    await drawn();

    expect(await candidate('Gabriel')).toBeInTheDocument();
    // Saka is a midfielder in this bootstrap.
    expect(noCandidate('Saka')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'MID' }));
    expect(await candidate('Saka')).toBeInTheDocument();
  });

  it('narrows by club', async () => {
    const user = userEvent.setup();
    renderPage();
    await drawn();

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
    await drawn();

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
    await drawn();
    await user.click(await candidate('Gabriel'));

    // Now the selected season is one that answers, and the trace's is not.
    rerenderAt(rerender, LATER);
    await screen.findByText(`Comparison \u00b7 ${LATER}`);

    // The chip says why it has no values; the axes and the band are still drawn
    // from the selected season, which answered.
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    expect(spokeLabels()).toContain('Pts/£');
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
    await drawn();

    for (const n of [0, 1, 2, 3]) {
      await user.click(await candidate(`D${n}`));
    }

    // The REASON, not the rule. "Maximum 4" restates the limit; what a reader
    // can act on is why four — colour is the only thing telling two traces
    // apart. Item 13's disabled-with-a-reason, applied to a control.
    expect(await screen.findByText(/as many as colour can tell apart/)).toBeInTheDocument();
    expect(screen.queryByText(/^4 is the limit/)).not.toBeInTheDocument();
    // Disabled rather than removed, so the sentence has something to sit beside.
    expect(await candidate('D4')).toBeDisabled();
  });
});

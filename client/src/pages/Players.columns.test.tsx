/**
 * Selectable columns on the Players list: what is offered, what is withheld, and
 * what survives a season change.
 *
 * Separate from `Players.test.tsx`, which is about the row disclosure and the
 * sort headers. Same page, different feature — the split follows
 * `Dashboard.preseason.test.tsx` and `PlayerDetail.upcoming.test.tsx`.
 *
 * The load-bearing assertions here are the **negative** ones. That an available
 * column renders is barely worth a test; that an unavailable one is *disabled
 * with a reason rather than silently missing*, and that a hidden column is still
 * *remembered*, are the two properties the whole design rests on.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Players from './Players';
import { BootstrapContext } from '../lib/bootstrap';
import { resetColumnHistory } from '../services/api';
import { aBootstrap, aPlayer, aTeam, availability } from '../test/factories';
import type { BootstrapData, ColumnHistoryRow } from '../types/fpl';

/**
 * `fetch` is mocked, not `fetchColumnHistory` — the exception to this suite's
 * usual rule, and the reason is the memo.
 *
 * `fetchColumnHistory` memoizes at module scope, which is the entire mechanism
 * the request-count test below exists to pin. Mocking the function replaces the
 * memo with the mock, so every mount would call it and the test would be
 * measuring nothing. Mocking the transport leaves the real memo in place and
 * makes the count an honest one.
 */
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/** How many times the matrix was actually asked for over the wire. */
const columnRequests = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/columns')).length;

const SEASONS = ['2026-27', '2025-26', '2022-23', '2016-17'];

/** xG recorded from 2022-23 on; 2026-27 unplayed, so it records nothing. */
const MATRIX: ColumnHistoryRow[] = [
  { season: '2025-26', key: 'expected_goals', state: 'full', measured_from: null },
  { season: '2022-23', key: 'expected_goals', state: 'partial', measured_from: 16 },
  { season: '2016-17', key: 'expected_goals', state: 'none', measured_from: null },
  { season: '2026-27', key: 'expected_goals', state: 'none', measured_from: null },
];

const SAKA = aPlayer({ id: 223340, web_name: 'Saka', team: 3, total_points: 157 });
const HAALAND = aPlayer({ id: 223094, web_name: 'Haaland', team: 43, total_points: 140 });

const teams = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

function bootstrapFor(season: string, states: Partial<Record<string, 'full' | 'none'>> = {}) {
  return aBootstrap({
    season,
    seasons: SEASONS,
    players: [SAKA, HAALAND],
    teams,
    columns: availability(states, { season }),
  });
}

function renderAt(b: BootstrapData) {
  const utils = render(
    <BootstrapContext.Provider value={b}>
      <Players onOpenDetail={() => {}} />
    </BootstrapContext.Provider>
  );
  /**
   * Change the season on the SAME mounted component, which is what the app does
   * — `App.tsx` swaps the bootstrap under a mounted page.
   *
   * Not interchangeable with unmount/remount, and the difference is not
   * academic: a remount resets `sort`, `selected` and every other piece of
   * component state, so a test that remounts cannot observe anything about
   * state surviving a season change. The sort-fallback test below passed
   * against a *broken* fallback until it stopped remounting — the mutation
   * "sort-key fallback removed" came back green, because `sort` had already
   * been reset to the default by the remount before the assertion ran.
   */
  const changeSeason = (next: BootstrapData) =>
    utils.rerender(
      <BootstrapContext.Provider value={next}>
        <Players onOpenDetail={() => {}} />
      </BootstrapContext.Provider>
    );
  return { ...utils, changeSeason };
}

const headers = () =>
  screen
    .getAllByRole('columnheader')
    .map((h) => h.textContent?.replace(/[▾▴]/g, '').trim() ?? '')
    .filter(Boolean);

const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Columns/ }));
};

/** The picker's checkbox for a column, by its long title. */
const entry = (title: string) => screen.getByRole('checkbox', { name: new RegExp(title) });

/**
 * The same, for a title that is a prefix of another one.
 *
 * "Defensive contribution hits" is a prefix of "Defensive contribution hits per
 * start", so a substring regex matches two checkboxes and `getByRole` throws.
 * The accessible name is `title` then `label`, so naming both disambiguates —
 * and the label is the thing actually rendered in the header, so pinning it
 * here is not redundant.
 */
const entryExact = (title: string, label: string) =>
  screen.getByRole('checkbox', {
    // The two spans are adjacent with no whitespace between them, so the
    // accessible name is "Defensive contribution hitsDCH" — concatenated, not
    // spaced. Asserted here rather than assumed: it was assumed first, and the
    // matcher found nothing.
    // No trailing anchor: a DISABLED entry appends its reason sentence to the
    // same label, so `$` matches only while the column is available.
    name: new RegExp(`^${title}${label.replace('/', '\\/')}`),
  });

beforeEach(() => {
  localStorage.clear();
  // Module state with a lifetime of its own: without clearing it the suite
  // silently becomes order-dependent, since whichever test ran first would own
  // the only request. Same coupling `resetShirtCache` exists for.
  resetColumnHistory();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ columns: MATRIX }) });
});

describe('availability decides what renders', () => {
  it('renders a measured column and withholds an unmeasured one', async () => {
    const first = renderAt(bootstrapFor('2025-26'));
    expect(headers()).toContain('xG');
    first.unmount();

    // 2016-17 measures none of the expected family.
    renderAt(bootstrapFor('2016-17', { expected_goals: 'none', expected_goal_involvements: 'none' }));
    expect(headers()).not.toContain('xG');
  });

  it('disables an unavailable column rather than hiding it, and says why', async () => {
    const user = userEvent.setup();
    renderAt(bootstrapFor('2016-17', { expected_goals: 'none' }));
    await openPicker(user);

    // Hidden would make the app look like it has never heard of expected goals.
    // Disabled with a sentence teaches the shape of the data instead.
    const xg = entry('Expected goals');
    expect(xg).toBeDisabled();
    expect(screen.getByText(/Not recorded in 2016-17 · recorded from 2022-23\./)).toBeInTheDocument();
  });

  it('names the boundary round on a partly measured season', async () => {
    const user = userEvent.setup();
    renderAt(
      aBootstrap({
        season: '2022-23',
        seasons: SEASONS,
        players: [SAKA, HAALAND],
        teams,
        columns: {
          season: '2022-23',
          measured: true,
          columns: [
            { key: 'expected_goals', state: 'partial', measured_from: 16 },
            { key: 'expected_goal_involvements', state: 'partial', measured_from: 16 },
            { key: 'starts', state: 'partial', measured_from: 16 },
            { key: 'expected_assists', state: 'partial', measured_from: 16 },
            { key: 'defensive_contribution', state: 'none', measured_from: null },
          ],
        },
      })
    );
    await openPicker(user);

    // A partial column has no honest season total — the reason names the round
    // rather than merely refusing.
    expect(entry('Expected goals')).toBeDisabled();
    // Four columns share this season's boundary, so four entries carry the same
    // sentence — `getAllByText` rather than `getByText`, and the count is the
    // assertion: 2022-23 holes exactly the expected family plus `starts`.
    expect(screen.getAllByText('Only recorded from GW16 in 2022-23.')).toHaveLength(4);
    expect(headers()).not.toContain('xG');
  });

  it('offers the two derived columns where their dependencies are measured', async () => {
    // Item 14's columns have no matrix cell of their own — `defcon_hits` is
    // counted from `defensive_contribution` and `defcon_hits_per_start` divides
    // it by `starts`. Without the `dependsOn` fold the picker finds no cell for
    // either key and disables both on the one season where they work.
    const user = userEvent.setup();
    renderAt(bootstrapFor('2025-26'));
    await openPicker(user);

    expect(entryExact('Defensive contribution hits', 'DCH')).not.toBeDisabled();
    expect(entry('Defensive contribution hits per start')).not.toBeDisabled();
  });

  it('withholds both derived columns on a season with no DC, naming where DC is', async () => {
    const user = userEvent.setup();
    renderAt(
      aBootstrap({
        season: '2016-17',
        seasons: SEASONS,
        players: [SAKA, HAALAND],
        teams,
        columns: {
          season: '2016-17',
          measured: true,
          columns: [
            { key: 'expected_goals', state: 'none', measured_from: null },
            { key: 'starts', state: 'none', measured_from: null },
            { key: 'defensive_contribution', state: 'none', measured_from: null },
          ],
        },
      })
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        columns: [
          ...MATRIX,
          { season: '2025-26', key: 'defensive_contribution', state: 'full', measured_from: null },
          { season: '2022-23', key: 'defensive_contribution', state: 'none', measured_from: null },
          { season: '2016-17', key: 'defensive_contribution', state: 'none', measured_from: null },
          { season: '2026-27', key: 'defensive_contribution', state: 'none', measured_from: null },
        ],
      }),
    });
    await openPicker(user);

    expect(entryExact('Defensive contribution hits', 'DCH')).toBeDisabled();
    expect(entry('Defensive contribution hits per start')).toBeDisabled();
  });

  it('does not render either derived column by default', async () => {
    // Item 13 measured the thirteen-column width at 1440 with 290px of headroom
    // and a 921px min-content table. Adding to DEFAULT_KEYS would invalidate
    // that measurement, so both new columns are offered rather than shown.
    renderAt(bootstrapFor('2025-26'));

    expect(headers()).not.toContain('DCH');
    expect(headers()).not.toContain('DCH/St');
    // And they really are on offer, so this is not passing because the entries
    // are missing altogether.
    const user = userEvent.setup();
    await openPicker(user);
    expect(entryExact('Defensive contribution hits', 'DCH')).toBeInTheDocument();
  });

  it('renders the hit columns once selected, with the placeholder for no starts', async () => {
    const user = userEvent.setup();
    renderAt(
      aBootstrap({
        season: '2025-26',
        seasons: SEASONS,
        // Two players whose hits-per-start must read differently: one with
        // starts, one with none at all. 367 of 2025-26's 841 players have no
        // starts, so the placeholder is the common case rather than the edge.
        players: [
          aPlayer({ id: 1, web_name: 'Regular', team: 3, defcon_hits: 11, starts: 30 }),
          aPlayer({ id: 2, web_name: 'Benchwarmer', team: 3, defcon_hits: 0, starts: 0 }),
        ],
        teams,
        columns: availability({}, { season: '2025-26' }),
      })
    );
    await openPicker(user);
    await user.click(entry('Defensive contribution hits per start'));

    expect(headers()).toContain('DCH/St');
    // 11/30 = 0.3666… → 0.37, and no starts is a placeholder rather than 0.00,
    // because "made no starts" and "hit none of his starts" are different.
    expect(screen.getByText('0.37')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('states an unplayed season once, in the season’s own words', async () => {
    const user = userEvent.setup();
    renderAt(
      aBootstrap({
        season: '2026-27',
        seasons: SEASONS,
        players: [SAKA, HAALAND],
        teams,
        columns: { season: '2026-27', measured: false, columns: [] },
      })
    );
    await openPicker(user);

    // The Dashboard's own wording, deliberately: one situation should not have
    // two sentences in one app. And it is a claim about the DATA, not the
    // calendar — playing the matches does not end it, ingesting them does.
    expect(screen.getAllByText('No matches recorded for 2026-27 yet.').length).toBeGreaterThan(0);
    expect(entry('Expected goals')).toBeDisabled();
  });

  it('offers a permanently unavailable field with a reason about our pipeline', async () => {
    const user = userEvent.setup();
    renderAt(bootstrapFor('2025-26'));
    await openPicker(user);

    // Not "does not exist": the raw manager count is stored per gameweek in all
    // ten seasons. What is missing is the denominator, which rides on the live
    // bootstrap — so the percentage is recoverable for a live season and the
    // sentence has to say that rather than implying the data is gone.
    expect(entry('Teams selected by %')).toBeDisabled();
    expect(
      screen.getByText('Ownership percentage is not stored. FPL publishes it live only.')
    ).toBeInTheDocument();

    expect(entry('Availability status')).toBeDisabled();
    expect(
      screen.getByText('Live-game field, not stored for a completed season.')
    ).toBeInTheDocument();
  });
});

describe('the selection persists', () => {
  it('keeps a column selected through a season that cannot show it', async () => {
    const user = userEvent.setup();

    // Add BPS on a season that has everything.
    const first = renderAt(bootstrapFor('2025-26'));
    await openPicker(user);
    await user.click(entry('Bonus points system score'));
    expect(headers()).toContain('BPS');
    first.unmount();

    // 2016-17 cannot show xG. The stored selection must NOT be trimmed to what
    // was on screen — storing the visible subset would silently forget the
    // choice the first time someone looked at an older season.
    const second = renderAt(bootstrapFor('2016-17', { expected_goals: 'none' }));
    expect(headers()).not.toContain('xG');
    expect(headers()).toContain('BPS');
    second.unmount();

    // Back to a season that has it: it returns, with no reconciliation step and
    // no second piece of state.
    renderAt(bootstrapFor('2025-26'));
    expect(headers()).toContain('xG');
    expect(headers()).toContain('BPS');
  });

  it('drops a stored key this build no longer defines', () => {
    localStorage.setItem('fpl-players-columns', JSON.stringify(['pts', 'not_a_column', 'goals']));
    renderAt(bootstrapFor('2025-26'));

    // There is no server to validate a column list against, so an unknown key is
    // filtered against this build's own definitions at read.
    expect(headers()).toEqual(expect.arrayContaining(['Pts', 'G']));
    expect(headers()).not.toContain('not_a_column');
  });

  it('falls back to the defaults when the stored value is corrupt', () => {
    localStorage.setItem('fpl-players-columns', '{not json');
    renderAt(bootstrapFor('2025-26'));
    expect(headers()).toContain('Pts');
    expect(headers()).toContain('xG');
  });
});

describe('the sort survives losing its column', () => {
  it('falls back to points when the sorted column is not on screen', async () => {
    const user = userEvent.setup();

    const { changeSeason } = renderAt(bootstrapFor('2025-26'));
    await user.click(screen.getByRole('button', { name: /^xG$/ }));
    // Descending on first click, which is what the arrow draws.
    expect(screen.getByRole('columnheader', { name: /^xG$/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    );

    // The season changes under the MOUNTED page, so `sort` is still
    // 'expected_goals' when 2016-17 arrives without that column. Remounting
    // instead would reset `sort` to the default before the assertion ran, and
    // the test would pass against a broken fallback -- which it did, until the
    // mutation run caught it.
    //
    // Without the fallback the table goes on sorting by a column nobody can
    // see, and no rendered header carries `aria-sort` at all, so a screen
    // reader is told the table is unsorted while it is not.
    changeSeason(bootstrapFor('2016-17', { expected_goals: 'none' }));

    expect(screen.queryByRole('columnheader', { name: /^xG$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^Pts$/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
  });
});

describe('the value columns round like every other average', () => {
  it('uses half-to-even, not toFixed', () => {
    // 98 points at £8.0m is exactly 12.25 — a binary-exact tie, which is the
    // only case where the two conventions differ. `roundHalfEven` gives 12.2;
    // `toFixed(1)`, which is not an implementation of any convention but
    // whatever the representation gives, yields 12.3. Item 11 measured the two
    // disagreeing on 111 of 226 tied player-seasons.
    const tied = aPlayer({
      id: 1,
      web_name: 'Tied',
      team: 3,
      total_points: 98,
      now_cost: 80,
      start_cost: 70,
    });

    renderAt(
      aBootstrap({
        season: '2025-26',
        seasons: SEASONS,
        players: [tied],
        teams,
        columns: availability({}, { season: '2025-26' }),
      })
    );

    const row = screen.getByRole('row', { name: /Tied/ });
    expect(within(row).getByText('12.2')).toBeInTheDocument();
    expect(within(row).queryByText('12.3')).not.toBeInTheDocument();

    // And the two value columns are genuinely different numbers: 98 / 7.0 = 14.0
    // at the opening price. A column that quietly used `now_cost` for both would
    // look right on every row where the price never moved.
    expect(within(row).getByText('14.0')).toBeInTheDocument();
  });
});

describe('the availability matrix is fetched once', () => {
  it('does not refetch on picker open, or on remount', async () => {
    const user = userEvent.setup();

    const first = renderAt(bootstrapFor('2025-26'));
    await openPicker(user);
    await openPicker(user); // close
    await openPicker(user); // open again
    first.unmount();

    // Navigating away from Players and back must not refetch: nothing about the
    // matrix changes while the tab is open. This is what fails both ways round —
    // against a fetch moved into the picker's open handler, and against a memo
    // that does not survive unmount.
    renderAt(bootstrapFor('2025-26'));
    await openPicker(user);

    expect(columnRequests()).toBe(1);
  });

  it('keeps working when the matrix never arrives', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => {}));

    renderAt(bootstrapFor('2016-17', { expected_goals: 'none' }));
    await openPicker(user);

    // Every disabled entry carries a complete, true sentence from the bootstrap
    // alone. The matrix only ever APPENDS the "· recorded from …" clause, so
    // there is no window in which something on screen is wrong — and a failed
    // fetch degrades to this state permanently rather than surfacing an error.
    expect(entry('Expected goals')).toBeDisabled();
    expect(screen.getByText('Not recorded in 2016-17.')).toBeInTheDocument();
    expect(screen.queryByText(/recorded from/)).not.toBeInTheDocument();
  });
});

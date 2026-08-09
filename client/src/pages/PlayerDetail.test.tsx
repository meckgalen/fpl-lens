/**
 * Expanding a career row: one request, and one only.
 *
 * This is the item 1 bug, which was found by eye in a network panel and could
 * not have been found any other way. `void loadSeason(season)` sat inside the
 * `setExpanded` updater; React double-invokes updaters under StrictMode
 * precisely to surface side effects hidden in one, and every expand fired two
 * identical requests.
 *
 * ## What this file catches, measured by mutation rather than assumed
 *
 * Each of these was applied to `PlayerDetail.tsx` and the suite run:
 *
 *   call moved back inside the updater  -> GREEN (4 passed)
 *   inFlight ref swapped back to state  -> GREEN (4 passed)
 *   both together (the bug as it was)   -> RED   ("expected 2 to be 1", twice)
 *
 * ## And why that does not mean either half is optional
 *
 * The two mechanisms are not equal in weight. The **ref guard suppresses the
 * symptom**: it is written synchronously before the first `await`, so the second
 * updater invocation finds the season already in flight and returns. The **call
 * sitting outside the updater is what makes the code correct.** React does not
 * promise to invoke an updater exactly twice, and it can discard a render
 * entirely — in which case a fetch has been started for a state change that
 * never committed. None of that is observable from outside the component, so no
 * test here pins it.
 *
 * Read the table as "the outcome is defended twice over", not as "either half is
 * fine". Deleting whichever one is in the way is how this bug comes back.
 *
 * The suite runs under StrictMode because `renderInApp` puts it there, and
 * `test/render.test.tsx` is the check that it is genuinely active — without
 * that, every assertion below would pass while pinning nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import PlayerDetail from './PlayerDetail';
import { renderInApp } from '../test/render';
import {
  aBootstrap,
  aCareerSeason,
  aGameweek,
  aPlayer,
  aPlayerDetail,
  aTeam,
  anIdentity,
} from '../test/factories';
import { fetchPlayerCareer, fetchPlayerDetail } from '../services/api';

/**
 * Both functions, not just the one under test.
 *
 * `PlayerDetail`'s mount effect runs them under a single `Promise.all`, so a
 * missing career mock rejects it, the component renders its error branch, and no
 * career row is ever drawn. The expand tests would then fail with "unable to
 * find element" — a message about the DOM, pointing at the table, for a problem
 * in this factory.
 */
vi.mock('../services/api', () => ({
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchBootstrap: vi.fn(),
  fetchFixtures: vi.fn(),
}));

const detailMock = vi.mocked(fetchPlayerDetail);
const careerMock = vi.mocked(fetchPlayerCareer);

const CURRENT = '2025-26';
const PREVIOUS = '2020-21';

const SAKA = aPlayer({ id: 223340, first_name: 'Bukayo', second_name: 'Saka', web_name: 'Saka' });
const MAGUIRE = aPlayer({
  id: 95658,
  first_name: 'Harry',
  second_name: 'Maguire',
  web_name: 'Maguire',
  team: 3,
});

const bootstrap = aBootstrap({
  season: CURRENT,
  players: [SAKA, MAGUIRE],
  teams: [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })],
});

/**
 * A distinct payload for every (player, season) pair.
 *
 * A bare `vi.fn()` returns one response whatever it is called with, which would
 * make the cache-reset test pass on the collapsed row alone — true of any
 * rerender, and silent about whether anything was invalidated. Seasons need
 * separating too, not just players: "This Season" and an expanded previous
 * season are both on screen at once, so a value shared between them cannot say
 * which table it came from.
 *
 * `bps` carries the marker because it is a plain integer that reaches the cell
 * with no formatting in between.
 */
const BPS: Record<number, Record<string, number>> = {
  [SAKA.id]: { [CURRENT]: 5101, [PREVIOUS]: 5102 },
  [MAGUIRE.id]: { [CURRENT]: 5201, [PREVIOUS]: 5202 },
};

const bps = (code: number, season: string) => String(BPS[code][season]);

function detailFor(code: number, season: string) {
  return aPlayerDetail({
    season,
    history: [aGameweek({ fixture: 1, round: 1, bps: BPS[code][season] })],
  });
}

/** A career total per season, so a row can be told apart from the other one. */
const CAREER_POINTS: Record<string, number> = { [CURRENT]: 6101, [PREVIOUS]: 6102 };

beforeEach(() => {
  detailMock.mockImplementation(async (code, season) => detailFor(code, season));
  careerMock.mockImplementation(async (code) => ({
    player: anIdentity({ id: code }),
    seasons: [
      aCareerSeason({
        season: CURRENT,
        team_short_name: 'ARS',
        total_points: CAREER_POINTS[CURRENT],
      }),
      aCareerSeason({
        season: PREVIOUS,
        team_short_name: 'ARS',
        total_points: CAREER_POINTS[PREVIOUS],
      }),
    ],
  }));
});

/** How many times a given season was fetched, for any player. */
const callsFor = (season: string) =>
  detailMock.mock.calls.filter(([, s]) => s === season).length;

/**
 * The clickable summary row for a season.
 *
 * `findBy*`, because the career table is drawn only once its promise resolves —
 * a synchronous query followed by `fireEvent.click` fires before the row exists.
 *
 * Found through the disclosure **button** rather than by text since item 12. The
 * selected season is now a row in this table as well as the label on the header
 * card above it, so `findByText('2025-26')` matches two elements. The button's
 * accessible name is the season and there is exactly one per row, which is also
 * why the "Selected" badge sits outside it.
 */
async function seasonRow(season: string) {
  const toggle = await screen.findByRole('button', { name: season });
  const row = toggle.closest('tr');
  if (!row) throw new Error(`no row around the ${season} toggle`);
  return row;
}

/** The `<tr>` holding a season's gameweeks, present only while it is open. */
const expansionFor = (season: string) => document.getElementById(`career-gameweeks-${season}`);

describe('PlayerDetail: expanding a previous season', () => {
  it('issues exactly one request for the season it opens', async () => {
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));

    // One, under StrictMode, with the updater invoked twice. Two is the bug.
    expect(callsFor(PREVIOUS)).toBe(1);

    // Counted per season rather than in total, deliberately: StrictMode also
    // double-invokes the mount effect, so the CURRENT season legitimately has
    // two calls and a total-call assertion would be pinning that instead.
    expect(callsFor(CURRENT)).toBeGreaterThanOrEqual(1);
  });

  it('issues no request when the season is reopened after collapsing', async () => {
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));
    expect(callsFor(PREVIOUS)).toBe(1);

    // Collapse keeps the cached response — that is the whole point of caching
    // per season rather than per open row.
    fireEvent.click(await seasonRow(PREVIOUS));
    expect(screen.queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));
    expect(callsFor(PREVIOUS)).toBe(1);
  });
});

describe('PlayerDetail: the cache does not outlive its player', () => {
  it('drops the previous player’s seasons and refetches for the new one', async () => {
    const { rerender } = renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));

    rerender(<PlayerDetail code={MAGUIRE.id} player={MAGUIRE} onBack={() => {}} />);

    // findBy*, not getBy*: the new player's own requests have to settle before
    // anything can be asserted about what is on screen. Checking for an absence
    // before the rerender has resolved passes because nothing has happened yet.
    await screen.findByText(bps(MAGUIRE.id, CURRENT));

    // Expanded state is reset with the cache, so the row comes back collapsed.
    expect(screen.queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();

    // The half that actually catches a cache surviving its player. A stale
    // cache would answer this expand out of Saka's entry, under Maguire's
    // name, without issuing a request — and it would look completely normal.
    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(MAGUIRE.id, PREVIOUS));
    expect(screen.queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();
    expect(screen.queryByText(bps(SAKA.id, CURRENT))).not.toBeInTheDocument();
  });
});

describe('PlayerDetail: the selected season is a row like any other', () => {
  /**
   * The inversion item 12 is. This assertion used to read
   * `expect(screen.queryByRole('row', { name: new RegExp(CURRENT) })).toBeNull()`
   * — the career table deliberately excluded the season shown above it, and the
   * two were rendered in different shapes on one page.
   */
  it('puts the selected season in the same table as the others', async () => {
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    const current = await seasonRow(CURRENT);
    const previous = await seasonRow(PREVIOUS);
    expect(current).not.toBe(previous);

    // One table, one header. Two would mean the section came back in disguise.
    expect(screen.getAllByRole('table').filter((t) => within(t).queryByText('Season'))).toHaveLength(1);

    // And neither heading survives. Both asserted something false: "This Season"
    // whenever the selector is off the live season, "Previous Seasons" on any
    // season with later ones listed above it.
    expect(screen.queryByText('This Season')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous Seasons')).not.toBeInTheDocument();
  });

  it('keeps the selected season’s totals in line when it is collapsed', async () => {
    // The point of the change, and the thing the reverted attempt got wrong: a
    // collapse must leave the totals on screen, in the same shape as every other
    // season's, not remove the season from the page.
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    const row = await seasonRow(CURRENT);
    fireEvent.click(row);

    expect(expansionFor(CURRENT)).toBeNull();
    expect(within(await seasonRow(CURRENT)).getByText(String(CAREER_POINTS[CURRENT])))
      .toBeInTheDocument();
    // Beside the other season's, which is what "in line" means.
    expect(within(await seasonRow(PREVIOUS)).getByText(String(CAREER_POINTS[PREVIOUS])))
      .toBeInTheDocument();
  });

  it('marks the selected season and no other', async () => {
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    // Scoped to the summary rows rather than the document, and not for tidiness:
    // `StatsTable` has an ownership column whose header is also "Selected", and it
    // is rendered inside the expanded row a few `<tr>`s below. A summary row is a
    // sibling of its expansion rather than its parent, so `within` a row sees only
    // the row — which is exactly the scope the claim is about.
    const mark = within(await seasonRow(CURRENT)).getByText('Selected');
    expect(within(await seasonRow(PREVIOUS)).queryByText('Selected')).not.toBeInTheDocument();

    // Outside the toggle, or every such row would announce as "2025-26 Selected"
    // — a control renaming itself from page state. This query finding the button
    // by the bare season is the same assertion `seasonRow` depends on.
    expect(screen.getByRole('button', { name: CURRENT })).not.toContainElement(mark);
  });

  it('starts the selected season expanded and the others collapsed', async () => {
    // What the page did before the merge: "This Season" was always open.
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    await screen.findByText(bps(SAKA.id, CURRENT));
    expect(expansionFor(CURRENT)).not.toBeNull();
    expect(expansionFor(PREVIOUS)).toBeNull();
  });
});

/**
 * Filters, which every expansion has now rather than one of them.
 *
 * The consequence that is easy to underestimate: the state has to be **per
 * season**, because the GW options are. 2019-20 runs to 47 after the Covid
 * restart and 2022-23 has no round 7, so one shared range would offer a season a
 * round it never played — and, more quietly, a range narrowed on one season
 * would silently hide rows on the next one opened.
 */
describe('PlayerDetail: the filters belong to their season', () => {
  const ROUNDS_1920 = [
    ...Array.from({ length: 29 }, (_, i) => i + 1),
    ...Array.from({ length: 9 }, (_, i) => i + 39),
  ];

  /** Two seasons with genuinely different round sets, both with rows to filter. */
  function twoSeasonCareer() {
    careerMock.mockImplementation(async (code) => ({
      player: anIdentity({ id: code }),
      seasons: [
        aCareerSeason({ season: CURRENT, total_points: CAREER_POINTS[CURRENT] }),
        aCareerSeason({
          season: PREVIOUS,
          total_points: CAREER_POINTS[PREVIOUS],
          rounds: ROUNDS_1920,
        }),
      ],
    }));
    detailMock.mockImplementation(async (code, season) =>
      aPlayerDetail({
        season,
        history: [
          aGameweek({ fixture: 1, round: 1, bps: BPS[code][season] }),
          aGameweek({ fixture: 2, round: season === PREVIOUS ? 47 : 38, bps: BPS[code][season] + 1 }),
        ],
      })
    );
  }

  /** The GW-from select inside one season's expansion. */
  const gwFrom = (season: string) =>
    within(expansionFor(season)!).getAllByRole('combobox')[0] as HTMLSelectElement;

  it('offers each season its own rounds, not the selected season’s', async () => {
    twoSeasonCareer();
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));

    const previousOptions = [...gwFrom(PREVIOUS).options].map((o) => Number(o.value));
    const currentOptions = [...gwFrom(CURRENT).options].map((o) => Number(o.value));

    // 47 exists in one season and not in the other, which is the whole point.
    expect(previousOptions).toEqual(ROUNDS_1920);
    expect(previousOptions).toContain(47);
    expect(currentOptions).not.toContain(47);

    // And the gap is the season's, not the player's: he has rows in rounds 1 and
    // 47 only, so a list built from his gameweeks would be [1, 47]. A list built
    // from the season has 38 entries with 30-38 missing, and a reader can tell
    // what that gap means.
    expect(previousOptions).toContain(29);
    expect(previousOptions).not.toContain(30);
    expect(previousOptions).toHaveLength(38);
  });

  it('narrowing one season’s range leaves the other’s alone', async () => {
    twoSeasonCareer();
    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    fireEvent.click(await seasonRow(PREVIOUS));
    await screen.findByText(bps(SAKA.id, PREVIOUS));

    // Both open, both showing both of their rows.
    expect(within(expansionFor(CURRENT)!).getByText(String(BPS[SAKA.id][CURRENT] + 1))).toBeInTheDocument();

    // Narrow the previous season past its round-1 row. With one shared pair this
    // would move the selected season's range too and hide its round-1 row as
    // well — which is the failure this file exists to catch, and it looks like
    // nothing more than a table that lost a row.
    fireEvent.change(gwFrom(PREVIOUS), { target: { value: '39' } });

    expect(within(expansionFor(PREVIOUS)!).queryByText(bps(SAKA.id, PREVIOUS))).not.toBeInTheDocument();
    expect(within(expansionFor(CURRENT)!).getByText(bps(SAKA.id, CURRENT))).toBeInTheDocument();
    expect(gwFrom(CURRENT).value).toBe('1');
  });

  it('draws no filter bar over a season with no rows to filter', async () => {
    // 2026-27's rounds come from its fixtures, so the season has all 38 of them
    // and not one match played. Gating the bar on rounds rather than on rows put
    // a full GW range above "Data will appear here once the season is underway"
    // — three controls that can only filter nothing. Found in the browser.
    careerMock.mockImplementation(async (code) => ({
      player: anIdentity({ id: code }),
      seasons: [aCareerSeason({ season: CURRENT, matches: 0, appearances: 0 })],
    }));
    detailMock.mockImplementation(async (code, season) =>
      aPlayerDetail({ season, history: [] })
    );

    renderInApp(<PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />, bootstrap);

    await screen.findByText(/is underway/);
    expect(within(expansionFor(CURRENT)!).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('forgets the filters when the player changes', async () => {
    // Not a defect the merge introduced — it is one it had to fix. Before item 12
    // the venue filter reset on nothing at all and the range only on a season
    // change, so opening a second player inherited the first one's window.
    twoSeasonCareer();
    const { rerender } = renderInApp(
      <PlayerDetail code={SAKA.id} player={SAKA} onBack={() => {}} />,
      bootstrap
    );

    await screen.findByText(bps(SAKA.id, CURRENT));
    fireEvent.change(gwFrom(CURRENT), { target: { value: '38' } });
    expect(within(expansionFor(CURRENT)!).queryByText(bps(SAKA.id, CURRENT))).not.toBeInTheDocument();

    rerender(<PlayerDetail code={MAGUIRE.id} player={MAGUIRE} onBack={() => {}} />);
    await screen.findByText(bps(MAGUIRE.id, CURRENT));

    expect(gwFrom(CURRENT).value).toBe('1');
  });
});

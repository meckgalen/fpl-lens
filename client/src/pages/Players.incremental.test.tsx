/**
 * The roster arrives in chunks, and the page says so.
 *
 * Item 18 set out to remove a hard `slice(0, 200)` and render the whole roster.
 * The browser refused: on the largest season stored (2023-24, 865 players)
 * mounting all of them took ~792ms against ~215ms for 200, and a re-sort ~408ms
 * against ~160ms. Memoizing the shirt, `table-layout: fixed` and
 * `content-visibility: auto` were each measured and each changed nothing worth
 * having, so the rows themselves are the cost.
 *
 * What shipped is incremental rendering — **not pagination**: no page controls,
 * no page number, one continuous list that grows as it is scrolled. These tests
 * pin the three things that make that honest rather than a silent truncation,
 * which is what the old cap was.
 *
 * **jsdom has no `IntersectionObserver`.** It is stubbed here rather than
 * mocked away, so the test can fire the callback itself and assert that
 * observing the sentinel is what grows the list.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Players from './Players';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    fetchColumnHistory: vi.fn(() => new Promise<never>(() => {})),
  };
});
import { BootstrapContext } from '../lib/bootstrap';
import { aBootstrap, aPlayer, aTeam } from '../test/factories';
import type { BootstrapData } from '../types/fpl';

/** The callbacks of every live observer, so a test can bring the sentinel into view. */
let observers: IntersectionObserverCallback[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IntersectionObserverCallback) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = '';
      thresholds = [];
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Fire the most recently created observer, as a scroll into view would.
 *
 * Inside `act`, because the callback is not a React event: the state update it
 * schedules is not flushed otherwise, and every assertion after it reads the
 * pre-growth DOM. That failure looks exactly like the growth being broken.
 */
const scrollToSentinel = () => {
  const cb = observers[observers.length - 1];
  act(() => {
    cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
};

/** More than one chunk, so the boundary is actually exercised. */
const manyPlayers = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    aPlayer({
      id: 1000 + i,
      web_name: `P${i}`,
      first_name: 'Test',
      second_name: `P${i}`,
      team: 3,
      // Descending, so the default sort keeps them in index order and a
      // rendered prefix is a predictable set of names.
      total_points: n - i,
      minutes: n - i,
    })
  );

const renderWith = (value: BootstrapData) =>
  render(
    <BootstrapContext.Provider value={value}>
      <Players onOpenDetail={() => {}} />
    </BootstrapContext.Provider>
  );

const rowCount = () => document.querySelectorAll('tbody tr').length;

describe('incremental rendering', () => {
  it('renders one chunk and says what it is holding back', () => {
    renderWith(aBootstrap({ players: manyPlayers(500), teams: [aTeam()] }));

    expect(rowCount()).toBe(200);
    // The sentence is the point. The old cap rendered 200 of 865 and the count
    // beside the filters said "865 players", with nothing accounting for the
    // difference — a surface silently dropping rows.
    expect(screen.getByText('Showing 200 of 500 · scroll for more')).toBeInTheDocument();
    // And the true total is still stated, unchanged.
    expect(screen.getByText('500 players')).toBeInTheDocument();
  });

  it('grows by a chunk when the sentinel comes into view', () => {
    renderWith(aBootstrap({ players: manyPlayers(500), teams: [aTeam()] }));

    expect(rowCount()).toBe(200);
    expect(screen.queryByText('P250')).not.toBeInTheDocument();

    scrollToSentinel();

    expect(rowCount()).toBe(400);
    expect(screen.getByText('P250')).toBeInTheDocument();
    expect(screen.getByText('Showing 400 of 500 · scroll for more')).toBeInTheDocument();
  });

  it('reaches the end of the roster, and stops saying anything then', () => {
    renderWith(aBootstrap({ players: manyPlayers(500), teams: [aTeam()] }));

    scrollToSentinel();
    scrollToSentinel();

    expect(rowCount()).toBe(500);
    // Nothing is being withheld, so nothing claims to be.
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
    expect(screen.getByText('P499')).toBeInTheDocument();
  });

  it('says nothing at all when the whole list already fits', () => {
    renderWith(aBootstrap({ players: manyPlayers(30), teams: [aTeam()] }));

    expect(rowCount()).toBe(30);
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
  });

  it('drops back to one chunk when the order changes', async () => {
    const user = userEvent.setup();
    renderWith(aBootstrap({ players: manyPlayers(500), teams: [aTeam()] }));

    scrollToSentinel();
    expect(rowCount()).toBe(400);

    // A re-sort is a different ordering, so "the first 400 of the old one" means
    // nothing in the new one — and keeping the grown count would make every sort
    // click pay the full-roster cost this exists to avoid.
    await user.click(screen.getByRole('button', { name: 'Min' }));

    expect(rowCount()).toBe(200);
    expect(screen.getByText('Showing 200 of 500 · scroll for more')).toBeInTheDocument();
  });

  it('drops back to one chunk when a filter changes', async () => {
    const user = userEvent.setup();
    renderWith(aBootstrap({ players: manyPlayers(500), teams: [aTeam()] }));

    scrollToSentinel();
    expect(rowCount()).toBe(400);

    // A term matching EVERY player, deliberately. A narrower search would drop
    // the list under one chunk on its own, and the assertion would then hold
    // whether or not the reset exists — which is how the first version of this
    // test passed against the reset being deleted.
    await user.type(screen.getByPlaceholderText('Search players…'), 'Test');

    expect(rowCount()).toBe(200);
    expect(screen.getByText('Showing 200 of 500 · scroll for more')).toBeInTheDocument();
  });
});

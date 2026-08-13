/**
 * The picker offers everyone, and says how many that is.
 *
 * It used to offer **eight**, sorted by points, with nothing on screen saying
 * so — on 2023-24 that left 270 of the 278 defenders unreachable whatever you
 * typed, and the eight looked like the whole answer rather than a slice of one.
 *
 * The cap is gone. What replaces it is a scrolling pane over the full match set,
 * rendered a chunk at a time because this list re-renders on every keystroke —
 * item 18 measured the worst case (MID on 2023-24, 374 candidates) at a 14.7ms
 * median per keystroke with chunking, against a pre-committed 100ms budget.
 *
 * The count in the header is the load-bearing part: it is what distinguishes
 * "these are all of them" from "these are the first sixty of them".
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Comparison from './Comparison';
import { fetchComparison, fetchComparisonThresholds } from '../services/api';
import { BootstrapContext } from '../lib/bootstrap';
import { aBootstrap, aComparison, aPlayer, aTeam, comparisonThresholds } from '../test/factories';

vi.mock('../services/api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPlayerDetail: vi.fn(),
  fetchPlayerCareer: vi.fn(),
  fetchFixtures: vi.fn(),
  fetchColumnHistory: vi.fn(() => new Promise<never>(() => {})),
  fetchComparison: vi.fn(),
  fetchComparisonThresholds: vi.fn(),
}));

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
  vi.mocked(fetchComparisonThresholds).mockResolvedValue(comparisonThresholds());
  vi.mocked(fetchComparison).mockResolvedValue(aComparison({ season: '2023-24' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const scrollPane = () =>
  act(() => {
    observers[observers.length - 1]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  });

/** 100 defenders: more than one chunk, so the boundary is real. */
const defenders = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    aPlayer({
      id: 5000 + i,
      web_name: `D${i}`,
      first_name: 'Def',
      second_name: `D${i}`,
      element_type: 2,
      team: 3,
      total_points: n - i,
    })
  );

const renderPage = (n: number) =>
  render(
    <BootstrapContext.Provider
      value={aBootstrap({ season: '2023-24', players: defenders(n), teams: [aTeam()] })}
    >
      <Comparison />
    </BootstrapContext.Provider>
  );

const offered = () => screen.queryAllByRole('button', { name: /^Add D\d+$/ }).length;

describe('the candidate picker', () => {
  it('offers more than the eight it used to, and counts the matches', async () => {
    renderPage(100);

    // The regression guard: 8 was the old cap, and it is the number this test
    // exists to never see again.
    await waitFor(() => expect(offered()).toBeGreaterThan(8));
    expect(offered()).toBe(60);
    expect(screen.getByText('100 matches')).toBeInTheDocument();
    expect(screen.getByText('Showing 60 of 100 · scroll for more')).toBeInTheDocument();
  });

  it('reaches the rest by scrolling, not by narrowing the search', async () => {
    renderPage(100);
    await waitFor(() => expect(offered()).toBe(60));

    // D99 is last by points and was unreachable under the cap at any search.
    expect(screen.queryByRole('button', { name: 'Add D99' })).not.toBeInTheDocument();

    scrollPane();

    expect(offered()).toBe(100);
    expect(screen.getByRole('button', { name: 'Add D99' })).toBeInTheDocument();
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
  });

  it('counts what matches the filters, not the whole roster', async () => {
    const user = userEvent.setup();
    renderPage(100);
    await waitFor(() => expect(offered()).toBe(60));

    await user.type(screen.getByPlaceholderText('Add a player…'), 'D1');

    // D1, D10-D19, D100+ do not exist past 99 — so D1 and D10..D19 is eleven.
    await waitFor(() => expect(screen.getByText('11 matches')).toBeInTheDocument());
    // Under one chunk, so nothing is withheld and nothing says it is.
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
  });

  it('says nothing about scrolling when everyone already fits', async () => {
    renderPage(12);

    await waitFor(() => expect(offered()).toBe(12));
    expect(screen.getByText('12 matches')).toBeInTheDocument();
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
  });
});

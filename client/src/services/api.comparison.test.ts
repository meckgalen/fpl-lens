/**
 * The comparison thresholds memo, which is `fetchColumnHistory`'s with one
 * clause reversed.
 *
 * `fetch` is mocked rather than `services/api.ts` — the same exception
 * `Players.columns.test.tsx` takes, for the same reason: the memo IS the
 * mechanism under test, and mocking the function replaces the memo with the
 * mock, leaving a test that measures nothing.
 *
 * The clause worth a file of its own is the **rejection**. The column matrix
 * memoizes its failure deliberately, because every disabled picker entry is
 * already a complete sentence without it and a retry would buy one request per
 * mount forever. These thresholds are the comparison page's entire axis
 * configuration: there is nothing to degrade to, so a memoized failure would
 * leave the page dead for the session with no way back short of a reload. The
 * two are opposite calls made from the same shape, which is exactly the kind of
 * thing that gets "tidied" into agreement later.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchComparisonThresholds, resetComparisonThresholds } from './api';
import { comparisonThresholds } from '../test/factories';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const thresholdRequests = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/comparison-thresholds')).length;

beforeEach(() => {
  // Module state with a lifetime of its own, so the suite is order-dependent
  // without this — whichever test ran first would own the only request.
  resetComparisonThresholds();
  fetchMock.mockReset();
});

afterEach(() => {
  resetComparisonThresholds();
});

describe('the thresholds memo', () => {
  it('asks once however many callers there are', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => comparisonThresholds() });

    const [a, b] = await Promise.all([fetchComparisonThresholds(), fetchComparisonThresholds()]);

    expect(thresholdRequests()).toBe(1);
    // The second caller gets the first caller's promise, so it is the same
    // object rather than an equal one — which is what makes a season change,
    // an unmount and a remount all free.
    expect(a).toBe(b);
  });

  it('takes no season, because a frozen threshold has none', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => comparisonThresholds() });
    await fetchComparisonThresholds();

    // The route rejects `?season=` rather than ignoring it, so a query string
    // here would be a 400 rather than a wasted parameter.
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/comparison-thresholds');
  });

  it('does NOT memoize a failure, unlike the column matrix', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    await expect(fetchComparisonThresholds()).rejects.toThrow();

    // The retry the page's only recovery depends on: with the failure memoized,
    // navigating away and back would re-use the rejection and the page would
    // stay dead for the rest of the session.
    fetchMock.mockResolvedValue({ ok: true, json: async () => comparisonThresholds() });
    const ok = await fetchComparisonThresholds();

    expect(thresholdRequests()).toBe(2);
    expect(ok.thresholds.DEF.length).toBeGreaterThan(0);
  });
});

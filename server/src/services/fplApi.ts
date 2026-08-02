/**
 * The live FPL API client.
 *
 * No route imports this. That is deliberate and it is not dead code: it is the
 * ingestion source for the live season, the one thing the CSV backfill cannot
 * cover, and the source of the `history_past` totals used to check the ingest
 * against a pipeline that is not the vaastav files.
 *
 * Everything it returns is a wire type (../types/wire.ts): season-scoped ids
 * and decimals as strings. Nothing here may be handed to a repository or a
 * route without going through an ingest first.
 */

import type { WireBootstrap, WireElementSummary, WireFixture } from '../types/wire.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchWithCache<T>(url: string): Promise<T> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FPL API error: ${res.status}`);
  const data = await res.json();
  cache.set(url, { data, timestamp: Date.now() });
  return data as T;
}

// Main bootstrap data: all players, teams, events
export async function getBootstrap(): Promise<WireBootstrap> {
  return fetchWithCache<WireBootstrap>(`${FPL_BASE}/bootstrap-static/`);
}

/**
 * Per-player gameweek history + fixture list.
 *
 * `playerId` is FPL's season-scoped element id, because that is what this
 * endpoint takes — the one place in the codebase where passing one is correct.
 * Resolve it through `player_seasons` and never let it out again (rule 2).
 */
export async function getPlayerDetail(playerId: number): Promise<WireElementSummary> {
  return fetchWithCache<WireElementSummary>(`${FPL_BASE}/element-summary/${playerId}/`);
}

// Fixture list (all matches)
export async function getFixtures(): Promise<WireFixture[]> {
  return fetchWithCache<WireFixture[]>(`${FPL_BASE}/fixtures/`);
}

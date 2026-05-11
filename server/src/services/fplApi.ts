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
export async function getBootstrap() {
  return fetchWithCache<any>(`${FPL_BASE}/bootstrap-static/`);
}

// Per-player gameweek history + fixture list
export async function getPlayerDetail(playerId: number) {
  return fetchWithCache<any>(`${FPL_BASE}/element-summary/${playerId}/`);
}

// Fixture list (all matches)
export async function getFixtures() {
  return fetchWithCache<any[]>(`${FPL_BASE}/fixtures/`);
}

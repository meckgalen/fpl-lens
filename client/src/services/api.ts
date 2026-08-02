import type { BootstrapData, PlayerDetailData, FixturesData } from '../types/fpl';

const BASE = '/api';

export async function fetchBootstrap(): Promise<BootstrapData> {
  const res = await fetch(`${BASE}/bootstrap`);
  if (!res.ok) throw new Error('Failed to fetch bootstrap data');
  return res.json();
}

/**
 * `playerCode` is the permanent player code — `Player.id` from the bootstrap
 * payload, which is what this returns it as. It is never an FPL element id:
 * those are reassigned every August, so a URL built on one comes to address a
 * different footballer without ever erroring.
 */
export async function fetchPlayerDetail(
  playerCode: number,
  season: string
): Promise<PlayerDetailData> {
  // The season is sent rather than left to default. Both endpoints default to
  // the latest season in the database, so today they agree by coincidence —
  // but they are two independent requests, and the moment anything selects a
  // season the detail page would keep serving the latest one beside a header
  // card from another year, with nothing on screen to say so.
  const res = await fetch(`${BASE}/player/${playerCode}?season=${encodeURIComponent(season)}`);
  if (!res.ok) throw new Error('Failed to fetch player detail');
  return res.json();
}

export async function fetchFixtures(event?: number): Promise<FixturesData> {
  const url = event != null ? `${BASE}/fixtures?event=${event}` : `${BASE}/fixtures`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch fixtures');
  return res.json();
}

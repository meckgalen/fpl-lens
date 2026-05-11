import type { BootstrapData, PlayerDetailData, Fixture } from '../types/fpl';

const BASE = '/api';

export async function fetchBootstrap(): Promise<BootstrapData> {
  const res = await fetch(`${BASE}/bootstrap`);
  if (!res.ok) throw new Error('Failed to fetch bootstrap data');
  return res.json();
}

export async function fetchPlayerDetail(playerId: number): Promise<PlayerDetailData> {
  const res = await fetch(`${BASE}/player/${playerId}`);
  if (!res.ok) throw new Error('Failed to fetch player detail');
  return res.json();
}

export async function fetchFixtures(event?: number): Promise<{ fixtures: Fixture[] }> {
  const url = event != null ? `${BASE}/fixtures?event=${event}` : `${BASE}/fixtures`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch fixtures');
  return res.json();
}

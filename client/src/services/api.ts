import type {
  BootstrapData,
  PlayerCareerData,
  PlayerDetailData,
  FixturesData,
} from '../types/fpl';

const BASE = '/api';

/**
 * A failed request, with the status and whatever the server put in the body.
 *
 * The wrappers used to throw a bare `Error('Failed to fetch …')`, which threw
 * the server's structured body away with it. That was survivable while nothing
 * acted on a failure, and stopped being so when the season became persistable:
 * a stored season the database does not have — a fresh clone, a rebuilt
 * container, a season list that moved on — gets a 400, and **a bare Error is
 * indistinguishable from the network being down**. One of those should silently
 * fall back to the default season; the other absolutely should not, because a
 * blind retry would drop the user's chosen season on a transient failure.
 *
 * `available` is the season list the unknown-season 400 carries. It is not used
 * to *pick* a replacement season — see App.tsx, which asks the server rather
 * than re-deriving `latestSeason()`'s rule client-side.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly available?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Every request goes through here, so every failure carries its status.
 *
 * The body is parsed on failure but never trusted to exist: a 500 from a proxy
 * or a dead connection produces no JSON at all, and that must not turn into a
 * parse error masquerading as an API error.
 */
async function request<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let error: string | undefined;
    let available: string[] | undefined;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string') error = body.error;
      if (Array.isArray(body?.available)) available = body.available;
    } catch {
      // No JSON body. The status is still the useful half.
    }
    throw new ApiError(error ?? `Failed to fetch ${what}`, res.status, available);
  }
  return res.json();
}

/**
 * One season's players, teams and gameweeks.
 *
 * The season is optional and omitting it is meaningful: the server then applies
 * its own default (`latestSeason`), and the response says which season that
 * turned out to be. The client never computes the default itself — that rule
 * lives in one place, on the server, and a second copy of it here would be a
 * second thing to keep in agreement.
 */
export async function fetchBootstrap(season?: string): Promise<BootstrapData> {
  const url = season ? `${BASE}/bootstrap?season=${encodeURIComponent(season)}` : `${BASE}/bootstrap`;
  return request<BootstrapData>(url, 'bootstrap data');
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
  // the latest season in the database, and since item 8 something does select a
  // season — so without this the detail page would keep serving the latest one
  // beside a header card from another year, with nothing on screen to say so.
  return request<PlayerDetailData>(
    `${BASE}/player/${playerCode}?season=${encodeURIComponent(season)}`,
    'player detail'
  );
}

/**
 * Every season the player was registered for, newest first, plus who he is.
 *
 * No season parameter, and the server rejects one rather than ignoring it: a
 * career is the whole of them. Each row names its own season, which is the
 * label to render — there is no top-level one here.
 *
 * `player` is the season-independent half: code, names and photo. It is the
 * only thing the detail page can render a player by when the selected season
 * has no player-season for him at all.
 */
export async function fetchPlayerCareer(playerCode: number): Promise<PlayerCareerData> {
  return request<PlayerCareerData>(`${BASE}/player/${playerCode}/career`, 'player career');
}

/**
 * One season's fixtures, optionally one round of them.
 *
 * The season is a real parameter rather than left to default, and that is a
 * fix rather than symmetry: this page picks its round from the bootstrap's
 * events, so a request without a season could ask the *default* season for a
 * round number derived from the *selected* one.
 */
export async function fetchFixtures(event?: number, season?: string): Promise<FixturesData> {
  const params = new URLSearchParams();
  if (event != null) params.set('event', String(event));
  if (season) params.set('season', season);
  const query = params.toString();
  return request<FixturesData>(`${BASE}/fixtures${query ? `?${query}` : ''}`, 'fixtures');
}

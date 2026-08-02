/**
 * Season lookups.
 *
 * The database holds ten seasons; the FPL API shape assumes one. Every route
 * therefore has to pick a season, and it picks the latest one present rather
 * than a hardcoded string — the day 2026-27 is ingested, the app should follow
 * without an edit.
 */

import type { Queryable } from '../db/pool.js';

/**
 * The most recent season with dimension rows.
 *
 * Read from `player_seasons` rather than `player_gameweeks` on purpose: during
 * a preseason the new season's players exist before any match has been played,
 * and that is the season the app should be showing. Rule 8's '2016-17' TEXT
 * format sorts correctly under a plain max() and will until the year 2100.
 */
export async function latestSeason(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ season: string | null }>(
    'SELECT max(season) AS season FROM player_seasons'
  );
  const season = rows[0]?.season;
  if (!season) {
    throw new Error(
      'No seasons in the database. Run: npm run ingest:dimensions, ' +
        'ingest:fixtures, ingest:gameweeks.'
    );
  }
  return season;
}

/** Every season present, oldest first. */
export async function listSeasons(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ season: string }>(
    'SELECT DISTINCT season FROM player_seasons ORDER BY season'
  );
  return rows.map((r) => r.season);
}

export async function seasonExists(db: Queryable, season: string): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM player_seasons WHERE season = $1) AS exists',
    [season]
  );
  return rows[0].exists;
}

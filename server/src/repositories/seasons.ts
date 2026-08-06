/**
 * Season lookups.
 *
 * The database holds eleven seasons; the FPL API shape assumes one. Every route
 * therefore has to pick a season, and it picks the latest one present rather
 * than a hardcoded string — which is how 2026-27 became the default the day it
 * was ingested, without an edit.
 *
 * Since item 8 the client can choose instead of accepting the default, so
 * `listSeasons` is served on every bootstrap rather than only on a 400.
 */

import type { Queryable } from '../db/pool.js';

/**
 * The most recent season with dimension rows. This is what `resolveSeason` in
 * ../routes/fpl.ts defaults to, so it is the season the whole app shows.
 *
 * Read from `player_seasons` rather than `player_gameweeks` on purpose, and
 * item 4 is where that stopped being hypothetical: 2026-27 has a roster, a
 * schedule and deadlines, and not one match played. Two answers were available
 * and this is the one taken.
 *
 * **The default follows the data, not the calendar.** The moment a new season
 * has dimension rows it becomes the default, and the pages that aggregate over
 * `player_gameweeks` show a season with nothing in it. That is not left to look
 * like a broken app: the Dashboard's three rankings render an explicit
 * "no matches recorded yet" state, and they gate it on every player having zero
 * appearances rather than on the date — see client/src/pages/Dashboard.tsx for
 * why the distinction matters. The Players list shows the new roster with zeros
 * in the stat columns, the Fixtures page shows a full unplayed schedule, and
 * the player detail page shows "registered, no rows yet", which is the empty
 * state item 1 wrote for exactly this and could not reach until now.
 *
 * The alternative — default to the latest season that has gameweek rows and
 * leave the new one reachable only by `?season=` — was rejected because at the
 * time there was no season selector in the UI. It would have made the season
 * everybody is actually playing invisible except as a career row filed under
 * "Previous Seasons", which is a worse lie than an honest empty table.
 *
 * Item 8 built that selector, which removes the "otherwise invisible" half of
 * the argument and leaves the conclusion standing: every season is one click
 * away now, so this only decides what the app *opens* on — and that is still
 * the season being played.
 *
 * Whoever hits this again in August 2027: the question is not "which season has
 * data" but "which season is the app about". It is about the one being played.
 *
 * Rule 8's '2016-17' TEXT format sorts correctly under a plain max() and will
 * until the year 2100.
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

/**
 * Every season present, **newest first**.
 *
 * One ordering, decided here, and no caller re-sorts. This is what the season
 * selector renders and what the `available` array on an unknown-season 400
 * carries; if the client sorted independently the two would eventually disagree
 * about something neither of them states. Newest first because that is the
 * order a selector wants — the season being played sits at the top.
 *
 * Rule 8's '2016-17' TEXT format sorts correctly as text, so DESC is the whole
 * of it.
 */
export async function listSeasons(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ season: string }>(
    'SELECT DISTINCT season FROM player_seasons ORDER BY season DESC'
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

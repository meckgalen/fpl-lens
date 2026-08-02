/**
 * Fixture reads, and the gameweek list derived from them.
 *
 * Team ids are `teams.fpl_team_code` here too — see ./teams.ts.
 *
 * `kickoff_time` is formatted in SQL rather than handed over as a timestamptz.
 * node-postgres would give back a JS Date, which serialises with milliseconds
 * ('...T19:00:00.000Z') where the FPL API has none ('...T19:00:00Z'). Doing it
 * here keeps the wire format byte-identical instead of near enough.
 */

import type { Queryable } from '../db/pool.js';

const KICKOFF_UTC = `to_char(f.kickoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export interface FixtureRow {
  /** Our own surrogate key. Permanent, and verified stable across re-ingest. */
  id: number;
  /**
   * FPL's permanent fixture code. We never ingested it, so there is nothing to
   * return and nothing worth inventing. Comes from the live sync later.
   */
  code: null;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  /** NULL for 2016-17 and 2017-18: no fixtures.csv upstream, no ratings (rule 14). */
  team_h_difficulty: number | null;
  team_a_difficulty: number | null;
  kickoff_time: string | null;
  finished: boolean;
}

/** One season's fixtures, optionally a single gameweek. */
export async function listFixtures(
  db: Queryable,
  season: string,
  gw?: number
): Promise<FixtureRow[]> {
  const { rows } = await db.query<FixtureRow>(
    `SELECT f.id,
            NULL::int AS code,
            f.gw AS event,
            home.fpl_team_code AS team_h,
            away.fpl_team_code AS team_a,
            f.home_score AS team_h_score,
            f.away_score AS team_a_score,
            f.home_difficulty AS team_h_difficulty,
            f.away_difficulty AS team_a_difficulty,
            ${KICKOFF_UTC} AS kickoff_time,
            f.finished
       FROM fixtures f
       JOIN teams home ON home.id = f.home_team_id
       JOIN teams away ON away.id = f.away_team_id
      WHERE f.season = $1
        AND ($2::int IS NULL OR f.gw = $2)
      ORDER BY f.gw, f.kickoff_time, f.id`,
    [season, gw ?? null]
  );
  return rows;
}

export interface EventRow {
  /** The gameweek number. */
  id: number;
  name: string;
  deadline_time: null;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

/**
 * The gameweek list, derived from `fixtures` — there is no events table, and
 * the parts that are genuinely derivable are derived rather than guessed.
 *
 *   id       the round number
 *   name     'Gameweek {n}', as the FPL API names them
 *   finished true when every fixture in the round has been played
 *
 * Not derivable, so not invented:
 *
 *   deadline_time  the deadline is ~90 minutes before the first kick-off, and
 *                  nothing in the database records it. NULL, from the live
 *                  sync later. The client is already null-safe here.
 *   is_current /   live-season concepts. Over a season that finished years ago
 *   is_next        there is no "current" round, so both are false rather than
 *                  a guess at the last one. The client falls back to the last
 *                  finished round on its own when nothing is flagged current.
 */
export async function listEvents(db: Queryable, season: string): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT f.gw AS id,
            'Gameweek ' || f.gw AS name,
            NULL::text AS deadline_time,
            bool_and(f.finished) AS finished,
            false AS is_current,
            false AS is_next
       FROM fixtures f
      WHERE f.season = $1 AND f.gw IS NOT NULL
      GROUP BY f.gw
      ORDER BY f.gw`,
    [season]
  );
  return rows;
}

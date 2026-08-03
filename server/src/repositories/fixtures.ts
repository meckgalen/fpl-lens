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
import type { Fixture, Gameweek } from '../types/domain.js';

const KICKOFF_UTC = `to_char(f.kickoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** Same treatment for the gameweek deadline, and for the same reason. */
const DEADLINE_UTC = `to_char(deadline_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * One season's fixtures, optionally a single gameweek.
 *
 * No mapper: scores and difficulties are smallint, ids are integer, and
 * kickoff_time is already formatted to text above. Nothing arrives as a string
 * that ought to be a number.
 *
 * `code` — FPL's own permanent fixture code — is not selected here. It was
 * never ingested, so it has no domain value; the route adds it as null, which
 * is where an absent-by-construction field belongs.
 */
export async function listFixtures(
  db: Queryable,
  season: string,
  gw?: number
): Promise<Fixture[]> {
  const { rows } = await db.query<Fixture>(
    `SELECT f.id,
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

/**
 * The gameweek list.
 *
 *   id            the round number
 *   name          'Gameweek {n}', as the FPL API names them
 *   finished      true when every fixture in the round has been played
 *   deadline_time from `events`, NULL for the ten CSV seasons
 *   is_current    derived, see below
 *   is_next       derived, see below
 *
 * **Which rounds exist comes from `fixtures`, and only from `fixtures`.** The
 * rows are NOT `1..n`: 2019-20 runs 1-29 and then 39-47, the nine rounds in
 * between having been emptied by the Covid suspension and replayed at the end;
 * 2022-23 has no round 7, postponed after the Queen's death. That derivation
 * has been right about both, so `events` joins onto it rather than the other
 * way round — a second list of rounds is a list that can disagree.
 *
 * The join is a LEFT JOIN for the same reason. Every one of the ten backfilled
 * seasons has fixtures and no deadlines, and a round with no deadline is still
 * a round.
 *
 * **is_current and is_next are computed here, from the deadline against the
 * clock, and never stored.** FPL publishes its own flags on every bootstrap and
 * storing them would make them a snapshot: correct at sync time and wrong every
 * hour after it. Derived, they cannot go stale between syncs. The definitions:
 *
 *   is_next     the earliest round whose deadline is still in the future
 *   is_current  the latest round whose deadline has passed
 *
 * Before the first deadline of a season there is no current round at all, which
 * is the right answer for a pre-season and is the state 2026-27 is in today.
 * A season with no `events` rows has both false on every round — which is
 * exactly what API identity rule 6 has always said about a completed season,
 * now arrived at by construction instead of by a hardcoded false in the route.
 */
export async function listEvents(db: Queryable, season: string): Promise<Gameweek[]> {
  const { rows } = await db.query<Gameweek>(
    `WITH rounds AS (
       SELECT f.gw AS id,
              bool_and(f.finished) AS finished,
              max(e.deadline_time) AS deadline_time
         FROM fixtures f
         LEFT JOIN events e ON e.season = f.season AND e.gw = f.gw
        WHERE f.season = $1 AND f.gw IS NOT NULL
        GROUP BY f.gw
     )
     SELECT id,
            'Gameweek ' || id AS name,
            finished,
            ${DEADLINE_UTC} AS deadline_time,
            deadline_time IS NOT NULL
              AND deadline_time <= now()
              AND deadline_time = max(deadline_time) FILTER (WHERE deadline_time <= now()) OVER ()
              AS is_current,
            deadline_time IS NOT NULL
              AND deadline_time > now()
              AND deadline_time = min(deadline_time) FILTER (WHERE deadline_time > now()) OVER ()
              AS is_next
       FROM rounds
      ORDER BY id`,
    [season]
  );
  return rows;
}

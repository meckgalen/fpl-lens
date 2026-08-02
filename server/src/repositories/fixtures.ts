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
 * The gameweek list, derived from `fixtures` — there is no events table, and
 * the parts that are genuinely derivable are derived rather than guessed.
 *
 *   id       the round number
 *   name     'Gameweek {n}', as the FPL API names them
 *   finished true when every fixture in the round has been played
 *
 * The rows are NOT `1..n`. 2019-20 runs 1-29 and then 39-47, the nine rounds in
 * between having been emptied by the Covid suspension and replayed at the end;
 * 2022-23 has no round 7, postponed after the Queen's death. Anything treating
 * the length of this array as the highest round number is wrong in both, in
 * opposite directions.
 *
 * deadline_time, is_current and is_next are not derivable and are not invented
 * here — the route adds them. See ../types/api.ts.
 */
export async function listEvents(db: Queryable, season: string): Promise<Gameweek[]> {
  const { rows } = await db.query<Gameweek>(
    `SELECT f.gw AS id,
            'Gameweek ' || f.gw AS name,
            bool_and(f.finished) AS finished
       FROM fixtures f
      WHERE f.season = $1 AND f.gw IS NOT NULL
      GROUP BY f.gw
      ORDER BY f.gw`,
    [season]
  );
  return rows;
}

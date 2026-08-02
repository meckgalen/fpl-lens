/**
 * Team reads.
 *
 * Every team id leaving this layer is `teams.fpl_team_code`, the permanent
 * code, never `team_seasons.fpl_team_id`. The season-scoped id is 1..20 and
 * reshuffles alphabetically whenever a club is promoted or relegated, so
 * putting it in an API response would mean "team 14" naming a different club
 * every August. It stays confined to the ingest layer, exactly as rule 5 keeps
 * it out of stored rows.
 */

import type { Queryable } from '../db/pool.js';

export interface TeamRow {
  /** teams.fpl_team_code — permanent across seasons. */
  id: number;
  name: string;
  short_name: string;
  /** NULL for 2016-17..2018-19: no teams.csv upstream, so no ratings (rule 15). */
  strength_overall_home: number | null;
  strength_overall_away: number | null;
  strength_attack_home: number | null;
  strength_attack_away: number | null;
  strength_defence_home: number | null;
  strength_defence_away: number | null;
}

/** The 20 clubs of one season, ordered by name as the FPL API orders them. */
export async function listTeams(db: Queryable, season: string): Promise<TeamRow[]> {
  const { rows } = await db.query<TeamRow>(
    `SELECT t.fpl_team_code AS id,
            t.name,
            t.short_name,
            ts.strength_overall_home,
            ts.strength_overall_away,
            ts.strength_attack_home,
            ts.strength_attack_away,
            ts.strength_defence_home,
            ts.strength_defence_away
       FROM team_seasons ts
       JOIN teams t ON t.id = ts.team_id
      WHERE ts.season = $1
      ORDER BY t.name`,
    [season]
  );
  return rows;
}

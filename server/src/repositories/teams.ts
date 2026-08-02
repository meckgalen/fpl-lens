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
import type { Team } from '../types/domain.js';

/**
 * The 20 clubs of one season, ordered by name as the FPL API orders them.
 *
 * No mapper: every column is text, integer or smallint, all of which the driver
 * already returns in their final form. The strengths are smallint and nullable
 * (rule 15), and nullable is what they stay.
 */
export async function listTeams(db: Queryable, season: string): Promise<Team[]> {
  const { rows } = await db.query<Team>(
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

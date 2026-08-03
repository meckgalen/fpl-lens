/**
 * The fixtures writer for the live season, shared by its two callers.
 *
 * `ingest-live-season.ts` loads a season's schedule before a ball is kicked;
 * `ingest-live-gameweeks.ts` refreshes it every run, because it has to know
 * which matches have settled before it writes any match rows. Item 5 pulled the
 * build and the upsert out here rather than giving the second script its own
 * copy — two writers of one table with two implementations is how a column ends
 * up maintained on one path and not the other.
 *
 * **Why the gameweek sync refreshes fixtures at all**, rather than declaring
 * `ingest:live` a prerequisite: every 2026-27 fixture is `finished: false` from
 * the pre-season load and nothing updates that until `ingest:live` runs again.
 * A sync that read the stored flag without refreshing it would write **zero
 * rows after Gameweek 1, correctly, for a reason nothing on screen explains.**
 * One extra request removes the trap entirely.
 */

import type { PoolClient } from 'pg';
import type { WireFixture, WireTeam } from '../types/wire.js';

export interface FixtureRow {
  fpl_fixture_id: number;
  gw: number | null;
  home_fpl_team_code: number;
  away_fpl_team_code: number;
  kickoff_time: string | null;
  finished: boolean;
  finished_provisional: boolean;
  home_score: number | null;
  away_score: number | null;
  home_difficulty: number | null;
  away_difficulty: number | null;
}

/**
 * Season-scoped team id -> permanent team code.
 *
 * Built from the bootstrap's own team list and used to resolve every fixture,
 * so nothing season-scoped leaves this layer (rules 2 and 5, one step earlier
 * than the repositories usually apply them).
 */
export function teamCodesByFplId(teams: WireTeam[]): Map<number, number> {
  return new Map(teams.map((t) => [t.id, t.code]));
}

function normaliseText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'None' ? null : trimmed;
}

/** Pure: wire fixtures to the rows to be written. */
export function buildFixtureRows(
  wireFixtures: WireFixture[],
  codeByTeamId: Map<number, number>
): FixtureRow[] {
  return wireFixtures.map((fixture) => {
    const home = codeByTeamId.get(fixture.team_h);
    const away = codeByTeamId.get(fixture.team_a);
    if (home === undefined || away === undefined) {
      throw new Error(
        `live ingest: fixture ${fixture.id} names season team ids ` +
          `${fixture.team_h}/${fixture.team_a}, which are not both in the bootstrap`
      );
    }
    return {
      fpl_fixture_id: fixture.id,
      // Nullable on purpose, and it belongs in the upsert's SET list: FPL
      // leaves `event` empty on a fixture it has not scheduled and nulls it on
      // a postponement until a new round is assigned. Writing NULL is the
      // correct behaviour there; throwing would be the script failing on real
      // data. All 380 carry a round today.
      gw: fixture.event,
      home_fpl_team_code: home,
      away_fpl_team_code: away,
      kickoff_time: normaliseText(fixture.kickoff_time),
      // Both flags, because neither alone says what the gameweek sync needs to
      // know. See the migration for why the conjunction is the answer and why
      // which-is-which cannot be established until a match is in play.
      finished: fixture.finished,
      finished_provisional: fixture.finished_provisional,
      home_score: fixture.team_h_score,
      away_score: fixture.team_a_score,
      home_difficulty: fixture.team_h_difficulty,
      away_difficulty: fixture.team_a_difficulty,
    };
  });
}

/**
 * Upsert one season's fixtures.
 *
 * Never delete-and-reinsert: `fixtures.id` is the foreign key target
 * `player_gameweeks` carries, and renumbering it would repoint match rows at
 * other matches with no constraint violation to catch it.
 */
export async function writeFixtures(
  client: PoolClient,
  season: string,
  rows: FixtureRow[],
  chunkSize = 500
): Promise<void> {
  if (rows.length === 0) return;

  const { rows: teamRows } = await client.query<{ id: number; code: number }>(
    'SELECT id, fpl_team_code AS code FROM teams'
  );
  const teamIdByCode = new Map(teamRows.map((r) => [r.code, r.id]));

  const values = rows.map((f) => {
    const home = teamIdByCode.get(f.home_fpl_team_code);
    const away = teamIdByCode.get(f.away_fpl_team_code);
    if (!home || !away) throw new Error(`unresolved team code on fixture ${f.fpl_fixture_id}`);
    return [
      season,
      f.fpl_fixture_id,
      f.gw,
      home,
      away,
      f.kickoff_time,
      f.finished,
      f.finished_provisional,
      f.home_score,
      f.away_score,
      f.home_difficulty,
      f.away_difficulty,
    ];
  });

  const columnsPerRow = 12;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const valuesClause = chunk
      .map(
        (_, r) =>
          `(${Array.from({ length: columnsPerRow }, (_, c) => `$${r * columnsPerRow + c + 1}`).join(',')})`
      )
      .join(',');
    await client.query(
      `INSERT INTO fixtures
         (season, fpl_fixture_id, gw, home_team_id, away_team_id, kickoff_time,
          finished, finished_provisional, home_score, away_score,
          home_difficulty, away_difficulty)
       VALUES ${valuesClause}
       ON CONFLICT (season, fpl_fixture_id) DO UPDATE SET
         gw                   = EXCLUDED.gw,
         home_team_id         = EXCLUDED.home_team_id,
         away_team_id         = EXCLUDED.away_team_id,
         kickoff_time         = EXCLUDED.kickoff_time,
         finished             = EXCLUDED.finished,
         finished_provisional = EXCLUDED.finished_provisional,
         home_score           = EXCLUDED.home_score,
         away_score           = EXCLUDED.away_score,
         home_difficulty      = EXCLUDED.home_difficulty,
         away_difficulty      = EXCLUDED.away_difficulty`,
      chunk.flat()
    );
  }
}

/**
 * The SQL test for "this match has settled", as one string so no caller writes
 * it by hand.
 *
 * `finished AND finished_provisional` alone is **NULL**, not false, for the two
 * seasons that have no `fixtures.csv` upstream and therefore no provisional
 * flag — which would quietly exclude 2016-17 and 2017-18 from anything asking
 * this question, the opposite of the documented rule that NULL means settled.
 */
export const SETTLED_SQL = (alias = 'f') =>
  `${alias}.finished AND COALESCE(${alias}.finished_provisional, true)`;

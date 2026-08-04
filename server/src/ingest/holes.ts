/**
 * Holes in the source: where a column is stored as 0 for a match nobody
 * measured it in.
 *
 * Rule 6 says a column absent from a season is NULL, never 0 — 0 asserts a
 * measurement, NULL records its absence. The rule was written for a whole
 * season, and the upstream CSVs break it at a finer grain than that: the
 * scraper began collecting `starts` and the expected family at round 16 of
 * 2022-23 and wrote `0` for the fourteen rounds before it. The column is
 * present in the file's header from round 1, so nothing about the shape of the
 * data says it is missing; only the values do.
 *
 * This is rule 6 applied per fixture instead of per season, and it is the one
 * place that rule lives. Both gameweek writers call it — see the note on
 * `findHoles`'s column parameter for why the verify script calls it with a
 * different set.
 *
 * **What makes a hole detectable, and why it is a fact about football rather
 * than about the data.** A hole is a fixture where a column totals exactly
 * zero across all 22 players who took the field. That is impossible for
 * `starts` (eleven a side, by the laws of the game) and for the expected
 * family, which accrues to everyone on the pitch from the first shot faced. A
 * played match totalling exactly zero on any of them is not a football result.
 *
 * The same reasoning does not extend to most columns: a match with no goals, no
 * cards and no own goals is an ordinary Tuesday, so a hole in a sparse column
 * is undetectable this way and this module can never be widened to cover one.
 */

import type { PoolClient } from 'pg';

/**
 * The columns the ingest fixes.
 *
 * Five, not the nine the verify script can detect. The ICT quartet is holed
 * too — 26 fixtures across three seasons — and is deliberately left storing 0.
 * The reasoning is proportion and is recorded in CLAUDE.md: those holes are
 * whole rounds, so representing them would blank the ICT total for every player
 * in 2021-22 and 2022-23 to correct an error of one round in thirty-eight, and
 * the four columns are NOT NULL in the schema, so it would also mean loosening
 * an invariant that holds on all 253,509 rows but these.
 */
export const HOLED_COLUMNS = [
  'starts',
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'expected_goals_conceded',
] as const;

export interface Hole {
  season: string;
  gw: number | null;
  fixtureId: number;
  /** The columns holed on this fixture. Never empty. */
  columns: string[];
}

/**
 * Fixtures where a column was not measured, in a season that measured it
 * elsewhere.
 *
 * **The column set is a parameter, and the callers deliberately pass different
 * sets.** Both ingests pass `HOLED_COLUMNS` (five, the ones they NULL); the
 * verify script passes all nine it can detect, because it only *observes*
 * holes and its attribution has to keep covering the ICT quartet that nothing
 * fixes. Unifying the two into one constant drops 26 fixtures out of that
 * attribution: measured, the verify run goes from 38 unexplained cells to 146.
 * (Not more, because the blank-*row* detector catches much of the ICT family on
 * its own — which is why this is worth pinning rather than trusting to show up
 * as an obvious explosion.)
 *
 * Three conditions, each load-bearing:
 *
 *   - `sum(minutes) > 0` — the match was actually played. A fixture nobody
 *     appeared in is not evidence of anything.
 *   - the column totals 0 across the fixture, **or** is NULL on every row of
 *     it. Both shapes are recognised so the rule is idempotent: after a
 *     re-ingest the holes are NULL rather than 0, and a detector that knew only
 *     the 0 shape would stop seeing the holes it had just fixed. `sum()` skips
 *     NULLs, so `sum(col) = 0` is NULL — not false — over an all-NULL column,
 *     which is precisely how that regression would hide.
 *   - the column holds a value — any value, including 0 — somewhere in the same
 *     season. This is what separates a hole from rule 6, and it is the clause
 *     the obvious query omits: without it, `starts` being NULL for the whole of
 *     2016-17 flags every fixture in three seasons and blanks them.
 *
 * **That third condition is `count(col) > 0`, not `sum(col) > 0`, and the
 * difference only shows up on a live season.** Both are identical across all
 * ten CSV seasons — 2016-17 is NULL throughout and every measuring season has
 * non-zero totals — so the choice cannot be made by looking at the backfill.
 * It is decided by round 1 of a live season, where every stored value of a
 * column might legitimately be 0:
 *
 *   - `sum(col) > 0` would call that season "not measured" and report nothing,
 *     storing the zeros. The hole becomes visible only once round 2 arrives
 *     with real values — so it self-heals, a week late and silently.
 *   - `count(col) > 0` calls it measured, flags the fixtures, and the sync
 *     reports them. The zeros never reach the database.
 *
 * The second is right because the premise of this whole module is that a played
 * match totalling zero on one of these columns is not a football result. That
 * is true of the first round of a season exactly as it is of the twentieth, so
 * there is nothing for a second round to add. It also fails in the safe
 * direction: NULL means "not measured", which is what a zero here always
 * means, and the live sync's upsert overwrites it the moment FPL publishes.
 */
export async function findHoles(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  seasons?: readonly string[]
): Promise<Hole[]> {
  if (columns.length === 0) return [];

  // Two aggregates per column, at two different grains: per fixture, whether
  // the column is holed; per season, whether it is measured at all. The season
  // grain is the rule-6 guard and cannot be computed from the fixture rows
  // alone.
  const fixtureFlags = columns
    .map((c) => `(sum(${c}) = 0 OR count(${c}) = 0) AS ${c}_holed`)
    .join(',\n             ');
  const seasonFlags = columns.map((c) => `count(${c}) > 0 AS ${c}_measured`).join(',\n             ');

  const scope = seasons ? 'WHERE season = ANY($1)' : '';
  const params = seasons ? [[...seasons]] : [];

  const { rows } = await client.query<Record<string, unknown>>(
    `WITH fixture AS (
       SELECT season, fixture_id, min(gw) AS gw,
              ${fixtureFlags}
         FROM ${table}
         ${scope}
        GROUP BY season, fixture_id
       HAVING sum(minutes) > 0
     ),
     measured AS (
       SELECT season,
              ${seasonFlags}
         FROM ${table}
         ${scope}
        GROUP BY season
     )
     SELECT f.season, f.fixture_id, f.gw,
            ${columns.map((c) => `(f.${c}_holed AND m.${c}_measured) AS ${c}`).join(',\n            ')}
       FROM fixture f
       JOIN measured m ON m.season = f.season
      ORDER BY f.season, f.gw, f.fixture_id`,
    params
  );

  const holes: Hole[] = [];
  for (const row of rows) {
    const holed = columns.filter((c) => row[c] === true);
    if (holed.length === 0) continue;
    holes.push({
      season: String(row.season),
      gw: row.gw === null ? null : Number(row.gw),
      fixtureId: Number(row.fixture_id),
      columns: holed,
    });
  }
  return holes;
}

/**
 * Write NULL where `findHoles` found a hole.
 *
 * Grouped by the column set so a fixture holed on five columns costs one
 * statement rather than five, and so a fixture holed on one is not widened to
 * the rest. Returns the number of rows touched, which the callers report.
 */
export async function applyHoles(
  client: PoolClient,
  table: string,
  holes: readonly Hole[]
): Promise<number> {
  if (holes.length === 0) return 0;

  const byColumns = new Map<string, Hole[]>();
  for (const hole of holes) {
    const key = [...hole.columns].sort().join(',');
    const group = byColumns.get(key);
    if (group) group.push(hole);
    else byColumns.set(key, [hole]);
  }

  let touched = 0;
  for (const [key, group] of byColumns) {
    const columns = key.split(',');
    const result = await client.query(
      `UPDATE ${table}
          SET ${columns.map((c) => `${c} = NULL`).join(', ')}
        WHERE (season, fixture_id) IN (
                SELECT * FROM unnest($1::text[], $2::int[])
              )`,
      [group.map((h) => h.season), group.map((h) => h.fixtureId)]
    );
    touched += result.rowCount ?? 0;
  }
  return touched;
}

/** One line per hole group, for a run report. Grouped by season, round and column set. */
export function summariseHoles(holes: readonly Hole[]): string[] {
  const groups = new Map<string, { season: string; gw: number | null; columns: string; n: number }>();
  for (const hole of holes) {
    const columns = [...hole.columns].sort().join(', ');
    const key = `${hole.season}|${hole.gw}|${columns}`;
    const group = groups.get(key);
    if (group) group.n++;
    else groups.set(key, { season: hole.season, gw: hole.gw, columns, n: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => a.season.localeCompare(b.season) || (a.gw ?? 0) - (b.gw ?? 0))
    .map(
      (g) =>
        `${g.season} gw ${g.gw ?? '—'}: ${g.n} fixture${g.n === 1 ? '' : 's'} — ${g.columns}`
    );
}

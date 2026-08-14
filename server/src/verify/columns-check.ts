/**
 * Does the column picker offer exactly what the data can answer?
 *
 * Read-only. For every season and every column the Players list can show, this
 * compares **what the picker would claim** against **what the rows actually
 * say**, derived independently.
 *
 *   - The claim comes from the shipped code: `seasonAvailability` builds what
 *     `bootstrap.columns` carries, `listColumnHistory` builds the matrix, and
 *     the client's own `resolveColumn` turns the pair into available/not. That
 *     is the same path the browser takes, so this checks the thing that ships
 *     rather than a description of it.
 *   - The truth comes from a query written for this file and nowhere else:
 *     `count(*)` and `count(*) FILTER (WHERE col IS NULL)`, counting NULLs
 *     **directly** rather than asking `count(col) = count(*)`. Different
 *     question, same answer — which is the point (working agreement:
 *     verification must not share its derivation with the thing it verifies).
 *
 * **It imports the client's `lib/playerColumns.ts` on purpose**, exactly as
 * `verify:ppg` imports `lib/averages.ts`. A check that reimplemented the
 * availability rule would agree with itself and prove nothing. The cost is that
 * this file sits outside the server's tsc program — see `server/tsconfig.json`.
 *
 * Exits non-zero on any mismatch.
 */

import { pool, closePool } from '../db/pool.js';
import { listSeasons } from '../repositories/seasons.js';
import { listColumnHistory, seasonAvailability } from '../repositories/columns.js';
import { PLAYER_COLUMNS, resolveColumn } from '../../../client/src/lib/playerColumns';
import type { ColumnHistoryRow } from '../../../client/src/types/fpl';

/**
 * What the rows say, per season and column, counted from scratch.
 *
 * `count(*) FILTER (WHERE col IS NULL)` rather than `count(col)`. The two are
 * complements and a bug in one is not a bug in the other, which is the only
 * reason this file is worth running.
 */
async function truthFor(season: string, columns: string[]): Promise<Map<string, boolean>> {
  const nullCounts = columns
    .map((c) => `count(*) FILTER (WHERE ${c} IS NULL) AS ${c}_nulls`)
    .join(', ');

  const { rows } = await pool.query<Record<string, string>>(
    `SELECT count(*) AS total, ${nullCounts} FROM player_gameweeks WHERE season = $1`,
    [season]
  );

  const total = Number(rows[0].total);
  const out = new Map<string, boolean>();
  for (const c of columns) {
    // Available means: the season has rows at all, AND not one of them is NULL.
    out.set(c, total > 0 && Number(rows[0][`${c}_nulls`]) === 0);
  }
  return out;
}

/**
 * The database columns a picker key reads, for the nullable ones.
 *
 * A **list** since item 14, because a derived column reads more than one: the
 * hit count comes from `defensive_contribution`, and hits-per-start divides it
 * by `starts`. Truth for such a column is the AND over its inputs — it can be
 * offered only where every column feeding it is complete.
 *
 * **Declared here rather than read off the shipped `dependsOn`, deliberately.**
 * This file already imports the shipped *logic* on purpose, so that it checks
 * what actually runs; the *data* it checks against has to be restated, or the
 * check agrees with itself and proves nothing (working agreement: verification
 * must not share its derivation with the thing it verifies). A dependency
 * declared wrong on the column definition shows up here as a mismatch, which is
 * exactly what this list is for.
 *
 * That split is not a reversal of item 13's decision to move `seasonAvailability`
 * into `columns.ts` so this file could import it. Same rule, applied to two
 * different things: import the logic, restate the data.
 */
const DB_COLUMNS: Record<string, string[]> = {
  starts: ['starts'],
  expected_goals: ['expected_goals'],
  expected_assists: ['expected_assists'],
  expected_goal_involvements: ['expected_goal_involvements'],
  defensive_contribution: ['defensive_contribution'],
  defcon_hits: ['defensive_contribution'],
  defcon_hits_per_start: ['defensive_contribution', 'starts'],
  // Item 19's ratios. `starts` alone: the counts themselves derive from
  // `total_points`, which is NOT NULL in every season and so can never be the
  // restrictive input. The two count columns are non-nullable and need no row
  // here — `main` only demands a mapping for nullable picker keys.
  hauls_per_start: ['starts'],
  floors_per_start: ['starts'],
};

async function main(): Promise<void> {
  const seasons = await listSeasons(pool);
  const matrix: ColumnHistoryRow[] = await listColumnHistory(pool);

  console.log('Column availability: what the picker offers vs what the rows hold.');
  console.log(`${seasons.length} seasons x ${PLAYER_COLUMNS.length} columns\n`);

  const nullableKeys = PLAYER_COLUMNS.filter((c) => c.nullable).map((c) => c.key);
  for (const k of nullableKeys) {
    if (!DB_COLUMNS[k]?.length)
      throw new Error(`No database column mapped for nullable key '${k}'`);
  }
  // The distinct set to query, since two picker keys can share a source column.
  const dbColumns = [...new Set(nullableKeys.flatMap((k) => DB_COLUMNS[k]))];

  let compared = 0;
  let agreed = 0;
  const mismatches: string[] = [];
  const perSeason: string[] = [];

  for (const season of seasons) {
    const availability = await seasonAvailability(pool, season);
    const truth = await truthFor(season, dbColumns);

    let offered = 0;
    let withheld = 0;

    for (const col of PLAYER_COLUMNS) {
      const claim = resolveColumn(col, availability, matrix, seasons).available;

      // The truth, stated from the schema and the rows rather than from the
      // shipped predicate:
      //   - a field with no source is never available, whatever the season;
      //   - a NOT NULL column is always available;
      //   - a nullable one is available exactly when no row of it is NULL, and
      //     a DERIVED one exactly when that holds for every column it reads.
      const expected = col.unavailable
        ? false
        : !col.nullable
          ? true
          : DB_COLUMNS[col.key].every((c) => truth.get(c) ?? false);

      compared++;
      if (claim === expected) agreed++;
      else
        mismatches.push(
          `   ${season}  ${col.key.padEnd(28)} picker says ${claim ? 'available' : 'unavailable'}, rows say ${expected ? 'available' : 'unavailable'}`
        );

      if (claim) offered++;
      else withheld++;
    }

    perSeason.push(
      `   ${season}  offered ${String(offered).padStart(2)}   withheld ${String(withheld).padStart(2)}${
        availability.measured ? '' : '   (no matches recorded)'
      }`
    );
  }

  console.log('Per season:');
  for (const line of perSeason) console.log(line);

  const rate = ((100 * agreed) / compared).toFixed(2);
  console.log(`\n   compared   ${compared}`);
  console.log(`   agreed     ${agreed}  (${rate}%)`);
  console.log(`   mismatched ${mismatches.length}`);
  for (const line of mismatches) console.log(line);

  console.log('\nRead-only: nothing was written to the database.\n');
  await closePool();

  if (mismatches.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

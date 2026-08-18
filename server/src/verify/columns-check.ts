/**
 * Two questions about the Players list's columns, never merged into one verdict.
 *
 *   - **Part 1: does the picker OFFER exactly what the data can answer?**
 *   - **Part 2: do the WITHHELD ones actually arrive empty?**
 *
 * Part 2 exists because part 1 cannot see a value at all, and item 19 shipped a
 * defect straight through that gap: `hauls_started` read `0` for all 564 players
 * of 2026-27 — asserting they started no 10-point fixture rather than that
 * nothing had been played — and the availability layer disabled the column that
 * reads it, so the wrong number sat behind a disabled picker entry where nothing
 * looked at it. Offering the right set of columns and filling them with the
 * right values are two claims, and only one of them was being checked.
 *
 * Read-only. Exits non-zero if either part disagrees.
 *
 * ---
 *
 * Part 1. For every season and every column the Players list can show, this
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
 * this file sits outside the server's tsc program — see `server/tsconfig.json`,
 * and see `verify/payload-fields.ts` for why part 2's field map lives in a file
 * that IS typechecked.
 */

import { pool, closePool } from '../db/pool.js';
import { listSeasons } from '../repositories/seasons.js';
import { listColumnHistory, seasonAvailability } from '../repositories/columns.js';
import { listPlayerTotals } from '../repositories/players.js';
import type { PlayerSeasonTotals } from '../types/domain.js';
import {
  ALWAYS_FIELDS,
  MEASURED_FIELDS,
  PAYLOAD_FIELDS,
  TRUTH_COLUMNS,
  type PayloadField,
} from './payload-fields.js';
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

async function partOne(seasons: string[]): Promise<number> {
  const matrix: ColumnHistoryRow[] = await listColumnHistory(pool);

  console.log('Part 1 — what the picker offers vs what the rows hold.');
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

  return mismatches.length;
}

/* ------------------------------------------------------------------ part 2 */

/**
 * What the rows say about ONE player-season, counted from scratch.
 *
 * `count(*) FILTER (WHERE col IS NULL)` per player, over `player_gameweeks`
 * alone. **No LEFT JOIN, deliberately**: the null-extension that produced the
 * defect must not exist in the query that judges it. A player with no match rows
 * is simply absent from this map, which is a fact about the set rather than a
 * row of zeroes that has to be interpreted.
 *
 * The grain is the player, not the season, and that is load-bearing: 2022-23
 * measures `starts` from round 16, so 661 of its 778 players have a holed row
 * and the other 117 — who arrived after the boundary — legitimately keep a real
 * total. A season-level `partial` cannot express that, which is why this does
 * not reuse `seasonAvailability`.
 */
interface PlayerTruth {
  rows: number;
  nulls: Record<string, number>;
}

async function truthPerPlayer(season: string): Promise<Map<number, PlayerTruth>> {
  const nullCounts = TRUTH_COLUMNS.map(
    (c) => `count(*) FILTER (WHERE pg.${c} IS NULL)::int AS ${c}_nulls`
  ).join(',\n            ');

  const { rows } = await pool.query<Record<string, number>>(
    `SELECT p.fpl_code AS id,
            count(*)::int AS rows,
            ${nullCounts}
       FROM player_gameweeks pg
       JOIN players p ON p.id = pg.player_id
      WHERE pg.season = $1
      GROUP BY p.fpl_code`,
    [season]
  );

  const out = new Map<number, PlayerTruth>();
  for (const r of rows) {
    const nulls: Record<string, number> = {};
    for (const c of TRUTH_COLUMNS) nulls[c] = Number(r[`${c}_nulls`]);
    out.set(Number(r.id), { rows: Number(r.rows), nulls });
  }
  return out;
}

/**
 * How many (player, field) cells must read NULL, per season. Frozen.
 *
 * These are the ten CSV-backfilled seasons, whose rows do not change. **Their
 * immutability is an assumption rather than a fact** — it holds only as long as
 * nobody re-ingests or backfills them — and if one moves, this check fires. That
 * is the check working, not a maintenance burden: a season's measured columns
 * changing under the app is exactly the event worth being told about.
 *
 * They exist because the assertion below filters to the cells that must be null,
 * and on a fully measured season **that set is empty**. Without a frozen size, a
 * bug that emptied the set would pass on every season by checking nothing.
 * `2025-26: 0` is frozen for the same reason the others are — it is a claim that
 * the season measures everything, not an absence of a claim.
 *
 * The 2022-23 row is the one to read twice: 661 players lose `starts` (and so
 * the two haul numerators), 661 lose xG and xA, **754** lose xGI — which is
 * holed at round 29 as well as through 1-15 — and all 778 lose DC. One shared
 * "the 2022-23 boundary" number would be wrong on one column in five.
 *
 * **Item 24 moved nine of the ten**, by adding `defcon_hits_started` to
 * `PAYLOAD_FIELDS`. That is the check doing its job rather than a chore: a new
 * measured field is exactly the event these numbers exist to notice.
 *
 * The delta was derived rather than read off the failing run, which would have
 * been the new code setting its own expectation. `defcon_hits_started` is null
 * wherever DC or `starts` is unmeasured, and DC is unmeasured on **every player
 * of every season before 2025-26** — counted in SQL against `player_gameweeks`,
 * not inferred from the payload — so each of those nine seasons gains exactly
 * its own roster and 2025-26 gains nothing. Hence 2016-17's 5464 + 683, and so
 * on down; the value in each row below is old + roster, and the run agreeing
 * with it afterwards is a confirmation rather than the source.
 */
const FROZEN_UNMEASURED_CELLS: Record<string, number> = {
  '2016-17': 6147, // 5464 + 683
  '2017-18': 5823, // 5176 + 647
  '2018-19': 5616, // 4992 + 624
  '2019-20': 5994, // 5328 + 666
  '2020-21': 6417, // 5704 + 713
  '2021-22': 6633, // 5896 + 737
  '2022-23': 6393, // 5615 + 778
  '2023-24': 2595, // 1730 + 865
  '2024-25': 2352, // 1568 + 784
  '2025-26': 0, // DC and starts both measured throughout, so nothing is added
};

/**
 * Seasons expected to have no match rows at all, whose expected cell count is
 * therefore **derived rather than frozen**.
 *
 * 2026-27's count is a function of how many rounds have been ingested, so a
 * frozen literal would go red at the first `ingest:live-gameweeks` run and again
 * every round after — and a check that reddens routinely gets its number raised
 * instead of investigated, which is the failure `verify:thresholds` part 2 is
 * built around. So the expectation is `players x measured fields`, with **both
 * factors derived and neither written down**: the roster from the payload, the
 * field count from `PAYLOAD_FIELDS`. They move on independent schedules — the
 * roster as FPL registers players, the field count when an item adds a field, as
 * item 19 did — and a single frozen product would hide which one moved.
 *
 * **The premise is asserted, not assumed, and its lapse is a failure rather than
 * a skip.** This branch is only meaningful while the season has no match rows.
 * The moment it has some, a check that quietly kept applying it would pass by
 * filtering everything away — which is item 13's vacuous truth arriving in the
 * checking layer, the same shape as the guard part 2 exists to defend, one level
 * up. So it fails loudly and says the season now needs a played season's
 * treatment.
 *
 * **It is not redundant with the derived count, and that was measured rather
 * than argued.** Register 2016-17 here — every player has rows and every input
 * column is unmeasured — and the derived expectation is `683 x 8 = 5464`, which
 * is exactly what the season produces. With the premise assertion the run
 * reddens; with only the assertion commented out it goes **green** on a season
 * whose premise is false. The count agrees with itself precisely when the branch
 * has stopped meaning anything.
 */
const EXPECTED_UNPLAYED = new Set(['2026-27']);

/**
 * Part 2: does every withheld field actually arrive empty, and every measured
 * one arrive full?
 *
 * **Both sides read shipped code, and that is NOT the `verify:haul` part 2B
 * mistake.** 2B hand-wrote SQL restating the same expression the aggregate uses,
 * so a mutation to the shipped query moved neither side and it stayed green —
 * a check that could not fail for the reason it existed. Here the payload comes
 * from the aggregate expressions in `listPlayerTotals` and the truth from
 * counting NULLs in `player_gameweeks`: genuinely different derivations, and a
 * guard bug moves **only** the payload side. Measured, not asserted — removing
 * `count(pg.fixture_id) > 0` from `hauls_started` reddens this on 564 cells of
 * 2026-27 (item 20's record).
 *
 * **Do not "fix" this into a re-derivation** by reading the truth side out of
 * `seasonAvailability` or `measuredSum`. That would make both sides the same
 * claim and reproduce 2B exactly.
 *
 * The ratio columns (`hauls_per_start`, `defcon_hits_per_start`, …) are absent
 * here on purpose: they are client-side divisions with no payload field. Their
 * **numerators** are checked, and the division itself is covered by the
 * `perStart` guard tests.
 */
async function partTwo(seasons: string[]): Promise<number> {
  console.log('\n\nPart 2 — do the withheld fields actually arrive empty?');

  let compared = 0;
  let checkedNullCells = 0;
  let playerSeasons = 0;
  const failures: string[] = [];
  const perSeason: string[] = [];

  for (const season of seasons) {
    const payload: PlayerSeasonTotals[] = await listPlayerTotals(pool, season);
    const truth = await truthPerPlayer(season);
    playerSeasons += payload.length;

    let seasonChecked = 0;
    let seasonMismatched = 0;
    const examples: string[] = [];

    for (const row of payload) {
      const t = truth.get(row.id);

      for (const [key, rule] of Object.entries(PAYLOAD_FIELDS) as [
        PayloadField,
        (typeof PAYLOAD_FIELDS)[PayloadField],
      ][]) {
        if (rule.kind === 'skip') continue;

        const value = row[key] as number | string | null;
        compared++;

        if (rule.kind === 'always') {
          if (typeof value !== 'number') {
            seasonMismatched++;
            if (examples.length < 3)
              examples.push(`${key} is ${String(value)} for player ${row.id}, must be a number`);
          }
          continue;
        }

        // A player absent from the truth map has no match rows at all, so
        // nothing feeding this field was measured for him.
        const expectNull =
          t === undefined || rule.inputs.some((c) => (t.nulls[c] ?? 0) > 0);

        if (expectNull) {
          seasonChecked++;
          checkedNullCells++;
        }

        if (expectNull !== (value === null)) {
          seasonMismatched++;
          if (examples.length < 3)
            examples.push(
              `${key} is ${value === null ? 'null' : String(value)} for player ${row.id}, ` +
                `rows say it must be ${expectNull ? 'null' : 'a number'}`
            );
        }
      }
    }

    // The expected size of the checked set, which is what stops the assertion
    // above passing vacuously on a set some bug has emptied.
    const frozen = FROZEN_UNMEASURED_CELLS[season];
    let expectation: string;

    if (frozen !== undefined) {
      expectation = `frozen ${frozen}`;
      if (seasonChecked !== frozen)
        failures.push(
          `   ${season}  ${seasonChecked} cells must be null, frozen expectation is ${frozen}`
        );
    } else if (EXPECTED_UNPLAYED.has(season)) {
      if (truth.size > 0) {
        // The premise has lapsed. Loudly, because a silent skip here is the
        // exact defect this part was written to catch, one layer up.
        failures.push(
          `   ${season}  registered as an unplayed season and now has match rows for ` +
            `${truth.size} players. Its expectation must move to the played-season ` +
            `treatment: freeze its cell count once the season is complete, or drop it ` +
            `from EXPECTED_UNPLAYED and give it a frozen row.`
        );
        expectation = 'PREMISE LAPSED';
      } else {
        const derived = payload.length * MEASURED_FIELDS.length;
        expectation = `derived ${payload.length} players x ${MEASURED_FIELDS.length} fields = ${derived}`;
        if (seasonChecked !== derived)
          failures.push(
            `   ${season}  ${seasonChecked} cells must be null, derived expectation is ${derived}`
          );
      }
    } else {
      failures.push(
        `   ${season}  has no expectation. Add a frozen cell count once its rows are ` +
          `final, or add it to EXPECTED_UNPLAYED while it has no matches.`
      );
      expectation = 'NONE';
    }

    perSeason.push(
      `   ${season}  players ${String(payload.length).padStart(3)}   ` +
        `must be null ${String(seasonChecked).padStart(5)}   ${expectation}` +
        (seasonMismatched > 0 ? `   MISMATCHED ${seasonMismatched}` : '')
    );
    for (const e of examples) perSeason.push(`              ${e}`);

    if (seasonMismatched > 0)
      failures.push(`   ${season}  ${seasonMismatched} field values disagree with the rows`);
  }

  // Printed after the loop rather than before it, because the player-season
  // count is derived from the payloads rather than written down — and a header
  // whose factors do not multiply out to the total beneath it is worse than no
  // header. The skipped fields are named but excluded: they are not compared.
  const checkedFields = MEASURED_FIELDS.length + ALWAYS_FIELDS.length;
  const allFields = Object.keys(PAYLOAD_FIELDS).length;
  console.log(
    `${seasons.length} seasons, ${playerSeasons} player-seasons x ${checkedFields} ` +
      `checked fields = ${playerSeasons * checkedFields} cells\n` +
      `(${MEASURED_FIELDS.length} measured, ${ALWAYS_FIELDS.length} always; ` +
      `${allFields - checkedFields} of ${allFields} skipped)\n`
  );

  console.log('Per season:');
  for (const line of perSeason) console.log(line);

  console.log(`\n   compared   ${compared}`);
  console.log(`   must be null ${checkedNullCells}`);
  console.log(`   failures   ${failures.length}`);
  for (const line of failures) console.log(line);

  return failures.length;
}

async function main(): Promise<void> {
  const seasons = await listSeasons(pool);

  const one = await partOne(seasons);
  const two = await partTwo(seasons);

  console.log('\nRead-only: nothing was written to the database.\n');
  await closePool();

  if (one > 0 || two > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

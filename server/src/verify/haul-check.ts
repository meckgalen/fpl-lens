/**
 * Hauls and floors: cross-derivation, then the rule.
 *
 * **Read-only.** Nothing here writes to the database.
 *
 * Two results that are **never merged into one verdict**, following
 * `defcon-check.ts`, and for the same reason: FPL publishes no haul count, so
 * there is nothing external to diff against and the two parts answer different
 * questions.
 *
 *   - **Part 1 is plumbing.** It re-counts each player's hauls and floors in
 *     TypeScript from the per-gameweek `total_points` the client already sees,
 *     and compares against the season aggregate. Both sides read
 *     `POINT_THRESHOLDS`, so **a wrong threshold agrees with itself** and this
 *     part passes. What it catches is a guard applied on one side only, the
 *     `player_seasons` join multiplying rows, a dedup fault, or the two queries
 *     filtering differently.
 *   - **Part 2 is the rule check**, resting on an audit distribution computed
 *     by hand in SQL before `hauls.ts` existed, frozen as literals here and
 *     **compared** rather than printed. A number nobody diffs is not a check.
 *
 * **Part 2 is itself in two halves, and the second is the one that matters.**
 * Part A's columns all describe *ungated* counts, so they pin the two
 * thresholds and the inclusive relation and pin **nothing about `starts = 1`** —
 * the one definition item 19 got wrong before measuring. Part B freezes the
 * started/bench split, where `bench_hauls` is load-bearing: drop the gate and
 * 18/12/9 all become 0, and 0 is plausible enough to pass unnoticed with no
 * frozen number beside it.
 *
 * Run: npm run verify:haul
 */

import { pool, closePool } from '../db/pool.js';
import { POINT_THRESHOLDS } from '../repositories/hauls.js';
import { getPlayerHistory, listPlayerTotals } from '../repositories/players.js';

/** The season part 1 walks player by player. The newest with match rows. */
const CROSS_CHECK_SEASON = '2025-26';

/**
 * Part A: the ungated counts, every season with match rows.
 *
 * Hand-written SQL over `player_gameweeks`, run before `hauls.ts` was written.
 * That independence is the whole value — regenerating these from the code they
 * check would make this file agree with itself.
 *
 * `playerSeasons` counts players with at least one match row, which is what the
 * audit's population was.
 *
 * **These go stale by design if a season is re-ingested.** The failure is loud,
 * and the fix is to re-derive them deliberately rather than to relax the check.
 */
const EXPECTED_UNGATED = {
  '2016-17': { playerSeasons: 683, hauls: 469, floors: 2647, maxHauls: 11, withHaul: 209 },
  '2017-18': { playerSeasons: 647, hauls: 431, floors: 2675, maxHauls: 15, withHaul: 197 },
  '2018-19': { playerSeasons: 624, hauls: 460, floors: 2619, maxHauls: 11, withHaul: 212 },
  '2019-20': { playerSeasons: 666, hauls: 435, floors: 2609, maxHauls: 10, withHaul: 205 },
  '2020-21': { playerSeasons: 713, hauls: 432, floors: 2651, maxHauls: 12, withHaul: 205 },
  '2021-22': { playerSeasons: 737, hauls: 472, floors: 2669, maxHauls: 11, withHaul: 214 },
  '2022-23': { playerSeasons: 778, hauls: 448, floors: 2657, maxHauls: 11, withHaul: 201 },
  '2023-24': { playerSeasons: 865, hauls: 482, floors: 2625, maxHauls: 10, withHaul: 227 },
  '2024-25': { playerSeasons: 784, hauls: 426, floors: 2551, maxHauls: 18, withHaul: 195 },
  // 3,221 floors against roughly 2,650 everywhere else: defensive contribution
  // points arriving, visible in the raw counts. See hauls.ts on why the
  // constants being fixed does not make the counts comparable across seasons.
  '2025-26': { playerSeasons: 841, hauls: 512, floors: 3221, maxHauls: 12, withHaul: 235 },
} as const;

/**
 * Part B: the started/bench split, 2022-23 onward.
 *
 * Restricted to 2022-23 onward because `starts` is NULL before it, and carrying
 * the hole guard explicitly — only player-seasons where `starts` is measured on
 * every row, which is the scoping `fullyMeasured('starts')` gives the shipped
 * column. **The guard is not optional and its absence is not subtle**: without
 * it 2022-23 reads 282 started and 166 bench hauls, and those 166 are not bench
 * appearances at all — `starts = 1` is NULL for rounds 1-15, so the `CASE` falls
 * to `ELSE 0` and fourteen rounds of real starts read as bench games.
 *
 * **`benchHauls` is the column that pins the gate.** Dropping `starts = 1` sets
 * started = ungated and every bench figure to 0.
 */
const EXPECTED_GATED = {
  // Its own gate signal is in floors only: benchHauls is genuinely 0 here,
  // benchFloors is 12 and would go to 0 if the gate were dropped. Frozen for
  // both reasons — the 0 is the hole guard working.
  '2022-23': { playerSeasons: 117, startedHauls: 12, benchHauls: 0, startedFloors: 70, benchFloors: 12 },
  '2023-24': { playerSeasons: 865, startedHauls: 464, benchHauls: 18, startedFloors: 2356, benchFloors: 269 },
  '2024-25': { playerSeasons: 784, startedHauls: 414, benchHauls: 12, startedFloors: 2310, benchFloors: 241 },
  '2025-26': { playerSeasons: 841, startedHauls: 503, benchHauls: 9, startedFloors: 2966, benchFloors: 255 },
} as const;

async function main(): Promise<void> {
  console.log('Hauls and floors: cross-derivation, then the rule.\n');
  console.log(
    `Lines under test: haul ${POINT_THRESHOLDS.HAUL}+ points, ` +
      `floor ${POINT_THRESHOLDS.FLOOR}+ points, counted per fixture.\n`
  );

  let failures = 0;

  // ------------------------------------------------- 1. the cross-derivation

  console.log(`=== 1. the season counts against the per-gameweek rows, ${CROSS_CHECK_SEASON} ===`);
  console.log('   PLUMBING, not the rule. Both sides read POINT_THRESHOLDS, so a');
  console.log('   wrong line agrees with itself and this part passes. It catches');
  console.log('   a guard applied on one side only, the player_seasons join');
  console.log('   multiplying rows, or the two queries filtering differently.\n');

  const totals = await listPlayerTotals(pool, CROSS_CHECK_SEASON);
  const withMatches = totals.filter((t) => t.matches > 0);

  let compared = 0;
  let agree = 0;
  const mismatches: string[] = [];

  for (const t of withMatches) {
    const history = await getPlayerHistory(pool, t.id, CROSS_CHECK_SEASON);
    const hauls = history.filter((g) => g.total_points >= POINT_THRESHOLDS.HAUL).length;
    const floors = history.filter((g) => g.total_points >= POINT_THRESHOLDS.FLOOR).length;
    // The gated numerators too, so part 1 covers all four columns rather than
    // the two that are easiest to reach.
    const haulsStarted = history.filter(
      (g) => g.starts === 1 && g.total_points >= POINT_THRESHOLDS.HAUL
    ).length;

    compared++;
    if (t.hauls === hauls && t.floors === floors && t.hauls_started === haulsStarted) agree++;
    else
      mismatches.push(
        `   ${String(t.id).padStart(7)} ${t.web_name.padEnd(18)} ` +
          `aggregate ${t.hauls}/${t.floors}/${t.hauls_started}, rows ${hauls}/${floors}/${haulsStarted}`
      );
  }

  const rate = ((100 * agree) / compared).toFixed(2);
  console.log(`   player-seasons compared  ${compared}`);
  console.log(`   agree                    ${agree}  (${rate}%)`);
  console.log(`   disagree                 ${mismatches.length}`);
  for (const line of mismatches.slice(0, 20)) console.log(line);
  if (mismatches.length > 20) console.log(`     … and ${mismatches.length - 20} more`);
  failures += mismatches.length;

  // ------------------------------------ 2A. the ungated audit distribution

  console.log(`\n=== 2A. the ungated counts against the audit's frozen figures ===`);
  console.log('   THE RULE CHECK, first half. These literals were computed by');
  console.log('   hand in SQL before hauls.ts existed. They pin both thresholds');
  console.log('   and the inclusive relation — and NOTHING about the started');
  console.log('   gate, which is what 2B is for.\n');

  console.log('   season    players    hauls   floors   max   with≥1   floors<hauls');
  for (const season of Object.keys(EXPECTED_UNGATED)) {
    const seasonTotals = (await listPlayerTotals(pool, season)).filter((t) => t.matches > 0);
    const hauls = seasonTotals.map((t) => t.hauls);
    const actual = {
      playerSeasons: seasonTotals.length,
      hauls: hauls.reduce((a, b) => a + b, 0),
      floors: seasonTotals.reduce((a, t) => a + t.floors, 0),
      maxHauls: hauls.reduce((a, b) => Math.max(a, b), 0),
      withHaul: hauls.filter((h) => h > 0).length,
    };
    const violations = seasonTotals.filter((t) => t.floors < t.hauls).length;
    const want = EXPECTED_UNGATED[season as keyof typeof EXPECTED_UNGATED];

    // The inclusive relation, asserted on every season rather than frozen:
    // there is no season in which a nonzero here would be acceptable.
    const ok =
      want !== undefined &&
      actual.playerSeasons === want.playerSeasons &&
      actual.hauls === want.hauls &&
      actual.floors === want.floors &&
      actual.maxHauls === want.maxHauls &&
      actual.withHaul === want.withHaul &&
      violations === 0;

    console.log(
      `   ${season}  ${String(actual.playerSeasons).padStart(7)}  ${String(actual.hauls).padStart(7)}  ` +
        `${String(actual.floors).padStart(6)}  ${String(actual.maxHauls).padStart(4)}  ` +
        `${String(actual.withHaul).padStart(6)}  ${String(violations).padStart(12)}   ${ok ? 'ok' : 'MISMATCH'}`
    );
    if (!ok) {
      failures++;
      if (want === undefined) console.log(`        no frozen figures for ${season}`);
      else
        console.log(
          `        expected players ${want.playerSeasons}, hauls ${want.hauls}, ` +
            `floors ${want.floors}, max ${want.maxHauls}, with≥1 ${want.withHaul}, violations 0`
        );
    }
  }

  // -------------------------------------------- 2B. the gate, 2022-23 onward

  console.log(`\n=== 2B. the started/bench split against the audit's frozen figures ===`);
  console.log('   THE RULE CHECK, second half, and the half that pins the gate.');
  console.log('   Dropping `starts = 1` sets started = ungated and every bench');
  console.log('   figure to 0 — plausible enough to pass unnoticed without a');
  console.log('   number frozen beside it.\n');

  console.log('   season    players   started H   bench H   started F   bench F');
  for (const season of Object.keys(EXPECTED_GATED)) {
    // The shipped column's own scoping: `hauls_started` is non-null exactly
    // where `fullyMeasured('starts')` held and a match was played, which is the
    // population the frozen figures were derived over. Reading it off the
    // aggregate rather than re-deriving the guard here is the point — the guard
    // is part of what is under test.
    const gatedTotals = (await listPlayerTotals(pool, season)).filter(
      (t) => t.hauls_started !== null && t.floors_started !== null
    );
    const startedHauls = gatedTotals.reduce((a, t) => a + t.hauls_started!, 0);
    const startedFloors = gatedTotals.reduce((a, t) => a + t.floors_started!, 0);
    const actual = {
      playerSeasons: gatedTotals.length,
      startedHauls,
      benchHauls: gatedTotals.reduce((a, t) => a + t.hauls, 0) - startedHauls,
      startedFloors,
      benchFloors: gatedTotals.reduce((a, t) => a + t.floors, 0) - startedFloors,
    };
    const want = EXPECTED_GATED[season as keyof typeof EXPECTED_GATED];
    const ok =
      want !== undefined &&
      actual.playerSeasons === want.playerSeasons &&
      actual.startedHauls === want.startedHauls &&
      actual.benchHauls === want.benchHauls &&
      actual.startedFloors === want.startedFloors &&
      actual.benchFloors === want.benchFloors;

    console.log(
      `   ${season}  ${String(actual.playerSeasons).padStart(7)}  ${String(actual.startedHauls).padStart(9)}  ` +
        `${String(actual.benchHauls).padStart(7)}  ${String(actual.startedFloors).padStart(9)}  ` +
        `${String(actual.benchFloors).padStart(7)}   ${ok ? 'ok' : 'MISMATCH'}`
    );
    if (!ok) {
      failures++;
      if (want === undefined) console.log(`        no frozen figures for ${season}`);
      else
        console.log(
          `        expected players ${want.playerSeasons}, started H ${want.startedHauls}, ` +
            `bench H ${want.benchHauls}, started F ${want.startedFloors}, bench F ${want.benchFloors}`
        );
    }
  }

  console.log('\nTwo results, deliberately not merged: part 1 says the two');
  console.log('derivations agree with each other, part 2 says the rule is right.');
  console.log('\nRead-only: nothing was written to the database.\n');

  await closePool();
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

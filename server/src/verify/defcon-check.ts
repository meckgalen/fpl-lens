/**
 * The defensive contribution hit count: does it hold together, and is the rule
 * right?
 *
 * **Those are two questions and this script answers them separately, on
 * purpose.** FPL publishes no hit count, so there is nothing external to diff
 * against — this is the first scoring rule the app computes for itself. What is
 * available is a cross-derivation and a frozen distribution, and merging them
 * into one verdict would let the weaker one borrow the stronger one's authority.
 *
 *   1. **Cross-derivation — plumbing, NOT the rule.** The season count from
 *      `listPlayerTotals` must equal the sum of `getPlayerHistory`'s per-row
 *      flags, for every player-season in 2025-26. Both sides call
 *      `defconHitSql`, so **a wrong threshold agrees with itself and this part
 *      exits 0.** What it does catch is real and narrow: a guard applied on one
 *      side only, the `player_seasons` join multiplying rows, an aggregate
 *      filtering differently from the row query. It is reported as what it is.
 *   2. **The distribution against frozen literals — this IS the rule check.**
 *      The numbers below were computed by hand in SQL during the item 14 audit,
 *      before any of this code existed, and are **compared** here rather than
 *      printed. A printed number nobody diffs is not a check. Swapping a
 *      defender's 10 with a midfielder's 12 moves these and nothing else in the
 *      codebase notices.
 *
 * Read-only: nothing is written to the database.
 *
 * Run: npm run verify:defcon
 */

import { pool, closePool } from '../db/pool.js';
import { getPlayerHistory, listPlayerTotals } from '../repositories/players.js';
import { DEFCON_THRESHOLDS } from '../repositories/defcon.js';

/** The only season with defensive contribution data. */
const SEASON = '2025-26';

/**
 * The item 14 audit's distribution, frozen.
 *
 * Derived independently of every line of shipped code — a hand-written SQL
 * query over `player_gameweeks` joined to `player_seasons`, run before
 * `defcon.ts` was written. That independence is the whole value; regenerating
 * these from the code they check would make this file agree with itself.
 *
 * `players` counts players with at least one match row, which is what the
 * audit's population was. Medians are over that same set.
 *
 * **These go stale by design if 2025-26 is ever re-ingested.** The failure is
 * loud, and the fix is to re-derive them deliberately rather than to relax the
 * check.
 */
const EXPECTED = {
  DEF: { players: 270, median: 1, zeroHit: 129, totalHits: 821 },
  MID: { players: 379, median: 0, zeroHit: 261, totalHits: 587 },
  FWD: { players: 95, median: 0, zeroHit: 91, totalHits: 9 },
  GK: { players: 97, median: 0, zeroHit: 97, totalHits: 0 },
} as const;

type Position = keyof typeof EXPECTED;

const median = (sorted: number[]): number =>
  sorted.length === 0 ? 0 : sorted[Math.floor((sorted.length - 1) / 2)];

async function main(): Promise<void> {
  console.log('Defensive contribution hits: cross-derivation, then the rule.\n');
  console.log(
    `Thresholds under test: DEF ${DEFCON_THRESHOLDS.DEF}, ` +
      `MID ${DEFCON_THRESHOLDS.MID}, FWD ${DEFCON_THRESHOLDS.FWD}, GK none.\n`
  );

  let failures = 0;

  // ------------------------------------------------- 1. the cross-derivation

  console.log(`=== 1. the season count against the per-gameweek flags, ${SEASON} ===`);
  console.log('   PLUMBING, not the rule. Both sides call defconHitSql, so a');
  console.log('   wrong threshold agrees with itself and this part passes. It');
  console.log('   catches a guard applied on one side only, the player_seasons');
  console.log('   join multiplying rows, or the two queries filtering');
  console.log('   differently.\n');

  const totals = await listPlayerTotals(pool, SEASON);
  const withMatches = totals.filter((t) => t.matches > 0);

  let compared = 0;
  let agree = 0;
  const mismatches: string[] = [];

  for (const t of withMatches) {
    const history = await getPlayerHistory(pool, t.id, SEASON);
    // `?? 0` is safe here and only here: 2025-26 measures DC on every row, so
    // no flag is null. A null WOULD be a real finding, so it is counted rather
    // than swallowed — see the null tally below.
    const summed = history.reduce((n, g) => n + (g.defcon_hit ?? 0), 0);

    compared++;
    if (t.defcon_hits === summed) agree++;
    else
      mismatches.push(
        `   ${String(t.id).padStart(7)} ${t.web_name.padEnd(18)} aggregate ${t.defcon_hits}, rows ${summed}`
      );
  }

  const nullFlags = (
    await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM player_gameweeks WHERE season = $1 AND defensive_contribution IS NULL`,
      [SEASON]
    )
  ).rows[0].n;

  const rate = ((100 * agree) / compared).toFixed(2);
  console.log(`   player-seasons compared  ${compared}`);
  console.log(`   agree                    ${agree}  (${rate}%)`);
  console.log(`   disagree                 ${mismatches.length}`);
  console.log(`   unmeasured DC rows       ${nullFlags}  (a nonzero here would explain a gap)`);
  for (const line of mismatches.slice(0, 20)) console.log(line);
  if (mismatches.length > 20) console.log(`     … and ${mismatches.length - 20} more`);
  failures += mismatches.length;

  // --------------------------------------------------- 2. the distribution

  console.log(`\n=== 2. the distribution against the audit's frozen figures ===`);
  console.log('   THE RULE CHECK. These literals were computed by hand in SQL');
  console.log('   before defcon.ts existed. A threshold swapped between');
  console.log('   positions moves them and nothing else would notice.\n');

  const byPosition = new Map<Position, number[]>([
    ['DEF', []],
    ['MID', []],
    ['FWD', []],
    ['GK', []],
  ]);

  // Position from player_seasons (rule 10), which is also what the rule reads.
  const positions = await pool.query<{ id: number; position: Position }>(
    `SELECT p.fpl_code AS id, ps.position
       FROM player_seasons ps JOIN players p ON p.id = ps.player_id
      WHERE ps.season = $1`,
    [SEASON]
  );
  const positionOf = new Map(positions.rows.map((r) => [r.id, r.position]));

  for (const t of withMatches) {
    const position = positionOf.get(t.id);
    if (position === undefined) continue;
    byPosition.get(position)?.push(t.defcon_hits ?? 0);
  }

  console.log('   pos  players  median  zero-hit  total hits');
  for (const position of ['DEF', 'MID', 'FWD', 'GK'] as Position[]) {
    const hits = (byPosition.get(position) ?? []).slice().sort((a, b) => a - b);
    const actual = {
      players: hits.length,
      median: median(hits),
      zeroHit: hits.filter((h) => h === 0).length,
      totalHits: hits.reduce((a, b) => a + b, 0),
    };
    const want = EXPECTED[position];
    const ok =
      actual.players === want.players &&
      actual.median === want.median &&
      actual.zeroHit === want.zeroHit &&
      actual.totalHits === want.totalHits;

    console.log(
      `   ${position.padEnd(4)} ${String(actual.players).padStart(7)}  ${String(actual.median).padStart(6)}  ` +
        `${String(actual.zeroHit).padStart(8)}  ${String(actual.totalHits).padStart(10)}   ${ok ? 'ok' : 'MISMATCH'}`
    );
    if (!ok) {
      failures++;
      console.log(
        `        expected players ${want.players}, median ${want.median}, ` +
          `zero-hit ${want.zeroHit}, total hits ${want.totalHits}`
      );
    }
  }

  // The two results stay two results. Reporting one verdict would let part 1's
  // 100% stand in for a rule check it cannot perform.
  console.log('\nTwo results, deliberately not merged: part 1 says the two');
  console.log('queries agree with each other, part 2 says the rule is right.');
  console.log('\nRead-only: nothing was written to the database.\n');

  await closePool();
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

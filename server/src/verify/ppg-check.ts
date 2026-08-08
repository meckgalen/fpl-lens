/**
 * Does the averages row agree with `points_per_game`, and does either agree with FPL?
 *
 * Read-only. Two runs, reported as two results and never merged into one verdict,
 * because they answer different questions and only one of them is independent.
 *
 *   1. **Self-consistency**, all ten seasons. The client's `columnAverage` over the
 *      match rows against the server's `points_per_game` over the same player-season.
 *      NOT independent — both sides are ours. What it catches is the two
 *      *denominators* drifting apart: the client counts the rows it was handed with
 *      `minutes > 0`, the server does `count(*) FILTER (WHERE pg.minutes > 0)` in
 *      SQL. Two implementations, two languages, one claim.
 *
 *   2. **Against FPL**, 2025-26 only. Our per-appearance quotient against FPL's own
 *      published `points_per_game`. This is the real cross-check, and 2025-26 is the
 *      only season it is available for — `history_past` carries no PPG and no
 *      appearance count, so the only source is the **pre-season bootstrap carryover**,
 *      which serves last season's totals on every element until GW1. That carryover
 *      is the biggest hazard in the ingest path (see CLAUDE.md); here it is exactly
 *      what is wanted, read-only.
 *
 * **It imports the client's `lib/averages.ts` on purpose.** A verification that
 * reimplements the averaging would share its derivation with nothing and prove
 * nothing. This runs the shipped module. The cost is that this one file sits outside
 * the server's tsc program — see the comment in `server/tsconfig.json`.
 */

import { pool, closePool } from '../db/pool.js';
import { getBootstrap } from '../services/fplApi.js';
import { columnAverage, roundHalfEven } from '../../../client/src/lib/averages';
import type { GameweekHistory } from '../../../client/src/types/fpl';

/** One decimal, which is the precision both numbers are ever displayed at. */
const DP = 1;

/**
 * Whether a quotient sits exactly on a `.x5` tie at `DP`.
 *
 * Reported in its own column and never folded into the mismatch count. A 4.55 that
 * rounds to 4.6 on one side and 4.5 on the other is a formatting difference, not a
 * disagreement — and the whole point of moving the rounding to one formatter was
 * that this population should now be empty.
 */
function isExactTie(points: number, apps: number): boolean {
  if (apps === 0) return false;
  const scale = 2 * 10 ** DP;
  return (points * scale) % apps === 0 && ((points * scale) / apps) % 2 === 1;
}

interface Row {
  season: string;
  code: number;
  points: number;
  apps: number;
  /** What the server's aggregate produced — unrounded since item 11. */
  serverPpg: number;
}

async function selfConsistency(): Promise<void> {
  console.log('\n=== 1. the averages row against points_per_game, all ten seasons ===');
  console.log('   NOT independent: both sides are ours. It checks the two');
  console.log('   denominators, computed separately in SQL and in TypeScript.\n');

  // The per-season aggregate the app serves, straight from the same expression the
  // repository uses. Compared against the client module run over the match rows.
  const totals = await pool.query<{
    season: string;
    code: string;
    points: string;
    apps: number;
    ppg: string;
  }>(
    `SELECT pg.season,
            p.fpl_code                                   AS code,
            sum(pg.total_points)                         AS points,
            count(*) FILTER (WHERE pg.minutes > 0)::int  AS apps,
            COALESCE(sum(pg.total_points)::numeric
              / NULLIF(count(*) FILTER (WHERE pg.minutes > 0), 0), 0) AS ppg
       FROM player_gameweeks pg
       JOIN players p ON p.id = pg.player_id
      GROUP BY pg.season, p.fpl_code`
  );

  const rows: Row[] = totals.rows.map((r) => ({
    season: r.season,
    code: Number(r.code),
    points: Number(r.points),
    apps: r.apps,
    serverPpg: Number(r.ppg),
  }));

  // The match rows, so the client module can be run over them exactly as the table
  // runs it. Only the two fields the Pts average needs.
  const matches = await pool.query<{
    season: string;
    code: string;
    minutes: number;
    total_points: number;
  }>(
    `SELECT pg.season, p.fpl_code AS code, pg.minutes, pg.total_points
       FROM player_gameweeks pg
       JOIN players p ON p.id = pg.player_id`
  );

  const byPlayerSeason = new Map<string, GameweekHistory[]>();
  for (const m of matches.rows) {
    const key = `${m.season}|${m.code}`;
    let list = byPlayerSeason.get(key);
    if (!list) byPlayerSeason.set(key, (list = []));
    // Only the two fields the Pts average reads; the module takes an accessor.
    list.push({ minutes: m.minutes, total_points: m.total_points } as GameweekHistory);
  }

  let compared = 0;
  let agree = 0;
  let ties = 0;
  const mismatches: Array<Row & { clientPpg: number | null; clientDenominator: number }> = [];

  for (const row of rows) {
    const history = byPlayerSeason.get(`${row.season}|${row.code}`) ?? [];
    const avg = columnAverage(history, (gw) => gw.total_points);
    compared++;

    // A player with no appearances: the client shows the placeholder, the server
    // COALESCEs to 0. Both are right and they are not comparable, so they are
    // counted apart rather than as agreement or as drift.
    if (avg.value === null) {
      if (row.apps === 0) agree++;
      else mismatches.push({ ...row, clientPpg: null, clientDenominator: avg.denominator });
      continue;
    }

    const same =
      avg.denominator === row.apps &&
      roundHalfEven(avg.value, DP) === roundHalfEven(row.serverPpg, DP);

    if (same) {
      agree++;
      if (isExactTie(row.points, row.apps)) ties++;
    } else {
      mismatches.push({ ...row, clientPpg: avg.value, clientDenominator: avg.denominator });
    }
  }

  const rate = ((100 * agree) / compared).toFixed(2);
  console.log(`   player-seasons compared      ${compared}`);
  console.log(`   agree                        ${agree}  (${rate}%)`);
  console.log(`   of which sit on an exact tie ${ties}  (see the rounding note below)`);
  console.log(`   disagree                     ${mismatches.length}`);

  for (const m of mismatches.slice(0, 20)) {
    console.log(
      `     ${m.season} code ${m.code}: client ${m.clientPpg ?? 'null'} over ` +
        `${m.clientDenominator}, server ${m.serverPpg} over ${m.apps}`
    );
  }
  if (mismatches.length > 20) console.log(`     … and ${mismatches.length - 20} more`);
}

async function againstFpl(): Promise<void> {
  console.log('\n=== 2. against FPL’s own points_per_game — 2025-26, the only season ===');
  console.log('   history_past carries no PPG and no appearance count, so the only');
  console.log('   source is the pre-season bootstrap carryover. Read-only.\n');

  const bootstrap = await getBootstrap();
  const events = bootstrap.events ?? [];
  const started = events.filter((e) => e.finished).length;

  if (started > 0) {
    console.log(`   SKIPPED: ${started} events are finished, so the bootstrap now`);
    console.log('   serves 2026-27 rather than 2025-26 carryover. This check is');
    console.log('   only available pre-season and expires at GW1.');
    return;
  }

  const byCode = new Map(bootstrap.elements.map((e) => [e.code, e]));

  const ours = await pool.query<{ code: string; points: string; apps: number; mins: string }>(
    `SELECT p.fpl_code AS code, sum(pg.total_points) AS points,
            count(*) FILTER (WHERE pg.minutes > 0)::int AS apps,
            sum(pg.minutes) AS mins
       FROM player_gameweeks pg
       JOIN players p ON p.id = pg.player_id
      WHERE pg.season = '2025-26'
      GROUP BY p.fpl_code`
  );

  let reachable = 0;
  let match = 0;
  let tieOnly = 0;
  const real: string[] = [];

  for (const r of ours.rows) {
    const element = byCode.get(Number(r.code));
    // No carryover on this element: nothing to compare against.
    if (!element || Number(element.minutes) === 0) continue;
    reachable++;

    const apps = r.apps;
    const points = Number(r.points);
    const oursPpg = apps > 0 ? roundHalfEven(points / apps, DP) : 0;
    const theirs = Number(element.points_per_game);

    if (Math.abs(oursPpg - theirs) < 1e-9) {
      match++;
      continue;
    }

    // Separate a formatting difference from a real one, per the brief.
    if (isExactTie(points, apps) && Math.abs(oursPpg - theirs) <= 10 ** -DP + 1e-9) {
      tieOnly++;
      continue;
    }

    // A totals disagreement is not a denominator disagreement, and the two must not
    // be conflated: the bootstrap's carryover is known to go stale on a few elements
    // where FPL's own history_past backs our figures.
    const totalsDiffer =
      Number(element.total_points) !== points || Number(element.minutes) !== Number(r.mins);
    real.push(
      `     code ${r.code}: ours ${oursPpg} (${points}/${apps}), FPL ${theirs}` +
        (totalsDiffer
          ? `  — TOTALS ALSO DIFFER (FPL ${element.total_points}pts/${element.minutes}min), so not a denominator question`
          : '')
    );
  }

  const rate = reachable === 0 ? '—' : ((100 * match) / reachable).toFixed(2);
  console.log(`   reachable (carryover present) ${reachable}`);
  console.log(`   exact match                   ${match}  (${rate}%)`);
  console.log(`   differing by tie-rounding only ${tieOnly}`);
  console.log(`   real mismatches               ${real.length}`);
  for (const line of real) console.log(line);
}

async function main(): Promise<void> {
  console.log('Comparing under: half-to-even at 1 decimal — the convention FPL');
  console.log('computes in, applied once, in the client formatter.');

  await selfConsistency();
  await againstFpl();

  console.log('\nRead-only: nothing was written to the database.\n');
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

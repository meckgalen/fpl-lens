/**
 * Are the frozen comparison thresholds still the right numbers?
 *
 * **Two questions, answered separately and never merged**, following
 * `verify:defcon`'s precedent. Merging them would let the informational half
 * borrow the deterministic half's authority, and — worse here — would make a
 * frozen threshold drifting from a fresh re-derivation look like a failure,
 * when it is the expected state and the entire point of freezing.
 *
 *   1. **The constants against their own derivation set — this one fails.**
 *      Over exactly the seasons each threshold records, the cohort size must be
 *      the recorded one, the ceiling must be at or above p99, and the floor
 *      must be what the rule says it is. It re-derives over the *recorded*
 *      seasons rather than over everything available, so it stays green as
 *      seasons are added. Exits non-zero on any disagreement.
 *   2. **What a re-derivation today would say — informational, never fails.**
 *      For each axis: today's p99, the ceiling the friendly ladder would pick
 *      from it, and how many player-seasons currently clip the frozen ceiling.
 *      This is what makes a stale re-derivable threshold visible rather than
 *      inferred. It reports drift; it does not judge it.
 *
 * **Part 1 checks the invariant, not the arithmetic.** It asserts
 * `ceiling >= p99` rather than re-running the friendly-number ladder and
 * comparing. Re-running the ladder would reproduce the constant by construction
 * and prove only that the same function was called twice — the working
 * agreement's "verification must not share its derivation" applied to a rounding
 * rule. `ceiling >= p99` is the property the ceiling exists to have, and it is
 * checkable from the data alone.
 *
 * **It imports `comparison/thresholds.ts` rather than restating the values**,
 * which is the opposite of `verify:columns`' `DB_COLUMNS` and for the same
 * underlying reason. There the restated thing was auxiliary data *about* the
 * check; here the frozen numbers *are* what is being checked, so a restated copy
 * would pass whenever the two copies matched each other, including when both
 * were wrong. `defconHitSql` is imported for the same reason: a check that
 * restated the DC threshold could not catch a wrong one.
 *
 * What this file does restate is the **SQL for each axis** — how a stat is
 * summed out of `player_gameweeks`. That derivation genuinely is independent of
 * the constants, and writing it here is what lets the check disagree with them.
 *
 * Read-only: nothing is written to the database.
 *
 * Run: npm run verify:thresholds
 */

import { pool, closePool } from '../db/pool.js';
import { defconHitSql } from '../repositories/defcon.js';
import {
  COMPARISON_THRESHOLDS,
  isReDerivable,
  type AxisThreshold,
  type ComparisonAxisKey,
  type ComparisonPosition,
} from '../comparison/thresholds.js';

/** The cohort gate. A player-season below this is not in any derivation. */
const MINUTES_GATE = 1200;

/**
 * How each axis is computed from the gameweek rows, restated for this check.
 *
 * These mirror `SEASON_AGGREGATE` and the two client quotients without
 * importing them, which is deliberate: the axis values are the independent half
 * of this verification. The nullable two carry their `measuredSum` guard,
 * because a season aggregate over a partly measured column has no honest total
 * (rule 6) and pooling one would move the percentile.
 */
const AXIS_SQL: Record<ComparisonAxisKey, string> = {
  pts: 'COALESCE(sum(pg.total_points), 0)::numeric',
  clean_sheets: 'COALESCE(sum(pg.clean_sheets), 0)::numeric',
  goals: 'COALESCE(sum(pg.goals_scored), 0)::numeric',
  minutes: 'COALESCE(sum(pg.minutes), 0)::numeric',
  assists: 'COALESCE(sum(pg.assists), 0)::numeric',
  bonus: 'COALESCE(sum(pg.bonus), 0)::numeric',
  saves: 'COALESCE(sum(pg.saves), 0)::numeric',

  // Points over matches APPEARED IN, unrounded — API identity rule 5, and the
  // asymmetry is deliberate: the numerator is the whole season's points.
  ppm: `COALESCE(sum(pg.total_points), 0)::numeric
          / NULLIF(count(*) FILTER (WHERE pg.minutes > 0), 0)`,

  // COALESCE(now_cost, end_cost): now_cost is NULL on every completed season.
  pts_per_now: `COALESCE(sum(pg.total_points), 0)::numeric
                  / NULLIF(COALESCE(ps.now_cost, ps.end_cost)::numeric / 10, 0)`,

  expected_goal_involvements: `CASE
        WHEN count(pg.expected_goal_involvements) = count(pg.fixture_id)
        THEN sum(pg.expected_goal_involvements)
      END`,

  // Hits in STARTED fixtures, over starts. Both operands guarded, and
  // count(pg.fixture_id) > 0 is the half that is easy to miss: count(*) FILTER
  // over no rows is 0, not NULL.
  //
  // **`pg.starts = 1` in the numerator is item 24 and is the point of this
  // entry.** The ratio counts only hits made in starts, so the population the
  // numerator draws from is the one the denominator covers. Restated here
  // rather than imported, like every other axis in this map — the axis values
  // are the independent half of this check, so `defconHitCountSql`'s gate and
  // this one have to be written twice to be able to disagree. The threshold
  // itself still comes from `defconHitSql`, because a hand-copied 10 and 12
  // would check the numbers rather than the rule.
  defcon_hits_per_start: `(CASE
        WHEN count(pg.fixture_id) > 0
         AND count(pg.defensive_contribution) = count(pg.fixture_id)
         AND count(pg.starts) = count(pg.fixture_id)
        THEN count(*) FILTER (WHERE pg.starts = 1 AND ${defconHitSql('pg', 'ps')} = 1)
      END)::numeric
      / NULLIF(CASE WHEN count(pg.starts) = count(pg.fixture_id)
                    THEN sum(pg.starts) END, 0)`,
};

interface AxisStats {
  /** Player-seasons in the cohort carrying a value for this axis. */
  n: number;
  p99: number;
  p01: number;
  max: number;
  /** How many carry a value strictly above the frozen ceiling. */
  clipping: number;
}

/**
 * Measure one axis over one position across a given season set.
 *
 * One query per axis rather than one per position: the axis sets differ in
 * which seasons they cover, and a single query would have to pick one cohort
 * for all of them. Read-only, and the whole script runs in a few seconds.
 */
async function measure(
  position: ComparisonPosition,
  axis: ComparisonAxisKey,
  seasons: string[],
  ceiling: number
): Promise<AxisStats> {
  const { rows } = await pool.query<{
    n: string;
    p99: string | null;
    p01: string | null;
    max: string | null;
    clipping: string;
  }>(
    `WITH agg AS (
       SELECT COALESCE(sum(pg.minutes), 0)::int AS gate_minutes,
              ${AXIS_SQL[axis]} AS val
         FROM player_seasons ps
         LEFT JOIN player_gameweeks pg
                ON pg.player_id = ps.player_id AND pg.season = ps.season
        WHERE ps.season = ANY($1) AND ps.position = $2
        GROUP BY ps.player_id, ps.season, ps.position, ps.now_cost, ps.end_cost
     ),
     cohort AS (SELECT val FROM agg WHERE gate_minutes >= ${MINUTES_GATE} AND val IS NOT NULL)
     SELECT count(*)::text AS n,
            (percentile_cont(0.99) WITHIN GROUP (ORDER BY val))::text AS p99,
            (percentile_cont(0.01) WITHIN GROUP (ORDER BY val))::text AS p01,
            max(val)::text AS max,
            count(*) FILTER (WHERE val > ${ceiling})::text AS clipping
       FROM cohort`,
    [seasons, position]
  );

  const r = rows[0];
  return {
    n: Number(r.n),
    p99: Number(r.p99),
    p01: Number(r.p01),
    max: Number(r.max),
    clipping: Number(r.clipping),
  };
}

/**
 * The floor the rule says an axis should carry.
 *
 * Zero everywhere except the two the 1,200-minute gate moves: `minutes` floors
 * at the gate itself, `ppm` at the cohort's p01 truncated to two decimals.
 * **Truncated, not rounded** — a floor rounded to nearest can land above the
 * quantile it names and clip more than the 1% it claims to. Rounding is
 * directional and a floor's safe direction is down.
 */
function expectedFloor(axis: ComparisonAxisKey, stats: AxisStats): number {
  if (axis === 'minutes') return MINUTES_GATE;
  if (axis === 'ppm') return Math.floor(stats.p01 * 100) / 100;
  return 0;
}

/**
 * The friendly-number ladder, for part 2 only.
 *
 * Fixed before any ceiling was looked at, in step 1: the smallest
 * m x 10^k at or above the value, m from the rungs below. Part 1 does not use
 * it — see the header on why re-running it would check nothing.
 */
const RUNGS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

function ladderCeiling(value: number): number {
  for (let k = -2; k <= 4; k++) {
    for (const m of RUNGS) {
      const rung = Number((m * 10 ** k).toPrecision(12));
      if (rung >= value) return rung;
    }
  }
  return value;
}

const POSITIONS: ComparisonPosition[] = ['GK', 'DEF', 'MID', 'FWD'];

function eachThreshold(): { position: ComparisonPosition; t: AxisThreshold }[] {
  return POSITIONS.flatMap((position) =>
    COMPARISON_THRESHOLDS[position].map((t) => ({ position, t }))
  );
}

const f = (v: number, dp = 2) => v.toFixed(dp);

async function main(): Promise<void> {
  console.log('\nComparison thresholds: two results, deliberately never merged.\n');

  // ---------------------------------------------------------------- part 1
  console.log('PART 1 — the constants against their own derivation set');
  console.log('  Over exactly the seasons each threshold records. Fails on disagreement.\n');
  console.log('  Pos  Axis          Seasons  Cohort         p99  Ceiling   Floor   Result');
  console.log('  ' + '-'.repeat(72));

  let failures = 0;
  const measured = new Map<string, AxisStats>();

  for (const { position, t } of eachThreshold()) {
    const stats = await measure(position, t.axis, t.derivedFrom.seasons, t.ceiling);
    measured.set(`${position}:${t.axis}`, stats);

    const cohortOk = stats.n === t.derivedFrom.cohort;
    const ceilingOk = t.ceiling >= stats.p99;
    const wantFloor = expectedFloor(t.axis, stats);
    const floorOk = t.floor === wantFloor;
    const ok = cohortOk && ceilingOk && floorOk;

    console.log(
      `  ${position.padEnd(4)} ${t.label.padEnd(12)} ${String(t.derivedFrom.seasons.length).padStart(7)}  ` +
        `${String(stats.n).padStart(6)} ${f(stats.p99).padStart(11)}  ${f(t.ceiling).padStart(7)} ` +
        `${f(t.floor).padStart(7)}   ${ok ? 'ok' : 'MISMATCH'}`
    );

    if (!ok) {
      failures++;
      if (!cohortOk) console.log(`        cohort: recorded ${t.derivedFrom.cohort}, measured ${stats.n}`);
      if (!ceilingOk) console.log(`        ceiling ${t.ceiling} is BELOW p99 ${f(stats.p99, 4)}`);
      if (!floorOk) console.log(`        floor: recorded ${t.floor}, rule says ${wantFloor}`);
    }
  }

  console.log(
    `\n  ${failures === 0 ? 'All ' + eachThreshold().length + ' thresholds agree with their derivation set.' : failures + ' MISMATCH(es).'}`
  );

  // ---------------------------------------------------------------- part 2
  //
  // "Re-derived today" means: the recorded seasons, plus every complete season
  // NEWER than the newest one recorded. That is the trigger the re-derivation
  // rule actually names — a season being added — and it deliberately does not
  // re-open the availability judgement that kept 2022-23 out of xGI. Today no
  // axis gains a season, so this reports zero drift, which is correct and is
  // what it will keep reporting until 2026-27 completes.
  const { rows: completeRows } = await pool.query<{ season: string }>(
    `SELECT DISTINCT season FROM player_gameweeks ORDER BY season`
  );
  const complete = completeRows.map((r) => r.season);

  console.log('\n\nPART 2 — what a re-derivation today would say. Informational; never fails.');
  console.log('  A frozen threshold drifting from a fresh derivation is the expected state.\n');
  console.log('  Pos  Axis          Src  Now   Frozen   p99 today  Ladder today  Clipping now');
  console.log('  ' + '-'.repeat(77));

  for (const { position, t } of eachThreshold()) {
    const newest = t.derivedFrom.seasons[t.derivedFrom.seasons.length - 1];
    const seasonsToday = [...t.derivedFrom.seasons, ...complete.filter((s) => s > newest)];

    const stats =
      seasonsToday.length === t.derivedFrom.seasons.length
        ? measured.get(`${position}:${t.axis}`)!
        : await measure(position, t.axis, seasonsToday, t.ceiling);

    // `minutes` is exempt from the ladder: 38 x 90 is the competition's own
    // maximum, so a re-derivation would not move it whatever p99 does.
    const today = t.axis === 'minutes' ? t.ceiling : ladderCeiling(stats.p99);
    const pct = stats.n === 0 ? 0 : (100 * stats.clipping) / stats.n;
    const flag = isReDerivable(t) ? '*' : ' ';

    console.log(
      `  ${position.padEnd(4)} ${t.label.padEnd(12)} ${String(t.derivedFrom.seasons.length).padStart(3)}${flag} ` +
        `${String(seasonsToday.length).padStart(3)}  ${f(t.ceiling).padStart(7)}  ` +
        `${f(stats.p99).padStart(10)}  ${f(today).padStart(12)}  ` +
        `${String(stats.clipping).padStart(5)} (${f(pct).padStart(5)}%)` +
        (today !== t.ceiling ? '  DRIFT' : '')
    );
  }

  console.log('\n  * re-derivable: fewer than five seasons behind it, so it is re-derived');
  console.log('    when a season is added. Src = seasons recorded, Now = seasons available.');

  console.log('\nTwo results, deliberately not merged: part 1 says the frozen numbers');
  console.log('still describe the cohort they were drawn from, part 2 says what a fresh');
  console.log('derivation would pick. Only the first is a failure condition.');
  console.log('\nRead-only: nothing was written to the database.\n');

  await closePool();
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

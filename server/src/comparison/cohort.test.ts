/**
 * The comparison chart's data: the axis set, the band, and the two quotients.
 *
 * Three kinds of test here, and the split matters because one of them is easy to
 * write in a way that proves nothing:
 *
 *   1. **Value anchors against the real database.** The 2025-26 DEF band was
 *      measured in item 16 step 1 by a hand-written psql session, before any of
 *      this code existed. Nine numbers, reproduced.
 *   2. **The median convention, on an EVEN cohort.** Every odd cohort agrees
 *      under `percentile_cont` and `percentile_disc`, so the nine anchors above —
 *      n = 109 — cannot tell the two apart and would pass either way. GK 2025-26
 *      is n = 22, where `cont` is 111 and the convention this module implements
 *      gives 109.
 *   3. **The cohort floor, on synthetic rows.** No real (season, position) has a
 *      cohort between 1 and 9, so the boundary is unreachable against real data.
 *      Nine players and ten, in a rolled-back transaction, is the only way to put
 *      a value *on* it — `defcon.test.ts`'s argument, for the same reason.
 *
 * Run: npm test   (requires the ingest scripts to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { syntheticSeason } from '../test/synthetic-seasons.js';
import { listPlayerTotals } from '../repositories/players.js';
import type { PlayerSeasonTotals } from '../types/domain.js';
import {
  COHORT_MIN_SIZE,
  getComparison,
  hitsPerStart,
  median,
  ptsPerNow,
  type ComparisonResult,
} from './cohort.js';

after(closePool);

/** This suite's synthetic season, claimed from the shared registry. */
const SEASON = syntheticSeason('comparison/cohort.test.ts');

const GABRIEL = 226597;
const GUEHI = 209036;
const SAKA = 223340;

async function comparison(
  season: string,
  position: 'GK' | 'DEF' | 'MID' | 'FWD',
  codes: number[] = []
): Promise<ComparisonResult> {
  const outcome = await getComparison(pool, season, position, codes);
  assert.ok(outcome.ok, `expected a result, got ${outcome.ok ? '' : outcome.error}`);
  return outcome.result;
}

describe('the axis set', () => {
  it('draws all ten defender axes on a season that measures everything', async () => {
    const { axes } = await comparison('2025-26', 'DEF');
    assert.deepEqual(axes, [
      'pts',
      'clean_sheets',
      'goals',
      'minutes',
      'ppm',
      'defcon_hits_per_start',
      'assists',
      'pts_per_now',
      'expected_goal_involvements',
      'bonus',
    ]);
  });

  it('drops an unmeasured axis rather than sending it null', async () => {
    // 2016-17 predates both the expected family and defensive contribution.
    const { axes, cohort } = await comparison('2016-17', 'DEF');

    assert.ok(!axes.includes('expected_goal_involvements'));
    assert.ok(!axes.includes('defcon_hits_per_start'));
    assert.equal(axes.length, 8);

    // Absent from the band too, not present-and-null: the client drops the spoke
    // and re-spaces, which it cannot do from a null it has to interpret.
    assert.ok(!('expected_goal_involvements' in cohort.band!));
    assert.ok(!('defcon_hits_per_start' in cohort.band!));
  });

  it('drops it from a player’s values as well as from the band', async () => {
    const { players } = await comparison('2016-17', 'DEF', []);
    assert.equal(players.length, 0);

    const withPlayer = await comparison('2025-26', 'DEF', [GABRIEL]);
    assert.ok('expected_goal_involvements' in withPlayer.players[0].values);

    const older = await getComparison(pool, '2016-17', 'DEF', []);
    assert.ok(older.ok);
    for (const axis of older.result.axes) {
      assert.ok(axis !== 'expected_goal_involvements' && axis !== 'defcon_hits_per_start');
    }
  });

  it('keeps the NOT NULL axes on a season with no matches at all', async () => {
    // 2026-27 is a roster and a schedule. Those columns are genuinely 0, and 0
    // is a measurement (rule 6) — withholding them would be the same overreach
    // in the other direction.
    const { axes } = await comparison('2026-27', 'DEF');
    assert.ok(axes.includes('pts'));
    assert.ok(axes.includes('minutes'));
    assert.ok(!axes.includes('expected_goal_involvements'));
    assert.ok(!axes.includes('defcon_hits_per_start'));
  });
});

describe('the cohort band, against the item 16 step 1 measurements', () => {
  it('reproduces all nine 2025-26 defender medians', async () => {
    const { cohort } = await comparison('2025-26', 'DEF');

    assert.equal(cohort.size, 109);
    const band = cohort.band!;

    assert.equal(band.pts, 95);
    assert.equal(band.clean_sheets, 6);
    assert.equal(band.goals, 1);
    assert.equal(band.minutes, 2195);
    assert.equal(band.assists, 2);
    assert.equal(band.bonus, 5);
    assert.equal(band.expected_goal_involvements, 2.67);

    // The two quotients, to the two decimals step 1 printed.
    assert.equal(band.ppm!.toFixed(2), '3.19');
    assert.equal(band.pts_per_now!.toFixed(2), '20.45');
    assert.equal(band.defcon_hits_per_start!.toFixed(2), '0.24');
  });

  it('takes the LOWER of two middles on an even cohort, not the interpolation', async () => {
    // The load-bearing test for the convention. GK 2025-26 is n = 22:
    // percentile_cont gives 111, percentile_disc gives 109. The nine anchors
    // above are n = 109 — odd — where both conventions agree, so they cannot
    // tell these apart and this one has to.
    const { cohort } = await comparison('2025-26', 'GK');

    assert.equal(cohort.size, 22);
    assert.equal(cohort.band!.pts, 109, 'percentile_cont would give 111');
  });

  it('suppresses the band on a season nobody has played', async () => {
    const { cohort, axes } = await comparison('2026-27', 'DEF');

    assert.equal(cohort.size, 0);
    assert.equal(cohort.band, null);
    // The spokes still exist and the player values still render; it is the band
    // alone that is missing.
    assert.ok(axes.length > 0);
  });
});

describe('the median', () => {
  it('is the middle member on an odd count', () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  it('is the lower middle member on an even count', () => {
    // Not 2.5. Nine of the eleven axes are integer counts and the band is
    // supposed to be a value some real player achieved.
    assert.equal(median([1, 2, 3, 4]), 2);
  });

  it('skips nulls rather than counting them as zero', () => {
    assert.equal(median([null, 4, null, 6, 8]), 6);
  });

  it('has no answer over nothing, or over nulls alone', () => {
    assert.equal(median([]), null);
    assert.equal(median([null, null]), null);
  });
});

describe('the two quotients, whose only other implementation is on the client', () => {
  it('agrees with the Pts and Price columns rendered beside it', async () => {
    // The drift guard. Pts/£ is computed here AND in
    // client/src/lib/playerColumns.ts, and the band forces that duplication —
    // a median across 109 players cannot be taken on a client that sees two.
    // This ties the chart's value to the two numbers the Players list shows in
    // the same row, so the two cannot silently disagree.
    const totals = await listPlayerTotals(pool, '2025-26');
    const cohort = totals.filter((p) => p.minutes >= 1200 && p.element_type === 2);
    assert.ok(cohort.length > 100);

    for (const row of cohort) {
      assert.equal(
        ptsPerNow(row),
        row.total_points / (row.now_cost! / 10),
        `${row.web_name}: chart value disagrees with Pts / Price`
      );
    }
  });

  it('reproduces the two values recorded on screen', async () => {
    const { players } = await comparison('2025-26', 'DEF', [GABRIEL, GUEHI]);
    const [gabriel, guehi] = players;

    // Item 14 measured Gabriel at 11 hits in 30 starts, and the Players list
    // renders 0.37. **Unchanged by item 24's gate**, and that is why he is the
    // right player to pin here: none of his 11 hits came off the bench, so the
    // axis he anchors did not move when the numerator did. The players it did
    // move — Canvot 0.71 to 0.64, Ballard 0.62 to 0.58 — are pinned in
    // `defcon.test.ts` against the count itself.
    assert.equal(gabriel.values.defcon_hits_per_start, 11 / 30);
    assert.equal(gabriel.values.defcon_hits_per_start!.toFixed(2), '0.37');

    // Step 1's top-three table put Guéhi top of DEF Pts/£ at 35.10.
    assert.equal(guehi.values.pts_per_now!.toFixed(2), '35.10');
  });

  it('returns null, never 0, when either operand is unmeasured', () => {
    // `null / 5` and `4 / null` are 0 in JavaScript, not NaN, so dropping either
    // guard renders a confident 0.00 for a player nobody measured — rule 6
    // defeated by a coercion. Item 14 found this on the client copy.
    // `defcon_hits` is set and deliberately disagrees: since item 24 the axis
    // reads `defcon_hits_started`, so a regression reading the ungated count
    // returns 0.9 rather than 0.4 and every assertion below moves.
    const base = {
      defcon_hits: 9,
      defcon_hits_started: 4,
      starts: 10,
      total_points: 100,
      now_cost: 50,
    };
    const row = (over: Partial<PlayerSeasonTotals>) =>
      ({ ...base, ...over }) as PlayerSeasonTotals;

    assert.equal(hitsPerStart(row({})), 0.4);
    assert.equal(hitsPerStart(row({ defcon_hits_started: null })), null);
    assert.equal(hitsPerStart(row({ starts: null })), null);
    // Zero starts is null rather than 0, so "made no starts" and "hit none of
    // his starts" stay distinguishable.
    assert.equal(hitsPerStart(row({ starts: 0 })), null);

    assert.equal(ptsPerNow(row({})), 20);
    assert.equal(ptsPerNow(row({ now_cost: null })), null);
    assert.equal(ptsPerNow(row({ now_cost: 0 })), null);
  });
});

describe('a player who is not the position asked for', () => {
  it('is a refusal, not a spoke drawn on the wrong axis set', async () => {
    const outcome = await getComparison(pool, '2025-26', 'DEF', [SAKA]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.status, 400);
    assert.match(outcome.error, /MID/);
  });

  it('is a 404 when the code is not in the season at all', async () => {
    const outcome = await getComparison(pool, '2025-26', 'DEF', [999999]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.status, 404);
  });
});

/**
 * The cohort floor, on synthetic rows.
 *
 * No real (season, position) has a cohort between 1 and 9 — the smallest is 20
 * goalkeepers — so this boundary cannot be reached against real data, and a test
 * that only checked the empty season would leave `COHORT_MIN_SIZE` untested at
 * the one value that matters.
 */
describe('the cohort floor', () => {
  async function withRollback(fn: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /** `n` defenders, each with one match of 1,200 minutes — over the gate by one. */
  async function seedDefenders(db: PoolClient, n: number): Promise<void> {
    const { rows: teams } = await db.query<{ id: number }>(
      'SELECT id FROM teams ORDER BY id LIMIT 2'
    );
    const [home, away] = [teams[0].id, teams[1].id];

    for (let i = 0; i < n; i++) {
      const { rows: p } = await db.query<{ id: number }>(
        `INSERT INTO players (fpl_code, web_name) VALUES ($1, $2) RETURNING id`,
        [900000 + i, `C${i}`]
      );
      const { rows: f } = await db.query<{ id: number }>(
        `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [SEASON, i + 1, i + 1, home, away]
      );
      await db.query(
        `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost, end_cost)
         VALUES ($1, $2, $3, $4, 'DEF', 50, 50)`,
        [p[0].id, SEASON, i + 1, home]
      );
      await db.query(
        `INSERT INTO player_gameweeks
           (player_id, fixture_id, season, gw, was_home, opponent_team_id,
            total_points, minutes, goals_scored, assists, clean_sheets, goals_conceded,
            own_goals, penalties_saved, penalties_missed, saves, yellow_cards, red_cards,
            bonus, bps, influence, creativity, threat, ict_index,
            value, selected, transfers_in, transfers_out, starts, defensive_contribution)
         VALUES ($1, $2, $3, $4, true, $5,
                 $6, 1200, 0, 0, 0, 0,
                 0, 0, 0, 0, 0, 0,
                 0, 0, 0, 0, 0, 0,
                 50, 0, 0, 0, 1, 12)`,
        [p[0].id, f[0].id, SEASON, i + 1, away, 10 + i]
      );
    }
  }

  it(`has no band one member below the floor of ${COHORT_MIN_SIZE}`, async () => {
    await withRollback(async (db) => {
      await seedDefenders(db, COHORT_MIN_SIZE - 1);
      const outcome = await getComparison(db, SEASON, 'DEF', []);
      assert.ok(outcome.ok);

      assert.equal(outcome.result.cohort.size, COHORT_MIN_SIZE - 1);
      assert.equal(outcome.result.cohort.band, null);
      // The size still travels, so the client can say why rather than infer it.
      assert.ok(outcome.result.axes.length > 0);
    });
  });

  it('has a band exactly at the floor', async () => {
    await withRollback(async (db) => {
      await seedDefenders(db, COHORT_MIN_SIZE);
      const outcome = await getComparison(db, SEASON, 'DEF', []);
      assert.ok(outcome.ok);

      assert.equal(outcome.result.cohort.size, COHORT_MIN_SIZE);
      assert.notEqual(outcome.result.cohort.band, null);
      // Points 10..19 seeded; the lower of the two middles is 14.
      assert.equal(outcome.result.cohort.band!.pts, 14);
    });
  });

  it('excludes a player who did not clear the minutes gate', async () => {
    await withRollback(async (db) => {
      await seedDefenders(db, COHORT_MIN_SIZE);
      await db.query(
        `UPDATE player_gameweeks SET minutes = 1199
          WHERE season = $1 AND player_id = (
            SELECT player_id FROM player_seasons WHERE season = $1 ORDER BY fpl_element_id LIMIT 1)`,
        [SEASON]
      );
      const outcome = await getComparison(db, SEASON, 'DEF', []);
      assert.ok(outcome.ok);

      assert.equal(outcome.result.cohort.size, COHORT_MIN_SIZE - 1);
      assert.equal(outcome.result.cohort.band, null, 'one minute short drops it below the floor');
    });
  });
});

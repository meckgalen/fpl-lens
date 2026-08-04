/**
 * The hole detector, on its own.
 *
 * `findHoles` is the load-bearing rule in two ingests: the CSV backfill applies
 * it to ten seasons and the live sync applies it to whatever FPL has just
 * served. Verifying it only through those two callers would mean a regression
 * here surfaces as a confusing failure somewhere else — a row count off by
 * 8,491 in `ingest:gameweeks`, or a `verify` run reporting two thousand
 * unexplained cells. So it gets its own suite, aimed at the three conditions
 * that make the rule correct.
 *
 * Everything runs against a temp table created `LIKE player_gameweeks` inside a
 * transaction that is always rolled back. Two reasons that is the right harness
 * rather than a shortcut: `LIKE` copies the real column types and NOT NULLs, so
 * this exercises the actual SQL against the actual schema; and it copies no
 * foreign keys, so a fixture can be invented without first inventing a player,
 * a club and a match to hang it on. The eleven real seasons are never touched.
 *
 * Run: npm test   (needs the database up; needs no ingest to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { HOLED_COLUMNS, applyHoles, findHoles } from './holes.js';

after(closePool);

const TABLE = 'probe_gameweeks';

/** A row's stats. Anything not named here takes the default below. */
interface RowSpec {
  fixture: number;
  gw: number;
  minutes?: number;
  starts?: number | null;
  expected_goals?: number | null;
}

/**
 * Twenty-two players took the field, which is what makes a zero total mean
 * something. The detector aggregates per fixture, so the row count matters and
 * the player identities do not.
 */
function fixtureRows(spec: RowSpec, players = 22): RowSpec[] {
  return Array.from({ length: players }, () => spec);
}

async function withTable(fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE ${TABLE} (LIKE player_gameweeks) ON COMMIT DROP`);
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

let nextPlayer = 1;

async function insert(client: PoolClient, season: string, rows: RowSpec[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO ${TABLE}
         (player_id, fixture_id, season, gw, was_home, opponent_team_id,
          total_points, minutes, goals_scored, assists, clean_sheets, goals_conceded,
          own_goals, penalties_saved, penalties_missed, saves, yellow_cards, red_cards,
          bonus, bps, value, selected, transfers_in, transfers_out,
          influence, creativity, threat, ict_index,
          starts, expected_goals)
       VALUES ($1, $2, $3, $4, true, 1,
               0, $5, 0, 0, 0, 0,
               0, 0, 0, 0, 0, 0,
               0, 0, 50, 0, 0, 0,
               0, 0, 0, 0,
               $6, $7)`,
      [
        nextPlayer++,
        row.fixture,
        season,
        row.gw,
        row.minutes ?? 90,
        row.starts === undefined ? 1 : row.starts,
        row.expected_goals === undefined ? 0.5 : row.expected_goals,
      ]
    );
  }
}

describe('findHoles: a column not measured on a match that was played', () => {
  it('flags a fixture whose column totals 0 where the season measures it elsewhere', async () => {
    await withTable(async (client) => {
      // Round 1 is the hole; round 2 is what proves the season measures it.
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, starts: 0 }));
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: 1 }));

      const holes = await findHoles(client, TABLE, ['starts']);

      assert.equal(holes.length, 1, 'exactly the round-1 fixture');
      assert.equal(holes[0].fixtureId, 1);
      assert.equal(holes[0].gw, 1);
      assert.deepEqual(holes[0].columns, ['starts']);
    });
  });

  it('does NOT flag a column the season never measured — that is rule 6, not a hole', async () => {
    // The clause this pins is the whole difference between the two, and it is
    // the one the obvious query omits. `starts` is NULL for every row of
    // 2016-17, 2017-18 and 2018-19 in the real database; without the
    // measured-elsewhere guard every fixture in those three seasons reads as
    // holed and the rule blanks a column that was already correctly blank.
    await withTable(async (client) => {
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, starts: null }));
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: null }));

      const holes = await findHoles(client, TABLE, ['starts']);

      assert.deepEqual(holes, [], 'a column absent from the whole season is not a hole in it');
    });
  });

  it('recognises both shapes, so the rule survives its own application', async () => {
    // 0-across is what the CSV stores; NULL-across is what this rule leaves
    // behind. A detector that knew only the first would stop seeing the holes
    // it had just fixed — and `sum(col) = 0` over an all-NULL column is NULL
    // rather than false, so that regression would hide rather than fail.
    await withTable(async (client) => {
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, starts: 0 }));
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: 1 }));

      const first = await findHoles(client, TABLE, ['starts']);
      assert.equal(first.length, 1);

      const nulled = await applyHoles(client, TABLE, first);
      assert.equal(nulled, 22, 'every row of the holed fixture');

      const second = await findHoles(client, TABLE, ['starts']);
      assert.deepEqual(
        second.map((h) => h.fixtureId),
        [1],
        'the same fixture is still holed once its zeros have become nulls'
      );

      const third = await applyHoles(client, TABLE, second);
      assert.equal(third, 22, 'idempotent: re-applying changes the same rows to the same values');
    });
  });

  it('does not flag a fixture nobody played', async () => {
    // A match with no minutes is not evidence of anything: there were no 22
    // players for the column to total zero across.
    await withTable(async (client) => {
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, minutes: 0, starts: 0 }));
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: 1 }));

      const holes = await findHoles(client, TABLE, ['starts']);

      assert.deepEqual(holes, [], 'an unplayed fixture cannot hole a column');
    });
  });

  it('holes each column independently on the same fixture', async () => {
    // 2022-23 round 29 is holed on expected_goal_involvements alone while the
    // other four are fine, so a fixture must never be holed wholesale. The
    // rule-6 assertion in ingest-gameweeks.ts depends on this: it excludes
    // holed fixtures per column, and would stop checking four columns it is
    // still exactly right about if a hole were fixture-wide.
    await withTable(async (client) => {
      await insert(
        client,
        '2099-00',
        fixtureRows({ fixture: 1, gw: 1, starts: 1, expected_goals: 0 })
      );
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: 1 }));

      const holes = await findHoles(client, TABLE, ['starts', 'expected_goals']);

      assert.equal(holes.length, 1);
      assert.deepEqual(holes[0].columns, ['expected_goals'], 'starts is measured and stays measured');
    });
  });

  it('scopes to the seasons it is given', async () => {
    await withTable(async (client) => {
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, starts: 0 }));
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: 1 }));
      await insert(client, '2098-99', fixtureRows({ fixture: 3, gw: 1, starts: 0 }));
      await insert(client, '2098-99', fixtureRows({ fixture: 4, gw: 2, starts: 1 }));

      const both = await findHoles(client, TABLE, ['starts']);
      assert.equal(both.length, 2, 'unscoped, it sees every season in the table');

      const one = await findHoles(client, TABLE, ['starts'], ['2099-00']);
      assert.deepEqual(
        one.map((h) => h.fixtureId),
        [1],
        'scoped, it sees only the season asked for'
      );
    });
  });

  it('sees a hole in round 1, with no later round to compare against', async () => {
    // This is the live-sync case and the reason the guard is `count(col) > 0`
    // rather than `sum(col) > 0`. Round 1 of a live season is the one moment
    // where every stored value of a column may legitimately be 0, so the two
    // formulations disagree here and nowhere else — across all ten CSV seasons
    // they are identical, which is why this cannot be checked against the
    // backfill and needs its own test.
    //
    // Under `sum(col) > 0` the season would read as "not measured", the zeros
    // would be stored, and nothing would be reported until round 2 arrived.
    // Detecting it now is right because the premise of the module holds in
    // round 1 exactly as in round 20: a played match totalling zero starts is
    // not a football result, and no later round makes that more true.
    await withTable(async (client) => {
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, starts: 0 }));

      const holes = await findHoles(client, TABLE, ['starts']);

      assert.deepEqual(
        holes.map((h) => h.fixtureId),
        [1],
        'a first-round hole is detectable on its own, with nothing to compare it to'
      );
    });
  });

  it('still refuses to call a wholly unmeasured column a hole, on a one-round season', async () => {
    // The other side of the same boundary, and what keeps the case above from
    // being a licence to blank anything. A column FPL does not publish at all
    // arrives NULL rather than 0 — the live mapper writes NULL for a field the
    // payload omits — so `count()` is 0 and rule 6 already covers it.
    await withTable(async (client) => {
      await insert(client, '2099-00', fixtureRows({ fixture: 1, gw: 1, starts: null }));

      const holes = await findHoles(client, TABLE, ['starts']);

      assert.deepEqual(holes, [], 'NULL throughout is rule 6, at any number of rounds');
    });
  });

  it('nulls only the columns holed, and only on the fixtures holed', async () => {
    await withTable(async (client) => {
      await insert(
        client,
        '2099-00',
        fixtureRows({ fixture: 1, gw: 1, starts: 0, expected_goals: 0 })
      );
      await insert(client, '2099-00', fixtureRows({ fixture: 2, gw: 2, starts: 1, expected_goals: 0.5 }));

      const holes = await findHoles(client, TABLE, ['starts', 'expected_goals']);
      await applyHoles(client, TABLE, holes);

      const { rows } = await client.query<{
        fixture_id: number;
        starts: number | null;
        expected_goals: string | null;
      }>(
        `SELECT fixture_id, max(starts) AS starts, max(expected_goals) AS expected_goals
           FROM ${TABLE} GROUP BY fixture_id ORDER BY fixture_id`
      );

      assert.equal(rows[0].starts, null, 'the holed fixture loses both columns');
      assert.equal(rows[0].expected_goals, null);
      assert.equal(rows[1].starts, 1, 'the measured fixture keeps them');
      assert.equal(Number(rows[1].expected_goals), 0.5);
    });
  });
});

describe('HOLED_COLUMNS: what the ingest fixes', () => {
  it('is the five nullable columns, and deliberately not the ICT quartet', async () => {
    // The ICT quartet is detectable and is NOT fixed — see CLAUDE.md for the
    // proportion argument. This pins the boundary so widening it is a decision
    // somebody makes rather than something that drifts in: adding a column here
    // without the migration would fail against a NOT NULL constraint, and
    // adding one with it would blank two seasons of ICT totals.
    assert.deepEqual(
      [...HOLED_COLUMNS],
      [
        'starts',
        'expected_goals',
        'expected_assists',
        'expected_goal_involvements',
        'expected_goals_conceded',
      ]
    );
  });
});

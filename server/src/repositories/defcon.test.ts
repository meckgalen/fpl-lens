/**
 * The defensive contribution hit rule, on its own.
 *
 * It gets its own suite for the reason `ingest/holes.ts` does: it is the
 * load-bearing rule in two queries — the per-row flag on `getPlayerHistory` and
 * the season count on `listPlayerTotals` — and a regression in it would
 * otherwise surface as a confusing failure somewhere downstream. It is also the
 * **first scoring rule this app computes for itself**, so nothing upstream can
 * be diffed against to catch a mistake.
 *
 * Two halves, deliberately, because neither can do the other's job:
 *
 *   - **Synthetic rows in a rolled-back transaction**, which is the only way to
 *     put a value *on* a boundary. Real 2025-26 has plenty of 9s and 10s but
 *     nothing guarantees it keeps them, and a test whose fixture is "whatever
 *     the season happens to contain" stops testing the boundary the moment the
 *     data moves. Season '2099-00' cannot collide with anything.
 *   - **Anchors against the real database**, which is the only way to catch a
 *     rule that is self-consistently wrong. Gabriel 11, Senesi 26 and Anderson
 *     26 come from the audit, computed by hand in SQL before any of this code
 *     existed.
 *
 * Run: npm test   (needs the database up and the three CSV ingests run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { syntheticSeason } from '../test/synthetic-seasons.js';
import { DEFCON_THRESHOLDS } from './defcon.js';
import { getPlayerHistory, listPlayerTotals } from './players.js';

after(closePool);

/**
 * This suite's synthetic season, claimed from the shared registry.
 *
 * **Not a literal, and not '2099-00' in particular**, which
 * `live-season.test.ts` owns. `node --test` runs test files in parallel, so two
 * open transactions inserting `fixtures (season, fpl_fixture_id) = ('2099-00', 1)`
 * contend on the same unique index and deadlock — observed as Postgres 40P01 on
 * the first full run after this file was added. See `test/synthetic-seasons.ts`
 * for why the registry exists rather than a second hand-picked constant.
 */
const SEASON = syntheticSeason('repositories/defcon.test.ts');

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

/** The two internal team ids the synthetic fixtures need. */
async function teamIds(db: PoolClient): Promise<{ home: number; away: number }> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM teams ORDER BY id LIMIT 2'
  );
  return { home: rows[0].id, away: rows[1].id };
}

interface Row {
  /** A distinct player per row, so each can be asserted independently. */
  code: number;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  /** null means the season never measured it — every season before 2025-26. */
  dc: number | null;
}

/**
 * Writes one synthetic season: a player, a registration and a match row each.
 *
 * Every row gets its own fixture as well as its own player, so a test never has
 * to reason about which of two rows it is looking at.
 */
async function seed(db: PoolClient, rows: Row[]): Promise<void> {
  const { home, away } = await teamIds(db);
  const teamId = home;

  for (const [i, row] of rows.entries()) {
    const { rows: p } = await db.query<{ id: number }>(
      `INSERT INTO players (fpl_code, web_name) VALUES ($1, $2) RETURNING id`,
      [row.code, `P${row.code}`]
    );
    const playerId = p[0].id;

    const { rows: f } = await db.query<{ id: number }>(
      `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [SEASON, i + 1, i + 1, home, away]
    );
    const fixtureId = f[0].id;

    await db.query(
      `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
       VALUES ($1, $2, $3, $4, $5, 50)`,
      [playerId, SEASON, i + 1, teamId, row.position]
    );

    await insertGameweek(db, playerId, fixtureId, i + 1, row.dc, away);
  }
}

/** One `player_gameweeks` row, with every NOT NULL column given a value. */
async function insertGameweek(
  db: PoolClient,
  playerId: number,
  fixtureId: number,
  gw: number,
  dc: number | null,
  opponentTeamId: number,
  /**
   * 0/1/NULL, as the column really is. Defaults to 1 — a started match — so
   * every test written before item 24 keeps the fixture it was written against
   * and only the tests that care about the bench say so.
   */
  starts: number | null = 1
): Promise<void> {
  await db.query(
    `INSERT INTO player_gameweeks
       (player_id, fixture_id, season, gw, was_home, opponent_team_id,
        total_points, minutes, goals_scored, assists, clean_sheets, goals_conceded,
        own_goals, penalties_saved, penalties_missed, saves, yellow_cards, red_cards,
        bonus, bps, influence, creativity, threat, ict_index,
        value, selected, transfers_in, transfers_out,
        starts, defensive_contribution)
     VALUES ($1, $2, $3, $4, true, $5,
             2, 90, 0, 0, 0, 0,
             0, 0, 0, 0, 0, 0,
             0, 0, 0, 0, 0, 0,
             50, 0, 0, 0,
             $7, $6)`,
    [playerId, fixtureId, SEASON, gw, opponentTeamId, dc, starts]
  );
}

/** The `defcon_hit` on each row of the synthetic season, keyed by player code. */
async function hitsByCode(db: PoolClient, rows: Row[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  for (const row of rows) {
    const history = await getPlayerHistory(db, row.code, SEASON);
    assert.equal(history.length, 1, `expected one row for ${row.code}`);
    out.set(row.code, history[0].defcon_hit);
  }
  return out;
}

describe('the defensive contribution threshold', () => {
  it('is 10 for a defender and 12 for a midfielder or forward, on the boundary', async () => {
    // Values chosen to sit ON each threshold and one below it. That is the whole
    // reason these rows are synthetic: `>=` versus `>` is a one-character
    // mutation, and it is invisible against real data unless a real match
    // happens to have landed exactly on 10 or 12.
    const rows: Row[] = [
      { code: 990001, position: 'DEF', dc: 9 },
      { code: 990002, position: 'DEF', dc: 10 },
      { code: 990003, position: 'MID', dc: 11 },
      { code: 990004, position: 'MID', dc: 12 },
      { code: 990005, position: 'FWD', dc: 11 },
      { code: 990006, position: 'FWD', dc: 12 },
    ];

    await withRollback(async (db) => {
      await seed(db, rows);
      const hits = await hitsByCode(db, rows);

      assert.equal(hits.get(990001), 0, 'DEF 9 is below the threshold');
      assert.equal(hits.get(990002), 1, 'DEF 10 clears it');
      assert.equal(hits.get(990003), 0, 'MID 11 is below the threshold');
      assert.equal(hits.get(990004), 1, 'MID 12 clears it');
      assert.equal(hits.get(990005), 0, 'FWD 11 is below the threshold');
      assert.equal(hits.get(990006), 1, 'FWD 12 clears it');
    });
  });

  it('is 0 for a goalkeeper however high the count', async () => {
    // FPL computes no DC for keepers, measured rather than assumed: DC is 0 on
    // all 3,427 GK rows of 2025-26 while the components are not — 24 tackles,
    // 934 CBI and 6,195 recoveries in those same rows.
    //
    // 0 rather than null because the column answers "did he score the DC
    // point", and a keeper scored none. Null would say "not measured", which is
    // the one meaning it must not carry: DC genuinely is measured for keepers
    // and genuinely is zero.
    const rows: Row[] = [
      { code: 990010, position: 'GK', dc: 0 },
      // Above every threshold, so a rule that forgot the position would say 1.
      { code: 990011, position: 'GK', dc: 40 },
    ];

    await withRollback(async (db) => {
      await seed(db, rows);
      const hits = await hitsByCode(db, rows);

      assert.equal(hits.get(990010), 0);
      assert.equal(hits.get(990011), 0, 'no threshold exists for a keeper to clear');
    });
  });

  it('is null, not 0, where the season never measured DC — including for a keeper', async () => {
    // The clause-order trap. The NULL test has to come BEFORE the GK branch, or
    // a 2016-17 goalkeeper row falls into `THEN 0` and asserts a measurement
    // nobody took. That is rule 6 defeated by the order of two lines, and it is
    // green under every other test in this file.
    const rows: Row[] = [
      { code: 990020, position: 'DEF', dc: null },
      { code: 990021, position: 'MID', dc: null },
      { code: 990022, position: 'GK', dc: null },
    ];

    await withRollback(async (db) => {
      await seed(db, rows);
      const hits = await hitsByCode(db, rows);

      assert.equal(hits.get(990020), null);
      assert.equal(hits.get(990021), null);
      assert.equal(hits.get(990022), null, 'the NULL clause must beat the GK clause');
    });
  });

  it('keeps a match row whose player has no registration, and marks it unmeasured', async () => {
    // The LEFT JOIN, pinned. `player_gameweeks` has foreign keys to fixtures,
    // teams and players and NONE to player_seasons, so a match row with no
    // registration is representable — there are zero today and nothing stops
    // one.
    //
    // Under an inner join the row is DROPPED and the gameweek disappears from
    // the table with nothing on screen saying so. Under the left join the
    // position is NULL, which falls through the ELSE-less CASE to null and
    // renders the no-value marker: visible, and rule 6's posture.
    await withRollback(async (db) => {
      const { home, away } = await teamIds(db);

      const { rows: p } = await db.query<{ id: number }>(
        `INSERT INTO players (fpl_code, web_name) VALUES (990030, 'Orphan') RETURNING id`
      );
      const { rows: f } = await db.query<{ id: number }>(
        `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
         VALUES ($1, 1, 1, $2, $3, true) RETURNING id`,
        [SEASON, home, away]
      );

      // Deliberately no player_seasons row. A real DC value, so the null that
      // comes back is attributable to the missing position and to nothing else.
      await insertGameweek(db, p[0].id, f[0].id, 1, 20, away);

      const history = await getPlayerHistory(db, 990030, SEASON);
      assert.equal(history.length, 1, 'the row must survive the join');
      assert.equal(history[0].defcon_hit, null, 'no position, so no answer');
      assert.equal(history[0].minutes, 90, 'and the rest of the row is intact');
    });
  });
});

describe('the season hit count', () => {
  it('counts the rows that cleared the threshold', async () => {
    await withRollback(async (db) => {
      const { home, away } = await teamIds(db);
      const { rows: p } = await db.query<{ id: number }>(
        `INSERT INTO players (fpl_code, web_name) VALUES (990040, 'Counter') RETURNING id`
      );
      const playerId = p[0].id;
      await db.query(
        `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
         VALUES ($1, $2, 1, $3, 'DEF', 50)`,
        [playerId, SEASON, home]
      );

      // Four rounds: 12, 10, 9, 0 — two of them clear a defender's 10.
      for (const [i, dc] of [12, 10, 9, 0].entries()) {
        const { rows: f } = await db.query<{ id: number }>(
          `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
           VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
          [SEASON, i + 1, i + 1, home, away]
        );
        await insertGameweek(db, playerId, f[0].id, i + 1, dc, away);
      }

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990040);
      assert.ok(player, 'the synthetic player must appear');
      assert.equal(player.defcon_hits, 2);

      // The cross-derivation this whole design exists for, in miniature: the
      // count and the flags come from two different queries and one rule.
      const history = await getPlayerHistory(db, 990040, SEASON);
      const summed = history.reduce((n, g) => n + (g.defcon_hit ?? 0), 0);
      assert.equal(player.defcon_hits, summed);
    });
  });

  it('is null, not 0, where the season measured DC on only some rows', async () => {
    // rule 6 one layer up, and the same argument `measuredSum` makes: a column
    // NULL on some of the rows that exist has no honest total, so it has no
    // honest count either. 2022-23 is the real shape this protects — measured
    // from round 16, so a count over it would be fourteen rounds short and look
    // exactly like a complete one.
    await withRollback(async (db) => {
      const { home, away } = await teamIds(db);
      const { rows: p } = await db.query<{ id: number }>(
        `INSERT INTO players (fpl_code, web_name) VALUES (990050, 'Partial') RETURNING id`
      );
      const playerId = p[0].id;
      await db.query(
        `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
         VALUES ($1, $2, 1, $3, 'DEF', 50)`,
        [playerId, SEASON, home]
      );

      for (const [i, dc] of [null, 20].entries()) {
        const { rows: f } = await db.query<{ id: number }>(
          `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
           VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
          [SEASON, i + 1, i + 1, home, away]
        );
        await insertGameweek(db, playerId, f[0].id, i + 1, dc, away);
      }

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990050);
      assert.ok(player);
      assert.equal(player.defcon_hits, null, 'one row measured out of two is no total');
    });
  });

  it('is null, not 0, for a registered player who has played nothing', async () => {
    // **The case the guard exists for, and the one a fixture would not
    // produce.** `count(col) = count(fixture_id)` is 0 = 0 over a player with no
    // match rows, so it passes vacuously — and `count(*) FILTER` over nothing
    // returns 0, not NULL. Without `count(pg.fixture_id) > 0` this reads as a
    // measured zero.
    //
    // `measuredSum` does not have this problem, because `sum()` over zero rows
    // is NULL. That asymmetry is the whole reason the guard is spelled out at
    // the call site instead of living inside `fullyMeasured`.
    await withRollback(async (db) => {
      const { home } = await teamIds(db);
      const { rows: p } = await db.query<{ id: number }>(
        `INSERT INTO players (fpl_code, web_name) VALUES (990060, 'Unplayed') RETURNING id`
      );
      await db.query(
        `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
         VALUES ($1, $2, 1, $3, 'DEF', 50)`,
        [p[0].id, SEASON, home]
      );

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990060);
      assert.ok(player, 'a registered player with no matches still has a row');
      assert.equal(player.matches, 0);
      assert.equal(player.defcon_hits, null, 'no matches is not zero hits');
    });
  });
});

describe('the started-only count, item 24', () => {
  /**
   * A helper for the shape these tests all need: one player, several rows, each
   * carrying its own `starts` as well as its own DC.
   */
  async function seedRows(
    db: PoolClient,
    code: number,
    name: string,
    position: 'GK' | 'DEF' | 'MID' | 'FWD',
    rows: { dc: number | null; starts: number | null }[]
  ): Promise<void> {
    const { home, away } = await teamIds(db);
    const { rows: p } = await db.query<{ id: number }>(
      `INSERT INTO players (fpl_code, web_name) VALUES ($1, $2) RETURNING id`,
      [code, name]
    );
    const playerId = p[0].id;
    await db.query(
      `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
       VALUES ($1, $2, 1, $3, $4, 50)`,
      [playerId, SEASON, home, position]
    );
    for (const [i, row] of rows.entries()) {
      const { rows: f } = await db.query<{ id: number }>(
        `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [SEASON, i + 1, i + 1, home, away]
      );
      await insertGameweek(db, playerId, f[0].id, i + 1, row.dc, away, row.starts);
    }
  }

  it('diverges from the total exactly on a hit won off the bench', async () => {
    // **The test the item exists for.** A substitute who clears the threshold
    // is a hit — `defcon_hits` counts him — and he is not a hit in a start, so
    // `defcon_hits_started` does not. Before item 24 there was one numerator
    // and the ratio divided bench hits by a denominator that never covered
    // them.
    //
    // Four rows for one defender: two hits started, one hit off the bench, one
    // start below the threshold. Every number below is distinct — 3 hits, 2
    // started, 3 starts — so no two of them can be swapped and still agree.
    await withRollback(async (db) => {
      await seedRows(db, 990070, 'Bencher', 'DEF', [
        { dc: 12, starts: 1 },
        { dc: 10, starts: 1 },
        { dc: 11, starts: 0 },
        { dc: 4, starts: 1 },
      ]);

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990070);
      assert.ok(player, 'the synthetic player must appear');

      assert.equal(player.starts, 3);
      assert.equal(player.defcon_hits, 3, 'the count keeps the bench hit');
      assert.equal(player.defcon_hits_started, 2, 'the ratio numerator drops it');
      assert.notEqual(
        player.defcon_hits,
        player.defcon_hits_started,
        'if these agree the gate is not being applied at all'
      );

      // What the two produce on screen, which is the actual defect: 1.00
      // against a true 0.67. Asserted here rather than left implicit, because
      // the divergence above is only interesting for what it does to the ratio.
      assert.equal((player.defcon_hits! / player.starts!).toFixed(2), '1.00');
      assert.equal((player.defcon_hits_started! / player.starts!).toFixed(2), '0.67');
    });
  });

  it('does not count a NULL start as a hit in a start', async () => {
    // `pg.starts = 1` is NULL where `starts` is NULL, so `NULL AND …` is NULL
    // and the row falls out of the FILTER rather than into it. The season-level
    // consequence is the next test; this one pins the per-row behaviour, and it
    // is a `COALESCE(starts, 1)` away from being wrong.
    //
    // The player is otherwise all hits, so a NULL read as a start would give 2
    // rather than 1 — a wrong number rather than a missing one.
    await withRollback(async (db) => {
      await seedRows(db, 990071, 'NullStart', 'DEF', [
        { dc: 12, starts: 1 },
        { dc: 12, starts: null },
      ]);

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990071);
      assert.ok(player);
      assert.equal(player.defcon_hits, 2, 'both rows cleared the threshold');
      assert.equal(
        player.defcon_hits_started,
        null,
        'and a partly measured starts column has no honest gated count'
      );
    });
  });

  it('is null where starts is measured on only some rows, where the total is not', async () => {
    // **The third guard, and the one `defcon_hits` does not need.** This is the
    // 2022-23 shape: DC measured throughout, `starts` only from round 16. The
    // ungated count is still honest there — nothing about it reads `starts` —
    // so the two fields differ in their NULLs as well as their values, and the
    // assertion is that they do.
    //
    // Without `fullyMeasured('starts')` this reads 1: the unmeasured row falls
    // out of the FILTER and the count silently undercounts instead of erroring.
    await withRollback(async (db) => {
      await seedRows(db, 990072, 'PartialStarts', 'MID', [
        { dc: 15, starts: null },
        { dc: 15, starts: 1 },
      ]);

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990072);
      assert.ok(player);
      assert.equal(player.defcon_hits, 2, 'DC is measured on both rows, so the count stands');
      assert.equal(player.defcon_hits_started, null, 'starts is not, so the gated count does not');
    });
  });

  it('is null, not 0, for a registered player who has played nothing', async () => {
    // `count(pg.fixture_id) > 0`, on the new field. The LEFT JOIN gives an
    // unplayed player one null-extended row and `count(*) FILTER` over it
    // returns 0, not NULL — item 13's vacuous truth in a fourth place. This is
    // every player of 2026-27, the season the app defaults to.
    await withRollback(async (db) => {
      const { home } = await teamIds(db);
      const { rows: p } = await db.query<{ id: number }>(
        `INSERT INTO players (fpl_code, web_name) VALUES (990073, 'Unplayed24') RETURNING id`
      );
      await db.query(
        `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
         VALUES ($1, $2, 1, $3, 'DEF', 50)`,
        [p[0].id, SEASON, home]
      );

      const totals = await listPlayerTotals(db, SEASON);
      const player = totals.find((t) => t.id === 990073);
      assert.ok(player);
      assert.equal(player.defcon_hits_started, null, 'no matches is not zero started hits');
    });
  });
});

describe('against the real database', () => {
  it('reproduces the audit anchors for 2025-26', async () => {
    // Computed by hand in SQL during the audit, before any of this code existed
    // — so these are an independent derivation rather than a snapshot of the
    // implementation. Gabriel is the entry in the item's own brief: 277 DC over
    // 30 starts averages 9.2 against a defender's 10, and the hit count says he
    // cleared it 11 times in 38.
    const totals = await listPlayerTotals(pool, '2025-26');
    const by = (name: string) => totals.find((t) => t.web_name === name);

    assert.equal(by('Gabriel')?.defcon_hits, 11);
    assert.equal(by('Senesi')?.defcon_hits, 26);
    assert.equal(by('Anderson')?.defcon_hits, 26);
    assert.equal(by('Tarkowski')?.defcon_hits, 22);
  });

  it('reproduces the two players item 24 was written from', async () => {
    // Canvot and Ballard, the worked examples in the brief, each with exactly
    // one hit off the bench. Derived by hand in SQL against
    // `player_gameweeks` before the aggregate was written, so this is an
    // outside number rather than the new code describing itself.
    //
    // **Both fields are asserted on every player**, which is what makes this a
    // check on the population rather than on the plumbing: the totals are
    // unchanged from item 14 and the started counts are one lower, and a
    // regression in either direction moves exactly one column of the four.
    const totals = await listPlayerTotals(pool, '2025-26');
    const by = (name: string) => totals.find((t) => t.web_name === name);

    // 10 hits, 9 of them started, over 14 starts: 0.71 became 0.64.
    assert.equal(by('Canvot')?.defcon_hits, 10);
    assert.equal(by('Canvot')?.defcon_hits_started, 9);
    assert.equal(by('Canvot')?.starts, 14);

    // 15 hits, 14 of them started, over 24 starts: 0.62 became 0.58.
    assert.equal(by('Ballard')?.defcon_hits, 15);
    assert.equal(by('Ballard')?.defcon_hits_started, 14);
    assert.equal(by('Ballard')?.starts, 24);

    // Gabriel has no bench hit, so his two counts agree and his ratio did not
    // move. He is the control: a mutation that gates nothing passes Canvot and
    // Ballard only by making them agree too, and one that gates everything
    // fails here.
    assert.equal(by('Gabriel')?.defcon_hits, 11);
    assert.equal(by('Gabriel')?.defcon_hits_started, 11);
  });

  it('counts 8 bench hits across the whole of 2025-26', async () => {
    // The season-wide figure, from the other side of item 14's audit, which
    // reported 8 hits won off the bench. Summing the difference between the two
    // fields must reproduce it — a check on the gate over 744 player-seasons
    // rather than the two the anchors above name.
    const totals = await listPlayerTotals(pool, '2025-26');
    const benchHits = totals
      .filter((t) => t.defcon_hits !== null && t.defcon_hits_started !== null)
      .reduce((n, t) => n + (t.defcon_hits! - t.defcon_hits_started!), 0);

    assert.equal(benchHits, 8);
  });

  it('never lets the started count exceed starts, on any season', async () => {
    // **The 1.00 bound, as an invariant rather than an observation.** Item 14
    // recorded that no 2025-26 player's ungated ratio actually exceeded 1 and
    // treated a value above 1 as legitimate; since item 24 the bound is
    // structural, because a hit in a start is a start. Checked over every
    // season so a future one cannot quietly break it.
    //
    // The pair rule 6 keeps apart: a null started count is skipped rather than
    // read as 0, which would compare a missing number to a real one.
    for (const season of ['2016-17', '2022-23', '2025-26', '2026-27']) {
      const totals = await listPlayerTotals(pool, season);
      for (const t of totals) {
        if (t.defcon_hits_started === null || t.starts === null) continue;
        assert.ok(
          t.defcon_hits_started <= t.starts,
          `${season} ${t.web_name}: ${t.defcon_hits_started} started hits > ${t.starts} starts`
        );
      }
    }
  });

  it('gives every player of the unplayed season a null count, never 0', async () => {
    // 2026-27 is the season the app DEFAULTS to and has 564 registrations with
    // zero match rows. Against the real database rather than a fixture, because
    // "564 registered players and nothing played" is a shape no handwritten
    // fixture would produce and is exactly where the vacuous guard bites.
    const totals = await listPlayerTotals(pool, '2026-27');
    assert.ok(totals.length > 500, 'the season should have its full roster');
    assert.equal(
      totals.filter((t) => t.defcon_hits !== null).length,
      0,
      'no player has played, so no player has a hit count'
    );
  });

  it('gives every player of a season predating DC a null count', async () => {
    const totals = await listPlayerTotals(pool, '2016-17');
    assert.ok(totals.length > 500);
    assert.equal(totals.filter((t) => t.defcon_hits !== null).length, 0);
  });

  it('gives every player of the unplayed season a null STARTED count too', async () => {
    // **The guard that fails silent rather than safe, at the scale it ships
    // at.** The synthetic test above covers one unplayed player; this covers
    // 2026-27's whole roster, which is the season the app DEFAULTS to.
    //
    // Worth its own assertion rather than folding into the `defcon_hits` test
    // beside it, because the two are not equally protected by their form.
    // `hauls_started` is built from `sum(CASE … ELSE 0)`, which the LEFT JOIN's
    // one null-extended row still turns into a hard 0 — but a bare `sum()` over
    // genuinely zero rows would have been NULL, so that shape at least fails in
    // a recognisable direction. `count(*) FILTER` returns **0 over anything**,
    // including nothing, so dropping `count(pg.fixture_id) > 0` here produces a
    // confident "started no hit" for 564 players who have not kicked a ball,
    // with nothing anywhere reading as an error.
    //
    // Both fields are asserted, so a guard removed from either one is caught.
    const totals = await listPlayerTotals(pool, '2026-27');
    assert.ok(totals.length > 500, 'the season should have its full roster');
    assert.equal(
      totals.filter((t) => t.defcon_hits_started !== null).length,
      0,
      'no player has played, so no player has a started-hit count'
    );
    assert.equal(totals.filter((t) => t.defcon_hits !== null).length, 0);
  });

  it('never returns a hit count above the number of matches played', async () => {
    // A property rather than a value, and the one that would catch the join
    // multiplying rows — which is the failure the anchors above could miss if
    // it scaled every player equally.
    const totals = await listPlayerTotals(pool, '2025-26');
    for (const t of totals) {
      if (t.defcon_hits === null) continue;
      assert.ok(
        t.defcon_hits <= t.matches,
        `${t.web_name}: ${t.defcon_hits} hits over ${t.matches} matches`
      );
    }
  });

  it('holds the thresholds the rule was introduced with', () => {
    // A tripwire on the constant itself. If FPL revises these, this is where it
    // is noticed — and the comment on DEFCON_THRESHOLDS says what to do then:
    // it becomes a per-season lookup, and 2025-26 keeps 10/12.
    assert.deepEqual(DEFCON_THRESHOLDS, { DEF: 10, MID: 12, FWD: 12 });
  });
});

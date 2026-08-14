/**
 * The haul and floor counts, on their own.
 *
 * Its own suite for the reason `defcon.test.ts` has one: this is a **scoring
 * rule the app computes for itself**, so no upstream number can be diffed
 * against to catch a mistake, and it is load-bearing for four columns rather
 * than one.
 *
 * Two halves, neither able to do the other's job:
 *
 *   - **Synthetic rows in a rolled-back transaction**, the only way to put a
 *     value *on* a boundary and the only way to construct a bench haul on
 *     demand. Real seasons contain both today and nothing guarantees they keep
 *     them, and a fixture that is "whatever the data happens to hold" stops
 *     testing the boundary the moment the data moves.
 *   - **Anchors and invariants against the real database**, the only way to
 *     catch a rule that is self-consistently wrong. The anchors were computed
 *     by hand in SQL before any of this code existed.
 *
 * **Read `describe('the 1.00 bound')` before deleting anything in it.** One of
 * its two clauses is deliberately unfalsifiable by today's data and says so.
 *
 * Run: npm test   (needs the database up and the three CSV ingests run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { syntheticSeason } from '../test/synthetic-seasons.js';
import { POINT_THRESHOLDS } from './hauls.js';
import { listPlayerTotals } from './players.js';

after(closePool);

/** This suite's synthetic season, claimed from the shared registry. */
const SEASON = syntheticSeason('repositories/hauls.test.ts');

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

async function teamIds(db: PoolClient): Promise<{ home: number; away: number }> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM teams ORDER BY id LIMIT 2');
  return { home: rows[0].id, away: rows[1].id };
}

/** One match: its points, and whether the player started it. */
interface Match {
  points: number;
  /** null means the season never measured it — every season before 2022-23. */
  starts: number | null;
}

interface Player {
  /** A distinct player per entry, so each can be asserted independently. */
  code: number;
  matches: Match[];
}

/**
 * Writes one synthetic season: a player and a registration each, plus one
 * fixture per match.
 *
 * Fixtures are numbered globally rather than per player, so two matches given
 * the same `gw` are two genuinely distinct fixtures — which is what makes the
 * double-gameweek case a real one rather than a duplicate row.
 */
async function seed(db: PoolClient, players: Player[], gwOf?: (i: number) => number): Promise<void> {
  const { home, away } = await teamIds(db);
  let fixtureNo = 0;

  for (const [i, player] of players.entries()) {
    const { rows: p } = await db.query<{ id: number }>(
      `INSERT INTO players (fpl_code, web_name) VALUES ($1, $2) RETURNING id`,
      [player.code, `P${player.code}`]
    );
    const playerId = p[0].id;

    await db.query(
      `INSERT INTO player_seasons (player_id, season, fpl_element_id, team_id, position, start_cost)
       VALUES ($1, $2, $3, $4, 'MID', 50)`,
      [playerId, SEASON, i + 1, home]
    );

    for (const [j, match] of player.matches.entries()) {
      fixtureNo += 1;
      const gw = gwOf ? gwOf(j) : fixtureNo;
      const { rows: f } = await db.query<{ id: number }>(
        `INSERT INTO fixtures (season, fpl_fixture_id, gw, home_team_id, away_team_id, finished)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [SEASON, fixtureNo, gw, home, away]
      );
      await insertGameweek(db, playerId, f[0].id, gw, match, away);
    }
  }
}

/** One `player_gameweeks` row, with every NOT NULL column given a value. */
async function insertGameweek(
  db: PoolClient,
  playerId: number,
  fixtureId: number,
  gw: number,
  match: Match,
  opponentTeamId: number
): Promise<void> {
  await db.query(
    `INSERT INTO player_gameweeks
       (player_id, fixture_id, season, gw, was_home, opponent_team_id,
        total_points, minutes, goals_scored, assists, clean_sheets, goals_conceded,
        own_goals, penalties_saved, penalties_missed, saves, yellow_cards, red_cards,
        bonus, bps, influence, creativity, threat, ict_index,
        value, selected, transfers_in, transfers_out,
        starts)
     VALUES ($1, $2, $3, $4, true, $5,
             $6, 90, 0, 0, 0, 0,
             0, 0, 0, 0, 0, 0,
             0, 0, 0, 0, 0, 0,
             50, 0, 0, 0,
             $7)`,
    [playerId, fixtureId, SEASON, gw, opponentTeamId, match.points, match.starts]
  );
}

/** The season totals of the synthetic season, keyed by player code. */
async function totalsByCode(db: PoolClient) {
  const totals = await listPlayerTotals(db, SEASON);
  return new Map(totals.map((t) => [t.id, t]));
}

describe('the haul and floor thresholds', () => {
  it('counts a match at the threshold and above, never below', async () => {
    await withRollback(async (db) => {
      // 9/10/11 straddles the haul line and 3/4/5 the floor line. This is the
      // case synthetic data exists for: it kills `>` in place of `>=`, which no
      // amount of real-season data can be relied on to contain forever.
      await seed(db, [
        { code: 960001, matches: [{ points: 9, starts: 1 }] },
        { code: 960002, matches: [{ points: 10, starts: 1 }] },
        { code: 960003, matches: [{ points: 11, starts: 1 }] },
        { code: 960004, matches: [{ points: 3, starts: 1 }] },
        { code: 960005, matches: [{ points: 4, starts: 1 }] },
        { code: 960006, matches: [{ points: 5, starts: 1 }] },
      ]);
      const t = await totalsByCode(db);

      assert.equal(t.get(960001)!.hauls, 0, '9 points is not a haul');
      assert.equal(t.get(960002)!.hauls, 1, '10 points is a haul');
      assert.equal(t.get(960003)!.hauls, 1, '11 points is a haul');

      assert.equal(t.get(960004)!.floors, 0, '3 points is not a floor');
      assert.equal(t.get(960005)!.floors, 1, '4 points is a floor');
      assert.equal(t.get(960006)!.floors, 1, '5 points is a floor');
    });
  });

  it('counts a haul as a floor too, so floors are never fewer than hauls', async () => {
    await withRollback(async (db) => {
      // **The seed must contain a haul or this passes vacuously**, which is why
      // 12 and 15 are here rather than a spread of small scores: with no haul,
      // `floors >= hauls` reduces to `n >= 0` and holds under any threshold
      // pair. Mutation: swap the two constants (HAUL 4, FLOOR 10) and this goes
      // red at 1 floor against 3 hauls.
      await seed(db, [
        { code: 960010, matches: [
          { points: 12, starts: 1 },
          { points: 15, starts: 1 },
          { points: 6, starts: 1 },
          { points: 1, starts: 1 },
        ] },
      ]);
      const p = (await totalsByCode(db)).get(960010)!;

      assert.equal(p.hauls, 2, 'two matches reached 10');
      assert.equal(p.floors, 3, 'the same two, plus the 6');
      assert.ok(p.floors >= p.hauls, 'floors include hauls');
    });
  });
});

describe('the started-only gate on the ratio numerators', () => {
  it('excludes a haul won off the bench, while the count column keeps it', async () => {
    await withRollback(async (db) => {
      // **The seed must contain a bench haul or this passes vacuously.** That
      // is the whole case: a substitute who scores 12 raises Hauls and must not
      // raise H/St, because he did not start.
      await seed(db, [
        { code: 960020, matches: [
          { points: 12, starts: 0 },
          { points: 11, starts: 1 },
          { points: 5, starts: 0 },
          { points: 2, starts: 1 },
        ] },
      ]);
      const p = (await totalsByCode(db)).get(960020)!;

      assert.equal(p.starts, 2, 'two of the four were starts');
      assert.equal(p.hauls, 2, 'the count column counts the bench haul');
      assert.equal(p.hauls_started, 1, 'the numerator does not');
      assert.equal(p.floors, 3, '12, 11 and 5 all reached 4');
      // The 12 and the 5 came off the bench and the 2 was a start that did not
      // reach 4, so the 11 is the only started floor.
      assert.equal(p.floors_started, 1);
    });
  });

  it('counts both fixtures of a double gameweek, in the numerator and the denominator', async () => {
    await withRollback(async (db) => {
      // Rule 13: the unit is the fixture, never the round. Two distinct
      // fixtures both numbered gw 7.
      await seed(db, [{ code: 960030, matches: [
        { points: 11, starts: 1 },
        { points: 13, starts: 1 },
      ] }], () => 7);
      const p = (await totalsByCode(db)).get(960030)!;

      assert.equal(p.matches, 2, 'two fixtures in one round');
      assert.equal(p.hauls, 2, 'a double gameweek can contribute two hauls');
      assert.equal(p.hauls_started, 2);
      assert.equal(p.starts, 2, 'and two to the denominator');
    });
  });

  it('is null, not an undercount, where the season measured starts on only some rows', async () => {
    await withRollback(async (db) => {
      // 2022-23's shape: starts arrive part way through. Without
      // `fullyMeasured('starts')` the null rows fall to the CASE's ELSE 0 and
      // this reads 1 — a real haul silently reclassified as a bench haul.
      // Mutation: drop that guard and this goes red at 1.
      await seed(db, [{ code: 960040, matches: [
        { points: 12, starts: null },
        { points: 11, starts: 1 },
      ] }]);
      const p = (await totalsByCode(db)).get(960040)!;

      assert.equal(p.hauls, 2, 'the ungated count is unaffected: it never reads starts');
      assert.equal(p.starts, null, 'no honest start total exists');
      assert.equal(p.hauls_started, null, 'and so no honest gated count does either');
      assert.equal(p.floors_started, null);
    });
  });

  it('is null for a registered player who has played nothing, never 0', async () => {
    await withRollback(async (db) => {
      // **The case the `count(pg.fixture_id) > 0` half of the guard exists
      // for, and it was measured rather than predicted.** `sum()` over zero
      // rows is NULL, which is what talked item 19 out of this guard — but the
      // LEFT JOIN null-extends to exactly ONE row, and `sum(CASE ... ELSE 0)`
      // over one null row is a hard 0. Without the guard all 564 players of
      // 2026-27 read 0 here.
      await seed(db, [{ code: 960050, matches: [] }]);
      const p = (await totalsByCode(db)).get(960050)!;

      assert.equal(p.matches, 0, 'registered, never played');
      assert.equal(p.hauls_started, null, 'no gated count exists over no matches');
      assert.equal(p.floors_started, null);
    });
  });

  it('gives a player with matches but no starts a real 0, not null', async () => {
    await withRollback(async (db) => {
      // The near-miss to the case above, and the pair rule 6 exists to keep
      // apart. He played, `starts` is measured, and he started none of them —
      // so the gated count is a measured zero. It is the CLIENT that renders
      // this blank, via `perStart`'s zero-denominator guard, because 0/0 has no
      // answer; the server must not pre-empt that by inventing a null.
      await seed(db, [{ code: 960060, matches: [
        { points: 12, starts: 0 },
        { points: 5, starts: 0 },
      ] }]);
      const p = (await totalsByCode(db)).get(960060)!;

      assert.equal(p.starts, 0, 'measured, and zero');
      assert.equal(p.hauls, 1, 'the bench haul still counts here');
      assert.equal(p.hauls_started, 0, 'measured, and zero — not null');
      assert.equal(p.floors_started, 0);
    });
  });
});

describe('the counts over an unplayed season', () => {
  it('gives every player of 2026-27 a real 0 rather than a null', async () => {
    // Item 19's decision, pinned: `total_points` is NOT NULL, so a haul count
    // has no unmeasured state and a roster that has played nothing has hauled
    // zero times — exactly as `goals_scored` reads 0 there. Withholding it
    // would be the overreach in the other direction (CLAUDE.md, Known Issues).
    const totals = await listPlayerTotals(pool, '2026-27');
    assert.ok(totals.length > 500, 'the full registered roster');

    assert.equal(totals.filter((t) => t.hauls !== 0).length, 0);
    assert.equal(totals.filter((t) => t.floors !== 0).length, 0);
    // The gated pair is the opposite, and for a different reason: no start was
    // measured because no match was played.
    assert.equal(totals.filter((t) => t.hauls_started !== null).length, 0);
    assert.equal(totals.filter((t) => t.floors_started !== null).length, 0);
  });

  it('gives a season predating the starts column null gated counts and real ungated ones', async () => {
    const totals = await listPlayerTotals(pool, '2016-17');
    assert.equal(totals.filter((t) => t.hauls_started !== null).length, 0, 'starts is NULL throughout');
    assert.ok(
      totals.reduce((n, t) => n + t.hauls, 0) > 0,
      'while the ungated counts read total_points and are unaffected'
    );
  });
});

describe('against the real database', () => {
  it('reproduces the audit anchors for 2025-26', async () => {
    // Hand-written SQL over player_gameweeks, run before hauls.ts existed. Each
    // pair separates the two numerators: every one of these players has a haul
    // off the bench, so a suite that dropped the gate would disagree here.
    const expected = [
      { code: 178301, name: 'Watkins', starts: 33, hauls: 5, started: 4 },
      { code: 475168, name: 'João Pedro', starts: 31, hauls: 5, started: 4 },
      { code: 224117, name: 'Gyökeres', starts: 26, hauls: 4, started: 3 },
      { code: 215439, name: 'Souček', starts: 24, hauls: 2, started: 1 },
    ];
    const totals = await listPlayerTotals(pool, '2025-26');

    for (const e of expected) {
      const p = totals.find((t) => t.id === e.code);
      assert.ok(p, `${e.name} is registered in 2025-26`);
      assert.equal(p.starts, e.starts, `${e.name} starts`);
      assert.equal(p.hauls, e.hauls, `${e.name} hauls`);
      assert.equal(p.hauls_started, e.started, `${e.name} hauls in started fixtures`);
    }
  });

  it('never reports fewer floors than hauls, on any row of any season', async () => {
    // The inclusive relation, over every player-season the database holds
    // rather than over a fixture that could be arranged to satisfy it.
    const seasons = await allSeasons();
    for (const season of seasons) {
      const totals = await listPlayerTotals(pool, season);
      const bad = totals.filter((t) => t.floors < t.hauls);
      assert.equal(bad.length, 0, `${season}: ${bad.length} rows with floors < hauls`);
    }
  });
});

describe('the 1.00 bound', () => {
  /**
   * **This is the only claim in item 19 that a reader is shown as a promise.**
   * Both ratio descriptions say H/St and F/St cannot exceed 1.00, and that
   * rests entirely on `numerator <= starts` — the inclusive relation and
   * `hauls_started <= hauls` compare a numerator to another numerator and imply
   * nothing about the denominator.
   *
   * **One of the two clauses below cannot currently fail, and that was measured
   * before it was written rather than discovered later.** Dropping the
   * `starts = 1` gate sets each numerator to its ungated count, so the bound
   * breaks only where an ungated count exceeds the start count. Guarded rows
   * where that happens, per season:
   *
   *     season     rows   hauls > starts   floors > starts
   *     2022-23     117         0                 0
   *     2023-24     865         0                15
   *     2024-25     784         0                13
   *     2025-26     841         0                13
   *
   * **No player in any season out-hauls his start count**, so the haul clause
   * would stay green under that mutation; the floor clause goes red on the last
   * three seasons (2025-26 witnesses: Chiesa 223541 at 1 start and 3 floors,
   * Onyeka 428580 at 0 and 2, Yates 204968 at 2 and 3, Awoniyi 210156 at 3
   * and 4).
   *
   * The haul clause is kept anyway, because it is the half the description
   * promises and a future season can make it falsifiable. **Do not delete it on
   * the grounds that no mutation reddens it** — that is recorded here so the
   * finding is not re-derived, and in
   * `docs/items/item-19-hauls-and-floors.md`.
   */
  it('never reports more started hauls or floors than starts, on any row of any season', async () => {
    const seasons = await allSeasons();
    let seasonsCovered = 0;

    for (const season of seasons) {
      const totals = await listPlayerTotals(pool, season);
      const comparable = totals.filter((t) => t.starts !== null && t.hauls_started !== null);
      if (comparable.length === 0) continue;
      seasonsCovered += 1;

      // 2022-23 is the season most at risk of emptying out, since its hole
      // guard removes all but the players whose rows all postdate round 16.
      // Frozen so that a change which silently drops them fails here rather
      // than passing on nothing. The figure is the audit's, not this code's.
      if (season === '2022-23') {
        assert.equal(comparable.length, 117, '2022-23 rows surviving the starts hole guard');
      }

      for (const t of totals) {
        if (t.starts === null) continue;
        if (t.hauls_started !== null) {
          assert.ok(
            t.hauls_started <= t.starts,
            `${season} ${t.web_name}: ${t.hauls_started} started hauls > ${t.starts} starts`
          );
        }
        if (t.floors_started !== null) {
          assert.ok(
            t.floors_started <= t.starts,
            `${season} ${t.web_name}: ${t.floors_started} started floors > ${t.starts} starts`
          );
        }
      }
    }

    // **The non-emptiness assertion.** "where both are non-null" excludes the
    // six seasons before 2022-23 and 2026-27 outright, so without this the
    // property passes by filtering everything away.
    assert.ok(seasonsCovered >= 4, `expected at least four covered seasons, got ${seasonsCovered}`);
  });
});

describe('the thresholds themselves', () => {
  it('holds the two lines the rule was introduced with', async () => {
    assert.deepEqual(POINT_THRESHOLDS, { HAUL: 10, FLOOR: 4 });
  });
});

/** Every season the database holds, newest first. */
async function allSeasons(): Promise<string[]> {
  const { rows } = await pool.query<{ season: string }>(
    'SELECT DISTINCT season FROM player_seasons ORDER BY season DESC'
  );
  return rows.map((r) => r.season);
}

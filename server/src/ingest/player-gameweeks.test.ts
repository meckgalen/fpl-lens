/**
 * Phase 0, step 5: the acceptance test for `player_gameweeks`.
 *
 * Run: npm test   (requires ingest:dimensions, ingest:fixtures and
 *                  ingest:gameweeks to have run against the .env database)
 *
 * This is an integration test on purpose. The failure mode step 5 is guarding
 * against is rows going missing between the CSV and the table, and only the
 * table can show that. It reads; it never writes.
 *
 * Where the expected numbers come from, which matters more than usual here
 * because a test that recomputes its expectation from the same source it is
 * checking proves nothing:
 *
 *   - Saka 2025-26 and Saka 2019-20 were taken from the official FPL API's
 *     `history_past` (`element-summary/12/`), which is an entirely separate
 *     pipeline from the vaastav CSVs this ingest reads.
 *   - Salah 2017-18 (303 points, 32 goals) and De Bruyne 2019-20 (251 points,
 *     23 assists) are matters of public record. Both players have since left the
 *     league, so `history_past` no longer carries them.
 *
 * One deliberate divergence from `history_past`: it reports `starts: 0` for
 * seasons before 2022-23, when the stat did not exist. We store NULL, because
 * zero would assert a measurement nobody took (rule 6). The pre-2022-23 cases
 * below assert NULL, and that is the ingest working, not a discrepancy.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../db/pool.js';

after(closePool);

/** The nine acceptance metrics, plus the row count behind them. */
interface Totals {
  matches: number;
  total_points: number | null;
  starts: number | null;
  minutes: number | null;
  goals_scored: number | null;
  assists: number | null;
  clean_sheets: number | null;
  goals_conceded: number | null;
  bonus: number | null;
  bps: number | null;
}

/**
 * Sum one player's season. Joined through `players.fpl_code`, never through an
 * FPL element id: element ids are reassigned every season (rule 2), so player
 * 234 in 2017-18 is a different person from player 234 today.
 *
 * `sum()` over an all-NULL column is NULL, not 0, which is what lets the
 * pre-2022-23 `starts` assertions below mean something.
 */
async function totals(fplCode: number, season: string): Promise<Totals> {
  const { rows } = await pool.query<Record<keyof Totals, string | null>>(
    `SELECT count(*)              AS matches,
            sum(pg.total_points)  AS total_points,
            sum(pg.starts)        AS starts,
            sum(pg.minutes)       AS minutes,
            sum(pg.goals_scored)  AS goals_scored,
            sum(pg.assists)       AS assists,
            sum(pg.clean_sheets)  AS clean_sheets,
            sum(pg.goals_conceded) AS goals_conceded,
            sum(pg.bonus)         AS bonus,
            sum(pg.bps)           AS bps
       FROM player_gameweeks pg
       JOIN players p ON p.id = pg.player_id
      WHERE p.fpl_code = $1 AND pg.season = $2`,
    [fplCode, season]
  );
  const row = rows[0];
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    matches: Number(row.matches),
    total_points: num(row.total_points),
    starts: num(row.starts),
    minutes: num(row.minutes),
    goals_scored: num(row.goals_scored),
    assists: num(row.assists),
    clean_sheets: num(row.clean_sheets),
    goals_conceded: num(row.goals_conceded),
    bonus: num(row.bonus),
    bps: num(row.bps),
  };
}

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

const SAKA = 223340;
const SALAH = 118748;
const DE_BRUYNE = 61366;
const KROUPI = 560262;

describe('player_gameweeks acceptance', () => {
  it('is populated at all', async () => {
    // Everything below would fail with a confusing null-vs-number diff if the
    // ingest had not been run. Say why up front instead.
    const n = await scalar('SELECT count(*) AS n FROM player_gameweeks');
    assert.equal(
      n,
      253509,
      `expected 253509 rows, found ${n} — run 'npm run ingest:gameweeks' first`
    );
  });

  /**
   * The step 5 acceptance test from CLAUDE.md. If minutes match but points do
   * not, rows were lost in a blank gameweek: minutes are dominated by the 90s a
   * regular starter racks up, while points are where a missing single row shows.
   */
  it('sums Bukayo Saka 2025-26 to the nine expected values', async () => {
    const t = await totals(SAKA, '2025-26');
    assert.deepEqual(
      {
        total_points: t.total_points,
        starts: t.starts,
        minutes: t.minutes,
        goals_scored: t.goals_scored,
        assists: t.assists,
        clean_sheets: t.clean_sheets,
        goals_conceded: t.goals_conceded,
        bonus: t.bonus,
        bps: t.bps,
      },
      {
        total_points: 157,
        starts: 25,
        minutes: 2218,
        goals_scored: 7,
        assists: 10,
        clean_sheets: 12,
        goals_conceded: 16,
        bonus: 18,
        bps: 570,
      }
    );
    assert.equal(t.matches, 38);
  });

  /**
   * 2017-18: a latin1 file (rule: 2016-17..2018-19 are ISO-8859-1), and three
   * seasons before xG or `starts` were measured. Salah's 303 points remains the
   * FPL single-season record for a 38-game campaign.
   */
  it('sums Mohamed Salah 2017-18, with starts NULL because it was not measured', async () => {
    const t = await totals(SALAH, '2017-18');
    assert.deepEqual(t, {
      matches: 38,
      total_points: 303,
      starts: null,
      minutes: 2905,
      goals_scored: 32,
      assists: 12,
      clean_sheets: 15,
      goals_conceded: 29,
      bonus: 26,
      bps: 881,
    });
  });

  /**
   * 2019-20 exercises the rule 12 dedup directly: De Bruyne played in fixture
   * 275, the Man City v Arsenal match postponed on 11 March and played on 17
   * June, which appears twice in merged_gw — once under round 29 with 0 minutes
   * and 0 points, once under round 39 with the real result. Take the wrong half
   * and his 251 points do not add up.
   */
  it('sums Kevin De Bruyne 2019-20 across the postponed-fixture dedup', async () => {
    const t = await totals(DE_BRUYNE, '2019-20');
    assert.deepEqual(t, {
      matches: 38,
      total_points: 251,
      starts: null,
      minutes: 2790,
      goals_scored: 13,
      assists: 23,
      clean_sheets: 18,
      goals_conceded: 22,
      bonus: 35,
      bps: 988,
    });
  });

  /** Cross-checked against the live API's history_past for 2019/20. */
  it('sums Bukayo Saka 2019-20, his 34-match debut season', async () => {
    const t = await totals(SAKA, '2019-20');
    assert.deepEqual(t, {
      matches: 34,
      total_points: 71,
      starts: null,
      minutes: 1746,
      goals_scored: 1,
      assists: 6,
      clean_sheets: 7,
      goals_conceded: 18,
      bonus: 4,
      bps: 259,
    });
  });
});

describe('player_gameweeks structure', () => {
  /**
   * Rule 12. The stored gw must be the round the match was actually played in,
   * not the round it was originally scheduled for.
   */
  it('stores the postponed 2019-20 fixture under round 39, not round 29', async () => {
    const { rows } = await pool.query<{ gw: number; minutes: number }>(
      `SELECT pg.gw, pg.minutes
         FROM player_gameweeks pg
         JOIN players p ON p.id = pg.player_id
         JOIN fixtures f ON f.id = pg.fixture_id
        WHERE p.fpl_code = $1 AND f.season = '2019-20' AND f.fpl_fixture_id = 275`,
      [DE_BRUYNE]
    );
    assert.equal(rows.length, 1, 'expected exactly one row for fixture 275');
    assert.equal(rows[0].gw, 39);
    // The round-29 placeholder carries 0 minutes; the real row does not.
    assert.ok(rows[0].minutes > 0, 'the surviving row is the placeholder, not the played match');

    // The match appears 119 times in merged_gw: 59 rows under round 29 and 60
    // under round 39. Every one of the 60 players must end up with exactly one
    // row, and all of them under the round it was actually played in. Only
    // fixture 275 moved — round 29's other ten matches went ahead as scheduled.
    const under29 = await scalar(
      `SELECT count(*) AS n FROM player_gameweeks pg
         JOIN fixtures f ON f.id = pg.fixture_id
        WHERE f.season = '2019-20' AND f.fpl_fixture_id = 275 AND pg.gw <> 39`
    );
    assert.equal(under29, 0, 'a row survived under the round the match was postponed from');

    const total = await scalar(
      `SELECT count(*) AS n FROM player_gameweeks pg
         JOIN fixtures f ON f.id = pg.fixture_id
        WHERE f.season = '2019-20' AND f.fpl_fixture_id = 275`
    );
    assert.equal(total, 60, '119 CSV rows for this match must dedup to 60');
  });

  /**
   * Rule 13. (player_id, gw) is NOT a key. A double gameweek gives a player two
   * rows in one round, which is why the constraint is (player_id, fixture_id).
   */
  it('keeps both rows of a double gameweek', async () => {
    const n = await scalar(
      `SELECT count(*) AS n
         FROM player_gameweeks pg JOIN players p ON p.id = pg.player_id
        WHERE p.fpl_code = $1 AND pg.season = '2019-20' AND pg.gw = 39`,
      [DE_BRUYNE]
    );
    assert.equal(n, 2, 'De Bruyne played twice in round 39');

    const { rows } = await pool.query<{ fixture_id: number }>(
      `SELECT DISTINCT fixture_id
         FROM player_gameweeks pg JOIN players p ON p.id = pg.player_id
        WHERE p.fpl_code = $1 AND pg.season = '2019-20' AND pg.gw = 39`,
      [DE_BRUYNE]
    );
    assert.equal(rows.length, 2, 'the two rows must be two different fixtures, not a duplicate');
  });

  /** Rule 13, the other half: a blank gameweek gives a player no row at all. */
  it('has two rows in round 33 and none in round 34 for Kroupi in 2025-26', async () => {
    const counts = await pool.query<{ gw: number; n: string }>(
      `SELECT pg.gw, count(*) AS n
         FROM player_gameweeks pg JOIN players p ON p.id = pg.player_id
        WHERE p.fpl_code = $1 AND pg.season = '2025-26' AND pg.gw IN (33, 34)
        GROUP BY pg.gw ORDER BY pg.gw`,
      [KROUPI]
    );
    assert.deepEqual(
      counts.rows.map((r) => [r.gw, Number(r.n)]),
      [[33, 2]],
      'round 33 is a double, round 34 is a blank with no row at all'
    );
  });

  /**
   * Rule 6, on the two boundaries that matter most. xG starts in 2022-23 and
   * defensive_contribution in 2025-26; before that the value is NULL, never 0.
   */
  it('leaves expected_goals NULL before 2022-23 and set from 2022-23 on', async () => {
    const wrong = await scalar(
      `SELECT count(*) AS n FROM player_gameweeks
        WHERE (season >= '2022-23') <> (expected_goals IS NOT NULL)`
    );
    assert.equal(wrong, 0);
  });

  it('sets defensive_contribution in 2025-26 only', async () => {
    const wrong = await scalar(
      `SELECT count(*) AS n FROM player_gameweeks
        WHERE (season = '2025-26') <> (defensive_contribution IS NOT NULL)`
    );
    assert.equal(wrong, 0);
  });

  /**
   * Rule 11. The 20 Assistant Manager elements from the 2024-25 chip are not
   * players. They carry permanent codes of their own — all in the 100,000,000+
   * range, where no real player code sits — so their absence is checkable
   * without hardcoding the whole list.
   */
  it('has no row, and no player, for an Assistant Manager', async () => {
    const inPlayers = await scalar(
      'SELECT count(*) AS n FROM players WHERE fpl_code >= 100000000'
    );
    assert.equal(inPlayers, 0, 'an Assistant Manager reached the players dimension');

    const arteta = await scalar('SELECT count(*) AS n FROM players WHERE fpl_code = 100051017');
    assert.equal(arteta, 0, 'Mikel Arteta is not a player');

    const gameweeks = await scalar(
      `SELECT count(*) AS n
         FROM player_gameweeks pg JOIN players p ON p.id = pg.player_id
        WHERE p.fpl_code >= 100000000`
    );
    assert.equal(gameweeks, 0);

    // 27,605 rows in the 2024-25 file, 322 of them managers. If the exclusion
    // were skipped, or over-applied, this is what would move.
    const season = await scalar(
      `SELECT count(*) AS n FROM player_gameweeks WHERE season = '2024-25'`
    );
    assert.equal(season, 27283);
  });
});

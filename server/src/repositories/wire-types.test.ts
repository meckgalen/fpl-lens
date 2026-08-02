/**
 * The numeric wire types, pinned.
 *
 * node-postgres returns int2/int4 as JS numbers but numeric — and int8, which
 * is what SUM over an integer column produces — as strings. Before the types
 * split every decimal reached the client as a string and every consumer called
 * parseFloat on it by hand.
 *
 * A field that quietly stays a string passes `tsc`: the repository declares it
 * `number` and nothing checks that claim at runtime. It surfaces months later
 * as a sort putting "9.1" above "10.4", which looks like a UI bug and is not.
 *
 * The other half of the contract is rule 6: a stat nobody measured is null, not
 * zero. `0` and `null` are the same width in a table cell and mean opposite
 * things — "generated no chances" versus "this season predates xG".
 *
 * These go through the repositories, so no server has to be running.
 *
 * Run: npm test   (requires the ingest scripts to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../db/pool.js';
import { getPlayerHistory, listPlayerTotals } from './players.js';

after(closePool);

const SAKA = 223340;
const SALAH = 118748;

/** Every field that must arrive as a JS number, or null where unmeasured. */
const NUMERIC_FIELDS = [
  'id',
  'team',
  'element_type',
  'now_cost',
  'total_points',
  'minutes',
  'goals_scored',
  'assists',
  'clean_sheets',
  'bonus',
  'bps',
  'starts',
  'appearances',
  'influence',
  'creativity',
  'threat',
  'ict_index',
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'points_per_game',
] as const;

/** Every field that must stay a string, so the sweep cannot pass vacuously. */
const STRING_FIELDS = ['first_name', 'second_name', 'web_name', 'photo'] as const;

describe('wire types: decimals are numbers, unmeasured stats are null', () => {
  it('returns numbers for a season that measured everything', async () => {
    const players = await listPlayerTotals(pool, '2025-26');
    const saka = players.find((p) => p.id === SAKA);
    assert.ok(saka, 'Saka is missing from 2025-26');

    for (const field of NUMERIC_FIELDS) {
      assert.equal(
        typeof saka[field],
        'number',
        `${field} is ${typeof saka[field]} (${JSON.stringify(saka[field])}), not a number`
      );
    }
  });

  it('returns numbers on the gameweek rows too, not just the aggregate', async () => {
    // The stats table is where a lexical sort would actually be seen, and it
    // reads these rows rather than the aggregate above.
    const history = await getPlayerHistory(pool, SAKA, '2025-26');
    assert.ok(history.length > 0);

    for (const row of history) {
      for (const field of [
        'influence',
        'creativity',
        'threat',
        'ict_index',
        'expected_goals',
        'expected_assists',
        'expected_goal_involvements',
      ] as const) {
        assert.equal(
          typeof row[field],
          'number',
          `history round ${row.round}: ${field} is ${typeof row[field]}, not a number`
        );
      }
    }
  });

  it('returns null, not zero, for a season that measured nothing', async () => {
    // 2017-18 predates both xG (2022-23) and starts (2022-23). Rule 6: those
    // are null. strictEqual so a 0 cannot pass on looseness, and so that a
    // string '0.00' fails loudly rather than being coerced.
    const players = await listPlayerTotals(pool, '2017-18');
    const salah = players.find((p) => p.id === SALAH);
    assert.ok(salah, 'Salah is missing from 2017-18');

    assert.strictEqual(salah.expected_goals, null, 'expected_goals should be null before 2022-23');
    assert.strictEqual(salah.expected_assists, null);
    assert.strictEqual(salah.expected_goal_involvements, null);
    assert.strictEqual(salah.starts, null, 'starts should be null before 2022-23');

    // The stats that were measured are still real numbers, so the test above
    // cannot pass by everything being null.
    assert.equal(typeof salah.total_points, 'number');
    assert.equal(typeof salah.ict_index, 'number');
    assert.equal(salah.total_points, 303);

    const history = await getPlayerHistory(pool, SALAH, '2017-18');
    assert.strictEqual(history[0].expected_goals, null);
    assert.equal(typeof history[0].ict_index, 'number');
  });

  it('leaves nothing numeric behind as a string, across a whole season', async () => {
    // The regression is one column the mapper was never extended to cover, not
    // all of them at once — so this sweeps every player rather than sampling.
    const players = await listPlayerTotals(pool, '2025-26');
    assert.ok(players.length > 500);

    for (const p of players) {
      for (const field of NUMERIC_FIELDS) {
        const v = p[field];
        assert.ok(
          typeof v === 'number' || v === null,
          `${p.web_name}: ${field} is ${typeof v} (${JSON.stringify(v)})`
        );
        assert.ok(!Number.isNaN(v), `${p.web_name}: ${field} parsed to NaN`);
      }
      for (const field of STRING_FIELDS) {
        const v = p[field];
        assert.ok(
          typeof v === 'string' || v === null,
          `${p.web_name}: ${field} is ${typeof v}, expected a string`
        );
      }
    }
  });
});

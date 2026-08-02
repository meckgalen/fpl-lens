/**
 * The API identity contract, pinned.
 *
 * Step 6 changed `/api/player/:id` to take `players.fpl_code` instead of the
 * FPL element id, because element ids are reassigned every August and a URL
 * built on one silently comes to mean a different footballer. That change is
 * invisible when it breaks: the client hands back whatever id bootstrap gave
 * it, so if the two ever drift apart the app 404s or — far worse — resolves to
 * the wrong player without erroring at all.
 *
 * These tests assert the round trip the client actually performs: take the id
 * from the bootstrap payload, look the player up with it. They go through the
 * repositories rather than over HTTP, so no server has to be running.
 *
 * Run: npm test   (requires the ingest scripts to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../db/pool.js';
import { latestSeason } from './seasons.js';
import { getPlayerHistory, listPlayerTotals, playerExists } from './players.js';

after(closePool);

const SAKA = 223340;

describe('API identity: /api/player/:code takes an fpl_code', () => {
  it('resolves every id bootstrap hands out', async () => {
    const season = await latestSeason(pool);
    const players = await listPlayerTotals(pool, season);
    assert.ok(players.length > 500, `expected a full season of players, got ${players.length}`);

    // Sampled rather than exhaustive: 800+ round trips would dominate the
    // suite's runtime, and a systematic break would not hide in a sample.
    const sample = players.filter((_, i) => i % 25 === 0);
    for (const p of sample) {
      assert.equal(
        await playerExists(pool, p.id),
        true,
        `bootstrap returned id ${p.id} (${p.web_name}) but no player has that fpl_code`
      );
    }
  });

  it('returns that player’s history for the id bootstrap gave', async () => {
    const season = await latestSeason(pool);
    const players = await listPlayerTotals(pool, season);
    const saka = players.find((p) => p.id === SAKA);
    assert.ok(saka, 'Saka is missing from the bootstrap payload');

    // The exact round trip PlayerDetail.tsx performs: fetchPlayerDetail(player.id).
    const history = await getPlayerHistory(pool, saka.id, season);
    assert.equal(history.length, 38);
    assert.equal(
      history.reduce((n, r) => n + r.total_points, 0),
      saka.total_points,
      'the history the id resolves to does not add up to the totals shown beside it'
    );
  });

  /**
   * The failure this guards against is not a 404 — it is a season-scoped id
   * that happens to be a valid code for somebody else. Saka is element 16 in
   * 2025-26; if element ids were accepted, /api/player/16 would mean Saka this
   * season and a different player next.
   */
  it('does not accept a season-scoped element id', async () => {
    const season = await latestSeason(pool);
    const { rows } = await pool.query<{ fpl_element_id: number }>(
      'SELECT fpl_element_id FROM player_seasons WHERE season = $1',
      [season]
    );
    assert.ok(rows.length > 0);

    for (const { fpl_element_id } of rows) {
      assert.equal(
        await playerExists(pool, fpl_element_id),
        false,
        `element id ${fpl_element_id} resolves as an fpl_code — the two id spaces overlap, ` +
          `so an element id in a URL would silently address a real player`
      );
    }
  });

  it('keeps the two id spaces disjoint by construction', async () => {
    // Element ids are 1..~800 and reassigned yearly; codes are permanent and
    // never below 1000. That gap is what makes the check above meaningful
    // rather than lucky.
    const { rows } = await pool.query<{ min: string; overlap: string }>(
      `SELECT min(fpl_code) AS min,
              (SELECT count(*) FROM players p
                WHERE EXISTS (SELECT 1 FROM player_seasons ps WHERE ps.fpl_element_id = p.fpl_code)
              ) AS overlap
         FROM players`
    );
    assert.ok(Number(rows[0].min) >= 1000, 'a player code below 1000 could collide with an element id');
    assert.equal(Number(rows[0].overlap), 0, 'a player code is also a season-scoped element id');
  });
});

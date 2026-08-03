/**
 * The live season ingest: the properties that cannot be checked by looking at
 * the result of one run.
 *
 * Everything here runs offline and writes nothing that survives. Each test
 * opens a transaction, writes a synthetic season through the real SQL, asserts,
 * and rolls back — so these exercise the actual upsert clauses rather than a
 * reimplementation of them, without touching the eleven real seasons. The
 * season used is '2099-00', which cannot collide with anything, and the payload
 * is hand-built rather than fetched, so no network is involved.
 *
 * The four properties, and why each needs a test rather than a comment:
 *
 *   1. **Re-runnable.** The transfer window runs to 31 August and this ingest
 *      will be run again and again. "Changes nothing the second time" is a
 *      claim about SQL nobody can verify by reading it.
 *   2. **start_cost is written once.** There is exactly one chance to get it
 *      right, and an upsert that refreshed it would still look correct on the
 *      day it was written.
 *   3. **No stat ever crosses the boundary.** A pre-season bootstrap carries
 *      LAST season's totals on every element. The test feeds two payloads that
 *      differ only in those fields and requires the built rows to be identical.
 *   4. **Nothing is deleted.** A player who leaves in August vanishes from the
 *      feed; his registration row has to survive it.
 *
 * Run: npm test   (needs the database up; needs no ingest to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { pool, closePool } from '../db/pool.js';
import { buildLiveSeason, deriveSeason, snapshot, writeLiveSeason } from './ingest-live-season.js';
import type { WireBootstrap, WireElement, WireEvent, WireFixture, WireTeam } from '../types/wire.js';

after(closePool);

const SEASON = '2099-00';

/** A club that is already in the database, by permanent code: Arsenal. */
const EXISTING_TEAM_CODE = 3;
/** A code no club has ever had, so it must insert a row. */
const NEW_TEAM_CODE = 9901;
/** A player already in the database, by permanent code: Saka. */
const EXISTING_PLAYER_CODE = 223340;

/**
 * Runs a test inside a transaction that is always rolled back.
 *
 * The identity sequences advance and are not reclaimed, which is the only trace
 * any of this leaves. Nothing else survives: no team, no player, no season.
 */
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

// ------------------------------------------------------------- the payloads

/**
 * One element, with every stat field filled in with a value that is not zero.
 *
 * That is deliberate: it stands in for the carryover a real pre-season
 * bootstrap carries, so any test whose expectations survive it is one where the
 * stats genuinely did not travel.
 */
function element(overrides: Partial<WireElement> & Pick<WireElement, 'id' | 'code'>): WireElement {
  return {
    first_name: 'Test',
    second_name: `Player ${overrides.code}`,
    web_name: `P${overrides.code}`,
    team: 1,
    team_code: EXISTING_TEAM_CODE,
    element_type: 3,
    now_cost: 55,
    cost_change_start: 0,
    opta_code: `p${overrides.code}`,
    birth_date: '1999-01-01',
    // Everything below is last season's, and none of it may be stored.
    total_points: 157,
    minutes: 2218,
    goals_scored: 7,
    assists: 10,
    clean_sheets: 12,
    goals_conceded: 16,
    bonus: 18,
    bps: 570,
    starts: 25,
    form: '5.4',
    selected_by_percent: '31.2',
    status: 'a',
    news: '',
    chance_of_playing_next_round: null,
    influence: '900.4',
    creativity: '801.2',
    threat: '1044.0',
    ict_index: '274.6',
    expected_goals: '7.57',
    expected_assists: '8.13',
    expected_goal_involvements: '15.70',
    points_per_game: '5.1',
    photo: `${overrides.code}.jpg`,
    ...overrides,
  };
}

function team(id: number, code: number, name: string): WireTeam {
  return {
    id,
    code,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    strength_overall_home: 4,
    strength_overall_away: 4,
    strength_attack_home: 4,
    strength_attack_away: 4,
    strength_defence_home: 4,
    strength_defence_away: 4,
  };
}

function event(id: number, deadline: string): WireEvent {
  return { id, name: `Gameweek ${id}`, deadline_time: deadline, finished: false, is_current: false, is_next: id === 1 };
}

function fixture(id: number, gw: number | null): WireFixture {
  return {
    id,
    code: 1000 + id,
    event: gw,
    team_h: 1,
    team_a: 2,
    team_h_score: null,
    team_a_score: null,
    team_h_difficulty: 3,
    team_a_difficulty: 4,
    kickoff_time: '2099-08-15T14:00:00Z',
    finished: false,
    finished_provisional: false,
  };
}

/** The default synthetic payload: two clubs, three players, one round. */
function bootstrap(elements: WireElement[]): WireBootstrap {
  return {
    elements,
    teams: [team(1, EXISTING_TEAM_CODE, 'Arsenal'), team(2, NEW_TEAM_CODE, 'Newtown')],
    events: [event(1, '2099-08-14T17:30:00Z')],
    element_types: [
      { id: 1, singular_name: 'Goalkeeper' },
      { id: 2, singular_name: 'Defender' },
      { id: 3, singular_name: 'Midfielder' },
      { id: 4, singular_name: 'Forward' },
    ],
  };
}

const THREE_PLAYERS = [
  element({ id: 1, code: EXISTING_PLAYER_CODE }),
  element({ id: 2, code: 9900002 }),
  element({ id: 3, code: 9900003, team: 2, team_code: NEW_TEAM_CODE }),
];

const FIXTURES = [fixture(1, 1)];

const codesOf = (b: WireBootstrap) => ({
  teamCodes: b.teams.map((t) => t.code),
  playerCodes: b.elements.map((e) => e.code),
});

// --------------------------------------------------------------------- tests

describe('live ingest: the season string', () => {
  it('derives the label from the first deadline', () => {
    assert.equal(deriveSeason([event(1, '2026-08-21T17:30:00Z')]), '2026-27');
    assert.equal(deriveSeason([event(1, '2099-08-14T17:30:00Z')]), '2099-00');
  });

  it('reads the earliest deadline, not the first in the array', () => {
    const shuffled = [event(38, '2027-05-30T13:30:00Z'), event(1, '2026-08-21T17:30:00Z')];
    assert.equal(deriveSeason(shuffled), '2026-27');
  });

  it('places a deadline in the back half of a season in the season that opened the previous August', () => {
    // Cannot happen on a full 38-event bootstrap and costs one comparison to be
    // right if it ever does: a January round belongs to the season that started
    // the previous year, not to one starting in January.
    assert.equal(deriveSeason([event(25, '2027-01-02T12:00:00Z')]), '2026-27');
  });

  it('throws rather than guessing when there is nothing to derive from', () => {
    assert.throws(() => deriveSeason([]), /no events/);
    assert.throws(
      () => deriveSeason([{ ...event(1, ''), deadline_time: '' }]),
      /no event carries a deadline/
    );
  });
});

describe('live ingest: the carryover never crosses the boundary', () => {
  it('builds identical rows from payloads that differ only in their stats', () => {
    // The failure this exists for: a pre-season element carries last season's
    // totals, and copying them in produces a new season that looks entirely
    // plausible and is a duplicate of the old one. If any stat field reached a
    // row, these two builds would differ.
    const carryover = bootstrap(THREE_PLAYERS);
    const zeroed = bootstrap(
      THREE_PLAYERS.map((e) => ({
        ...e,
        total_points: 0,
        minutes: 0,
        goals_scored: 0,
        assists: 0,
        clean_sheets: 0,
        goals_conceded: 0,
        bonus: 0,
        bps: 0,
        starts: 0,
        form: '0.0',
        selected_by_percent: '0.0',
        influence: '0.0',
        creativity: '0.0',
        threat: '0.0',
        ict_index: '0.0',
        expected_goals: '0.00',
        expected_assists: '0.00',
        expected_goal_involvements: '0.00',
        points_per_game: '0.0',
      }))
    );

    assert.deepEqual(
      buildLiveSeason(carryover, FIXTURES),
      buildLiveSeason(zeroed, FIXTURES),
      'a stat field changed the built rows, so something is being stored that should not be'
    );
  });

  it('carries no stat-shaped key at all', () => {
    // The complement of the test above, which would pass if a stat were stored
    // as a constant. This one names the fields.
    const built = JSON.stringify(buildLiveSeason(bootstrap(THREE_PLAYERS), FIXTURES));
    for (const banned of [
      'total_points',
      'minutes',
      'goals_scored',
      'assists',
      'clean_sheets',
      'bps',
      'bonus',
      'starts',
      'ict_index',
      'expected_goals',
      'points_per_game',
      'form',
      'selected_by_percent',
    ]) {
      assert.equal(built.includes(banned), false, `${banned} appears in the rows to be written`);
    }
  });

  it('excludes an element type outside 1-4 and counts it (rule 11)', () => {
    // 2024-25's Assistant Manager chip shipped element_type 5. The 2026-27
    // bootstrap has none, which is a fact about today's feed and not about the
    // feed, so the filter is tested rather than assumed.
    const withManager = bootstrap([
      ...THREE_PLAYERS,
      element({ id: 4, code: 9900004, element_type: 5 }),
    ]);
    const built = buildLiveSeason(withManager, FIXTURES);
    assert.deepEqual(built.excludedCodes, [9900004]);
    assert.equal(built.players.length, 3);
    assert.equal(built.playerSeasons.length, 3);
  });
});

describe('live ingest: writing is repeatable', () => {
  it('changes nothing on a second run', async () => {
    await withRollback(async (client) => {
      const built = buildLiveSeason(bootstrap(THREE_PLAYERS), FIXTURES);
      const { teamCodes, playerCodes } = codesOf(bootstrap(THREE_PLAYERS));

      await writeLiveSeason(client, built);
      const first = await snapshot(client, SEASON, teamCodes, playerCodes);

      await writeLiveSeason(client, built);
      const second = await snapshot(client, SEASON, teamCodes, playerCodes);

      assert.deepEqual(second, first, 'a second identical run changed stored data');
    });
  });

  it('reuses an existing club by permanent code and inserts only the new one', async () => {
    // Both promotion paths in one assertion. Hull came up for 2026-27 having
    // last played in 2016-17 and must land on its existing row — a second row
    // for the same club would split its history in half — while Coventry, whose
    // code has never appeared, needs a new one.
    await withRollback(async (client) => {
      const before = await client.query<{ id: number }>(
        'SELECT id FROM teams WHERE fpl_team_code = $1',
        [EXISTING_TEAM_CODE]
      );
      assert.equal(before.rowCount, 1, 'the existing club should be in the database already');

      await writeLiveSeason(client, buildLiveSeason(bootstrap(THREE_PLAYERS), FIXTURES));

      const after = await client.query<{ id: number }>(
        'SELECT id FROM teams WHERE fpl_team_code = $1',
        [EXISTING_TEAM_CODE]
      );
      assert.equal(after.rowCount, 1, 'the existing club was duplicated instead of matched');
      assert.equal(after.rows[0].id, before.rows[0].id, 'the surrogate id moved');

      const inserted = await client.query('SELECT id FROM teams WHERE fpl_team_code = $1', [
        NEW_TEAM_CODE,
      ]);
      assert.equal(inserted.rowCount, 1, 'the genuinely new club was not inserted');
    });
  });
});

describe('live ingest: start_cost is written once', () => {
  it('does not move when the price does', async () => {
    await withRollback(async (client) => {
      const built = buildLiveSeason(bootstrap(THREE_PLAYERS), FIXTURES);
      await writeLiveSeason(client, built);

      const costs = async () => {
        const { rows } = await client.query<{ start_cost: number; now_cost: number }>(
          `SELECT ps.start_cost, ps.now_cost
             FROM player_seasons ps JOIN players p ON p.id = ps.player_id
            WHERE ps.season = $1 AND p.fpl_code = $2`,
          [SEASON, EXISTING_PLAYER_CODE]
        );
        return rows[0];
      };

      assert.deepEqual(await costs(), { start_cost: 55, now_cost: 55 });

      // Move the stored value underneath the ingest, the way a price rise in
      // the transfer window would, then run it again with a new price.
      await client.query(
        `UPDATE player_seasons ps SET start_cost = 999
           FROM players p
          WHERE p.id = ps.player_id AND ps.season = $1 AND p.fpl_code = $2`,
        [SEASON, EXISTING_PLAYER_CODE]
      );

      const risen = bootstrap(
        THREE_PLAYERS.map((e) =>
          e.code === EXISTING_PLAYER_CODE ? { ...e, now_cost: 58, cost_change_start: 3 } : e
        )
      );
      await writeLiveSeason(client, buildLiveSeason(risen, FIXTURES));

      const after = await costs();
      assert.equal(after.start_cost, 999, 'start_cost was rewritten — it is meant to be write-once');
      assert.equal(after.now_cost, 58, 'now_cost did not refresh, so the price shown would be stale');
    });
  });

  it('derives the opening price rather than taking today’s', async () => {
    // The distinction only shows once prices have moved, which in a real
    // pre-season they have not — so it can only be tested here. A first run
    // made after Gameweek 1 must still record the price the season OPENED at,
    // because there is no second chance to write it.
    await withRollback(async (client) => {
      const midSeason = bootstrap([
        element({ id: 1, code: 9900009, now_cost: 62, cost_change_start: 7 }),
      ]);
      await writeLiveSeason(client, buildLiveSeason(midSeason, FIXTURES));

      const { rows } = await client.query<{ start_cost: number; now_cost: number }>(
        `SELECT ps.start_cost, ps.now_cost
           FROM player_seasons ps JOIN players p ON p.id = ps.player_id
          WHERE ps.season = $1 AND p.fpl_code = 9900009`,
        [SEASON]
      );
      assert.equal(rows[0].start_cost, 55, 'start_cost should be now_cost minus the movement since');
      assert.equal(rows[0].now_cost, 62);
    });
  });
});

describe('live ingest: nothing is ever deleted', () => {
  it('keeps the registration row of a player who leaves the game', async () => {
    // Someone sold on 30 August simply stops appearing in the bootstrap. The
    // row says he was registered for this season, which stays true; he may
    // already have gameweek rows whose career row would otherwise vanish while
    // the matches themselves remained; and the feed that no longer mentions him
    // cannot be used to put him back.
    await withRollback(async (client) => {
      await writeLiveSeason(client, buildLiveSeason(bootstrap(THREE_PLAYERS), FIXTURES));

      const registered = async () => {
        const { rows } = await client.query<{ n: string }>(
          'SELECT count(*) AS n FROM player_seasons WHERE season = $1',
          [SEASON]
        );
        return Number(rows[0].n);
      };
      assert.equal(await registered(), 3);

      const departed = bootstrap(THREE_PLAYERS.filter((e) => e.code !== 9900002));
      await writeLiveSeason(client, buildLiveSeason(departed, FIXTURES));

      assert.equal(await registered(), 3, 'a player missing from the feed lost his season row');
    });
  });
});

describe('live ingest: the schedule', () => {
  it('stores a fixture with no round rather than refusing it', async () => {
    // FPL nulls `event` on a postponement until a new round is assigned, and
    // leaves it empty on a fixture it has not scheduled. Writing NULL is the
    // correct behaviour; throwing would be the ingest failing on real data.
    await withRollback(async (client) => {
      const built = buildLiveSeason(bootstrap(THREE_PLAYERS), [fixture(1, 1), fixture(2, null)]);
      await writeLiveSeason(client, built);

      const { rows } = await client.query<{ gw: number | null }>(
        'SELECT gw FROM fixtures WHERE season = $1 ORDER BY fpl_fixture_id',
        [SEASON]
      );
      assert.deepEqual(
        rows.map((r) => r.gw),
        [1, null]
      );
    });
  });

  it('resolves both sides through the permanent team code', async () => {
    // Rule 2/5 one layer earlier than usual: the feed's team_h and team_a are
    // season-scoped ids, and nothing season-scoped may reach the fixtures table.
    await withRollback(async (client) => {
      await writeLiveSeason(client, buildLiveSeason(bootstrap(THREE_PLAYERS), FIXTURES));

      const { rows } = await client.query<{ home: number; away: number }>(
        `SELECT h.fpl_team_code AS home, a.fpl_team_code AS away
           FROM fixtures f
           JOIN teams h ON h.id = f.home_team_id
           JOIN teams a ON a.id = f.away_team_id
          WHERE f.season = $1`,
        [SEASON]
      );
      assert.deepEqual(rows, [{ home: EXISTING_TEAM_CODE, away: NEW_TEAM_CODE }]);
    });
  });
});

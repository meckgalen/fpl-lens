/**
 * The career query: one summary row per season, with the gameweeks underneath.
 *
 * The FPL site shows this table and stops there. Ours expands, so the summary
 * and the rows below it are two derivations of the same numbers and they have
 * to agree — which is what most of this file checks, deliberately from the
 * opposite direction to the query itself: the repository asks Postgres to
 * GROUP BY and sum, the tests reduce over the match rows in JS. A GROUP BY that
 * quietly drops or duplicates rows cannot fool both.
 *
 * The subjects are chosen, not sampled:
 *
 *   - **Maguire (95658)** has all ten seasons, so one player's career spans
 *     every nullability boundary in the data. His 2016-17 is Hull, a club in no
 *     current season, which is what the denormalised club name is for.
 *   - **Saka (223340)** carries the acceptance values, sourced from the API's
 *     `history_past` rather than from the CSVs the ingest reads.
 *   - **Onana (202641) 2025-26** and **Perri (201595) 2018-19** are seasons of
 *     rows that are all zero: in the squad, never played.
 *   - **Cresswell (55459)** has nine seasons and no 2025-26, which is a
 *     different thing again from having a season with no rows in it.
 *
 * These go through the repositories, so no server has to be running.
 *
 * Run: npm test   (requires the ingest scripts to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../db/pool.js';
import { getPlayerCareer, getPlayerHistory, listPlayerTotals } from './players.js';
import { listTeams } from './teams.js';
import type { PlayerCareerSeason, PlayerGameweek } from '../types/domain.js';

after(closePool);

const SAKA = 223340;
const MAGUIRE = 95658;
const ONANA = 202641;
const PERRI = 201595;
const CRESSWELL = 55459;

const ALL_TEN = [
  '2025-26',
  '2024-25',
  '2023-24',
  '2022-23',
  '2021-22',
  '2020-21',
  '2019-20',
  '2018-19',
  '2017-18',
  '2016-17',
];

/** Seasons that measured xG, xA, xGI, xGC and starts. */
const HAS_XG = new Set(['2022-23', '2023-24', '2024-25', '2025-26']);
/** Seasons that measured tackles, CBI and recoveries — note the six-year gap. */
const HAS_DEFENSIVE = new Set(['2016-17', '2017-18', '2018-19', '2025-26']);
/** The season the defensive contribution scoring rule was introduced. */
const HAS_DC = new Set(['2025-26']);

const bySeason = (rows: PlayerCareerSeason[]) => new Map(rows.map((r) => [r.season, r]));
const sum = (rows: PlayerGameweek[], f: (r: PlayerGameweek) => number) =>
  rows.reduce((n, r) => n + f(r), 0);

describe('career: one row per season, newest first', () => {
  it('returns every season the player was registered for, and no others', async () => {
    // Eight, not nine. Saka's first FPL season is 2018-19 — the task this was
    // built for assumed nine, and the data says otherwise. A ninth appears when
    // 2026-27 is ingested, not before.
    const career = await getPlayerCareer(pool, SAKA);
    assert.deepEqual(
      career.map((r) => r.season),
      ['2025-26', '2024-25', '2023-24', '2022-23', '2021-22', '2020-21', '2019-20', '2018-19']
    );

    const maguire = await getPlayerCareer(pool, MAGUIRE);
    assert.deepEqual(maguire.map((r) => r.season), ALL_TEN, 'Maguire should span all ten seasons');
  });

  it('names the club on the row, including one that is in no current season', async () => {
    // The reason the club is denormalised. A caller holding the current
    // season's twenty teams — which is what the bootstrap hands out — cannot
    // name Hull, and would print the bare code 88 on the oldest row of the
    // table this feature exists to show.
    const career = bySeason(await getPlayerCareer(pool, MAGUIRE));

    const hull = career.get('2016-17');
    assert.ok(hull);
    assert.equal(hull.team_name, 'Hull');
    assert.equal(hull.team_short_name, 'HUL');

    const current = await listTeams(pool, '2025-26');
    assert.equal(
      current.some((t) => t.id === hull.team),
      false,
      'Hull is in the current twenty, so this row no longer proves anything — pick another club'
    );

    // And the club really does move between rows, so the column is not
    // constant-per-player and cannot be hoisted out of it.
    assert.equal(career.get('2017-18')?.team_name, 'Leicester');
    assert.equal(career.get('2025-26')?.team_name, 'Man Utd');
  });
});

describe('career: the acceptance values', () => {
  it('reproduces all nine for Saka 2025-26', async () => {
    // From the official API's history_past, a separate pipeline from the
    // vaastav CSVs the ingest reads.
    const row = bySeason(await getPlayerCareer(pool, SAKA)).get('2025-26');
    assert.ok(row);

    assert.equal(row.total_points, 157);
    assert.equal(row.starts, 25);
    assert.equal(row.minutes, 2218);
    assert.equal(row.goals_scored, 7);
    assert.equal(row.assists, 10);
    assert.equal(row.clean_sheets, 12);
    assert.equal(row.goals_conceded, 16);
    assert.equal(row.bonus, 18);
    assert.equal(row.bps, 570);
  });

  it('keeps points_per_game on appearances, not rounds', async () => {
    // 157 / 31 appearances = 5.1. Dividing by his 38 rounds would give 4.1, and
    // both are defensible until you compare them with FPL's own number.
    const row = bySeason(await getPlayerCareer(pool, SAKA)).get('2025-26');
    assert.ok(row);
    assert.equal(row.appearances, 31);
    assert.equal(row.points_per_game, 5.1);
  });
});

describe('career: the summary agrees with the rows underneath it', () => {
  // The cross-check the expandable table makes necessary. Postgres sums by
  // GROUP BY; these reduce over the match rows in JS. Nothing is shared but the
  // table itself, so a grouping that double-counts a double gameweek or drops a
  // blank one shows up here and nowhere else.
  for (const [name, code] of [
    ['Saka', SAKA],
    ['Maguire', MAGUIRE],
  ] as const) {
    it(`${name}: every season's totals equal the sum of that season's matches`, async () => {
      const career = await getPlayerCareer(pool, code);
      assert.ok(career.length > 0);

      for (const row of career) {
        const history = await getPlayerHistory(pool, code, row.season);
        const where = `${name} ${row.season}`;

        assert.equal(row.matches, history.length, `${where}: matches`);
        assert.equal(
          row.appearances,
          history.filter((h) => h.minutes > 0).length,
          `${where}: appearances`
        );

        assert.equal(row.total_points, sum(history, (h) => h.total_points), `${where}: points`);
        assert.equal(row.minutes, sum(history, (h) => h.minutes), `${where}: minutes`);
        assert.equal(row.goals_scored, sum(history, (h) => h.goals_scored), `${where}: goals`);
        assert.equal(row.assists, sum(history, (h) => h.assists), `${where}: assists`);
        assert.equal(
          row.clean_sheets,
          sum(history, (h) => h.clean_sheets),
          `${where}: clean sheets`
        );
        assert.equal(
          row.goals_conceded,
          sum(history, (h) => h.goals_conceded),
          `${where}: goals conceded`
        );
        assert.equal(row.bonus, sum(history, (h) => h.bonus), `${where}: bonus`);
        assert.equal(row.bps, sum(history, (h) => h.bps), `${where}: bps`);
        assert.equal(row.saves, sum(history, (h) => h.saves), `${where}: saves`);
        assert.equal(
          row.yellow_cards,
          sum(history, (h) => h.yellow_cards),
          `${where}: yellow cards`
        );
      }
    });
  }

  it('counts fixtures, not outer join rows', async () => {
    // count(*) over the LEFT JOIN would report 1 for a season with no matches,
    // which is the single value that makes "not started" look like "played
    // once". No player-season in the ten currently has zero rows, so the
    // regression is pinned as a property across a sample rather than by
    // example: matches must equal the history length for every row.
    const players = await listPlayerTotals(pool, '2025-26');
    const sample = players.filter((_, i) => i % 90 === 0);
    assert.ok(sample.length >= 8, `sample too small: ${sample.length}`);

    for (const p of sample) {
      for (const row of await getPlayerCareer(pool, p.id)) {
        const history = await getPlayerHistory(pool, p.id, row.season);
        assert.equal(
          row.matches,
          history.length,
          `${p.web_name} ${row.season}: matches ${row.matches} but ${history.length} rows`
        );
      }
    }
  });
});

describe('career: rule 6 — nullability follows the season, not the stat', () => {
  it('leaves the xG family and starts null before 2022-23', async () => {
    const career = await getPlayerCareer(pool, MAGUIRE);

    for (const row of career) {
      const measured = HAS_XG.has(row.season);
      for (const field of [
        'expected_goals',
        'expected_assists',
        'expected_goal_involvements',
        'expected_goals_conceded',
        'starts',
      ] as const) {
        if (measured) {
          assert.equal(
            typeof row[field],
            'number',
            `${row.season}: ${field} should be measured, got ${JSON.stringify(row[field])}`
          );
        } else {
          assert.strictEqual(
            row[field],
            null,
            `${row.season}: ${field} must be null, not ${JSON.stringify(row[field])} — 0 would claim a measurement nobody took`
          );
        }
      }
    }
  });

  it('handles the defensive stats, which run old-then-gap-then-new', async () => {
    // The family that reads backwards: collected 2016-17 to 2018-19, dropped
    // for six seasons, collected again in 2025-26. Anything assuming "newer
    // season, more stats" gets this one wrong in both directions.
    const career = await getPlayerCareer(pool, MAGUIRE);

    for (const row of career) {
      for (const field of ['tackles', 'clearances_blocks_interceptions', 'recoveries'] as const) {
        if (HAS_DEFENSIVE.has(row.season)) {
          assert.equal(typeof row[field], 'number', `${row.season}: ${field} should be measured`);
        } else {
          assert.strictEqual(row[field], null, `${row.season}: ${field} must be null`);
        }
      }
      assert.equal(
        row.defensive_contribution === null,
        !HAS_DC.has(row.season),
        `${row.season}: defensive_contribution nullability is wrong`
      );
    }

    // Positive control: the four measured seasons carry real totals, so the
    // assertions above cannot be satisfied by a column of zeroes.
    const s = bySeason(career);
    assert.equal(s.get('2016-17')?.recoveries, 149);
    assert.equal(s.get('2017-18')?.tackles, 36);
    assert.equal(s.get('2025-26')?.clearances_blocks_interceptions, 129);
  });

  it('never nulls a stat that every season measured', async () => {
    const career = await getPlayerCareer(pool, MAGUIRE);
    assert.equal(career.length, 10);

    for (const row of career) {
      for (const field of [
        'total_points',
        'minutes',
        'goals_scored',
        'assists',
        'clean_sheets',
        'goals_conceded',
        'own_goals',
        'penalties_saved',
        'penalties_missed',
        'yellow_cards',
        'red_cards',
        'saves',
        'bonus',
        'bps',
        'influence',
        'creativity',
        'threat',
        'ict_index',
        'points_per_game',
        'matches',
        'appearances',
      ] as const) {
        assert.equal(
          typeof row[field],
          'number',
          `${row.season}: ${field} is ${typeof row[field]} (${JSON.stringify(row[field])})`
        );
        assert.ok(!Number.isNaN(row[field]), `${row.season}: ${field} parsed to NaN`);
      }
    }
  });

  it('parses the gameweek rows the same way', async () => {
    // The eleven columns added to the match rows have the same boundaries. A
    // numeric left as a string here is what puts "9.1" above "10.4" in a sort.
    const old = await getPlayerHistory(pool, MAGUIRE, '2016-17');
    const now = await getPlayerHistory(pool, MAGUIRE, '2025-26');
    assert.ok(old.length > 0 && now.length > 0);

    assert.strictEqual(old[0].expected_goals_conceded, null);
    assert.strictEqual(old[0].defensive_contribution, null);
    assert.equal(typeof old[0].tackles, 'number');
    assert.equal(typeof old[0].saves, 'number');

    assert.equal(typeof now[0].expected_goals_conceded, 'number');
    assert.equal(typeof now[0].defensive_contribution, 'number');
    assert.equal(typeof now[0].recoveries, 'number');

    const mid = await getPlayerHistory(pool, MAGUIRE, '2021-22');
    assert.strictEqual(mid[0].tackles, null, 'tackles were not collected in 2021-22');
    assert.strictEqual(mid[0].clearances_blocks_interceptions, null);
    assert.strictEqual(mid[0].recoveries, null);
  });
});

describe('career: the condition that makes bare sum() safe', () => {
  it('measures each nullable column for a whole season or for none of it', async () => {
    // The career query sums the nullable columns with a bare `sum()` so NULL
    // survives (rule 6). `sum()` also *skips* nulls, which is only harmless
    // while a column is either measured for every row of a season or for none
    // of them. A column measured for part of one would produce a total covering
    // that part and render as though it covered the whole season — a number
    // that is wrong by an unknown amount and looks exactly like a right one.
    //
    // That this holds today is currently luck. This makes it a claim, and it
    // fails on the first partially ingested season, which is when the
    // incremental sync needs to hear about it rather than after.
    //
    // Asked of the whole table, not through the career query it justifies: a
    // GROUP BY over one player could satisfy this while the season as a whole
    // did not.
    const columns = [
      'starts',
      'expected_goals',
      'expected_assists',
      'expected_goal_involvements',
      'expected_goals_conceded',
      'tackles',
      'recoveries',
      'clearances_blocks_interceptions',
      'defensive_contribution',
    ] as const;

    const { rows } = await pool.query<Record<string, string>>(
      `SELECT season, count(*) AS total,
              ${columns.map((c) => `count(${c}) AS ${c}`).join(', ')}
         FROM player_gameweeks
        GROUP BY season
        ORDER BY season DESC`
    );

    assert.deepEqual(rows.map((r) => r.season), ALL_TEN, 'every season should be present');

    for (const row of rows) {
      const total = Number(row.total);
      assert.ok(total > 0, `${row.season}: no rows at all`);

      for (const column of columns) {
        const measured = Number(row[column]);
        assert.ok(
          measured === 0 || measured === total,
          `${row.season}: ${column} is measured on ${measured} of ${total} rows — ` +
            `sum() would silently total only those, and the career row would present ` +
            `a part-season figure as a whole-season one`
        );
      }
    }
  });
});

describe('career: the ways a season can look empty', () => {
  it('distinguishes a full season never played from an absent one', async () => {
    // Onana was at Man Utd all of 2025-26 and did not play a minute. Thirty-
    // eight rows of zeroes is the honest answer, and it is a different fact
    // from having no rows: the table should render.
    const row = bySeason(await getPlayerCareer(pool, ONANA)).get('2025-26');
    assert.ok(row, 'Onana should have a 2025-26 row');
    assert.equal(row.matches, 38);
    assert.equal(row.appearances, 0);
    assert.equal(row.minutes, 0);
    assert.equal(row.total_points, 0);

    const history = await getPlayerHistory(pool, ONANA, '2025-26');
    assert.equal(history.length, 38);
    assert.equal(
      history.every((h) => h.minutes === 0),
      true,
      'the all-zeros branch keys on every row having no minutes'
    );
  });

  it('handles a player registered part-way through a season', async () => {
    // Perri joined in the second half of 2018-19 and never played. Fourteen
    // rows, starting at round 25 — so "no rows before 25" is a registration
    // date, not a gap in the data.
    const row = bySeason(await getPlayerCareer(pool, PERRI)).get('2018-19');
    assert.ok(row);
    assert.equal(row.matches, 14);
    assert.equal(row.appearances, 0);

    const history = await getPlayerHistory(pool, PERRI, '2018-19');
    assert.equal(history.length, 14);
    assert.equal(Math.min(...history.map((h) => h.round)), 25);
    assert.equal(Math.max(...history.map((h) => h.round)), 38);
  });

  it('omits a season the player was never in the game for', async () => {
    // The state the client must not word as "once the season is underway":
    // Cresswell has nine seasons and 2025-26 is not one of them, so there is
    // nothing to wait for. The career response is where the client learns this
    // — an empty history alone cannot tell the two apart.
    const career = await getPlayerCareer(pool, CRESSWELL);
    assert.equal(career.length, 9);
    assert.equal(
      career.some((r) => r.season === '2025-26'),
      false
    );
    assert.equal(career[0].season, '2024-25', 'newest first');

    assert.equal((await getPlayerHistory(pool, CRESSWELL, '2025-26')).length, 0);
  });
});

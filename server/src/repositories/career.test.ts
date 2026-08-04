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
/**
 * A January 2023 signing: first appeared in 2022-23 round 22, so none of his
 * rows fall in that season's holed rounds. The control for the hole rule
 * degrading per player rather than per season.
 */
const ENZO = 448047;

/**
 * Two season lists, because there are now two different questions.
 *
 * They were one constant called ALL_TEN until item 4, and it answered both:
 * every season a player can be registered for, and every season with match
 * data. Those were the same ten seasons for as long as the database held only
 * completed ones. 2026-27 has a roster, a schedule and no matches, so they are
 * not the same list any more, and a single constant would have made one of the
 * two tests below fail while looking like an ingest problem.
 *
 * Named for what they mean rather than for how many they hold, so the next
 * season does not repeat this.
 */

/** Every season in `player_seasons` — what a career can span. */
const ALL_SEASONS = [
  '2026-27',
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

/**
 * Every season present in `player_gameweeks`.
 *
 * Ten, and it stays ten until the incremental gameweek sync is **run** — item 5
 * built that script but has not pointed it at 2026-27, because no match has
 * been played. **The first real run makes this eleven and this test red**,
 * which is the intended way to find out: add '2026-27' here and the list is
 * true again.
 *
 * The `sum()` property test below was traced against a partly ingested season
 * rather than left to be discovered in September, and it **holds**: a season
 * ingested round by round is partial in its ROWS, not in its columns. Every row
 * the live sync writes carries the modern stats, so `count(col)` equals
 * `count(*)`, and the fifteen Opta-era columns are null on all of them, so it
 * is 0. The test fires only if FPL starts supplying a column partway through a
 * season, which is exactly the case it was written to catch.
 */
const SEASONS_WITH_GAMEWEEKS = ALL_SEASONS.filter((s) => s !== '2026-27');

/** Seasons that measured xG, xA, xGI, xGC and starts. */
/**
 * Seasons whose files carry the xG family and `starts` at all.
 *
 * **A season being in this set no longer means every player has a total for
 * them.** 2022-23 carries the columns from round 1 and the *values* from round
 * 16, so a player who played through the hole gets NULL and one who arrived in
 * January gets a number — see `ingest/holes.ts`. The set answers "does the
 * season have this column", which is still the right question for the seasons
 * either side of the boundary and the wrong one on its own for 2022-23.
 */
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
    // Nine as of item 4, and the arithmetic is worth keeping. Saka's first FPL
    // season is 2018-19: the task item 1 was built for assumed nine when there
    // were eight, and the data corrected it. The ninth is 2026-27, which
    // arrived the day the live season was ingested — exactly as that comment
    // predicted, which is why this one now says so rather than replacing it.
    const career = await getPlayerCareer(pool, SAKA);
    assert.deepEqual(
      career.map((r) => r.season),
      [
        '2026-27',
        '2025-26',
        '2024-25',
        '2023-24',
        '2022-23',
        '2021-22',
        '2020-21',
        '2019-20',
        '2018-19',
      ]
    );

    const maguire = await getPlayerCareer(pool, MAGUIRE);
    assert.deepEqual(
      maguire.map((r) => r.season),
      ALL_SEASONS,
      'Maguire should span every season in the database'
    );
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
  /**
   * The five columns 2022-23 measures only from round 16 — see the hole rule in
   * `ingest/holes.ts`. Held apart from `HAS_XG` because "the season measures
   * this" and "this player's total is a real number" stopped being the same
   * question when the holes became NULL.
   */
  const HOLED_IN_2022_23 = [
    'expected_goals',
    'expected_assists',
    'expected_goal_involvements',
    'expected_goals_conceded',
    'starts',
  ] as const;

  it('leaves the xG family and starts null before 2022-23', async () => {
    // Maguire played through 2022-23's holed rounds, so his 2022-23 row is now
    // null on all five — see the pair of tests below for why that is the
    // answer rather than a regression. Every other season is unchanged.
    const career = await getPlayerCareer(pool, MAGUIRE);

    for (const row of career) {
      const measured = HAS_XG.has(row.season) && row.season !== '2022-23';
      for (const field of HOLED_IN_2022_23) {
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

  it('returns null for a 2022-23 player who played through the hole', async () => {
    // The user-visible half of item 7. Maguire has all 38 rows and started
    // nearly all of them; before the fix his career row read 24 starts against
    // a real 38, because the fourteen holed rounds stored 0 and sum() added
    // them in. Fourteen rounds of a measurement nobody took have no honest
    // total, so the row now says so.
    const row = bySeason(await getPlayerCareer(pool, MAGUIRE)).get('2022-23');
    assert.ok(row);

    assert.equal(row.matches, 38, 'the rows are all present — this is not row loss');
    assert.ok(row.minutes > 0);
    for (const field of HOLED_IN_2022_23) {
      assert.strictEqual(row[field], null, `${field} covers only part of the season`);
    }
  });

  it('returns a real number for a 2022-23 player who arrived after the hole', async () => {
    // The control that makes the test above mean something, and the property
    // the Deferred entry predicted: **the rule degrades per player, not per
    // season.** Enzo Fernández signed in January 2023 and first appeared in
    // round 22, so he missed the rounds 1-15 block entirely.
    //
    // Without this, "2022-23 is null" would be satisfied just as well by a
    // change that blanked the whole season — which is the outcome the ICT
    // decision in item 7 rejected, and which nothing else here would catch.
    const row = bySeason(await getPlayerCareer(pool, ENZO)).get('2022-23');
    assert.ok(row);

    assert.equal(row.starts, 18);
    assert.equal(row.matches, 18);
    for (const field of ['starts', 'expected_goals', 'expected_assists', 'expected_goals_conceded'] as const) {
      assert.equal(
        typeof row[field],
        'number',
        `${field} should be a real number for a player with no holed rows`
      );
    }

    // Except one, and it is the better half of this test. 2022-23 round 29 is
    // holed on `expected_goal_involvements` **alone** while the other four are
    // fine, and Enzo played it — twice, it being a double gameweek for him
    // (rule 13). So a single real player shows the rule degrading per column as
    // well as per player: four totals survive and this one does not.
    //
    // A fixture-wide hole rule would have taken all five here, and every
    // assertion above would still have passed.
    assert.strictEqual(
      row.expected_goal_involvements,
      null,
      'holed on round 29, which he played, while the other four columns were not'
    );
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
    // Including the season with no matches in it. A career row for 2026-27 is
    // eleven columns of COALESCE over zero gameweek rows, and every one of them
    // has to come back as the number 0 rather than as null: nobody has scored
    // nothing yet, which is a measurement, unlike xG in 2016-17, which was
    // never taken. The two look identical on screen and this is the line
    // between them.
    const career = await getPlayerCareer(pool, MAGUIRE);
    assert.equal(career.length, ALL_SEASONS.length);

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

describe('career: a partly measured column has no total', () => {
  /**
   * This replaces a test rather than amending one, and the distinction is the
   * point.
   *
   * Until item 7 this block asserted that every nullable column was measured
   * for a whole season or for none of it — the condition under which the career
   * query's bare `sum()` was safe, since `sum()` skips NULLs and would
   * otherwise total part of a season and present it as all of one. **That test
   * was correct, and it was right about something real**: the property held,
   * and it was the thing standing between the query and a silently wrong
   * number.
   *
   * What it could not see is the shape the defect actually took. 2022-23 stored
   * `0` rather than NULL for `starts` and the expected family across rounds
   * 1-15, and a column stored as 0 is fully "measured" by `count()`. So the
   * test passed on a season that was short by fourteen rounds — the one case it
   * was written to catch, arriving in the one form it was blind to.
   *
   * Item 7 fixed that at the source, which makes the old assertion false by
   * design: 2022-23 is now genuinely part-measured. And the property it
   * protected is gone too, because `measuredSum` replaced the bare `sum()`. So
   * the claim is not adjusted; it is the other one. **The aggregate returns
   * NULL exactly when the column is partly measured, and a number when it is
   * measured throughout.**
   *
   * Derived from the fixtures rather than from the aggregate's own expression:
   * a player-season is partly measured precisely when the player appeared in a
   * holed fixture, and a hole is a fact about a match that was played, not
   * about the SQL. Asserting `measuredSum` against a re-derivation of
   * `measuredSum` would pass whatever either of them said.
   */
  const NULLABLE = [
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

  it('returns a total exactly when every row of the season has a value', async () => {
    // One query, every player-season in the table, both sides side by side: what
    // the repository's aggregate returns, and whether the player has a row
    // missing that value. The second is computed from the rows themselves and
    // owes nothing to the aggregate.
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT p.fpl_code AS code, pg.season,
              ${NULLABLE.map(
                (c) => `(count(pg.${c}) = count(pg.fixture_id)) AS ${c}_complete`
              ).join(',\n              ')},
              ${NULLABLE.map((c) => `sum(pg.${c}) AS ${c}_sum`).join(',\n              ')}
         FROM player_gameweeks pg
         JOIN players p ON p.id = pg.player_id
        GROUP BY p.fpl_code, pg.season`
    );
    assert.ok(rows.length > 0);

    // Spot-check the invariant through the real query on the seasons where it
    // has teeth, rather than issuing 20,000 HTTP-shaped calls: a partly
    // measured column exists only in 2022-23, so a player from it and a player
    // from a clean season are what separate the two branches.
    for (const code of [MAGUIRE, ENZO, SAKA]) {
      const career = bySeason(await getPlayerCareer(pool, code));
      for (const [season, row] of career) {
        const raw = rows.find((r) => Number(r.code) === code && r.season === season);
        if (!raw) continue;
        for (const column of NULLABLE) {
          const complete: boolean = raw[`${column}_complete`] === true;
          const anyValue: boolean = raw[`${column}_sum`] !== null;
          const expected: boolean = complete && anyValue;
          assert.equal(
            row[column] !== null,
            expected,
            `${code} ${season}: ${column} is ${row[column] === null ? 'null' : 'a number'}, ` +
              `but the rows say it is ${expected ? 'measured throughout' : 'partly or never measured'}`
          );
        }
      }
    }
  });

  it('nulls the total for exactly the players who played through a hole', async () => {
    // The independent derivation. A hole is a fixture where a column totals
    // zero across all 22 players who took the field — impossible for `starts`
    // by the laws of the game — so "who lost their total" is answerable from
    // the fixtures without consulting the aggregate at all.
    const { rows } = await pool.query<{ code: string; holed: boolean }>(
      `WITH holed AS (
         SELECT season, fixture_id FROM player_gameweeks
          GROUP BY season, fixture_id
         HAVING sum(minutes) > 0 AND count(starts) = 0
       )
       SELECT p.fpl_code AS code,
              bool_or(h.fixture_id IS NOT NULL) AS holed
         FROM player_gameweeks pg
         JOIN players p ON p.id = pg.player_id
         LEFT JOIN holed h ON h.season = pg.season AND h.fixture_id = pg.fixture_id
        WHERE pg.season = '2022-23'
        GROUP BY p.fpl_code`
    );

    const holed = rows.filter((r) => r.holed).length;
    const clean = rows.length - holed;
    assert.equal(holed, 661, '2022-23 players with at least one holed row');
    assert.equal(clean, 117, 'players who arrived after round 15 and keep a real total');

    // And the aggregate agrees, on one from each side.
    assert.strictEqual(bySeason(await getPlayerCareer(pool, MAGUIRE)).get('2022-23')?.starts, null);
    assert.equal(bySeason(await getPlayerCareer(pool, ENZO)).get('2022-23')?.starts, 18);
  });

  it('still covers every season with match data, and only those', async () => {
    // Carried over from the replaced test, which is the half of it that did not
    // depend on the property. 2026-27 has a roster and no matches, so it
    // contributes no group at all — and the day the live sync writes its first
    // rows, this is what says so.
    const { rows } = await pool.query<{ season: string }>(
      `SELECT season FROM player_gameweeks GROUP BY season ORDER BY season DESC`
    );
    assert.deepEqual(
      rows.map((r) => r.season),
      SEASONS_WITH_GAMEWEEKS
    );
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

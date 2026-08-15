/**
 * The column availability predicate, on its own.
 *
 * It gets its own suite rather than being covered through the bootstrap route
 * because it is the load-bearing rule of item 13 and it decides what the Players
 * list is *allowed to show*. Get one cell wrong and the result is either a
 * column of dashes or — far worse, and silently — a partly measured column
 * offered as a whole-season total, which is the defect item 7 spent a session
 * removing. A regression reached through a route would surface as a confusing
 * UI bug somewhere else.
 *
 * Two halves, deliberately different in kind:
 *
 *   1. **`deriveSeasonAvailability` against hand-built fixtures.** Pure, so each
 *      clause of the predicate is aimed at directly: a whole-season absence, a
 *      partial hole, a fully measured column, a season with no rows at all, and
 *      the `matches > 0` filter.
 *   2. **The real database**, where the two independent derivations must agree
 *      and `measured_from` must survive a cross-derivation.
 *
 * The cross-derivations are the point of the second half, per the working
 * agreement: `listColumnHistory` asks Postgres for `count(col)` against
 * `count(*)`; the tests reduce over rows fetched separately in JS. A predicate
 * that is wrong in the same way in both places is the only thing that can fool
 * both, and the two are not written from each other.
 *
 * Run: npm test   (requires the ingest scripts to have been run)
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../db/pool.js';
import {
  NULLABLE_COLUMNS,
  deriveSeasonAvailability,
  listColumnHistory,
  measuredFrom,
  partialColumns,
  type NullableColumn,
  type PlayerColumnMeasurement,
} from './columns.js';

after(closePool);

/** The season whose five columns are measured from round 16 and not before. */
const HOLED_SEASON = '2022-23';
const HOLED_COLUMNS: NullableColumn[] = [
  'starts',
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'expected_goals_conceded',
];
/** The round the upstream scraper began collecting those five. */
const HOLE_BOUNDARY = 16;

/** A player with match rows, measured or not on each column. */
const player = (
  matches: number,
  values: Partial<Record<NullableColumn, number | null>>
): PlayerColumnMeasurement => ({ matches, values });

/** Every nullable column set to one value, so a fixture reads at a glance. */
const all = (v: number | null): Record<NullableColumn, number | null> =>
  Object.fromEntries(NULLABLE_COLUMNS.map((c) => [c, v])) as Record<NullableColumn, number | null>;

const stateOf = (a: ReturnType<typeof deriveSeasonAvailability>, key: NullableColumn) =>
  a.columns.find((c) => c.key === key)?.state;

describe('deriveSeasonAvailability: each clause of the predicate', () => {
  it('reports `full` when every player with rows has a value', () => {
    const a = deriveSeasonAvailability('2025-26', [
      player(38, all(10)),
      player(12, all(3)),
      player(1, all(0)), // zero is a MEASUREMENT, not an absence (rule 6)
    ], NULLABLE_COLUMNS);

    assert.equal(a.measured, true);
    for (const c of NULLABLE_COLUMNS) assert.equal(stateOf(a, c), 'full', c);
  });

  it('reports `none` for a column absent all season', () => {
    const a = deriveSeasonAvailability('2019-20', [player(38, all(null)), player(20, all(null))], NULLABLE_COLUMNS);

    assert.equal(a.measured, true);
    for (const c of NULLABLE_COLUMNS) assert.equal(stateOf(a, c), 'none', c);
  });

  it('reports `partial` when some players are measured and some are not', () => {
    // 2022-23's real shape: the regulars played through the hole and lose their
    // total; a January arrival has no holed rows and keeps his.
    const a = deriveSeasonAvailability(HOLED_SEASON, [
      player(38, { ...all(null), starts: null }),
      player(16, { ...all(5), starts: 14 }),
    ], NULLABLE_COLUMNS);

    assert.equal(stateOf(a, 'starts'), 'partial');
  });

  it('states the empty season once, at the season level, with no column entries', () => {
    // The blind spot the flag exists for: over zero rows `count(col)` equals
    // `count(*)` equals 0, so the strict predicate reads TRUE *vacuously* and
    // every column would claim to be available — on the season the app DEFAULTS
    // to. There is one fact here, not nine.
    const a = deriveSeasonAvailability('2026-27', [
      player(0, all(null)),
      player(0, all(null)),
    ], NULLABLE_COLUMNS);

    assert.equal(a.measured, false);
    assert.deepEqual(a.columns, []);
  });

  it('ignores players with no match rows when deciding a measured season', () => {
    // The `matches > 0` filter, isolated. The registered non-player has a NULL
    // aggregate because he has nothing to sum, not because the column is
    // unmeasured — counting him would drag a full season to `partial`, which is
    // what a live season looks like the day the gameweek sync starts writing.
    const a = deriveSeasonAvailability('2026-27', [
      player(3, all(7)),
      player(0, all(null)),
      player(0, all(null)),
    ], NULLABLE_COLUMNS);

    assert.equal(a.measured, true);
    for (const c of NULLABLE_COLUMNS) assert.equal(stateOf(a, c), 'full', c);
  });

  it('carries measured_from on a partial column and on no other', () => {
    const a = deriveSeasonAvailability(
      HOLED_SEASON,
      [player(38, { ...all(null), expected_goals: 4 }), player(38, all(null))],
      NULLABLE_COLUMNS,
      { expected_goals: HOLE_BOUNDARY, starts: HOLE_BOUNDARY }
    );

    const xg = a.columns.find((c) => c.key === 'expected_goals')!;
    const starts = a.columns.find((c) => c.key === 'starts')!;

    assert.equal(xg.state, 'partial');
    assert.equal(xg.measured_from, HOLE_BOUNDARY);

    // `starts` is `none` here, so it gets no boundary even though one was
    // supplied: a round number on a column with no values would be inventing a
    // fact. Only `partial` has a boundary worth naming.
    assert.equal(starts.state, 'none');
    assert.equal(starts.measured_from, null);
  });

  it('makes no claim at all about a column it was not given', () => {
    // The bootstrap aggregate carries five of the nine, so it must speak for
    // five. Found by reading the payload rather than by a failing test: the
    // first version derived over all nine, and the four the bootstrap never
    // queried fell out as `none` — a *measured* claim that no player has a
    // value, made about a column nobody had asked about.
    //
    // Plausible on 2022-23 and flatly wrong on 2016-17, where `tackles` is
    // fully measured and /api/columns says so. Two sources of one fact
    // disagreeing is what API identity rule 7 exists to prevent.
    const bootstrapish = [player(38, { starts: 5, expected_goals: 1.2 })];
    const a = deriveSeasonAvailability('2016-17', bootstrapish, [
      'starts',
      'expected_goals',
    ]);

    assert.deepEqual(
      a.columns.map((c) => c.key),
      ['starts', 'expected_goals']
    );
    for (const absent of ['tackles', 'recoveries', 'expected_goals_conceded']) {
      assert.equal(
        a.columns.find((c) => c.key === absent),
        undefined,
        `${absent} must not appear when it was never measured`
      );
    }
  });

  it('leaves measured_from null on a full column', () => {
    const a = deriveSeasonAvailability('2025-26', [player(38, all(1))], NULLABLE_COLUMNS, { starts: 4 });
    assert.equal(a.columns.find((c) => c.key === 'starts')!.measured_from, null);
  });
});

describe('the matrix against the database', () => {
  it('agrees with a NOT EXISTS derivation on every season and column', async () => {
    const matrix = await listColumnHistory(pool);

    // The independent derivation. `count(col) = count(*)` is what the shipped
    // code asks; this asks "is there any NULL row, and is there any row at
    // all", which is a different question with the same answer.
    const checks = NULLABLE_COLUMNS.map(
      (c) => `bool_or(${c} IS NULL) AS ${c}_any_null, count(${c}) > 0 AS ${c}_any_value`
    ).join(', ');
    const { rows } = await pool.query<Record<string, boolean | string>>(
      `SELECT season, count(*) AS n, ${checks} FROM player_gameweeks GROUP BY season`
    );

    let compared = 0;
    for (const r of rows) {
      for (const c of NULLABLE_COLUMNS) {
        const anyNull = r[`${c}_any_null`] as boolean;
        const anyValue = r[`${c}_any_value`] as boolean;
        const expected = !anyValue ? 'none' : anyNull ? 'partial' : 'full';

        const cell = matrix.find((m) => m.season === r.season && m.key === c);
        assert.ok(cell, `no matrix cell for ${r.season} ${c}`);
        assert.equal(cell.state, expected, `${r.season} ${c}`);
        compared++;
      }
    }

    // Ten seasons with match rows x nine columns. Pinned so a season silently
    // dropping out of the join fails here rather than passing vacuously.
    assert.equal(compared, 90);
  });

  it('includes the season that has no match rows at all', async () => {
    const matrix = await listColumnHistory(pool);
    const seasons = [...new Set(matrix.map((r) => r.season))];

    // Driven from `player_seasons`, so 2026-27 appears despite contributing no
    // `player_gameweeks` row. A GROUP BY over the fact table would omit it, and
    // the omission is exactly the blind spot the season-level flag closes.
    assert.ok(seasons.includes('2026-27'), 'the unplayed season is missing from the matrix');
    assert.equal(seasons.length, 11);
  });

  it('finds the 2022-23 hole and no other partial cell anywhere', async () => {
    const matrix = await listColumnHistory(pool);
    const partial = matrix.filter((r) => r.state === 'partial');

    assert.deepEqual(
      [...new Set(partial.map((r) => r.season))],
      [HOLED_SEASON],
      'a partial column exists outside 2022-23'
    );
    assert.deepEqual([...partial.map((r) => r.key)].sort(), [...HOLED_COLUMNS].sort());
  });

  it('reproduces the defensive trio measured before the gap and after it', async () => {
    const matrix = await listColumnHistory(pool);
    const state = (season: string, key: string) =>
      matrix.find((r) => r.season === season && r.key === key)!.state;

    // The case that reads backwards: the OLD seasons have data the middle ones
    // do not. A predicate accidentally keyed on "newer is better" passes
    // everything else in this file and fails here.
    for (const s of ['2016-17', '2017-18', '2018-19', '2025-26']) {
      assert.equal(state(s, 'tackles'), 'full', s);
      assert.equal(state(s, 'recoveries'), 'full', s);
    }
    for (const s of ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25']) {
      assert.equal(state(s, 'tackles'), 'none', s);
    }
  });
});

describe('measured_from, cross-derived', () => {
  it('equals a min(round) computed in JS from separately fetched rows', async () => {
    // Different derivation, same claim (working agreement). The repository asks
    // Postgres for `min(gw) FILTER (...)`; this pulls the distinct (gw, is-null)
    // pairs and reduces them here.
    const from = await measuredFrom(pool, HOLED_SEASON, HOLED_COLUMNS);

    for (const c of HOLED_COLUMNS) {
      const { rows } = await pool.query<{ gw: number }>(
        `SELECT DISTINCT gw FROM player_gameweeks
          WHERE season = $1 AND ${c} IS NOT NULL
          ORDER BY gw`,
        [HOLED_SEASON]
      );
      const expected = Math.min(...rows.map((r) => r.gw));
      assert.equal(from[c], expected, c);
      assert.equal(from[c], HOLE_BOUNDARY, `${c} should start at GW${HOLE_BOUNDARY}`);
    }
  });

  it('matches a JS-computed min(round) on all eleven seasons and nine columns', async () => {
    // The wide form of the check above. Every cell of the matrix carries a
    // boundary claim — a round for `partial`, and an implicit "from the start"
    // or "never" for `full` and `none` — and all 99 are cross-derived here.
    //
    // The derivation is deliberately split across the two languages: SQL is
    // asked only "does this column have any value in this round", one row per
    // round, and the **minimum and the classification are computed in JS**. The
    // shipped code asks Postgres for `min(gw) FILTER (...)` directly, so a
    // mistake in that expression cannot be reproduced here.
    const matrix = await listColumnHistory(pool);
    const seasons = [...new Set(matrix.map((r) => r.season))];
    assert.equal(seasons.length, 11);

    const has = NULLABLE_COLUMNS.map((c) => `bool_or(${c} IS NOT NULL) AS ${c}`).join(', ');
    let compared = 0;

    for (const season of seasons) {
      const { rows } = await pool.query<Record<string, number | boolean>>(
        `SELECT gw, ${has} FROM player_gameweeks WHERE season = $1 GROUP BY gw`,
        [season]
      );

      // The season's own first round, which is what a `full` column must start
      // at. Not 1 by assumption: nothing here should hardcode a round number.
      const allRounds = rows.map((r) => Number(r.gw));

      // The precondition for the `full` branch below, asserted rather than
      // assumed. `Math.min(...[])` is **Infinity**, not an error, so on a
      // season with no gameweek rows that branch would compare a real round
      // against Infinity and fail with a message about round numbers rather
      // than about the empty season that actually caused it.
      //
      // Unreachable today — the vacuous-truth guard means an empty season can
      // never read `full` — but this is the same empty-array trap item 11 hit
      // in the averages footnote, and the reason it is worth a line is that the
      // failure is confusing rather than obvious.
      const seasonHasRows = allRounds.length > 0;
      if (!seasonHasRows) {
        const states = NULLABLE_COLUMNS.map(
          (c) => matrix.find((m) => m.season === season && m.key === c)!.state
        );
        assert.ok(
          states.every((s) => s === 'none'),
          `${season} has no gameweek rows, so no column can be full or partial`
        );
        compared += NULLABLE_COLUMNS.length;
        continue;
      }

      for (const c of NULLABLE_COLUMNS) {
        const roundsWithValue = rows.filter((r) => r[c] === true).map((r) => Number(r.gw));
        const jsMin = roundsWithValue.length > 0 ? Math.min(...roundsWithValue) : null;

        const cell = matrix.find((m) => m.season === season && m.key === c)!;

        if (cell.state === 'partial') {
          assert.equal(cell.measured_from, jsMin, `${season} ${c} boundary`);
        } else if (cell.state === 'full') {
          // No boundary is shipped, and the claim that carries instead is that
          // the column runs from the season's first round. If that were false
          // the column would be partial, so this is the assertion `full` makes.
          assert.equal(cell.measured_from, null, `${season} ${c} should ship no boundary`);
          assert.equal(jsMin, Math.min(...allRounds), `${season} ${c} should start at round one`);
        } else {
          assert.equal(cell.measured_from, null, `${season} ${c} should ship no boundary`);
          assert.equal(jsMin, null, `${season} ${c} claims none but has a value`);
        }
        compared++;
      }
    }

    // 11 seasons x 9 columns. Pinned so a season dropping out of the matrix
    // fails here instead of quietly shrinking the check.
    assert.equal(compared, 99);
  });

  it('is not a promise that every later round is measured', async () => {
    // xGI is 16 like the rest AND is holed again at round 29, which is why the
    // field is named for where measurement starts rather than for a prefix. A
    // reader treating it as "everything from here is present" would be wrong on
    // this one column, so the divergence is asserted rather than smoothed over.
    const { rows } = await pool.query<{ gw: number }>(
      `SELECT DISTINCT gw FROM player_gameweeks
        WHERE season = $1 AND gw >= $2 AND expected_goal_involvements IS NULL
        ORDER BY gw`,
      [HOLED_SEASON, HOLE_BOUNDARY]
    );
    assert.deepEqual(
      rows.map((r) => r.gw),
      [29]
    );
  });

  it('returns nothing, and asks nothing, when no column is partial', async () => {
    // Ten of the eleven seasons pay no extra query. The empty-input guard is
    // what makes that true, so it is pinned rather than assumed.
    const none = await measuredFrom(pool, '2025-26', []);
    assert.deepEqual(none, {});
  });
});

describe('the two derivations agree', () => {
  it('reduction over player aggregates matches count(col) = count(*)', async () => {
    // The equivalence the design rests on: the bootstrap derives availability
    // from rows it already has (no query), while `/api/columns` derives it in
    // SQL. If these ever disagree the app would disable a column in one place
    // and offer it in the other, with nothing on screen to say which is right.
    const matrix = await listColumnHistory(pool);

    // This CASE reads 1 VACUOUSLY for a player-season with no match rows: both
    // counts are 0, so it claims "fully measured" about a player who measured
    // nothing. Left as it is, because neither side of the comparison ever reads
    // it — `deriveSeasonAvailability` filters `matches > 0` before computing a
    // state, and `listColumnHistory` groups on `player_gameweeks`, where such a
    // player has no row at all. Confirmed against the data in item 20: zero-row
    // player-seasons number 0 in every one of the ten CSV seasons and 564 of 564
    // in 2026-27, so no season is even mixed today. Do not "fix" it without
    // evidence that something reads it.
    const selects = NULLABLE_COLUMNS.map(
      (c) => `CASE WHEN count(pg.${c}) = count(pg.fixture_id) THEN 1 ELSE 0 END AS ${c}`
    ).join(', ');

    const seasons = [...new Set(matrix.map((m) => m.season))];
    assert.equal(seasons.length, 11);

    let compared = 0;
    let emptySeasons = 0;
    for (const season of seasons) {
      // One row per player, each column 1 where `measuredSum` would return a
      // number — the same CASE expression the real aggregate uses.
      const { rows } = await pool.query<Record<string, number | string>>(
        `SELECT count(pg.fixture_id)::int AS matches, ${selects}
           FROM player_seasons ps
           LEFT JOIN player_gameweeks pg
                  ON pg.player_id = ps.player_id AND pg.season = ps.season
          WHERE ps.season = $1
          GROUP BY ps.player_id`,
        [season]
      );

      const players: PlayerColumnMeasurement[] = rows.map((r) => ({
        matches: Number(r.matches),
        values: Object.fromEntries(
          NULLABLE_COLUMNS.map((c) => [c, Number(r[c]) === 1 ? 1 : null])
        ),
      }));

      const derived = deriveSeasonAvailability(season, players, NULLABLE_COLUMNS);

      if (players.every((p) => p.matches === 0)) {
        // The one place the two derivations deliberately DIVERGE, asserted
        // rather than skipped. The reduction lifts an unplayed season to a
        // single `measured: false` and ships no column entries; the SQL matrix
        // has no season-level field, so it flattens the same fact to nine
        // `none` cells. Both are right and they are not interchangeable — which
        // is exactly why the route pairs the matrix with the flag, and why a
        // client reading `state` alone on 2026-27 would say "not recorded"
        // nine times about a season nobody has played.
        assert.equal(derived.measured, false, season);
        assert.deepEqual(derived.columns, [], season);
        for (const c of NULLABLE_COLUMNS) {
          assert.equal(matrix.find((m) => m.season === season && m.key === c)!.state, 'none');
        }
        emptySeasons++;
        continue;
      }

      assert.equal(derived.measured, true, season);

      for (const c of NULLABLE_COLUMNS) {
        const fromSql = matrix.find((m) => m.season === season && m.key === c)!.state;
        assert.equal(stateOf(derived, c), fromSql, `${season} ${c}`);
        compared++;
      }
    }

    // Ten played seasons x nine columns, agreeing cell for cell, plus the one
    // unplayed season handled above. The audit ran the narrow form of this at
    // 50 of 50; this is the whole matrix.
    assert.equal(compared, 90);
    assert.equal(emptySeasons, 1);
  });

  it('names exactly the columns that need a measured_from query', async () => {
    const players: PlayerColumnMeasurement[] = [
      player(38, { ...all(null), starts: null }),
      player(16, all(2)),
    ];
    const a = deriveSeasonAvailability(HOLED_SEASON, players, NULLABLE_COLUMNS);

    // `partialColumns` is what decides whether the extra 28ms query runs at all,
    // so it must name every partial column and nothing else.
    assert.deepEqual(
      [...partialColumns(a)].sort(),
      [...NULLABLE_COLUMNS].sort(),
      'every column is partial in this fixture'
    );

    const full = deriveSeasonAvailability('2025-26', [player(38, all(1))], NULLABLE_COLUMNS);
    assert.deepEqual(partialColumns(full), []);
  });
});

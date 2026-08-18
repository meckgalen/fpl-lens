/**
 * How the picker describes the seasons a column IS recorded in.
 *
 * This is the sentence a disabled entry ends with — "Not recorded in 2016-17 ·
 * **recorded from 2022-23**" — and it is the one part of the reason that needs
 * the cross-season matrix. It gets its own file because it is prose generated
 * from data, which is the kind of thing that is wrong in ways a type checker
 * cannot see and a rendering test does not look at.
 *
 * Two shapes have to stay distinguishable, and the whole file is about the
 * boundary between them:
 *
 *   - **"from X"** — the column arrived and is still being recorded.
 *   - **"X to Y"** — the column was recorded and then stopped.
 *
 * Getting that wrong does not produce an error or an obviously silly string. It
 * produces a sentence that reads perfectly and asserts something false about the
 * data, which is the failure mode this project keeps refusing to ship.
 *
 * **Since item 21 `describeRecordedIn` returns the phrase without a verb**, and
 * the two consumers add what they need: the sentence writes
 * `· recorded ${phrase}.`, the picker's tag renders the phrase bare. One
 * derivation with two renderings, which is why the tag cannot come to describe a
 * different state than the sentence beside it. The tag branches are pinned at
 * the foot of this file.
 */

import { describe, expect, it } from 'vitest';
import { columnByKey, describeRecordedIn, resolveColumn } from './playerColumns';
import { NO_VALUE } from '../types/fpl';
import type { ColumnHistoryRow, Player, SeasonColumnAvailability } from '../types/fpl';
import { aPlayer } from '../test/factories';

/** Eleven seasons, newest first, exactly as the bootstrap sends them. */
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
 * A matrix cell per season for one column, from a list of the seasons that
 * record it. Everything else is `none`, which is what the server sends.
 */
const matrixFor = (key: string, recorded: string[]): ColumnHistoryRow[] =>
  ALL_SEASONS.map((season) => ({
    season,
    key,
    state: recorded.includes(season) ? 'full' : 'none',
    measured_from: null,
  }));

const onSeason = (season: string): SeasonColumnAvailability => ({
  season,
  measured: true,
  // The column under test reads `none` here — that is what makes the picker
  // reach for the matrix and produce the trailing clause at all.
  columns: [
    { key: 'expected_goals', state: 'none', measured_from: null },
    { key: 'starts', state: 'none', measured_from: null },
    { key: 'defensive_contribution', state: 'none', measured_from: null },
  ],
});

const reasonFor = (key: string, season: string, matrix: ColumnHistoryRow[]): string => {
  const status = resolveColumn(columnByKey(key)!, onSeason(season), matrix, ALL_SEASONS);
  if (status.available) throw new Error(`${key} unexpectedly available on ${season}`);
  return status.reason;
};

describe('the newest season records nothing, which is 2026-27 today', () => {
  /**
   * The shape that shipped wrong in item 13's first draft.
   *
   * xG runs unbroken 2022-23 → 2025-26. 2026-27 is the newest season and has no
   * match rows, so xG is absent there too — and the first implementation
   * compared the end of the run against "the newest season", found 2025-26 !==
   * 2026-27, and printed a **closed range**. "Recorded 2022-23 to 2025-26" is
   * literally true of our rows and tells the reader the column was
   * discontinued. It was not. That season has not been played.
   *
   * No handwritten fixture in this suite would have caught it, because a
   * handwritten fixture stops at a season with data. It was found by opening the
   * picker on 2016-17 and reading the sentence.
   */
  it('says "from" when a column runs to the last season that has any data', () => {
    const matrix = matrixFor('expected_goals', ['2022-23', '2023-24', '2024-25', '2025-26']);

    expect(reasonFor('expected_goals', '2016-17', matrix)).toBe(
      'Not recorded in 2016-17 · recorded from 2022-23.'
    );
  });

  it('does not treat the unplayed season as a gap in any column', () => {
    // The same claim on a column whose run is a single season. `defensive
    // contribution` is 2025-26 only, and must still read as current rather than
    // as a one-season blip that ended.
    const matrix = matrixFor('defensive_contribution', ['2025-26']);

    expect(reasonFor('defensive_contribution', '2016-17', matrix)).toBe(
      'Not recorded in 2016-17 · recorded from 2025-26.'
    );
  });

  /**
   * The opposite case, in the same file on purpose.
   *
   * Once the newest season DOES have rows and the column is absent there, that
   * is a real discontinuation and it must read as a closed range. Without this,
   * "always say from" would pass the two tests above and be just as wrong in the
   * other direction — it would describe a dropped column as one still being
   * collected.
   */
  it('says "to" when the column really did stop while later seasons kept recording', () => {
    // 2026-27 now records `starts`, so the data reaches it — and a column that
    // stopped at 2024-25 genuinely stopped.
    const matrix: ColumnHistoryRow[] = [
      ...matrixFor('starts', ['2022-23', '2023-24', '2024-25']),
      // Another column proving the newest season has data, which is what
      // `latestWithData` reads.
      { season: '2026-27', key: 'expected_goals', state: 'full', measured_from: null },
    ];

    expect(reasonFor('starts', '2016-17', matrix)).toBe(
      'Not recorded in 2016-17 · recorded 2022-23 to 2024-25.'
    );
  });
});

describe('a column recorded, dropped, and recorded again', () => {
  /**
   * The defensive trio's real shape: collected 2016-17 to 2018-19, dropped for
   * six seasons, collected again in 2025-26.
   *
   * **The expected strings lost their `recorded ` prefix in item 21.** The
   * function returns the phrase alone and the caller supplies the verb — the
   * sentence writes `· recorded ${where}.`, the picker's tag uses the phrase as
   * it stands. One derivation feeding both, rather than the tag being sliced
   * back off the sentence.
   *
   * **This shape is also why the tag is not uniformly short.** It compresses to
   * a range list and no further: `from 2025-26` would be false about the six
   * seasons in between, so the tag runs long here and stays true.
   *
   * "Recorded from 2016-17" would be a flat lie about the six seasons in
   * between, and it is the string a naive implementation produces — first
   * recorded season, still recorded today, so "from". The run-splitting exists
   * for this and nothing else.
   *
   * Not reachable from the picker today, because `tackles` is on the career
   * aggregate rather than the bootstrap and so is not an offered column. Unit
   * tested rather than left to a browser pass that cannot reach it.
   */
  it('names both runs instead of spanning the gap', () => {
    const recorded = ['2016-17', '2017-18', '2018-19', '2025-26'];

    expect(describeRecordedIn(recorded, ALL_SEASONS, '2025-26')).toBe(
      '2016-17 to 2018-19, and 2025-26'
    );
  });

  it('collapses a run of one to a bare season and keeps multi-season runs as ranges', () => {
    expect(describeRecordedIn(['2017-18', '2020-21'], ALL_SEASONS, '2025-26')).toBe(
      '2017-18, and 2020-21'
    );
    expect(
      describeRecordedIn(['2016-17', '2017-18', '2020-21', '2021-22'], ALL_SEASONS, '2025-26')
    ).toBe('2016-17 to 2017-18, and 2020-21 to 2021-22');
  });

  it('lists three runs with a comma between the first two', () => {
    expect(
      describeRecordedIn(['2016-17', '2019-20', '2022-23'], ALL_SEASONS, '2025-26')
    ).toBe('2016-17, 2019-20, and 2022-23');
  });
});

describe('a derived column, whose availability is its dependencies\'', () => {
  /**
   * Item 14's two columns have **no matrix cell of their own**: `defcon_hits` is
   * counted from `defensive_contribution` and `defcon_hits_per_start` divides
   * that by `starts`. Availability folds over `dependsOn` instead, taking the
   * most restrictive and breaking ties by declaration order.
   *
   * The failure this catches is not a crash. Without the fold, `find` looks for
   * a cell keyed `defcon_hits`, finds none, and the picker says "Not available
   * for 2025-26" — on the one season where the column works perfectly.
   */
  const availability = (
    cells: Record<string, 'full' | 'partial' | 'none'>,
    measuredFrom: Record<string, number> = {},
    season = '2016-17'
  ): SeasonColumnAvailability => ({
    season,
    measured: true,
    columns: Object.entries(cells).map(([key, state]) => ({
      key,
      state,
      measured_from: measuredFrom[key] ?? null,
    })),
  });

  const status = (key: string, a: SeasonColumnAvailability, matrix: ColumnHistoryRow[] | null) =>
    resolveColumn(columnByKey(key)!, a, matrix, ALL_SEASONS);

  it('offers both columns where every dependency is fully measured', () => {
    const a = availability(
      { defensive_contribution: 'full', starts: 'full' },
      {},
      '2025-26'
    );

    expect(status('defcon_hits', a, null).available).toBe(true);
    expect(status('defcon_hits_per_start', a, null).available).toBe(true);
  });

  it('withholds both where the dependency is not recorded, naming where it is', () => {
    // 2016-17: DC does not exist. Both columns are gone and both point at
    // 2025-26 — the season DC is actually recorded in, not the season either
    // column is named for.
    const matrix = matrixFor('defensive_contribution', ['2025-26']);
    const a = availability({ defensive_contribution: 'none', starts: 'none' });

    expect(reasonFrom(status('defcon_hits', a, matrix))).toBe(
      'Not recorded in 2016-17 · recorded from 2025-26.'
    );
    expect(reasonFrom(status('defcon_hits_per_start', a, matrix))).toBe(
      'Not recorded in 2016-17 · recorded from 2025-26.'
    );
  });

  it('takes the more restrictive of two dependencies rather than the first', () => {
    // 2022-23's real shape once DC exists nowhere: `starts` is measured from
    // GW16 and DC is not recorded at all. `none` beats `partial`, so the
    // sentence is DC's — the stronger statement, and the one that explains why
    // the column is missing rather than merely incomplete.
    const matrix = matrixFor('defensive_contribution', ['2025-26']);
    const a = availability(
      { defensive_contribution: 'none', starts: 'partial' },
      { starts: 16 },
      '2022-23'
    );

    expect(reasonFrom(status('defcon_hits_per_start', a, matrix))).toBe(
      'Not recorded in 2022-23 · recorded from 2025-26.'
    );
  });

  it('reports the partial dependency when it is the only thing blocking', () => {
    // The mirror case, and the one that proves the fold is not just "always use
    // the first dependency": DC is fine, `starts` is the problem, and the
    // reason has to name `starts`' boundary rather than DC's absence.
    const a = availability(
      { defensive_contribution: 'full', starts: 'partial' },
      { starts: 16 },
      '2022-23'
    );

    expect(reasonFrom(status('defcon_hits_per_start', a, null))).toBe(
      'Only recorded from GW16 in 2022-23.'
    );
    // And the count column, which does not depend on `starts`, is unaffected.
    expect(status('defcon_hits', a, null).available).toBe(true);
  });

  it('breaks a tie by declaration order, which is why DC is declared first', () => {
    // Both dependencies `none`. DC is declared first, so its matrix run is the
    // one described. Declaring `starts` first would print "recorded from
    // 2022-23" on a column that has never existed before 2025-26 — true of
    // `starts` and a lie about this column.
    const matrix = [
      ...matrixFor('defensive_contribution', ['2025-26']),
      ...matrixFor('starts', ['2022-23', '2023-24', '2024-25', '2025-26']),
    ];
    const a = availability({ defensive_contribution: 'none', starts: 'none' });

    expect(reasonFrom(status('defcon_hits_per_start', a, matrix))).toBe(
      'Not recorded in 2016-17 · recorded from 2025-26.'
    );
  });

  it('leaves every pre-existing column resolving through its own key', () => {
    // The fold defaults `dependsOn` to `[key]`, so a column without one takes
    // an identical path. If that default broke, every nullable column would
    // resolve no cell and the whole picker would read "Not available".
    const a = availability({ expected_goals: 'full', starts: 'full' }, {}, '2025-26');

    expect(status('expected_goals', a, null).available).toBe(true);
    expect(status('starts', a, null).available).toBe(true);
  });
});

/** The reason off a status, refusing to guess when the column was available. */
function reasonFrom(status: ReturnType<typeof resolveColumn>): string {
  if (status.available) throw new Error('expected the column to be unavailable');
  return status.reason;
}

describe('hits per start', () => {
  /**
   * The quotient itself, and the three nulls that keep it honest.
   *
   * `null / 5` is **0** in JavaScript, not NaN — so a missing hit count renders
   * a confident `0.00` unless it is tested for. That is rule 6 defeated by a
   * coercion, in a cell indistinguishable from a real zero.
   *
   * **The numerator is `defcon_hits_started`, not `defcon_hits`** — item 24.
   * Every case below passes a value for both, and they never agree, so a
   * regression reading the ungated count renders a different number rather than
   * the same one.
   */
  const col = columnByKey('defcon_hits_per_start')!;
  const player = (
    defcon_hits_started: number | null,
    starts: number | null,
    defcon_hits: number | null = 99
  ) => ({ ...aPlayer(), defcon_hits, defcon_hits_started, starts }) as Player;

  it('divides STARTED hits by starts, at two places, rounded half to even', () => {
    // Canvot and Ballard, the two players item 24 was written from. Their
    // ungated counts are 10 and 15, which rendered 0.71 and 0.62 — the numbers
    // this column used to show and the reason it changed.
    expect(col.render(player(9, 14, 10))).toBe('0.64');
    expect(col.render(player(14, 24, 15))).toBe('0.58');
    // Gabriel, who has no bench hit: 11/30 under either definition. He is here
    // to show the change is not a blanket shift — a player with no bench hit
    // reads exactly what he always did.
    expect(col.render(player(11, 30, 11))).toBe('0.37');
  });

  it('ignores the ungated count entirely', () => {
    // The mutation guard for the field swap. If `hitsPerStart` reads
    // `defcon_hits`, this renders 2.00 instead of 0.50.
    expect(col.render(player(5, 10, 20))).toBe('0.50');
  });

  it('renders the placeholder rather than 0.00 when the player never started', () => {
    // 367 of 2025-26's 841 players have no starts, so this is the common case.
    // "He made no starts" and "he hit none of his starts" must not collapse.
    //
    // The second case is the one item 24's brief called newly reachable: a
    // player with no starts and a nonzero DCH. It was already reachable and
    // already guarded — `perStart` tests the denominator, not the numerator —
    // and no outfield player in 2025-26 is actually in it, so it is pinned here
    // rather than in the browser.
    expect(col.render(player(0, 0))).toBe(NO_VALUE);
    expect(col.value(player(0, 0))).toBeNull();
    expect(col.render(player(0, 0, 3))).toBe(NO_VALUE);
  });

  it('renders the placeholder rather than 0.00 when the hit count is unmeasured', () => {
    // The coercion. Guarded here rather than left to the availability layer:
    // the server's guard exists precisely so this value CAN be null, and a
    // column whose correctness rests on another module's filter is one refactor
    // from being wrong.
    expect(col.render(player(null, 5))).toBe(NO_VALUE);
    expect(col.value(player(null, 5))).toBeNull();
  });

  it('keeps a real zero, which is a different statement', () => {
    // He started five and cleared the threshold in none of them. That is a
    // measurement, and it renders.
    expect(col.render(player(0, 5))).toBe('0.00');
  });

  it('cannot exceed 1.00, which is what the gate buys', () => {
    // The bound is by construction, not by luck: a started hit is a start, so
    // the numerator can at most equal the denominator. A perfect record renders
    // 1.00, and the pre-item-24 shape — more hits than starts, which the
    // ungated numerator made reachable — can no longer be built from this
    // field. Pinned across all eleven seasons in the server's `defcon.test.ts`.
    expect(col.render(player(12, 12))).toBe('1.00');
  });
});

describe('hauls and floors per start', () => {
  /**
   * The same three guards as DCH/St above, reached through the same `perStart`
   * helper — these columns are what collapsed the two copies into one.
   *
   * **What differs is the numerator, and only the numerator.** These read
   * `hauls_started` / `floors_started`, which the server gates on `starts = 1`,
   * so unlike DCH/St they cannot exceed 1.00. Both glosses say so on
   * screen, which is what makes the bound a promise rather than a detail; it is
   * pinned server-side across every season in `repositories/hauls.test.ts`.
   */
  const h = columnByKey('hauls_per_start')!;
  const f = columnByKey('floors_per_start')!;
  const player = (over: Partial<Player>) => ({ ...aPlayer(), ...over }) as Player;

  it('divides the started count by starts, at two places', () => {
    expect(h.render(player({ hauls_started: 5, starts: 30 }))).toBe('0.17');
    expect(f.render(player({ floors_started: 12, starts: 30 }))).toBe('0.40');
  });

  it('reads the gated numerator, not the ungated count beside it', () => {
    // The bug the gate exists to prevent, and the reason the factory gives
    // `hauls` and `hauls_started` different values: reusing `hauls` here would
    // read 0.24 rather than 0.20, which is wrong and entirely plausible.
    expect(h.render(player({ hauls: 6, hauls_started: 5, starts: 25 }))).toBe('0.20');
  });

  it('renders the placeholder rather than 0.00 when the player never started', () => {
    // Onyeka in 2025-26 is the real case: 38 appearances, 0 starts, 2 floors.
    expect(f.render(player({ floors_started: 0, starts: 0 }))).toBe(NO_VALUE);
    expect(f.value(player({ floors_started: 0, starts: 0 }))).toBeNull();
  });

  it('renders the placeholder rather than 0.00 when the gated count is unmeasured', () => {
    // `null / 5` is 0 in JavaScript. Reachable wherever `starts` is holed, which
    // is every season before 2022-23 and part of that one.
    expect(h.render(player({ hauls_started: null, starts: 5 }))).toBe(NO_VALUE);
    expect(f.render(player({ floors_started: null, starts: 5 }))).toBe(NO_VALUE);
    expect(h.value(player({ hauls_started: null, starts: 5 }))).toBeNull();
  });

  it('keeps a real zero, which is a different statement', () => {
    // He started twenty and hauled in none of them. A measurement, and it
    // renders — 43.3% of qualifying defenders are exactly this.
    expect(h.render(player({ hauls_started: 0, starts: 20 }))).toBe('0.00');
  });

  it('renders a perfect record as 1.00 and can never exceed it', () => {
    // The bound the gloss promises. It is reachable at the top —
    // a player who returned 4+ in every start — and unreachable above.
    expect(f.render(player({ floors_started: 12, starts: 12 }))).toBe('1.00');
  });
});

describe('points per million', () => {
  /**
   * The client half of the cross-language guard on the two quotients the
   * comparison chart duplicates.
   *
   * `Pts/£` and `DCH/St` are computed **twice**: here, and in
   * `server/src/comparison/cohort.ts`, where the band forces a copy — a median
   * across 109 defenders cannot be taken on a client that sees two. The server's
   * own test cannot close that gap on its own: it restates the formula inline
   * and compares `ptsPerNow` against the restatement, so both sides of that
   * assertion are server code and the client's `perMillion` is not in the
   * comparison at all.
   *
   * What ties the two implementations together is that each is pinned to the
   * **same externally-derived number** — item 16 step 1's top-three table, from
   * a psql session that predates both. Guéhi's 2025-26 is 179 points at £5.1m
   * and tops DEF `Pts/£` at 35.10; `cohort.test.ts` asserts that of the server's
   * value and this asserts it of the column the Players list renders. Neither
   * imports the other, and a drift in either moves it off 35.10.
   *
   * `DCH/St` already has its half above: `player(11, 30)` is Gabriel's 2025-26,
   * item 14's count, and the server anchors `11 / 30` from the same measurement.
   */
  const col = columnByKey('pts_per_now')!;
  const GUEHI = { ...aPlayer(), total_points: 179, now_cost: 51 } as Player;

  it('reproduces the value the thresholds were derived against', () => {
    expect(col.value(GUEHI)!.toFixed(2)).toBe('35.10');
    // Rendered at one place, through `fmtPpg`'s half-to-even rounding — never
    // `toFixed`, which is whatever the binary representation gives.
    expect(col.render(GUEHI)).toBe('35.1');
  });

  it('is null, not 0, where there is no price to divide by', () => {
    // `100 / null` is Infinity and `null / 5` is 0; neither is a points-per-
    // million figure, and both would render as a confident number.
    expect(col.value({ ...GUEHI, now_cost: null } as Player)).toBeNull();
    expect(col.value({ ...GUEHI, now_cost: 0 } as Player)).toBeNull();
    expect(col.render({ ...GUEHI, now_cost: null } as Player)).toBe(NO_VALUE);
  });
});

describe('describeRecordedIn, directly', () => {
  it('returns null when the column is recorded nowhere', () => {
    // The mid-season lag case: after GW1 is ingested, a column the upstream has
    // not populated yet is recorded in no season at all. There is nothing to
    // point at, and the base sentence is already complete without a clause.
    expect(describeRecordedIn([], ALL_SEASONS, '2025-26')).toBeNull();
  });

  it('does not depend on the order the seasons arrive in', () => {
    // `allSeasons` is newest-first from the server and the runs are
    // chronological, so this sorts internally. Passing them the other way must
    // not silently produce eleven runs of one.
    const ascending = [...ALL_SEASONS].sort();
    expect(describeRecordedIn(['2022-23', '2023-24'], ascending, '2023-24')).toBe(
      'from 2022-23'
    );
  });
});

/**
 * The picker's short form, and **which branches decline to produce one**.
 *
 * Item 21 compressed the reasons into tags because 2026-27 disables a dozen
 * columns at once and a dozen sentences is a wall. The interesting assertions
 * are the negatives: three branches return no tag, and a later tidy-up that
 * gives them one to make the list uniform is the regression this pins.
 *
 * Both forms come off ONE call, so a tag can never describe a different state
 * than the sentence beside it. That is asserted directly rather than assumed —
 * each case checks the pair.
 */
describe('the tag beside the sentence', () => {
  const statusOf = (key: string, a: SeasonColumnAvailability, matrix: ColumnHistoryRow[] | null) =>
    resolveColumn(columnByKey(key)!, a, matrix, ALL_SEASONS);

  const unavailable = (s: ReturnType<typeof resolveColumn>) => {
    if (s.available) throw new Error('expected the column to be unavailable');
    return s;
  };

  it('compresses an unplayed season, keeping the shared sentence intact', () => {
    // The sentence must stay `noMatchesRecorded`'s: the Dashboard, Comparison
    // and Fixtures pages render that same string, and only the picker's form is
    // new. A tag that replaced it would fork one sentence into two.
    const s = unavailable(
      statusOf('expected_goals', { season: '2026-27', measured: false, columns: [] }, null)
    );

    expect(s.tag).toBe('no matches yet');
    expect(s.reason).toBe('No matches recorded for 2026-27 yet.');
  });

  it('compresses a mid-season boundary to the round, dropping the season', () => {
    // `from GW16` is only true because the picker's heading names the season and
    // an entry is greyed for that season alone. It is also what keeps this
    // distinguishable from the `from 2022-23` season tag: one is a boundary
    // WITHIN the selected season, the other points at a different one.
    const s = unavailable(
      statusOf(
        'expected_goals',
        {
          season: '2022-23',
          measured: true,
          columns: [{ key: 'expected_goals', state: 'partial', measured_from: 16 }],
        },
        null
      )
    );

    expect(s.tag).toBe('from GW16');
    expect(s.reason).toBe('Only recorded from GW16 in 2022-23.');
  });

  it('compresses an absent column to the season it arrived in', () => {
    const matrix: ColumnHistoryRow[] = [
      { season: '2016-17', key: 'defensive_contribution', state: 'none', measured_from: null },
      { season: '2025-26', key: 'defensive_contribution', state: 'full', measured_from: null },
    ];
    const s = unavailable(
      statusOf(
        'defensive_contribution',
        {
          season: '2016-17',
          measured: true,
          columns: [{ key: 'defensive_contribution', state: 'none', measured_from: null }],
        },
        matrix
      )
    );

    // The tag is the phrase, the sentence is the phrase with a verb in front —
    // one derivation, which is the property that stops the two disagreeing.
    expect(s.tag).toBe('from 2025-26');
    expect(s.reason).toBe('Not recorded in 2016-17 · recorded from 2025-26.');
  });

  it('gives the two permanently unavailable fields NO tag', () => {
    /*
     * The load-bearing negative. Neither field is season-dependent, and their
     * sentences are not interchangeable: `Own%`'s says the gap is in OUR
     * pipeline — the raw manager count is stored for all ten seasons, the
     * total-managers denominator is not — where `Status`' says the field
     * describes a live game. A shared `not stored` tag collapses exactly that
     * distinction, and it is the tidy-up this test exists to turn red.
     */
    const a: SeasonColumnAvailability = { season: '2025-26', measured: true, columns: [] };

    const own = unavailable(statusOf('selected_by_percent', a, null));
    expect(own.tag).toBeUndefined();
    expect(own.reason).toBe('Ownership percentage is not stored. FPL publishes it live only.');

    const status = unavailable(statusOf('status', a, null));
    expect(status.tag).toBeUndefined();
    expect(status.reason).toBe('Live-game field, not stored for a completed season.');
  });

  it('gives no tag where there is no season to point at', () => {
    // `none` with no matrix. The sentence is complete and there is nothing for a
    // tag to say; `not recorded` would be the greying restated.
    const s = unavailable(
      statusOf(
        'expected_goals',
        {
          season: '2016-17',
          measured: true,
          columns: [{ key: 'expected_goals', state: 'none', measured_from: null }],
        },
        null
      )
    );

    expect(s.tag).toBeUndefined();
    expect(s.reason).toBe('Not recorded in 2016-17.');
  });

  it('keeps a multi-run tag truthful rather than short', () => {
    /*
     * The one shape that does NOT compress to a few characters, and the reason
     * the tag is allowed to run long. A column recorded 2016-17 to 2018-19 and
     * again in 2025-26 would be described by `from 2025-26` as a lie about six
     * seasons — so the tag carries the whole range list.
     *
     * Reached here through `defensive_contribution` because the real
     * non-monotonic columns (`tackles` and its two siblings) sit on the career
     * aggregate rather than the bootstrap and so are not offered columns at all.
     * Unit tested rather than left to a browser pass that cannot reach it.
     */
    const seasons = ['2016-17', '2017-18', '2018-19', '2025-26'];
    const matrix: ColumnHistoryRow[] = [
      ...seasons.map((season) => ({
        season,
        key: 'defensive_contribution',
        state: 'full' as const,
        measured_from: null,
      })),
      { season: '2019-20', key: 'defensive_contribution', state: 'none', measured_from: null },
    ];
    const s = unavailable(
      statusOf(
        'defensive_contribution',
        {
          season: '2019-20',
          measured: true,
          columns: [{ key: 'defensive_contribution', state: 'none', measured_from: null }],
        },
        matrix
      )
    );

    expect(s.tag).toBe('2016-17 to 2018-19, and 2025-26');
    expect(s.reason).toBe(
      'Not recorded in 2019-20 · recorded 2016-17 to 2018-19, and 2025-26.'
    );
  });
});

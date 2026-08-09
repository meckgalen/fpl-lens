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
 *   - **"recorded from X"** — the column arrived and is still being recorded.
 *   - **"recorded X to Y"** — the column was recorded and then stopped.
 *
 * Getting that wrong does not produce an error or an obviously silly string. It
 * produces a sentence that reads perfectly and asserts something false about the
 * data, which is the failure mode this project keeps refusing to ship.
 */

import { describe, expect, it } from 'vitest';
import { columnByKey, describeRecordedIn, resolveColumn } from './playerColumns';
import type { ColumnHistoryRow, SeasonColumnAvailability } from '../types/fpl';

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
      'recorded 2016-17 to 2018-19, and 2025-26'
    );
  });

  it('collapses a run of one to a bare season and keeps multi-season runs as ranges', () => {
    expect(describeRecordedIn(['2017-18', '2020-21'], ALL_SEASONS, '2025-26')).toBe(
      'recorded 2017-18, and 2020-21'
    );
    expect(
      describeRecordedIn(['2016-17', '2017-18', '2020-21', '2021-22'], ALL_SEASONS, '2025-26')
    ).toBe('recorded 2016-17 to 2017-18, and 2020-21 to 2021-22');
  });

  it('lists three runs with a comma between the first two', () => {
    expect(
      describeRecordedIn(['2016-17', '2019-20', '2022-23'], ALL_SEASONS, '2025-26')
    ).toBe('recorded 2016-17, 2019-20, and 2022-23');
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
      'recorded from 2022-23'
    );
  });
});

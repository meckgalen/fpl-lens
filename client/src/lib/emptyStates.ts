/**
 * The sentences a surface uses when it has nothing to show, in one place.
 *
 * **Not a component module**, for the Fast Refresh reason `playerColumns.ts` and
 * `comparison.ts` both give.
 *
 * It exists because item 18 needed the column picker's season sentence on the
 * Fixtures page. Copying it would have put one string in two files, free to
 * drift — and the string is pinned by four suites, so a drift would go red
 * somewhere unrelated. Importing it *from* `playerColumns.ts` would have made a
 * fixtures page depend on a player-columns module for something with nothing to
 * do with columns, and putting it in `lib/fixtures.ts` would invert that. A
 * neutral third module leaves both importing downwards.
 *
 * It also puts the two "nothing here yet" sentences side by side, which is where
 * two sentences that must not drift belong.
 */

/**
 * The whole season has no match rows.
 *
 * True of 2026-27 until the first round is ingested — and note that it is
 * *ingesting* the matches that clears this, not playing them.
 *
 * The exact wording is load-bearing: `Players.columns.test.tsx`,
 * `Dashboard.preseason.test.tsx`, `Comparison.test.tsx` and
 * `playerColumns.test.ts` all pin it. That is the point of it being a function
 * rather than four literals.
 */
export const noMatchesRecorded = (season: string): string =>
  `No matches recorded for ${season} yet.`;

/**
 * One round has not been played, in a season that has been.
 *
 * The season sentence above is *false* here — the season has matches, this round
 * does not — so it needs its own words rather than a reuse. It became reachable
 * the moment the first 2026-27 round was ingested: before that every round of
 * that season is covered by `noMatchesRecorded`, and the ten CSV seasons are
 * complete, so nothing could reach it.
 */
export const roundNotPlayed = (season: string, round: number): string =>
  `Gameweek ${round} of ${season} has not been played yet.`;

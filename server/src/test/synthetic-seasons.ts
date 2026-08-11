/**
 * Synthetic seasons, one reserved per test suite that writes one.
 *
 * **This exists because two suites shared a season and deadlocked.** Both
 * `live-season.test.ts` and item 14's `defcon.test.ts` wrote `'2099-00'` inside
 * a `BEGIN … ROLLBACK`, and `node --test` runs test files in parallel — so two
 * open transactions inserting `fixtures (season, fpl_fixture_id) = ('2099-00', 1)`
 * contended on the `fixtures_uniq_season_fpl_fixture_id` unique index and
 * Postgres raised **40P01, deadlock detected**. Neither suite was wrong. They
 * were sharing a namespace neither of them declared.
 *
 * **The collision is on `(season, fpl_fixture_id)`, so the season is the only
 * lever that separates suites cheaply** — fixture ids restart at 1 in every
 * suite and always will, because a test that has to remember which integers
 * another file already used is worse than this module.
 *
 * Renaming one season was the one-sided fix: `live-season.test.ts` carried
 * nothing saying it owned `'2099-00'`, so the next suite to need a synthetic
 * season would read it, copy the constant, and reproduce the deadlock. The
 * registry is what makes the pairing visible from either end.
 *
 * **Adding a suite means adding a row here**, and the type makes an
 * unregistered name a compile error rather than a season silently shared.
 *
 * The years are deliberately far past anything the database holds (the newest
 * real season is 2026-27), so none of these can collide with real data however
 * many seasons are ingested — and rule 8's `YYYY-YY` format is preserved so the
 * `season ~ '^[0-9]{4}-[0-9]{2}$'` CHECK constraints accept them.
 */

const RESERVED = {
  'ingest/live-season.test.ts': '2099-00',
  'repositories/defcon.test.ts': '2098-99',
  'comparison/cohort.test.ts': '2097-98',
} as const;

export type SuiteWithSyntheticSeason = keyof typeof RESERVED;

/**
 * The season this suite owns.
 *
 * Takes the suite's own path so the call site says which row it is claiming,
 * rather than importing a name whose connection to this file's table has to be
 * traced.
 */
export function syntheticSeason(suite: SuiteWithSyntheticSeason): string {
  return RESERVED[suite];
}

// Checked at import rather than in a test of its own: a duplicated value is
// exactly the defect this module exists to prevent, and it should fail the
// moment any suite loads rather than only when the two happen to interleave.
// The deadlock it replaces was intermittent by nature — it needs both
// transactions open at once — so a duplicate here could sit green for a while.
{
  const seasons = Object.values(RESERVED);
  if (new Set(seasons).size !== seasons.length) {
    throw new Error(
      `synthetic-seasons: two suites share a season (${seasons.join(', ')}). ` +
        'Parallel test files writing the same (season, fpl_fixture_id) deadlock.'
    );
  }
}

/**
 * Phase 1, item 5: the second half of "has this match finished".
 *
 * FPL publishes two flags on a fixture and they flip at different moments: one
 * at roughly full time, the other once the round's bonus is confirmed. Only
 * `finished` was ever stored, and the gameweek sync needs to know that bonus and
 * BPS have settled before it writes a row — a row stored between those two
 * moments records a real-looking 0 bonus that later changes.
 *
 * **Which flag means which cannot be verified from a completed season.** In
 * 2025-26's fixtures.csv both are `True` on all 380 rows, and in the 2026-27
 * payload both are `false` on all 380; only a match in progress distinguishes
 * them, and there is none until 21 Aug 2026. So the sync gates on the
 * conjunction — `finished AND finished_provisional` is true only once both have
 * fired, which is the later of the two whichever way round they are — and that
 * needs both columns.
 *
 * Nullable, and NULL means settled. 2016-17 and 2017-18 have no fixtures.csv
 * upstream and so no such field, exactly as rule 14 already leaves `finished`
 * derived for those two. In SQL that makes the test
 * `finished AND COALESCE(finished_provisional, true)` — never the bare
 * conjunction, which is NULL rather than false for those rows and would quietly
 * exclude two entire seasons from anything asking whether a match had settled.
 *
 * This migration does not backfill. `npm run ingest:fixtures` re-populates the
 * column for the eight seasons whose CSV carries it.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('fixtures', {
    finished_provisional: { type: 'boolean' },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('fixtures', 'finished_provisional');
}

/**
 * Phase 1, item 4: what a live season needs that ten completed ones did not.
 *
 * Two additions, both of which exist because a season in progress has facts a
 * finished season does not:
 *
 *   - `events`, for gameweek deadlines. They come from the live bootstrap and
 *     have no source in the CSV backfill, so the ten historical seasons have no
 *     rows here and get none. That absence is load-bearing: it is what keeps
 *     `is_current` / `is_next` false over a completed season, which is the
 *     behaviour API identity rule 6 has always described.
 *
 *   - `player_seasons.now_cost`, for a price that is still moving. `start_cost`
 *     is the price the season opened at and `end_cost` is the price it closed
 *     at, which a season in progress does not have yet (rule 6: NULL, not a
 *     guess). Neither answers "what does he cost today", and during a transfer
 *     window that is the only price anybody wants.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Rule 8, same check the other five tables carry. */
const SEASON_FORMAT = "season ~ '^[0-9]{4}-[0-9]{2}$'";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ----------------------------------------------------------------- events
  // One row per gameweek that has a published deadline.
  //
  // `deadline_time` is NOT NULL because a row exists only by virtue of having
  // one. A gameweek with no deadline is represented by the absence of a row,
  // not by a row full of nulls — the round itself is already known from
  // `fixtures`, which stays the authority on which rounds exist. This table
  // only ever answers "and when does that round lock".
  //
  // That division matters. Rounds are not 1..n: 2019-20 runs to 47 after the
  // Covid restart and 2022-23 has no round 7. Deriving the round list from
  // fixtures has been right about both, and a second list here could disagree
  // with it.
  //
  // timestamptz, not timestamp. FPL sends ISO 8601 in UTC, the flags derived
  // from this column compare it against now(), and the client renders it in
  // local time. A naive timestamp would be a silent few hours out in all three.
  pgm.createTable(
    'events',
    {
      season: { type: 'text', notNull: true },
      gw: { type: 'smallint', notNull: true },
      deadline_time: { type: 'timestamptz', notNull: true },
    },
    {
      constraints: {
        primaryKey: ['season', 'gw'],
        check: SEASON_FORMAT,
      },
    }
  );

  // ------------------------------------------------- player_seasons.now_cost
  // The price at the last sync. Refreshed on every run of the live ingest,
  // unlike start_cost, which is written once.
  //
  // NULL on all ten completed seasons, and deliberately not backfilled to equal
  // end_cost. Duplicating one fact into two columns with nothing keeping them
  // equal is the failure this schema has avoided everywhere else. NULL here
  // means "this season is over, ask end_cost", which makes
  // COALESCE(now_cost, end_cost) correct on every row in the table without any
  // caller having to know which season it is looking at.
  pgm.addColumn('player_seasons', {
    now_cost: { type: 'integer' },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('player_seasons', 'now_cost');
  pgm.dropTable('events');
}

/**
 * Which stat columns a season can actually answer for.
 *
 * The Players list lets a user pick its columns (item 13). The picker is the
 * easy half; this is the load-bearing one. Rule 6 says a column absent in a
 * season is NULL and never 0, and item 7 made that true per *fixture* as well —
 * 2022-23 measures `starts` and the expected family from round 16 only. Offer
 * those columns on 2022-23 and the table shows a fourteen-round-short figure in
 * a cell indistinguishable from a complete one, which is the exact defect item 7
 * spent a session removing.
 *
 * Everything here rests on one predicate, stated once:
 *
 *   > a column is AVAILABLE for a season when every row that season carries a
 *   > value for it.
 *
 * In SQL that is `count(col) = count(*)` over `player_gameweeks`. Verified two
 * independent ways against `NOT EXISTS (… WHERE col IS NULL)` — they agree on
 * all ten seasons x nine nullable columns, 90 of 90 cells.
 *
 * **Why not the weaker `count(col) > 0`.** The two disagree on exactly one
 * season and five columns: 2022-23's `starts`, xG, xA, xGI and xGC, where
 * fourteen rounds of NULLs would be offered as a season total. That single
 * difference is the whole point of the strict form.
 *
 * **What the predicate cannot see, recorded rather than worried about.** A hole
 * stored as `0` in a NOT NULL column is invisible to it, so the ICT quartet
 * reads available in all ten seasons including the three where Known Issues
 * records it short a round. That is not an exposure this creates: an ENABLED
 * entry carries no sentence and so asserts nothing about completeness. The
 * picker explains absences only.
 */

import type { Queryable } from '../db/pool.js';
import { listPlayerTotals } from './players.js';
import type { PlayerSeasonTotals } from '../types/domain.js';
import type {
  ColumnAvailability,
  ColumnHistoryRow,
  ColumnState,
  SeasonColumnAvailability,
} from '../types/domain.js';

/**
 * The nine columns that can be NULL in some season, and so are the only ones
 * whose availability is ever in question. Every other stat column is NOT NULL in
 * the schema and is available wherever the season has rows at all.
 *
 * These are the database column names, which are also the keys the client's own
 * column definitions use for the nullable entries. One vocabulary, so a rename
 * on either side is a compile error rather than a column that silently never
 * resolves.
 */
export const NULLABLE_COLUMNS = [
  'starts',
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'expected_goals_conceded',
  'tackles',
  'clearances_blocks_interceptions',
  'recoveries',
  'defensive_contribution',
] as const;

export type NullableColumn = (typeof NULLABLE_COLUMNS)[number];

/**
 * The subset of those the **bootstrap aggregate** actually carries.
 *
 * `expected_goals_conceded`, `tackles`, `clearances_blocks_interceptions` and
 * `recoveries` live only on `CAREER_EXTRA_AGGREGATE`, so `listPlayerTotals` has
 * no value for them and the Players list cannot render them either.
 *
 * **A caller must not be asked about a column it did not measure**, which is why
 * this list exists rather than the bootstrap passing the full nine and letting
 * the absent ones fall out as `none`. That is the difference between "no player
 * has a value" and "nobody asked", and collapsing them produces a payload
 * asserting `tackles: none` for 2016-17 — where tackles is fully measured, and
 * where `/api/columns` says so. Two sources of one fact, disagreeing: the exact
 * failure API identity rule 7 keeps refusing.
 */
export const BOOTSTRAP_NULLABLE_COLUMNS = [
  'starts',
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'defensive_contribution',
] as const satisfies readonly NullableColumn[];

/**
 * One player's aggregate for one column, reduced to whether it was measured.
 *
 * The shape `deriveSeasonAvailability` consumes. It is deliberately not a row
 * type from any query: the bootstrap builds it from rows it has already
 * computed, and the tests build it by hand.
 */
export interface PlayerColumnMeasurement {
  /** count(pg.fixture_id) for the player-season — 0 for a registered non-player. */
  matches: number;
  /** null exactly where `measuredSum` returned NULL for that column. */
  values: Partial<Record<NullableColumn, number | null>>;
}

/**
 * Season availability, derived from the bootstrap's own rows. No query.
 *
 * **This is the whole reason the feature costs ~1ms rather than 43.** The
 * per-column state is already implied by rows `listPlayerTotals` computes:
 * `measuredSum` returns NULL per player exactly when that player has an
 * unmeasured row, so over the players of a season who have match rows —
 *
 *   - NULL on every one      -> `none`
 *   - non-NULL on every one  -> `full`
 *   - mixed                  -> `partial`
 *
 * Cross-checked against the count-based predicate over all ten seasons x five
 * columns: 50 of 50 cells agree. They are provably equivalent —
 * `count(col) = count(*)` holds iff no row is NULL iff no player with rows has a
 * NULL aggregate — which is why `listColumnHistory` below can use the SQL form
 * and this can use the reduction, with a test pinning them against each other.
 *
 * **The `matches > 0` filter is load-bearing, not defensive.** A registered
 * player with no match rows has a NULL aggregate for every column — not because
 * the column is unmeasured but because he has nothing to sum. Counting him would
 * drag a fully measured season to `partial` the day the live sync starts writing
 * rows mid-season, which is precisely when nobody would be looking for it.
 * Today no player-season in the ten CSV seasons has zero gameweek rows (0 of 683
 * … 0 of 841), and all 564 of 2026-27's do — which the season-level flag covers.
 */
export function deriveSeasonAvailability(
  season: string,
  players: PlayerColumnMeasurement[],
  /**
   * Which columns to report on — the ones the caller actually measured.
   * Explicit rather than "all nine", because a caller holding five of them must
   * not be made to assert anything about the other four. See
   * BOOTSTRAP_NULLABLE_COLUMNS.
   */
  columns: readonly NullableColumn[],
  measuredFrom: Partial<Record<NullableColumn, number | null>> = {}
): SeasonColumnAvailability {
  const withMatches = players.filter((p) => p.matches > 0);

  // The season-level state, at the season level: when nothing has been played
  // there is ONE fact, not nine copies of it. Deriving it from `matches > 0`
  // costs nothing and it is what stops the predicate reading TRUE vacuously on
  // 2026-27 — over zero rows `count(col) = count(*) = 0` for every column, so
  // the app's DEFAULT season would claim to measure everything.
  if (withMatches.length === 0) {
    return { season, measured: false, columns: [] };
  }

  const out: ColumnAvailability[] = columns.map((key) => {
    let measured = 0;
    for (const p of withMatches) {
      if (p.values[key] !== null && p.values[key] !== undefined) measured++;
    }

    const state: ColumnState =
      measured === 0 ? 'none' : measured === withMatches.length ? 'full' : 'partial';

    return {
      key,
      state,
      // Only a partial column has a boundary worth naming. A `full` column
      // starts at round one by definition and a `none` column has no first
      // round at all, so sending a number for either would be inventing one.
      measured_from: state === 'partial' ? (measuredFrom[key] ?? null) : null,
    };
  });

  return { season, measured: true, columns: out };
}

/** The columns that came back `partial`, which are the only ones needing a round. */
export function partialColumns(availability: SeasonColumnAvailability): NullableColumn[] {
  return availability.columns
    .filter((c) => c.state === 'partial')
    .map((c) => c.key as NullableColumn);
}

/**
 * The first round each named column was measured in, for one season.
 *
 * Narrow on purpose, and called only when a column actually came back `partial`
 * — which today is 2022-23 alone, on five columns. Ten of the eleven seasons pay
 * no extra query at all. Measured at 28.2ms against a 52ms aggregate it runs
 * beside, versus 74-83ms for the full eleven-season matrix.
 *
 * `min(gw) FILTER (WHERE col IS NOT NULL)` rather than a `WHERE` on the whole
 * statement, so one pass answers every column: a shared `WHERE col IS NOT NULL`
 * would be wrong the moment two columns have different boundaries, which is
 * exactly 2022-23's shape (xGI is holed at round 29 as well as 1-15).
 *
 * Note what this number is and is not. It is the first round with a value, so
 * "only recorded from GW16" is true of xGI — but xGI's unmeasured rounds are not
 * a prefix, round 29 sitting above the boundary. The client's `measurementStart`
 * navigates the same fact with a `some`-over-the-group rule for the career
 * footnote; the two derivations are deliberately separate and are pinned against
 * each other by test rather than merged. See the item 13 record.
 */
export async function measuredFrom(
  db: Queryable,
  season: string,
  columns: readonly NullableColumn[]
): Promise<Partial<Record<NullableColumn, number | null>>> {
  if (columns.length === 0) return {};

  // Interpolated, not parameterised, and safe because these are members of
  // NULLABLE_COLUMNS — a compile-time closed set, never user input. A column
  // name cannot be a bind parameter in Postgres.
  const selects = columns
    .map((c) => `min(gw) FILTER (WHERE ${c} IS NOT NULL) AS ${c}`)
    .join(',\n            ');

  const { rows } = await db.query<Record<string, number | null>>(
    `SELECT ${selects}
       FROM player_gameweeks
      WHERE season = $1`,
    [season]
  );

  const out: Partial<Record<NullableColumn, number | null>> = {};
  for (const c of columns) out[c] = rows[0]?.[c] ?? null;
  return out;
}

/**
 * The whole eleven-season matrix, one row per (season, column).
 *
 * This is what `GET /api/columns` serves, and it exists for the picker's reason
 * strings rather than for what renders now: "Not recorded in 2016-17 · recorded
 * from 2022-23" needs to know about seasons other than the one on screen. The
 * bootstrap's single-season `columns` covers first paint, so nothing blocks on
 * this.
 *
 * Rows carrying their own `season` is API identity rule 7's many-seasons form,
 * the same shape `getPlayerCareer` uses. A `Record<season, …>` map would be the
 * manifest that rule refuses: two statements of one fact, free to disagree.
 *
 * **Every season appears, including one with no match rows.** 2026-27 has 564
 * registrations and zero gameweeks, and a plain GROUP BY over the fact table
 * omits it — which is precisely the blind spot the season-level `measured` flag
 * exists to close, so this must not reproduce it.
 *
 * It gets there with two cheap queries rather than one expensive join, and the
 * difference is not marginal. Driving the aggregate from
 * `(SELECT DISTINCT season FROM player_seasons) LEFT JOIN player_gameweeks`
 * reads correctly and measures **161ms**, against **51ms** for the same
 * aggregate grouped directly on `player_gameweeks` — 110ms spent entirely to
 * carry one row for a season that has no data. So the aggregate stays on the
 * fact table and the missing seasons are folded in here, where they cost a
 * `SELECT DISTINCT` over a small dimension table and no join at all.
 *
 * Measured at ~55ms for the pair. Fetched once per page load, off the critical
 * path.
 */
export async function listColumnHistory(db: Queryable): Promise<ColumnHistoryRow[]> {
  const perColumn = NULLABLE_COLUMNS.map(
    (c) => `count(pg.${c}) AS ${c}_n,
            min(pg.gw) FILTER (WHERE pg.${c} IS NOT NULL) AS ${c}_from`
  ).join(',\n            ');

  const [agg, seasons] = await Promise.all([
    db.query<Record<string, string | number | null>>(
      `SELECT pg.season,
              count(pg.fixture_id) AS total,
              ${perColumn}
         FROM player_gameweeks pg
        GROUP BY pg.season`
    ),
    db.query<{ season: string }>('SELECT DISTINCT season FROM player_seasons'),
  ]);

  const bySeason = new Map(agg.rows.map((r) => [String(r.season), r]));

  // Rule 8's TEXT format sorts correctly as text, and newest-first matches
  // `listSeasons`. One ordering, stated once — a second opinion would
  // eventually disagree about something neither end declares.
  const allSeasons = seasons.rows.map((r) => r.season).sort().reverse();

  const out: ColumnHistoryRow[] = [];
  for (const season of allSeasons) {
    const r = bySeason.get(season);

    for (const key of NULLABLE_COLUMNS) {
      // A season with no match rows at all. One fact, flattened to `none` per
      // column because this response has no season-level field to put it on —
      // the bootstrap's `measured: false` is what carries it, which is why the
      // client must read the two together and not this alone.
      if (r === undefined) {
        out.push({ season, key, state: 'none', measured_from: null });
        continue;
      }

      // count() returns int8, which the driver hands back as a string.
      const total = Number(r.total);
      const n = Number(r[`${key}_n`]);
      const from = r[`${key}_from`];

      const state: ColumnState = n === 0 ? 'none' : n === total ? 'full' : 'partial';

      out.push({
        season,
        key,
        state,
        measured_from: state === 'partial' && from !== null ? Number(from) : null,
      });
    }
  }
  return out;
}

/**
 * The bootstrap's own rows, read as measurements.
 *
 * **Five of the nine nullable columns are on that query, and the bootstrap
 * speaks for those five only.** `expected_goals_conceded`, `tackles`,
 * `clearances_blocks_interceptions` and `recoveries` live on the career
 * aggregate, so they are absent here rather than null.
 *
 * They must not come back as `none`, which is what an earlier draft shipped and
 * what reading the payload caught: `none` is a measured claim that no player has
 * a value, and it was being made about columns nobody had queried. It read
 * `tackles: none` on 2022-23 — plausible — and would have read the same on
 * 2016-17, where tackles is fully measured and `/api/columns` says so. Two
 * sources of one fact, disagreeing on a season one click away.
 */
export function asMeasurements(players: PlayerSeasonTotals[]): PlayerColumnMeasurement[] {
  return players.map((p) => ({
    matches: p.matches,
    values: {
      starts: p.starts,
      expected_goals: p.expected_goals,
      expected_assists: p.expected_assists,
      expected_goal_involvements: p.expected_goal_involvements,
      defensive_contribution: p.defensive_contribution,
    },
  }));
}

/**
 * What `bootstrap.columns` carries for one season, end to end.
 *
 * Lives here rather than in the route so the route and `verify:columns` run the
 * same shipped code — a check that reimplemented this would share its derivation
 * with nothing and prove nothing (working agreement).
 *
 * **The gating is the whole cost story.** The states come from rows the
 * bootstrap has already computed, so they are free. Only a `partial` column has
 * a boundary worth naming, and only a season with a partial column runs the
 * query that finds it — 2022-23 alone today. Ten of the eleven seasons pay no
 * extra query at all.
 *
 * Sequential rather than parallel, and that is forced rather than chosen: which
 * columns are partial is not known until the aggregate has been reduced, so the
 * boundary query cannot be fired alongside it. Firing it unconditionally for all
 * nine columns would make it parallel and make every season pay for it, which is
 * the trade the gating exists to avoid.
 */
export async function seasonAvailability(
  db: Queryable,
  season: string,
  players?: PlayerSeasonTotals[]
): Promise<SeasonColumnAvailability> {
  const rows = players ?? (await listPlayerTotals(db, season));
  const measurements = asMeasurements(rows);
  const cols = BOOTSTRAP_NULLABLE_COLUMNS;

  const first = deriveSeasonAvailability(season, measurements, cols);
  const partial = partialColumns(first);
  if (partial.length === 0) return first;

  const from = await measuredFrom(db, season, partial);
  return deriveSeasonAvailability(season, measurements, cols, from);
}

/**
 * Phase 0, step 2: the initial FPL Lens schema.
 *
 * Nothing here is arbitrary. The nullability of every stat column is taken
 * straight from the column-presence matrix in docs/data-profile.md section 6,
 * and the key design follows the Data Layer Rules in CLAUDE.md. The two that
 * bite hardest:
 *
 *   - Rule 2/3: FPL `id` is season-scoped and reassigned every season, so
 *     nothing joins on it across seasons. Permanent `code` values live on
 *     players.fpl_code and teams.fpl_team_code; the season-scoped ids are
 *     confined to player_seasons.fpl_element_id and team_seasons.fpl_team_id.
 *
 *   - Rule 6: a column absent from a season is NULL, never 0. Zero means
 *     "generated no chances", NULL means "not measured". That is why the
 *     drifting stats below carry no NOT NULL and, critically, no DEFAULT.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Rule 8: season is TEXT in '2016-17' form, everywhere, no exceptions. */
const SEASON_FORMAT = "season ~ '^[0-9]{4}-[0-9]{2}$'";

const identityPk = {
  type: 'integer',
  primaryKey: true,
  sequenceGenerated: { precedence: 'ALWAYS' },
} as const;

/** Counting stat present in all ten seasons. */
const count = { type: 'smallint', notNull: true } as const;

/** Counting stat missing from at least one season. No default: see rule 6. */
const nullableCount = { type: 'smallint' } as const;

/**
 * Decimal stat present in all ten seasons. Unconstrained NUMERIC on purpose:
 * upstream precision is not stable (expected_goals is 0.00000 in 2022-23 and
 * 0.00 in 2025-26), and pinning a scale would silently round.
 */
const metric = { type: 'numeric', notNull: true } as const;

/** Decimal stat missing from at least one season. */
const nullableMetric = { type: 'numeric' } as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------- players
  // fpl_code is the permanent, cross-season player identity (rule 3).
  // opta_code and birth_date only appear in players_raw.csv from 2024-25.
  pgm.createTable('players', {
    id: identityPk,
    fpl_code: { type: 'integer', notNull: true, unique: true },
    opta_code: { type: 'text' },
    first_name: { type: 'text' },
    second_name: { type: 'text' },
    web_name: { type: 'text', notNull: true },
    birth_date: { type: 'date' },
  });

  // ------------------------------------------------------------------ teams
  // fpl_team_code is permanent. Names for clubs relegated before 2019-20 have
  // no teams.csv to come from and are seeded by hand (rule 15).
  pgm.createTable('teams', {
    id: identityPk,
    fpl_team_code: { type: 'integer', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    short_name: { type: 'text', notNull: true },
  });

  // ----------------------------------------------------------- team_seasons
  // The season-scoped team id mapping (rule 4). Strength ratings come from
  // teams.csv, which does not exist for 2016-17 through 2018-19.
  pgm.createTable(
    'team_seasons',
    {
      team_id: { type: 'integer', notNull: true, references: 'teams' },
      season: { type: 'text', notNull: true },
      fpl_team_id: { type: 'smallint', notNull: true },
      strength_overall_home: nullableCount,
      strength_overall_away: nullableCount,
      strength_attack_home: nullableCount,
      strength_attack_away: nullableCount,
      strength_defence_home: nullableCount,
      strength_defence_away: nullableCount,
    },
    {
      constraints: {
        primaryKey: ['team_id', 'season'],
        unique: [['season', 'fpl_team_id']],
        check: SEASON_FORMAT,
      },
    }
  );

  // --------------------------------------------------------- player_seasons
  // The season-scoped player id mapping (rule 4), plus the season-level
  // attributes: which club, which position, and the price at each end.
  //
  // The position CHECK enforces rule 10's element_type mapping and makes both
  // failure modes loud: a 'GKP' leaking through from the 2021-22 gameweek file
  // and an element_type = 5 Assistant Manager (rule 11) both reject on insert
  // rather than quietly persisting.
  //
  // Costs are raw £0.1m units (rule 9); divide at the presentation layer.
  pgm.createTable(
    'player_seasons',
    {
      player_id: { type: 'integer', notNull: true, references: 'players' },
      season: { type: 'text', notNull: true },
      fpl_element_id: { type: 'smallint', notNull: true },
      team_id: { type: 'integer', notNull: true, references: 'teams' },
      position: {
        type: 'text',
        notNull: true,
        check: "position IN ('GK', 'DEF', 'MID', 'FWD')",
      },
      start_cost: { type: 'integer' },
      end_cost: { type: 'integer' },
    },
    {
      constraints: {
        primaryKey: ['player_id', 'season'],
        unique: [['season', 'fpl_element_id']],
        check: SEASON_FORMAT,
      },
    }
  );

  // --------------------------------------------------------------- fixtures
  // Read from fixtures.csv for 2018-19 onward; derived from merged_gw.csv for
  // 2016-17 and 2017-18, which have no such file (rule 14).
  //
  // gw and kickoff_time are nullable because the live FPL API leaves `event`
  // and `kickoff_time` empty for fixtures it has not scheduled yet, and the
  // live sync will write to this same table. Every historical CSV row
  // populates both.
  //
  // difficulty is NULL for 2016-17 and 2017-18: no fixtures.csv, no ratings.
  // scores are NULL for fixtures that have not been played.
  // `finished` is set true for the two derived seasons, both being complete.
  pgm.createTable(
    'fixtures',
    {
      id: identityPk,
      season: { type: 'text', notNull: true },
      fpl_fixture_id: { type: 'integer', notNull: true },
      gw: { type: 'smallint' },
      home_team_id: { type: 'integer', notNull: true, references: 'teams' },
      away_team_id: { type: 'integer', notNull: true, references: 'teams' },
      kickoff_time: { type: 'timestamptz' },
      finished: { type: 'boolean', notNull: true },
      home_score: nullableCount,
      away_score: nullableCount,
      home_difficulty: nullableCount,
      away_difficulty: nullableCount,
    },
    {
      constraints: {
        unique: [['season', 'fpl_fixture_id']],
        check: SEASON_FORMAT,
      },
    }
  );

  // ------------------------------------------------------- player_gameweeks
  // One row per player per match actually played.
  //
  // The key is (player_id, fixture_id), never (player_id, gw): a double
  // gameweek gives a player two rows in one round and a blank gives them none
  // (rule 13). opponent_team_id is the resolved internal id, never the raw
  // season-scoped opponent_team from the CSV (rule 5). gw is the round the
  // match was actually played in (rule 12) and carries no upper-bound check,
  // because 2019-20 ran to round 47 after the Covid suspension.
  //
  // Deliberately absent: xP (rule 7, it is scraped post-match and leaks
  // lookahead), the seven mng_* columns (rule 11), ea_index (see below), and
  // the CSV's raw element, round, fixture and opponent_team, all of which
  // resolve to real keys above.
  pgm.createTable(
    'player_gameweeks',
    {
      player_id: { type: 'integer', notNull: true, references: 'players' },
      fixture_id: { type: 'integer', notNull: true, references: 'fixtures' },
      season: { type: 'text', notNull: true },
      gw: { type: 'smallint', notNull: true },
      was_home: { type: 'boolean', notNull: true },
      opponent_team_id: { type: 'integer', notNull: true, references: 'teams' },

      // Core stats, present in all ten seasons.
      total_points: count,
      minutes: count,
      goals_scored: count,
      assists: count,
      clean_sheets: count,
      goals_conceded: count,
      own_goals: count,
      penalties_saved: count,
      penalties_missed: count,
      saves: count,
      yellow_cards: count,
      red_cards: count,
      bonus: count,
      bps: count,
      influence: metric,
      creativity: metric,
      threat: metric,
      ict_index: metric,
      value: count, // £0.1m units, rule 9
      // selected peaks at 9.58m, well past smallint.
      selected: { type: 'integer', notNull: true },
      transfers_in: { type: 'integer', notNull: true },
      transfers_out: { type: 'integer', notNull: true },

      // 2022-23 onward. NULL before that means "not measured".
      starts: nullableCount,
      expected_goals: nullableMetric,
      expected_assists: nullableMetric,
      expected_goal_involvements: nullableMetric,
      expected_goals_conceded: nullableMetric,

      // Defensive stats. Present 2016-17..2018-19, dropped, then back in
      // 2025-26. defensive_contribution is 2025-26 only.
      tackles: nullableCount,
      recoveries: nullableCount,
      clearances_blocks_interceptions: nullableCount,
      defensive_contribution: nullableCount,

      // Legacy detail, 2016-17..2018-19 only. Never collected since.
      //
      // ea_index is excluded even though it appears in those three files: it
      // is 0 in all 67,936 rows. Storing 0 would assert a measurement nobody
      // took, and storing NULL would leave it empty in every row it exists
      // in. Either way it carries no signal, so it does not get a column.
      attempted_passes: nullableCount,
      big_chances_created: nullableCount,
      big_chances_missed: nullableCount,
      completed_passes: nullableCount,
      dribbles: nullableCount,
      errors_leading_to_goal: nullableCount,
      errors_leading_to_goal_attempt: nullableCount,
      fouls: nullableCount,
      key_passes: nullableCount,
      offside: nullableCount,
      open_play_crosses: nullableCount,
      penalties_conceded: nullableCount,
      tackled: nullableCount,
      target_missed: nullableCount,
      winning_goals: nullableCount,
    },
    {
      constraints: {
        primaryKey: ['player_id', 'fixture_id'],
        check: SEASON_FORMAT,
      },
    }
  );

  // The primary key already serves player-leading lookups; these two serve
  // season filtering and whole-gameweek scans.
  pgm.createIndex('player_gameweeks', ['player_id', 'season']);
  pgm.createIndex('player_gameweeks', ['season', 'gw']);
  // The PK leads on player_id, so it cannot serve fixture-led access: "every
  // player in this match" would seq-scan without this. It also backs the
  // fixture_id foreign key, which is otherwise unindexed.
  pgm.createIndex('player_gameweeks', 'fixture_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Reverse dependency order. Indexes and constraints go with their tables.
  pgm.dropTable('player_gameweeks');
  pgm.dropTable('fixtures');
  pgm.dropTable('player_seasons');
  pgm.dropTable('team_seasons');
  pgm.dropTable('players');
  pgm.dropTable('teams');
}

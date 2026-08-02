# FPL Lens

## What This Is

A full-stack FPL (Fantasy Premier League) player analytics dashboard. Search any
player, see their gameweek-by-gameweek stats across multiple seasons in one view
with filters.

## Current State

MVP scaffold is complete and still reads directly from the live FPL API. **Active work
is Phase 0: replacing that with a Postgres data layer backfilled from historical CSVs.**

Phase 0 steps 1 through 5 are done. The raw CSVs for all ten seasons are in
`data/raw/` and profiled in `docs/data-profile.md`. Postgres 16 runs in
docker-compose and the schema exists, created by
`server/migrations/1785550165663_initial-schema.ts`.

**All six tables are populated.** Three ingest scripts do it. All three are
idempotent, run in one transaction, and assert their own results:

| Table              | Rows                    | Populated by                |
| ------------------ | ----------------------- | --------------------------- |
| `teams`            | 34                      | `npm run ingest:dimensions` |
| `team_seasons`     | 200 (20 per season)     | `npm run ingest:dimensions` |
| `players`          | 2623                    | `npm run ingest:dimensions` |
| `player_seasons`   | 7338                    | `npm run ingest:dimensions` |
| `fixtures`         | 3800 (380 per season)   | `npm run ingest:fixtures`   |
| `player_gameweeks` | 253509                  | `npm run ingest:gameweeks`  |

The scripts must be run in that order. Each asserts its predecessors' row counts
before it starts and fails with a message naming the one to run first:
`ingest:fixtures` needs `team_seasons`, and `ingest:gameweeks` needs
`player_seasons` and `fixtures` to resolve its three season-scoped ids.

`npm test` runs the acceptance suite in
`server/src/ingest/player-gameweeks.test.ts` against the populated database: the
nine Saka 2025-26 metrics, Salah 2017-18 and De Bruyne 2019-20 (both sourced
independently of the CSVs), plus the dedup, double/blank gameweek and rule 6
nullability boundaries. 11 tests, all passing.

The routes still hit the live API; `server/src/db/pool.ts` is not yet imported by
`index.ts`, and nothing is read from Postgres until step 6.

The app currently cannot show anything useful, because it is preseason (2026/27 GW1
deadline is 21 Aug 2026) and the live API returns an empty current-season history
array. Historical data is the only data that exists right now.

## Tech Stack

- **Frontend:** React 18 + TypeScript, Vite
- **Backend:** Node.js + Express + TypeScript (tsx for dev), port 3001
- **Database:** PostgreSQL. Source of truth for all player, team, fixture and
  gameweek data.
- **Cache:** 5min in-memory TTL on live FPL API calls only. DB reads are not cached.

### Ingestion sources

Live season, incremental, official FPL API (no auth needed):

- `https://fantasy.premierleague.com/api/bootstrap-static/` (players, teams, gameweeks)
- `https://fantasy.premierleague.com/api/element-summary/{player_id}/` (per-GW history,
  upcoming fixtures, and `history_past` season totals)
- `https://fantasy.premierleague.com/api/fixtures/`

Historical backfill, 2016-17 onward, from
[vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League),
raw CSVs at
`https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/{season}/`:

- `players_raw.csv` (carries both `id` and `code`, plus `opta_code`, `birth_date`)
- `teams.csv` (carries both `id` and `code`)
- `gws/merged_gw.csv` (per-player per-gameweek rows, keyed on season-scoped `element`)

The official API cannot serve previous seasons at gameweek granularity. It exposes
prior seasons only as totals via `history_past`, and current-season data is wiped at
rollover. That is why the CSV backfill exists.

## Project Structure

```
fpl-lens/
├── data/raw/                  # gitignored, downloaded CSVs by season
├── docs/
│   └── data-profile.md        # column presence matrix, generated in Phase 0
├── scripts/
│   ├── fetch-raw-data.ts      # downloads historical CSVs
│   └── profile-raw-data.ts    # profiles column drift across seasons
├── server/
│   ├── migrations/            # node-pg-migrate
│   ├── src/
│   │   ├── index.ts           # Express entry, port 3001
│   │   ├── db/                # pool, connection config
│   │   ├── ingest/            # CSV loaders + live API sync
│   │   ├── repositories/      # DB query layer
│   │   ├── routes/fpl.ts      # GET /api/bootstrap, GET /api/player/:id
│   │   ├── services/fplApi.ts # live FPL API client with in-memory cache
│   │   └── types/             # wire types (FPL/CSV shapes) + domain types
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx            # Root component, state, filter logic
│   │   ├── types/fpl.ts       # domain types + UI constants
│   │   ├── services/api.ts    # frontend fetch wrappers
│   │   └── components/
│   │       ├── PlayerSearch.tsx
│   │       ├── PlayerHeader.tsx
│   │       ├── GameweekFilters.tsx
│   │       └── StatsTable.tsx
│   ├── vite.config.ts         # proxies /api to :3001
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml         # dev Postgres 16, host port 5434
├── .env.example               # copy to .env; read by compose AND server/src/db
├── package.json               # root scripts (concurrently runs both)
└── CLAUDE.md
```

## Data Layer Rules

These are not style preferences. Violating them produces data that looks correct and
is silently wrong.

1. **Postgres is the source of truth.** The FPL API is an ingestion source, not the
   data layer.
2. **FPL `id` is season-scoped for both players and teams, and is reassigned every
   season. NEVER join on it across seasons.** Player 328 in 2021-22 is a different
   person from player 328 today. Team ids are 1 to 20 and reshuffle alphabetically as
   clubs are promoted and relegated.
3. **Always resolve to `code`.** Player `code` and team `code` are permanent across
   seasons. `players_raw.csv` and `teams.csv` carry both columns, so the join chain
   is `merged_gw.element` to `players_raw.id` to `players_raw.code`.
4. **`player_seasons` and `team_seasons` hold the season-scoped mapping.** They are
   derived automatically from the CSVs at ingest. Never hand-edit them.
5. **`opponent_team` in gameweek files is a season-scoped team id and MUST be mapped
   to an internal team id before storage.** Storing it raw means "Saka against team
   14" refers to a different club in every season.
6. **Columns absent in older seasons are NULL, never 0.** xG does not exist before
   2022-23 and defensive stats only from 2025-26. Zero means "generated no chances".
   NULL means "not measured". Check `docs/data-profile.md` for exact first-appearance
   seasons.
7. **Drop the `xP` column at ingest.** It is scraped from FPL's `ep_this` field after
   the gameweek ends, so it can carry post-match information. Any model trained on it
   unshifted gets severe lookahead bias and looks excellent while being useless.
8. **Season format is TEXT, `'2016-17'`.** Consistent everywhere, no integers, no
   slashes.
9. **All costs are in £0.1m units.** `now_cost = 100` means £10.0m. Store raw, divide
   at the presentation layer only.
10. **Derive position from `players_raw.element_type`, never from the `position`
    string in `merged_gw.csv`.** The string column is absent in 2016-17 through
    2019-20 and internally inconsistent in 2021-22, which contains both `GK` and
    `GKP`. `element_type` is present in all ten seasons and is unambiguous. Map
    1=GK, 2=DEF, 3=MID, 4=FWD once at ingest. Position is a season-level attribute:
    store it on `player_seasons`, not on `player_gameweeks`.
11. **Exclude `element_type = 5` entirely.** It appears in 2024-25 only and
    identifies Assistant Manager elements (Arteta, Emery, Iraola, Hürzeler and so
    on) from the chip FPL ran that season and dropped for 2025-26. They are not
    players, they carry permanent `code` values that would pollute the players
    dimension, and they would surface in player search. Filter them at ingest and
    drop the seven `mng_*` columns with them.
12. **Deduplicate `(element, fixture)` before insert, ordering by `kickoff_time`
    descending and taking the first row.** Two distinct causes exist, and this one
    rule covers both. In 2019-20 a postponed fixture appears twice: once under its
    originally scheduled round with 0 minutes and 0 points, and again under the
    round it was actually played in with the real result (fixture 275, postponed
    11 Mar 2020, played 17 Jun 2020, 59 affected rows). Those rows genuinely
    differ, so the pick matters. In 2025-26, 10 rows are exact byte-identical
    copies belonging to two players whose FPL display name changed mid-season
    (Kroupi rounds 1-9, Gannon-Doak round 1), so the tiebreak is irrelevant there.
    Never resolve either case with `ON CONFLICT DO NOTHING`, which keeps whichever
    row arrives first and would discard a real 90-minute performance in favour of
    the placeholder. The stored `gw` must be the round the match was actually
    played in. Apply the same dedup when deriving the `fixtures` table.
13. **A player can have two rows in one round (double gameweek) or none (blank
    gameweek).** Element 100 in 2025-26 has two distinct fixtures in round 33 and
    no row at all in round 34. `(player_id, gw)` is therefore NOT unique and must
    never be used as a key, which is why the `player_gameweeks` constraint is
    `UNIQUE(player_id, fixture_id)`. It also means any per-gameweek average has to
    state explicitly whether it divides by rounds or by matches played.
14. **`fixtures.csv` exists 2018-19 onward only.** For 2016-17 and 2017-18, derive
    the `fixtures` table from `merged_gw.csv` by grouping on `fixture`.

    **Assign home and away from `was_home` plus `opponent_team`, never from
    `players_raw.team`:**

    - `was_home = true` → the player is the home side, so `opponent_team` is **away**
    - `was_home = false` → the player is the away side, so `opponent_team` is **home**

    Each side must resolve to exactly one distinct team per fixture. Ambiguity is a
    hard failure, not a warning.

    `players_raw.team` was tried and rejected, and the reasoning matters because
    rule 17 makes that column look like the natural choice. Rule 17 establishes
    that `players_raw.csv` is an end-of-season snapshot, so a player who
    transferred in January carries his **new** club on fixtures he actually played
    for his **old** one. That makes `was_home` + `players_raw.team` internally
    inconsistent on **32 to 124 fixtures per season**, survivable only by majority
    voting across each fixture's rows — and majority voting has no failure mode: it
    silently picks whichever side has more rows. `opponent_team` is a property of
    the match rather than of the player, so no snapshot staleness can reach it.
    Verified: **0 mismatches and 0 ambiguity across all ten seasons.**

    The derivation is cross-checked in `server/src/ingest/ingest-fixtures.ts`
    against the eight seasons that also have a `fixtures.csv`, on home team, away
    team, both scores, `gw` and `kickoff_time`. That check is what justifies
    trusting it for the two seasons with no second source, so it must keep passing.
    **One known exception:** 2021-22 fixture 263, where `merged_gw` says 15:00 and
    `fixtures.csv` says 15:30. Teams, round and score agree. It is allowlisted by
    name; any other disagreement, on any field, fails the ingest.

    `team_h_score` and `team_a_score` are present in `merged_gw` for all seasons.
    Difficulty ratings do not exist for the two derived seasons and stay NULL.
    `fixtures.finished` is **read** from `fixtures.csv` for 2018-19 onward but
    **derived** for 2016-17 and 2017-18, where no such field exists: set it `true`,
    both seasons being complete. Ignore the `stats` column in `fixtures.csv`; the
    bonus and BPS detail it carries is already in `merged_gw`.
15. **Team identity for 2016-17 through 2018-19 comes from
    `players_raw.team_code`, not `teams.csv`, which is absent for those seasons.**
    Team names are only available from `teams.csv`, so clubs relegated before
    2019-20 and never promoted since have a code with no name. Those are seeded
    manually in `server/src/ingest/seed-teams.ts`. Strength ratings do not exist
    for those seasons and stay NULL.
16. **`ea_index` is excluded.** It appears in `merged_gw.csv` for 2016-17 through
    2018-19 and is 0 in all 67,936 rows across those three seasons. Storing 0
    would assert a measurement nobody took; storing NULL would leave it empty in
    every row it exists in. It carries no signal either way, so it gets no column.
    Note that `docs/data-profile.md` lists it as present in three seasons with no
    indication that it is empty, because the profiler reports column presence, not
    column content.
17. **`player_seasons.team_id` is the club at the END of that season, not for the
    whole season.** `players_raw.csv` is an end-of-season bootstrap snapshot, so a
    player who transferred in January is recorded under his new club for the entire
    season row. Never use it to answer "which club was this player at in gameweek
    N". That comes from the fixture: `was_home` picks `home_team_id` or
    `away_team_id` on the `player_gameweeks` row's fixture. Verified empirically:
    for the 96 players who turned out for two clubs in one season across 2020-21,
    2022-23, 2024-25 and 2025-26, the snapshot's `team_code` matches the club of
    their chronologically last appearance in 96 of 96 cases.
18. **The literal string `'None'` is a null, and only `'None'`.** The upstream
    scraper serialises Python `None` as the four-character string `None`. It occurs
    in eleven columns of `players_raw.csv`, of which only `birth_date` is ingested
    (162 rows in 2024-25, 19 in 2025-26). It does NOT occur anywhere in
    `merged_gw.csv` or `fixtures.csv`, in any season. Normalise `'None'` and the
    empty string to NULL at parse time in every ingest, including the ones whose
    sources are currently clean. Do NOT normalise `'-'`, `'null'`, `'nan'` or
    lowercase `'none'`: none of them occur in any of the three files, and `'-'`
    could be legitimate in a text field.

## Getting Started

```bash
npm install
npm run install:all
cp .env.example .env
docker compose up -d
npm run migrate:up
npm run dev
```

Frontend: http://localhost:5173, Backend: http://localhost:3001

Postgres publishes on host port **5434**, not 5432, because a native Postgres and
another project's container already hold 5432 and 5433 on the dev machine. Change
`POSTGRES_PORT` and the port inside `DATABASE_URL` together if you need a different
one. `npm run migrate:down` reverts the last migration.

## What's Built

- [x] Backend FPL API proxy with in-memory caching
- [x] Player search with autocomplete
- [x] Player header card (name, team, position, price, form, xG, xA, ICT)
- [x] Gameweek-by-gameweek stats table (sortable, all columns)
- [x] Filters: gameweek range, home/away
- [x] Averages row in stats table

## Known Issues

- Gameweek range filter defaults to "from 1 to 1", so it shows a single gameweek even
  when data exists.
- `history_past` is fetched from `element-summary` and then discarded. It is never
  rendered. Superseded by Phase 0, which will provide full per-gameweek history for
  those seasons.
- The header card currently displays 2025-26 carryover totals from bootstrap
  (`total_points`, `minutes`, `goals_scored`, ICT, bonus, bps). These reset to zero at
  the 21 Aug rollover and the card will look broken. Price, ownership, form and status
  are already live 2026/27 values.
- Empty state reads "No data for the selected filters", which is misleading during
  preseason when the cause is an empty history array, not the filters.
- `client/src/types/fpl.ts` mirrors the FPL wire format directly. Numerics arrive as
  strings (`expected_goals: string`, `form: string`) and every consumer parses them ad
  hoc. There is no `code`, `team_code` or `birth_date` on `Player`, no `code` on
  `Team`, and `GameweekHistory` has no `element`, `fixture`, `kickoff_time` or
  `season`, so a row cannot be uniquely keyed.
- The dark theme below is the original spec, but the current UI renders light/cream.
  Reconcile before any styling work.

## Current Work: Phase 0, Persistence and Backfill

One session per step. Commit between each.

- [x] **1. Fetch and profile.** `scripts/fetch-raw-data.ts` downloads the three CSVs
      per season, 2016-17 through 2025-26, into `data/raw/{season}/`.
      `scripts/profile-raw-data.ts` writes `docs/data-profile.md` with the column
      presence matrix per season, distinct `element_type` values, distinct position
      strings, row and distinct-element counts per season, first-appearance season for
      each drifting stat family, and an explicit answer to whether `code` exists in
      `players_raw.csv` for every season. No schema design in this step.
- [x] **2. Schema.** Postgres in docker-compose, node-pg-migrate wired with up/down
      scripts, first migration creating the tables below. No ingestion logic.
- [x] **3. Dimension ingest.** Populate `teams`, `team_seasons`, `players`,
      `player_seasons` from `teams.csv` and `players_raw.csv`.
- [x] **4. Fixture ingest.** Populate `fixtures` from `fixtures.csv` for 2018-19
      onward and derive it from `merged_gw.csv` for 2016-17 and 2017-18 per rule 14.
- [x] **5. Fact ingest.** `server/src/ingest/ingest-gameweeks.ts` populates
      `player_gameweeks` with 253,509 rows from `merged_gw.csv`, resolving `element`,
      `fixture` and `opponent_team` through the season maps. `COPY` through
      node-postgres into a temp staging table, then one
      `INSERT ... ON CONFLICT (player_id, fixture_id) DO UPDATE`. Exclusions are
      pinned by count, not absorbed: 322 Assistant Manager rows in 2024-25, 59
      postponed-fixture duplicates in 2019-20, 10 byte-identical duplicates in
      2025-26. Nothing else is dropped — an unresolved id throws.
- [ ] **6. Repository and cutover.** Add `repositories/`, then swap
      `GET /api/player/:id` to read from Postgres while keeping the response shape
      byte-identical so the client stays untouched.
- [ ] **7. Types split.** Separate wire types (FPL and CSV shapes), domain types, and
      UI constants, with the mapper living at the ingestion boundary. Numerics become
      `number`, not `string`.

### Target schema

```
players          (id, fpl_code UNIQUE NOT NULL, opta_code, first_name, second_name,
                  web_name, birth_date)
teams            (id, fpl_team_code UNIQUE NOT NULL, name, short_name)
team_seasons     (team_id, season, fpl_team_id, strength_*,
                  UNIQUE(season, fpl_team_id))
player_seasons   (player_id, season, fpl_element_id, team_id, position,
                  start_cost, end_cost, UNIQUE(season, fpl_element_id))
fixtures         (id, season, fpl_fixture_id, gw, home_team_id, away_team_id,
                  kickoff_time, finished, home_score, away_score, home_difficulty,
                  away_difficulty, UNIQUE(season, fpl_fixture_id))
player_gameweeks (player_id, season, gw, fixture_id, was_home, opponent_team_id,
                  <stat columns>, UNIQUE(player_id, fixture_id))
```

Index `player_gameweeks` on `(player_id, season)` and on `(season, gw)`. The unique
constraints make re-ingestion idempotent, which matters because these scripts will be
run many times.

### Acceptance test

Written, passing, and kept: `server/src/ingest/player-gameweeks.test.ts`, run with
`npm test`. Summing `player_gameweeks` for Bukayo Saka in 2025-26 produces all nine
of these:

| Metric         | Expected |
| -------------- | -------- |
| Total points   | 157      |
| Starts         | 25       |
| Minutes        | 2218     |
| Goals          | 7        |
| Assists        | 10       |
| Clean sheets   | 12       |
| Goals conceded | 16       |
| Bonus          | 18       |
| BPS            | 570      |

If minutes match but points do not, rows were lost in a blank gameweek. The suite
repeats the sum for Salah 2017-18 (a latin1 season, `starts` NULL), De Bruyne
2019-20 (the postponed-fixture dedup, and a double gameweek) and Saka 2019-20,
which exercises the xG nullability path three times over.

Expected values come from outside the CSVs wherever possible: the two Saka seasons
were taken from the official API's `history_past`, which is a separate pipeline
from the vaastav files. Note that `history_past` reports `starts: 0` before
2022-23 while we store NULL — that is rule 6, not a discrepancy.

**Two volume checks in the ingest do not share their derivation with the pinned
row counts**, and so can catch loss those counts cannot: every season must have
exactly 380 distinct `fixture_id`s, and `SUM(minutes)` must land within 1% below
380 × 2 × 11 × 90 = 752,400. The minutes figure is reported, never pinned to a
number — red cards and stoppage time make it approximate. Observed range is 0.13%
to 0.52% below.

## Deferred

Not in scope until Phase 0 is complete. Do not start these.

- **Data view improvements:** fixture difficulty colouring, totals row, per-90 toggle,
  rolling form, multi-player comparison, styling polish.
- **Expected points prediction:** transparent weighted formula, not black-box ML,
  because explainability matters for FPL managers. Requires a backtest harness fitted
  on earlier seasons and evaluated on a held-out one, benchmarked against a trailing
  five-gameweek average and against FPL's own `ep_next`. Unreachable without the
  historical data Phase 0 provides.
- **LLM scouting reports.**
- **Deploy on karpuz-prod** alongside TechRelative (Docker Compose, Nginx), responsive
  design, README with screenshots.

## Design Decisions

- Postgres is the source of truth. The FPL API cannot serve previous seasons at
  gameweek granularity, and current-season data is wiped at rollover.
- Tables first, charts later. Get the data layer right before adding visualisations.
- Dark theme (#0f0f23 background, #00ff87 FPL green accent). See Known Issues, the
  current UI does not match this.

## Working Agreement

- Read this file and `docs/data-profile.md` before starting any task.
- One Phase 0 step per session. Commit between steps.
- Do not touch `client/` during steps 1 through 5. API response shapes stay stable
  until step 6.
- Plan before writing code for steps 3 and 4. Ingestion is where an agent will
  confidently produce something that silently drops rows.
- End each session by updating the Current State section above so the next session
  starts from truth rather than a stale description.

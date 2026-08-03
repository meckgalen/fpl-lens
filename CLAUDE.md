# FPL Lens

## What This Is

A full-stack FPL (Fantasy Premier League) player analytics dashboard. Search any
player, see their gameweek-by-gameweek stats across multiple seasons in one view
with filters.

## Current State

**Phase 0 is complete. All seven steps are done, and the app reads from
Postgres, not the live FPL API.** The raw CSVs for all ten seasons are in
`data/raw/` and profiled in
`docs/data-profile.md`. Postgres 16 runs in docker-compose and the schema
exists, created by `server/migrations/1785550165663_initial-schema.ts`.

**All six tables are populated.** Three ingest scripts do it. All three are
idempotent, run in one transaction, and assert their own results:

| Table              | Rows                  | Populated by                |
| ------------------ | --------------------- | --------------------------- |
| `teams`            | 34                    | `npm run ingest:dimensions` |
| `team_seasons`     | 200 (20 per season)   | `npm run ingest:dimensions` |
| `players`          | 2623                  | `npm run ingest:dimensions` |
| `player_seasons`   | 7338                  | `npm run ingest:dimensions` |
| `fixtures`         | 3800 (380 per season) | `npm run ingest:fixtures`   |
| `player_gameweeks` | 253509                | `npm run ingest:gameweeks`  |

The scripts must be run in that order. Each asserts its predecessors' row counts
before it starts and fails with a message naming the one to run first:
`ingest:fixtures` needs `team_seasons`, and `ingest:gameweeks` needs
`player_seasons` and `fixtures` to resolve its three season-scoped ids.

`npm test` runs **two suites on two runners**: **34 server tests** and **39
client tests**, all passing. They are counted separately on purpose — two
runners print two summaries, and a combined figure would be maintained by hand
against neither of them.

The root script is `run-s --continue-on-error test:server test:client`, so the
client suite runs even when the server suite is red and the overall exit code is
still non-zero. `npm run test:server` and `npm run test:client` run either
alone. Not `&&`, which would hide the client result behind a database problem,
and not `;`, which reports only the last command's exit code and would let a red
server suite pass silently.

**Server — `node --import tsx --test`, against the populated database.** Four
files:

- `server/src/ingest/player-gameweeks.test.ts` — the ingest acceptance suite.
  The nine Saka 2025-26 metrics, Salah 2017-18 and De Bruyne 2019-20 (both
  sourced independently of the CSVs), plus the dedup, double/blank gameweek and
  rule 6 nullability boundaries.
- `server/src/repositories/api-identity.test.ts` — `/api/player/:code` takes an
  `fpl_code`, the id bootstrap hands out is the one that resolves, and no
  season-scoped element id resolves as a code.
- `server/src/repositories/wire-types.test.ts` — decimals arrive as numbers and
  unmeasured stats arrive as null, on the aggregate and on the gameweek rows.
- `server/src/repositories/career.test.ts` — the career query. Season set and
  order, the nine acceptance values, the summary cross-checked against the
  gameweek rows it claims to sum, the nullability matrix across all ten seasons
  on one player, the three shapes an empty season takes, and the property that
  makes the query's bare `sum()` safe: every nullable column is measured for a
  whole season or for none of it, never part of one.

**Client — Vitest in jsdom, no database.** Components are rendered and the API
is mocked at `services/api.ts`, not at `fetch`: mocking the transport would
additionally pin URL shapes and `res.ok` handling, which the server suite
already covers. `@testing-library/user-event` drives anything involving a
keyboard — `fireEvent` dispatches a synthetic click and so cannot tell a
`<button>` from a `<div onClick>`, which is the entire distinction item 3 turns
on. Eight files:

- `client/src/test/render.test.tsx` — a test for the harness, not the app. The
  suite's helper wraps in StrictMode, and everything `PlayerDetail.test.tsx`
  claims depends on React's double-invocation being genuinely active. This
  counts a probe component's renders and asserts two, both on the first render
  and after a `rerender`.
- `client/src/components/GameweekSection.test.tsx` — the four empty states, each
  pinned by the wording that distinguishes it, including the sentence that must
  **not** appear when a season is registered but empty. Two of the four are
  unreachable from the UI and reachable here.
- `client/src/pages/PlayerDetail.test.tsx` — expanding a career row issues one
  request, reopening after a collapse issues none, and changing player clears
  the cache. Payloads differ per (player, season) so a stale cache is visible
  rather than merely absent.
- `client/src/components/StatsTable.test.tsx` — rule 6 on screen: a null renders
  `—` and a zero renders `0.00`, in the same column of the same table.
- `client/src/components/CareerTable.test.tsx` — the season disclosure. Tab
  reaches it, Enter and Space both work, `aria-expanded` follows the state,
  `aria-controls` is absent while collapsed and resolves through
  `document.getElementById` while open, the accessible name is the season, and
  one mouse click toggles exactly once.
- `client/src/pages/Players.test.tsx` — the same disclosure assertions on the
  second table, because a shared control that has quietly stopped being shared
  passes one file and fails the other only if both files ask. Plus the sortable
  header on that page.
- `client/src/pages/Dashboard.test.tsx` — every ranking opens the player it
  lists, by mouse and by keyboard, in all three. **Pins the Dashboard's half of
  the contract and no more**: `App.tsx` has no test, so the callback firing is
  not evidence the detail page opens. That half is a browser check.
- `client/src/components/StatsTable.sort.test.tsx` — the sort header is a button,
  reachable by Tab, activated by Enter and Space, `aria-sort` follows the state,
  and the arrow stays out of the accessible name. Also a class-level tripwire on
  the button filling its cell, which is worth having and worth knowing the limit
  of — see the Phase 1 item 3 record.

Two runners rather than one, deliberately. The server suite's defining property
is that it talks to Postgres, and `node:test` was already there and works. The
client suite needs jsdom and a module mock, which is Vitest's job. Migrating the
server suite to Vitest would be a tooling change wearing a testing item's
clothes.

**Phase 1 step 1 is done: the player detail page shows a career.** It has three
sections — the header card, "This Season", and "Previous Seasons", which is one
summary row per season with the gameweeks underneath every one of them. The FPL
site shows that summary table and stops; expanding it is the app's reason to
exist. See "Phase 1" below for what the step decided.

**All four routes read Postgres.** `GET /api/bootstrap`,
`GET /api/player/:code`, `GET /api/player/:code/career` and `GET /api/fixtures`
go through `server/src/repositories/`, and no SQL exists outside that directory.
`server/src/services/fplApi.ts` and its 5-minute cache are still there and still
unused by the routes — it is the ingestion source for the live season, not dead
code.

The three season-scoped routes serve one season, defaulting to the latest in the
database (computed, not hardcoded) and accepting `?season=2019-20`. An unknown
season is a 400 listing the ten that exist. Every one of them names the season it
resolved, and every page header displays it. `/api/player/:code/career` is the
exception and spans all of them: it takes no `?season=` and rejects one rather
than ignoring it, and its rows carry the label instead (API identity rule 7).

The client sends `?season=` on `/api/player/:code` only — forwarding the season
bootstrap resolved for "This Season", and the row's own season when a previous
one is expanded. Nothing yet *chooses* a season in the sense a selector would.

`GET /api/bootstrap` runs a ~90ms aggregate per request. No cache and no
materialized view: it is fast enough, and a cache is a second source of truth.

The app now shows the 2025-26 season in full — 841 players, 380 fixtures, 38
gameweeks — instead of the empty current-season history the live API returns
during preseason (2026/27 GW1 deadline is 21 Aug 2026).

**Step 7 split the types, and the JSON changed with it.** Decimals are numbers,
not strings: `expected_goals` is `7.57`, not `"7.57"`. `server/src/types/`
holds `wire.ts` (what upstreams send: strings and season-scoped ids), `domain.ts`
(what the app means: numbers, permanent codes, explicit nulls) and `api.ts` (the
response bodies). The parse happens once, in `server/src/repositories/parse.ts`,
called column by column from each repository's mapper. Nothing in `client/`
calls `parseFloat` any more.

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
│   │   ├── repositories/      # DB query layer — the ONLY place SQL may live
│   │   ├── routes/fpl.ts      # /api/bootstrap, /api/player/:code[/career], /api/fixtures
│   │   ├── services/fplApi.ts # live FPL API client, cache; ingest source only
│   │   └── types/
│   │       ├── wire.ts        # what upstreams send: strings, season-scoped ids
│   │       ├── domain.ts      # what the app means: numbers, codes, real nulls
│   │       └── api.ts         # the response bodies the client consumes
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx            # shell: nav, theme, bootstrap fetch, detail state
│   │   ├── types/fpl.ts       # domain types + UI constants + formatters
│   │   ├── services/api.ts    # frontend fetch wrappers
│   │   ├── lib/
│   │   │   ├── bootstrap.ts   # BootstrapContext, current/next gameweek
│   │   │   └── cn.ts          # class name join
│   │   ├── test/              # harness only — no component lives here
│   │   │   ├── setup.ts       # jest-dom matchers, explicit afterEach(cleanup)
│   │   │   ├── factories.ts   # payload builders, return types annotated
│   │   │   ├── render.tsx     # renderInApp: StrictMode + BootstrapContext
│   │   │   └── render.test.tsx    # proves StrictMode is actually active
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx  # three rankings; each entry opens its player
│   │   │   ├── Dashboard.test.tsx     # the click-through, all three rankings
│   │   │   ├── Players.tsx    # the list: own inline search, sort, expand
│   │   │   ├── Players.test.tsx       # disclosure + sort, by keyboard
│   │   │   ├── Fixtures.tsx   # by gameweek, with difficulty
│   │   │   ├── PlayerDetail.tsx  # header / This Season / Previous Seasons
│   │   │   └── PlayerDetail.test.tsx  # expand, collapse, cache reset
│   │   └── components/
│   │       ├── ui/            # Card, Table, Badge, Switch, Input
│   │       │                  # + DisclosureButton: the one row toggle
│   │       ├── OpenPlayerButton.tsx # a player's name, as a link to their page
│   │       ├── PlayerHeader.tsx
│   │       ├── GameweekFilters.tsx
│   │       ├── GameweekSection.tsx # a season's gameweeks + the 4 empty states
│   │       ├── GameweekSection.test.tsx  # all four, by their wording
│   │       ├── CareerTable.tsx     # one row per season, each expandable
│   │       ├── CareerTable.test.tsx    # the disclosure: Tab, Enter, Space, ARIA
│   │       ├── StatsTable.tsx
│   │       ├── StatsTable.test.tsx # rule 6: null renders —, zero renders 0
│   │       ├── StatsTable.sort.test.tsx  # sorting without a mouse
│   │       ├── PosBadge.tsx   # PosBadge, StatusDot, FDRBadge, PlayerAvatar
│   │       ├── Countdown.tsx
│   │       └── PlayerSearch.tsx  # UNUSED: nothing imports it
│   ├── vite.config.ts         # proxies /api to :3001
│   ├── vitest.config.ts       # jsdom, setupFiles, clearMocks; no react plugin
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

## API Identity Rules

The storage rules above keep season-scoped ids out of the database. These keep
them out of the API. Added in step 6; they are the reason the cutover has a
deliberate breaking change in it. Rules 7 and 8 were added in step 7.

1. **A code is the external contract. A season-scoped FPL id is not.** Anything
   that appears in a URL or in a response body is a permanent code:
   `players.fpl_code` for players, `teams.fpl_team_code` for teams. FPL reassigns
   element ids and team ids every August, so `/api/player/328` would address a
   different footballer each season and every stored URL would rot at rollover
   without erroring. This is rule 2 and rule 5 applied one layer outwards.
2. **The season-scoped ids stay in the ingest layer**, where `player_seasons`
   and `team_seasons` translate them. No repository returns one.
3. **Concretely:** `players[].id` is `fpl_code`; `teams[].id`, `players[].team`
   and `history[].opponent_team` are all `fpl_team_code`;
   `GET /api/player/:code` takes a `fpl_code`. `fixtures[].id` is our own
   surrogate `fixtures.id`, which is permanent and verified stable across
   re-ingest.
4. **Fields with no source in the database are null, not invented.** `form`,
   `selected_by_percent`, `status`, `news`, `chance_of_playing_next_round` and
   `events[].deadline_time` describe the live game and arrive with the bootstrap
   sync. `fixtures[].code` is FPL's permanent fixture code, which was never
   ingested. The keys stay present so the shape does not move.
5. **`photo` and `points_per_game` are derived, because they genuinely are.**
   `photo` is `${fpl_code}.jpg`, which is how FPL builds it.
   `points_per_game` is total points over **matches appeared in**
   (`minutes > 0`), not over rounds — rule 13 requires saying which, and this is
   the one that reproduces FPL's own value. It rounds half-to-even, matching
   FPL's Python; Postgres `numeric` rounds half away from zero and disagreed
   with the live API on ten players before that was fixed.
6. **`is_current` / `is_next` are false on every event.** They describe a live
   season. Over a completed one there is no current gameweek, and nominating the
   last one would be a guess dressed as data.
7. **Every response labels its data with the season that data came from. Which
   level the label sits at depends on whether the response spans seasons.**

   - **One season → a top-level `season`.** `GET /api/bootstrap`,
     `GET /api/player/:code` and `GET /api/fixtures` each return one. It is the
     season `resolveSeason()` actually used, never the one requested — so it
     stays true when the parameter is absent and the default applies, and it
     keeps being true if the defaulting rule changes.
   - **Many seasons → no top-level key, and a `season` on every row.**
     `GET /api/player/:code/career` is the first such response. Its body is
     `{ seasons: [...] }` and each element carries its own `season`, which is
     what a consumer must render against.

   A top-level `season: null` on a career response was considered and rejected.
   Null already means "not measured" everywhere in this codebase (rule 6), and a
   second meaning for it is the ambiguity that rule exists to prevent; it would
   also be constant across every career response, so it would be ceremony rather
   than data. A `seasons: string[]` manifest was rejected for duplicating what
   the rows already carry, and so being able to disagree with them.

   The requirement is unchanged in substance. The database holds ten seasons and
   a payload carrying the wrong one is indistinguishable from the right one at a
   glance: same players, same round numbers, same column names. Without the
   label the only way to place it is to recognise the opponent abbreviations.
   Any consumer showing data from a response must label it with that response's
   own season — which is why the Fixtures page labels itself from the fixtures
   response, the player detail page from the detail response, and each career
   row from itself.
8. **Decimals are numbers on the wire, not strings.** `expected_goals` is
   `7.57`, not `"7.57"`. Postgres returns `numeric` and int8 as text and the FPL
   API sends its decimals quoted; both are parsed once, at the repository
   boundary, by `server/src/repositories/parse.ts`. The parse throws rather than
   coercing, because the two failure modes it replaces were silent: a `as
   number` cast that shipped the string, and a `Number(x) || 0` that would turn
   rule 6's null into a zero.

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

`npm test` runs both suites. The server suite needs the database up and the
three ingest scripts to have been run; the client suite needs neither and can be
run alone with `npm run test:client`.

## What's Built

- [x] Postgres-backed read API through `server/src/repositories/`
- [x] Player list with search, position filter and sortable columns
- [x] Player header card (season, team, position, price, apps, starts, xG, xA, ICT)
- [x] Gameweek-by-gameweek stats table (sortable, all columns, keyed on fixture)
- [x] Filters: gameweek range built from the rounds that exist, home/away
- [x] Averages row in stats table, nulls skipped, denominator stated
- [x] Dashboard, ranked on real aggregates: total points, points per match with
      an appearance floor, ICT index
- [x] Fixtures page with difficulty ratings, by gameweek
- [x] Every page header names the season it is showing
- [x] Career history: one summary row per season on the detail page, each
      expanding into that season's gameweeks
- [x] The eleven columns FPL shows that we used to drop — xGC, tackles, CBI,
      recoveries, defensive contribution, own goals, penalties saved and missed,
      cards, saves — on both the gameweek rows and the season summary
- [x] Four distinct empty states where there was one
- [x] A client test suite: components in jsdom with the API mocked, running
      alongside the server suite under one `npm test`
- [x] Every interactive element reachable by keyboard: the career and Players
      row toggles, and the sortable column headers on both tables
- [x] Click-through from all three Dashboard rankings to a player's detail page

The live FPL API proxy in `services/fplApi.ts` still exists with its 5-minute
cache, but no route calls it: it is the ingestion source for the live season.
`components/PlayerSearch.tsx` is an orphan from the original scaffold — the
Players page has its own inline search and nothing imports it.

## Known Issues

Every entry here is traced to the code before it is trusted. An issue that has
quietly been fixed is worse than no issue list, because the next session plans
around it.

- The five live-only fields (`form`, `selected_by_percent`, `status`, `news`,
  `chance_of_playing_next_round`) are `null` and stay null until a live
  bootstrap sync exists. The UI renders `—` for them. `form` and
  `selected_by_percent` were sortable columns on the Players page and are gone
  rather than shown empty; they come back with the sync. See API identity
  rule 4.
- `client/src/components/PlayerSearch.tsx` is dead: nothing imports it. The
  Players page has its own inline search.
- **The player object on the detail page is a snapshot.** `App.tsx` stores the
  whole `Player` in `detailPlayer` when a row is clicked, so the header card
  keeps rendering the object captured then, while its season label comes from
  the live `bootstrap`. Today that cannot diverge — bootstrap is fetched once at
  mount and never refetched — but a season selector would refetch it and leave a
  card showing one season's totals under another season's label. Observed
  directly by forcing a season change through HMR. The fix is to store the code
  and re-resolve from `bootstrap.players`, and it belongs with the selector.
  Item 3 added a second route in — the Dashboard passes a `Player` the same way
  — so the fix now has two call sites rather than one, and is no more urgent for
  it: both hand over an object from the same `bootstrap.players`.
- **The back link on the detail page says "← Back to players" from every route,
  including the Dashboard.** The behaviour is right: `onBack` clears
  `detailPlayer` and leaves `page` alone, so a player opened from the Dashboard
  returns to the Dashboard — verified in the browser. Only the label is wrong,
  and it was true until item 3, when the Players list stopped being the only way
  in. Left alone deliberately: it is routing copy, and item 3 was already
  carrying two surfaces more than it started with.
- `GameweekHistory` still has no `kickoff_time` or `season`, so a row cannot be
  keyed globally, only within one player-season (`fixture` is enough for that,
  and is what `StatsTable` uses). Nothing needs the wider key yet — the career
  table renders one `StatsTable` per expanded season, so keys never have to be
  unique across seasons.
- **Two of the four empty states cannot be reached from the UI.** "Not in the
  game that season" needs a player the current squad does not contain, and the
  player list only holds players with a `player_seasons` row for the current
  season. "Registered, no rows yet" needs a player-season with no matches, and
  none of the ten seasons has one. Both become reachable with a live season or
  with search across all players; neither is dead code. Since Phase 1 item 2
  both are rendered and asserted by `GameweekSection.test.tsx`, which is what
  "unreachable from the UI" now means — the data conditions are pinned by
  `career.test.ts`, the wording by the client suite.
- **The 2025-26 "This Season" section shows a completed season under a
  present-tense heading.** It is the latest in the database, so it is correct
  and reads oddly. It resolves itself when 2026-27 is ingested.
- `Player` carries no `birth_date` and `Team` no `code`, both of which exist in
  the database. They are not in any response because nothing renders them.
- The UI has a working light/dark toggle, but neither theme is the one in Design
  Decisions: light is cream (`36 22% 95%`), dark is a warm near-black
  (`30 5% 10%`), and the accent is indigo (`228 36% 42%`) rather than
  `#0f0f23`/`#00ff87`. Reconcile the spec with the build before any styling work
  — the decision of which one wins is still open.

## Phase 0, Persistence and Backfill — complete

One session per step, committed between each. Kept as the record of how the data
layer was built and what each step decided.

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
- [x] **6. Repository and cutover.** `server/src/repositories/{seasons,teams,
    players,fixtures}.ts` hold every query; the three routes read Postgres
      through them. Response shapes are unchanged bar the identity changes in
      "API Identity Rules" and the five null live-only fields. Verified with a
      field-by-field diff against responses captured from the live API before
      the swap: no unexplained differences, and on the six players where the
      live bootstrap's carryover totals disagree with ours, FPL's own
      `history_past` backs ours.
- [x] **7. Types split.** `server/src/types/{wire,domain,api}.ts` separate what
      upstreams send from what the app means from what the API returns;
      `server/src/repositories/parse.ts` does the parsing, column by column, in
      each repository's mapper. Decimals became numbers on the wire — the one
      contract change — and `starts` and `appearances` joined the bootstrap
      aggregate. Every response now names its season and every page header
      displays it. Three commits: the visible null fallout, the sort-direction
      and deadline bugs found in the browser, then the split itself.

      The step's stated premise was false and is recorded as such: the client
      never sent an FPL element id to `/api/player/:code`. `fetchPlayerDetail`
      has one call site and the id round-tripped from bootstrap correctly. That
      is now pinned by `server/src/repositories/api-identity.test.ts` rather
      than asserted in prose.

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

### Rounds are not 1..n

Two seasons break the assumption, in opposite directions, and any code deriving
a maximum round from a count is wrong in both:

| Season  | Rounds with fixtures | Highest round | Missing  |
| ------- | -------------------- | ------------- | -------- |
| 2019-20 | 38                   | 47            | 30 to 38 |
| 2022-23 | 37                   | 38            | 7        |

2019-20's Covid suspension emptied rounds 30-38 and replayed them as 39-47;
2022-23 lost round 7 to the postponements after the Queen's death. The eight
other seasons are 38 and 38. `PlayerDetail.tsx` therefore takes the round
numbers from the events themselves rather than counting them.

## Phase 1

Same rule as Phase 0: one item per session, committed between each, and the
section below is the record of what each decided.

- [x] **1. Career history on the player detail page.** Three sections — header
      card, "This Season", "Previous Seasons". The last is
      `GET /api/player/:code/career`, one row per season, and each row expands
      into that season's gameweeks by re-using `GET /api/player/:code?season=X`
      and the same `StatsTable`. Responses are cached per season on the client,
      so collapsing and reopening issues no request.

      **API identity rule 7 was rewritten rather than satisfied.** A career
      spans ten seasons and has no single one to name. `season: null` was
      rejected for overloading null, which means "not measured" everywhere else
      (rule 6); `seasons: string[]` for duplicating what the rows carry. The
      rule now scopes by response: one season means a top-level key, many means
      a key on every row.

      **Two premises in the task were false and the data corrected them.**
      Saka's career is **8** seasons, not 9 — his first is 2018-19, and a ninth
      arrives with 2026-27. And no player-season in the ten has zero gameweek
      rows, so "the season has not started" is unreachable on current data.

      Empty states went from one to **four**, because "no rows" turned out to
      have two causes and only one of them is about time: a player never
      registered for that season (Cresswell has nine seasons and no 2025-26) will
      never fill in, while one the season has not reached yet will. The other two
      are rows that are all zero — Onana's 2025-26 is 38 of them, and the table
      renders — and rows excluded by the filters.

      Two things the columns forced. The club is **denormalised onto the career
      row** (`team_name`, `team_short_name`): a career crosses Middlesbrough,
      Hull, Sunderland and Cardiff, which no single season's team list can name,
      and the summary would print a bare integer on its oldest rows. For the
      same reason in the other direction, `GET /api/player/:code?season=X` now
      returns that season's `teams` — the opponent differs on every gameweek row,
      so denormalising is not an option there.

      At ~30 columns both tables scroll horizontally, so the Season and GW
      columns are pinned left with the expand chevron in the Season cell. The
      nested gameweek table takes `scroll={false}` and shares the outer scroll
      container: `position: sticky` resolves against the nearest scrolling
      ancestor, and its own `overflow-x-auto` would never be narrow enough to
      scroll, so GW would have slid away with everything else.

      One bug found in the browser and not by the tests: the per-season fetch
      was fired **inside a `setExpanded` updater**, and React StrictMode
      double-invokes updaters precisely to surface effects hidden in one — every
      expand issued two requests. Moved out of the updater, with the in-flight
      guard in a ref rather than in state, since a state guard is read from the
      render that scheduled the click and two calls in a tick both see it empty.

- [x] **2. Client-side testing.** The client had no tests, and everything item 1
      added was verified by looking at a browser. Vitest in jsdom, React Testing
      Library, the API mocked at `services/api.ts`. 14 tests in four files; see
      the test inventory in Current State for what each holds. The step added
      one server test and changed no component.

      **Two runners, not one.** The server suite stays on `node:test` against a
      real Postgres. Root `test` is
      `run-s --continue-on-error test:server test:client` so a red server suite
      does not hide the client result — verified by pointing `DATABASE_URL` at a
      dead port: 34 server failures, 14 client passes, exit code 1.

      **The mutation check found what the plan predicted, which changed what the
      test is allowed to claim.** The obvious mutation — move `loadSeason` back
      inside the `setExpanded` updater — does **not** turn the double-fetch test
      red. Measured, all three:

      | Mutation | Result |
      | --- | --- |
      | call moved back inside the updater | green |
      | `inFlight` ref swapped back to state | green |
      | both together — the bug as it happened | **red**, "expected 2 to be 1" |

      The ref writes synchronously before its first `await`, so it absorbs
      StrictMode's second updater invocation on its own. **That does not make
      either half optional, and the comment in `PlayerDetail.tsx` says so.** The
      ref suppresses the symptom; the call sitting outside the updater is what
      makes the code correct, because React does not promise to invoke an
      updater exactly twice and may discard a render entirely — leaving a fetch
      started for a state change that never committed. None of that is
      observable from outside the component, so no test pins it, and "either
      half alone is green" must not be read as "either half alone is fine".

      **`render.test.tsx` tests the harness rather than the app**, because the
      whole `PlayerDetail` suite is worthless if StrictMode is not actually
      active — and it would be worthless silently. It counts a probe
      component's renders: two on mount, two more after a `rerender`. The second
      half is the one that catches a helper that wraps by hand instead of
      through RTL's `wrapper` option, which loses StrictMode on re-render only.

      **The factories carry explicit return-type annotations.** Nothing in this
      suite ever sees a real payload, so they are a second description of the
      wire shape; the annotation is the only thing that fails `tsc` when a field
      is added to `types/fpl.ts` and missed here.

      **No `@vitejs/plugin-react` in the Vitest config.** Its jobs are Fast
      Refresh, which no test wants, and the JSX transform, which Vite already
      does from `tsconfig.json`'s `jsx: "react-jsx"`. Including it printed
      deprecation warnings on every run, because Vitest 4 carries a newer Vite
      than the app builds with.

      **No `user-event`** — `fireEvent.click` covers a `<tr onClick>`, which is
      all this item touches. That is a decision for this item, not a settled
      one: keyboard handling on career rows is where it earns its place.

      The server addition: the career query's bare `sum()` skips nulls, which is
      safe only while a column is measured for a whole season or none of it. A
      column measured for part of one would total that part and render as a
      whole-season figure. `career.test.ts` now asserts it per season and per
      column over all 253,509 rows. It holds today with a real split — tackles
      are full in 2016-17..2018-19 and 2025-26 and zero in the six between — and
      it fails on the first partially ingested season, which is when the
      incremental sync needs to hear about it.

- [x] **3. Keyboard reach and click-through.** Two gaps that were the same
      problem stated twice: the career rows were `<tr onClick>` that no keyboard
      could reach and nothing announced as a disclosure, and the Dashboard's
      three rankings had no click handler at all — not a broken one, none — so
      the career view was reachable only through the Players list.

      **The audit found the defect in two more places**, and the scope grew
      because leaving them would have been worse than a consistent gap. The
      Players row toggle had it identically. And **sortable column headers** had
      it on both the Players list and every `StatsTable` — which is the one that
      settled it, because `StatsTable` renders inside every expanded career row:
      fixing the toggle alone would have let a keyboard user open a season and
      then not sort the table they had just opened. Nested, not parallel. Total:
      four `<tr>`/`<th>` handlers replaced, one focus bug fixed.

      **A real `<button>` inside the cell, never `role="button"` on the row.** A
      button gets Enter, Space, focus order and the right role for free; a
      hand-rolled focusable element scrolls the page on Space unless that is
      suppressed, and the suppression gets written once and omitted at the
      second call site. Confirmed in the browser: Space toggles a season and the
      scroll position does not move.

      **The button wraps the chevron *and* the text, never the chevron alone.**
      An icon-only button has no accessible name — 200 Players rows would
      announce "button" 200 times. Wrapping the season names that button
      "2024-25"; wrapping the player's name names that one "Saka". **No
      `aria-label` anywhere**, so there is nothing that can drift out of
      agreement with what is on screen. The chevron and the sort arrow are
      `aria-hidden` for the same reason.

      **`stopPropagation` lives in `DisclosureButton`, not at the call sites.**
      Both tables keep their row `onClick`, because clicking anywhere on the row
      is how a mouse has always worked here — and dropping it would also have
      broken `PlayerDetail.test.tsx`, which item 2 requires to stay green
      unmodified. Without the guard the button's click bubbles into the row and
      toggles back, netting to closed, which looks exactly like a click that did
      nothing. Pinned by count in two files, and the mutation confirms it:
      removing `stopPropagation` turns four tests red with "expected 1 times,
      but got 2 times".

      **`aria-controls` is emitted only while expanded; `aria-expanded` always.**
      The expanded row exists only when open — rendering every season's panel
      and hiding it would defeat the lazy per-season fetch — and pointing
      `aria-controls` at an id that is not in the document is an ARIA violation:
      a dangling reference is worse than none, because a screen reader following
      it lands nowhere. The test resolves the id through `document.getElementById`
      rather than comparing the attribute against the string that produced it.

      **The browser pass caught a regression the class-level test did not, and
      that is the entry worth reading.** Moving the sort handler onto a button
      meant moving the padding with it, or the mouse target would shrink from a
      padded cell to two or three characters of label on 31 columns. The first
      attempt put `h-10 px-3` on the button and left the `<th>` at `p-0` — and
      the header row **collapsed from 40px to 21px on every sortable table**,
      because the button carried both `h-10` and `h-full`, `h-full` wins in
      Tailwind's cascade, and `height: 100%` then resolved against a cell with
      no height of its own. Every class the test asserted was present. The fix
      is that the **cell owns the height and the button owns the padding**:
      `h-10 px-0` on the `<th>`, `w-full h-full px-3` on the button. Verified by
      a real click 119px to the left of a label, in a `StatsTable` nested inside
      an expanded career row, which sorted the column. The test was rewritten
      against the arrangement that fixed it and now fails if the pair goes back
      on one element — but the lesson stands: asserting classes in jsdom is a
      tripwire, not proof, because jsdom does not lay out.

      **One focus bug fixed**, found by the audit rather than reported: the
      Players search input had a bare `outline-none` with no ring replacement,
      so focus landed in a text field with nothing on screen saying so. The ring
      goes on the bordered wrapper rather than the borderless input, with
      `focus-within` — for a text field it fires with `:focus-visible` anyway,
      since browsers match that on text inputs even when clicked. `FOCUS_RING`
      in `lib/cn.ts` now names the convention the three new controls share; the
      three components that already spelled it out inline keep their copy, since
      retrofitting them is restyling this item did not need.

      **`user-event` is now a client dependency**, as item 2 said it would be:
      `fireEvent` dispatches a synthetic click and cannot tell a `<button>` from
      a `<div onClick>`, which is the entire distinction here.

      **What the Dashboard tests do not cover.** `Dashboard.test.tsx` pins that
      activating a player calls `onOpenDetail` with that player. `App.tsx` is
      what turns that into a detail page and `App.tsx` has no test, so the
      callback firing is not evidence the feature works. Checked in the browser
      instead, all three rankings, each confirmed by the player's name on the
      page that opened. The back link's stale label was found doing it — see
      Known Issues.

## Deferred

The gate used to be "not until Phase 0 is complete". Phase 0 is complete, and
Phase 1 has started, so that sentence would now read as permission to start all
of this, which is the opposite of the intent.

What gates the list now: **each item is picked deliberately, as the subject of a
session, and never drifted into as a side effect of another task.** Nothing here
is a prerequisite for anything already built, so touching one while working on
something else is scope creep rather than progress. Two of them have a real
ordering constraint, marked below.

Also still open, from Known Issues rather than from this list: a live bootstrap
sync, which is what fills the five null fields and makes `form` and ownership
real again.

- **Data view improvements:** fixture difficulty colouring, totals row, per-90 toggle,
  rolling form, multi-player comparison, styling polish.
- **Expected points prediction:** transparent weighted formula, not black-box ML,
  because explainability matters for FPL managers. Requires a backtest harness fitted
  on earlier seasons and evaluated on a held-out one, benchmarked against a trailing
  five-gameweek average and against FPL's own `ep_next`. The historical data it
  needs now exists. **Blocked on nothing; blocks the captaincy model.**
- **A real captaincy model.** The Dashboard ranks by points per match with an
  appearance floor, which is honest but is not a captain pick. A real one needs
  fixture difficulty, minutes risk, form and ownership. **Blocked on the
  expected points work above** — without it there is no per-fixture projection
  to captain on, and the live sync, for form and ownership.
- **LLM scouting reports.**
- **Deploy on karpuz-prod** alongside TechRelative (Docker Compose, Nginx), responsive
  design, README with screenshots.
- **A season selector in the UI.** The API accepts `?season=` on all three
  season-scoped routes and returns any of the ten. The detail page now sends it
  per expanded career row, but nothing lets a user *choose* the season the app
  is showing, so the Players, Dashboard and Fixtures pages are still fixed to
  the latest. Carries the `detailPlayer` snapshot fix in Known Issues with it.

## Design Decisions

- Postgres is the source of truth. The FPL API cannot serve previous seasons at
  gameweek granularity, and current-season data is wiped at rollover.
- Tables first, charts later. Get the data layer right before adding visualisations.
- Dark theme (#0f0f23 background, #00ff87 FPL green accent). See Known Issues, the
  current UI does not match this.

## Working Agreement

- Read this file and `docs/data-profile.md` before starting any task.
- One item per session, from Deferred, chosen deliberately. Commit between them.
- Plan before writing code for anything that ingests or aggregates. That is
  where an agent will confidently produce something that silently drops rows.
- **Verification must not share its derivation with the thing it verifies.** A
  pinned row count computed the same way the ingest computes it proves nothing.
  Add a check from a different direction — 380 fixtures a season from the
  competition format, `SUM(minutes)` against 380 × 2 × 11 × 90, acceptance
  values from `history_past` rather than the CSVs — and report an approximate
  quantity as a band, not a number.
- **Trace a claim to the code before repeating it.** Two entries in Known Issues
  were false when audited in step 7, one of them written by the previous session
  and planned around by the next. An issue list that is not re-checked is worse
  than none.
- End each session by updating the Current State section above so the next
  session starts from truth rather than a stale description.

# Phase 0 — Persistence and Backfill

The record of how the data layer was built and what each of the seven steps
decided. One session per step, committed between each.

Moved verbatim out of `CLAUDE.md` in item 15, for the reason its seven-step list
was always an item record in everything but name: it says what each step chose
and why, which is history rather than a rule. **The rules it produced stayed in
`CLAUDE.md`** — the target schema, the acceptance test, the "rounds are not 1..n"
note and the eighteen Data Layer Rules are all still there, because they are what
the next session has to reason from.

---

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

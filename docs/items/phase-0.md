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


---

## Verification results moved here in the item-15 preamble

Three measurements that `CLAUDE.md` carried inline. They are results rather than
rules — nothing compares against them, and none would change any code if the next
ingest moved them — so under the numbers rule they belong here, with the claim and
a pointer left in place. Each is the evidence for a rule that is still stated in
`CLAUDE.md`.

### `ea_index` is empty, not just present (Data Layer rule 16)

It appears in `merged_gw.csv` for 2016-17 through 2018-19 and is **0 in all
67,936 rows across those three seasons**. That is why it gets no column at all:
storing 0 would assert a measurement nobody took, and storing NULL would leave it
empty in every row it exists in.

`docs/data-profile.md` lists it as present in three seasons with no indication
that it is empty, because the profiler reports column presence, not column
content. This is the case that establishes that caveat.

### The end-of-season snapshot, verified (Data Layer rule 17)

`players_raw.csv` records a January transfer under the player's **new** club for
the whole season row. Checked against the fixtures rather than assumed: for the
**96 players who turned out for two clubs in one season** across 2020-21, 2022-23,
2024-25 and 2025-26, the snapshot's `team_code` matches the club of their
chronologically last appearance in **96 of 96 cases**.

So the snapshot is reliably the *end* state and reliably useless for "which club
was this player at in gameweek N", which is the rule.

### The minutes volume check, observed (acceptance test)

`SUM(minutes)` must land within 1% below 380 × 2 × 11 × 90 = 752,400 per season.
The figure is reported and never pinned to a number, because red cards and
stoppage time make it approximate. **Observed range across the ten CSV seasons:
0.13% to 0.52% below.**

That band is what makes the 1% bound meaningful rather than arbitrary — the
observed spread sits comfortably inside it, so the check has room to catch real
loss without firing on ordinary variation.

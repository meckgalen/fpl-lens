# FPL Lens

## What This Is

A full-stack FPL (Fantasy Premier League) player analytics dashboard. Search any
player, see their gameweek-by-gameweek stats across multiple seasons in one view
with filters.

## Current State

**Phase 0 is complete. All seven steps are done, and the app reads from
Postgres, not the live FPL API.** The raw CSVs for the ten completed seasons are
in `data/raw/` and profiled in `docs/data-profile.md`. Postgres 16 runs in
docker-compose; the schema is `server/migrations/1785550165663_initial-schema.ts`
plus `1785742016477_live-season.ts`, which item 4 added.

**The database holds eleven seasons of registrations and ten of matches, and
those are two different numbers now.** 2016-17 through 2025-26 are complete and
came from the CSV backfill. 2026-27 came from the live FPL API in Phase 1
item 4: clubs, roster, deadlines and the full fixture list, and **not one
`player_gameweeks` row**, because none has been played. Anything that used to
say "the ten seasons" has to pick which of the two it meant — see the constants
in `career.test.ts`, which were one and are now two.

**All seven tables are populated.** Four ingest scripts do it, and a fifth
exists but has never been run — see "the gameweek sync" below. All are
idempotent, run in one transaction, and assert their own results:

| Table              | Rows                  | Populated by                |
| ------------------ | --------------------- | --------------------------- |
| `teams`            | 35                    | `ingest:dimensions` + `ingest:live` |
| `team_seasons`     | 220 (20 per season)   | `ingest:dimensions` + `ingest:live` |
| `players`          | 2690                  | `ingest:dimensions` + `ingest:live` |
| `player_seasons`   | 7902                  | `ingest:dimensions` + `ingest:live` |
| `fixtures`         | 4180 (380 per season) | `ingest:fixtures` + `ingest:live`   |
| `events`           | 38 (2026-27 only)     | `npm run ingest:live`       |
| `player_gameweeks` | 253509                | `npm run ingest:gameweeks`  |

The three CSV scripts must be run in that order. Each asserts its predecessors'
row counts before it starts and fails with a message naming the one to run
first: `ingest:fixtures` needs `team_seasons`, and `ingest:gameweeks` needs
`player_seasons` and `fixtures` to resolve its three season-scoped ids.
`ingest:live` has no ordering constraint — it owns its own season end to end —
and can be run at any time, as often as you like.

**Every one of those preconditions is scoped to the ten CSV seasons**, which
item 4 had to change. They were counts over whole tables (`teams = 34`,
`player_seasons = 7338`), and the moment an eleventh season existed, re-running
any CSV ingest failed on a season it does not own. They were scoped rather than
loosened to `>=`: the numbers are exact because that is what catches a dropped
row, and a bound wide enough to admit a new season is wide enough to admit a
missing match. The pinned figures are unchanged.

**The gameweek sync exists and has not been run.** `npm run ingest:live-gameweeks`
loads match rows for the live season from the official API. Item 5 built and
verified it; **it has never been pointed at 2026-27, because no match has been
played.** `player_gameweeks` therefore still holds exactly the ten CSV seasons,
and the two "no matches recorded / no rows yet" empty states stay until the
first real run — they are gated on that table being empty, so playing the
matches does not clear them and ingesting them does. The first real run also
turns `SEASONS_WITH_GAMEWEEKS` in `career.test.ts` red, on purpose: that is how
the eleventh season announces itself.

**Item 6 checked what is in those 253,509 rows against a second source, and
found holes. Item 7 fixed five columns of them and deliberately left four.**
`npm run verify:history-past` sums every player-season we hold and diffs it
against FPL's `history_past` — 1,915 player-seasons, 27 columns, 51,705 cells.
**1,524 drifts, 1,516 of them with ours lower than FPL's**, and 1,486
attributable to **178 fixtures where a column is 0 on every row of a match that
was played**.

**The hole rule lives in `server/src/ingest/holes.ts` and both gameweek writers
apply it.** A hole is a fixture where a column totals exactly zero across the
22 players who took the field — impossible for `starts` by the laws of the game,
and for the expected family, which accrues to everyone on the pitch from the
first shot faced. Those cells are stored NULL: **152 fixtures, 9,704 rows, all
in 2022-23**, where the upstream scraper began collecting from round 16 and
wrote `0` for the fourteen rounds before. The ICT quartet's 26 fixtures are
still stored as 0 — see Known Issues for why that is a decision rather than an
omission.

**`sum()` alone was not enough, so the season aggregate changed too.** `sum()`
skips NULLs, so NULLing the source would have left a 2022-23 ever-present still
reading 24 starts against a true 38. `measuredSum` in
`server/src/repositories/players.ts` returns NULL unless every contributing row
has a value, on all nine nullable columns. The distinction it draws is
**missing rows versus missing values**: a blank gameweek, a January arrival or a
season still being played all produce *fewer rows*, and summing those is right;
a column NULL on *some of the rows that exist* has no honest total.

**It degrades per player, not per season.** 661 of 778 2022-23 players lose
their `starts` total and 117 keep a real one. Per column too: Enzo Fernández
keeps `starts`, xG, xA and xGC and loses `expected_goal_involvements` alone,
because round 29 is holed on that column only and he played it as a double
gameweek.

**The drift against FPL is unchanged, and that is expected rather than a
disappointment.** `verify:history-past` still reports 1,524 drifts, 1,486
attributed, **38 unexplained** — identical before and after. Its
`fetchOurTotals` keeps a bare `sum()` on purpose: it asks what is *in the rows*
so it can be compared against FPL, and adopting `measuredSum` there would blank
our side of every holed player-season and make the drift vanish without a
stored value having changed. What item 7 buys is that the app no longer *shows*
a part-season figure as a whole-season one.

**Item 8 gave the app a season selector, and with it the ten completed seasons.**
Every page is now reachable on any of the eleven: the selector is a `<select>`
in the sidebar, its state lives in `App.tsx`, and **the selected season is
`bootstrap.season`** — the one the server actually served — rather than a second
piece of state that could disagree with the payload on screen. The list of
seasons rides on the bootstrap response as `seasons: string[]`. Item 8 also
fixed the `detailPlayer` snapshot that had been in Known Issues since item 1,
made `currentGameweek`/`nextGameweek` return null instead of a plausible wrong
answer, and made the last of the four empty states reachable.

`npm test` runs **two suites on two runners**: **77 server tests** and **69
client tests**, all passing. They are counted separately on purpose — two
runners print two summaries, and a combined figure would be maintained by hand
against neither of them.

The root script is `run-s --continue-on-error test:server test:client`, so the
client suite runs even when the server suite is red and the overall exit code is
still non-zero. `npm run test:server` and `npm run test:client` run either
alone. Not `&&`, which would hide the client result behind a database problem,
and not `;`, which reports only the last command's exit code and would let a red
server suite pass silently.

**Server — `node --import tsx --test`, against the populated database.** Seven
files:

- `server/src/ingest/holes.test.ts` — the hole detector, on its own, because it
  is the load-bearing rule in two ingests and a regression in it would otherwise
  surface as a confusing failure somewhere else. Runs against a temp table
  created `LIKE player_gameweeks` inside a rolled-back transaction: `LIKE`
  copies the real types and NOT NULLs so this exercises the actual SQL, and
  copies no foreign keys so a fixture can be invented without a player, a club
  and a match behind it. Covers the 0 shape, the NULL shape (idempotence across
  a re-ingest), the unplayed fixture, per-column independence, season scoping,
  and both sides of the rule-6 boundary.

- `server/src/ingest/live-gameweeks.test.ts` — the gameweek sync, offline. Its
  centrepiece is a **replay**: all 29,757 rows of 2025-26's `merged_gw.csv`
  reshaped into the wire shape and run through the new mapper, then compared
  field for field against what the CSV ingest stored. **29,747 of 29,747 rows
  equivalent, no field mismatches**, with rule 12 removing exactly the ten known
  duplicates. Plus the settled gate in both flag orderings, the partial round,
  idempotency, the ordering trap, the round-less guard, the dedup tiebreak, and
  that a failed request aborts the run.

  **What the replay is evidence of, precisely:** it is an equivalence test
  between two independently written mappers over the same bytes — strong about
  the new code and **silent about the source**. It cannot show that the live
  endpoint agrees with the CSV, because nothing can until a round is played.
  The `history_past` cross-check in the item 5 record is the other half, and the
  two are reported as two results rather than one verdict.

- `server/src/ingest/live-season.test.ts` — the live ingest, offline. Every test
  writes a synthetic season (`2099-00`) inside a `BEGIN … ROLLBACK`, so it
  exercises the real upsert SQL without touching the eleven real seasons and
  without the network. Covers the season derivation, that no stat field crosses
  the boundary, that a second run changes nothing, that `start_cost` is
  write-once, that a departed player keeps his row, that a promoted club matches
  its existing row by code, and that a fixture with no round stores as NULL.

- `server/src/ingest/player-gameweeks.test.ts` — the ingest acceptance suite.
  The nine Saka 2025-26 metrics, Salah 2017-18 and De Bruyne 2019-20 (both
  sourced independently of the CSVs), plus the dedup, double/blank gameweek and
  rule 6 nullability boundaries.
- `server/src/repositories/api-identity.test.ts` — `/api/player/:code` takes an
  `fpl_code`, the id bootstrap hands out is the one that resolves, and no
  season-scoped element id resolves as a code. The identity assertions run
  against the **default** season, which is now the unplayed one; the round trip
  that checks a history sums to the totals beside it runs against the latest
  season **with matches**, because over an unplayed season it would compare zero
  to zero and pass without reading a row.
- `server/src/repositories/wire-types.test.ts` — decimals arrive as numbers and
  unmeasured stats arrive as null, on the aggregate and on the gameweek rows.
- `server/src/repositories/career.test.ts` — the career query. Season set and
  order, the nine acceptance values, the summary cross-checked against the
  gameweek rows it claims to sum, the nullability matrix across every season on
  one player, and the three shapes an empty season takes.

  **The `sum()` property test was replaced in item 7, not amended, and what it
  was right about is worth keeping.** It asserted that every nullable column is
  measured for a whole season or for none of it — the condition under which a
  bare `sum()` was safe, and a real property that really did hold. What it could
  not see is the shape the defect actually took: a column stored as `0` is fully
  "measured" by `count()`, so it passed on a 2022-23 that was short by fourteen
  rounds. The one case it existed to catch, arriving in the one form it was
  blind to.

  Item 7 made the old assertion false by design and removed the property it
  protected in the same stroke. So the claim is now the other one: **the
  aggregate returns NULL exactly when the column is partly measured.** Derived
  from the fixtures rather than from `measuredSum`'s own expression — a
  player-season is partly measured precisely when the player appeared in a holed
  fixture — with named anchors at Maguire (null), Enzo Fernández (18) and Saka
  2025-26 (25, unchanged).

  **It holds two season lists now, `ALL_SEASONS` (eleven) and
  `SEASONS_WITH_GAMEWEEKS` (ten), and the split was the subtlest thing in
  item 4.** They were one constant, `ALL_TEN`, used for two different questions:
  the seasons a career spans (`player_seasons`) and the seasons present in
  `player_gameweeks`. Those were the same list until 2026-27 and are not any
  more. Editing the single constant to eleven would have turned the `sum()`
  property test red with a message about a missing season, which reads exactly
  like a broken ingest. They are named for what they mean rather than for how
  many they hold, so the next August does not repeat it.

**Client — Vitest in jsdom, no database.** Components are rendered and the API
is mocked at `services/api.ts`, not at `fetch`: mocking the transport would
additionally pin URL shapes and `res.ok` handling, which the server suite
already covers. `@testing-library/user-event` drives anything involving a
keyboard — `fireEvent` dispatches a synthetic click and so cannot tell a
`<button>` from a `<div onClick>`, which is the entire distinction item 3 turns
on. Thirteen files:

- `client/src/App.test.tsx` — the shell, and **the first test `App.tsx` has ever
  had**. That absence is why item 3 could only pin the Dashboard's half of the
  click-through contract, and the `detailPlayer` fix cannot be tested anywhere
  else: it is a bug about which object the shell hands down. Twelve tests: the
  selector's options and their order, refetching with the new season, the app
  *not* blanking mid-switch, persistence of the **served** season, recovery from
  a stored season the database does not have, a network failure *not* being
  treated as one, the sidebar deadline block in both directions, the header and
  gameweeks agreeing across a season change, the no-false-empty-state window,
  and the not-in-the-game state.

  It does **not** use `renderInApp`: that helper supplies a `BootstrapContext`,
  which is precisely what is under test here. StrictMode is applied by hand for
  the reason `render.tsx` gives.

- `client/src/pages/Fixtures.test.tsx` — six tests, and the page's first. The
  centrepiece is the **round collision**: two seasons that both end at round 38
  produce the same derived round, so an effect keyed on it alone cannot see a
  season change. Plus that the season is sent at all, that fixtures clear while
  the new ones load, that the tab choice survives, and that a season with
  nothing played still names a results round — which is a bug item 8 introduced
  and caught in the browser, not a hypothetical.

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
- `client/src/pages/Dashboard.preseason.test.tsx` — the three rankings with
  nothing to rank. The load-bearing assertion is the **negative** one: the
  message must not promise Gameweek 1. See item 4 for the window in which that
  promise is false.
- `client/src/pages/PlayerDetail.upcoming.test.tsx` — the Upcoming strip: five
  of the remaining fixtures, the opponent read off the correct side of
  `is_home`, a difficulty per fixture, and **nothing at all** when the list is
  empty, which is every completed season.
- `client/src/components/PlayerHeader.test.tsx` — the photo URL built from
  `photo`, and the `onError` fallback to the placeholder, which is the common
  case for a newly published roster rather than an edge one.

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
season is a 400 listing the eleven that exist.

**`GET /api/bootstrap` also returns `seasons: string[]`** — every season that
exists, newest first, which is what the selector offers. It rides on the
bootstrap rather than on a route of its own because that is already the one
request the app blocks on at mount, and because arriving on the same payload as
`season` means "which season this is" and "which seasons exist" cannot disagree.
It is deliberately **not** on `/api/player/:code` or `/api/fixtures`: only the
selector needs it, and the same constant on three payloads is three things that
can drift. See API identity rule 7 for why a manifest is right here when item 1
refused one on `/career`.

**`GET /api/player/:code/career` also returns a `player` identity block** —
`{ id, web_name, first_name, second_name, photo }`, the season-independent half.
It replaced that route's `playerExists` call rather than adding a query, and it
is what lets the detail page name a player for a season he was not in the game
for, where no player-season exists to name him from.

**The default follows the data, and since item 4 that means a season nobody has
played yet.** The reasoning is written out beside `latestSeason()` in
`server/src/repositories/seasons.ts`, which is where the next person will hit
it. In short: the app is about the season being played, the pages that aggregate
over `player_gameweeks` render explicit empty states rather than tables of
zeroes, and the alternative — defaulting to the newest season with match data —
would make the season everyone is actually playing invisible. Every one of them
names the season it resolved, and every page header displays it.
`/api/player/:code/career` is the exception and spans all of them: it takes no
`?season=` and rejects one rather than ignoring it, and its rows carry the label
instead (API identity rule 7).

**Item 8 removed the "no selector yet" half of that argument without changing
the conclusion.** The completed seasons are one click away now, so defaulting to
2026-27 no longer hides anything — it just decides what the app opens on, which
is still the season being played.

The client sends `?season=` on all three season-scoped routes. `App.tsx` sends
it on the bootstrap; `Fixtures.tsx` sends it with the round, which it must,
because that page derives its round from the *selected* season's events and a
request without a season would ask the *default* season for it; and the detail
page sends the season bootstrap resolved for "This Season", or the row's own
season when a previous one is expanded.

`GET /api/bootstrap` runs its aggregate per request. No cache and no
materialized view: it is fast enough, and a cache is a second source of truth.

**The cost depends on the season, and the recorded figure used to name neither.**
"~90ms" described a *completed* season while the actual default, 2026-27, has no
match rows at all. Item 8 is where the distinction started to matter, because a
selector lets a user put the app on the expensive season deliberately. Measured
end to end — request to last byte, medians of 11 warm runs — which is what a
user actually waits for, rather than the query time alone:

| Season  | `/api/bootstrap` | Payload | Players |
| ------- | ---------------- | ------- | ------- |
| 2026-27 | **27 ms**        | 296 KB  | 564     |
| 2019-20 | 75 ms            | 356 KB  | 666     |
| 2022-23 | 91 ms            | 414 KB  | 778     |
| 2025-26 | **117 ms**       | 441 KB  | 841     |

For comparison, item 7 measured `listPlayerTotals` alone at 9ms for 2026-27 and
99ms for 2025-26; the difference is serialisation and transfer, which the query
figure does not include. The worst case is a season change to 2025-26 at ~117ms,
which is why the shell keeps the previous bootstrap mounted rather than blanking
— see item 8.

The app defaults to **2026-27**: 564 players, 20 clubs, 380 unplayed fixtures
and 38 real deadlines, with GW1 locking 21 Aug 2026 at 17:30Z. 2025-26 remains
complete and reachable at `?season=2025-26` and through every career table.

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

**The bootstrap carries no season label anywhere**, so `ingest:live` derives it
from the earliest gameweek deadline: a deadline in August 2026 means `2026-27`.
Any deadline from January onward belongs to the season that opened the previous
August, which cannot arise on a full 38-event payload and costs one comparison
to be right about if it ever does.

**A pre-season bootstrap serves LAST season's totals on every element.** At the
time of writing Saka's element carries minutes 2218, points 157 and starts 25 —
his 2025-26 figures exactly — and 400 of the 564 elements carry nonzero stats
the same way. This is the single biggest hazard in the live path: ingesting them
produces a new season that looks completely plausible and is a copy of the old
one. `ingest:live` reads structural fields only, and both the ingest's own
assertions and two tests in `live-season.test.ts` exist to keep it that way.

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

**That is not an abstract limitation, and item 5 ran into it head on.** The
obvious verification for the gameweek sync — point it at 2025-26 and diff the
result against the stored rows — is impossible: `element-summary/{id}/history`
returns `[]` today, because it serves only the current season and 2026-27 has
not started. Every verification in item 5 is shaped by that fact.

**Which endpoint the gameweek sync reads, and why:**

- **`element-summary/{element_id}/`** — one request per player, and its
  `history[]` is one entry per fixture with the full stat set. That is the shape
  of `player_gameweeks`, a double gameweek included, which is what rule 13
  exists for. This is the one used.
- **`event/{gw}/live/`** — one request per *round* rather than per player, so
  far cheaper. Not used, because **its shape cannot be verified until a round is
  played**: before Gameweek 1 it returns `{"elements": []}`, so whether its
  `stats` are per fixture or aggregated per round is unknowable, and adopting an
  unverified shape for the table rule 13 protects is not a risk worth taking.
  The cross-check that settles it is in Deferred.

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
│   │   │   ├── gameweek-columns.ts    # the column list BOTH gameweek writers use
│   │   │   ├── sync-fixtures.ts       # the fixtures writer, two callers
│   │   │   ├── ingest-live-season.ts  # the live season: npm run ingest:live
│   │   │   ├── live-season.test.ts    # offline, in a rolled-back transaction
│   │   │   ├── ingest-live-gameweeks.ts  # match rows: ingest:live-gameweeks
│   │   │   └── live-gameweeks.test.ts # the 2025-26 replay + the gate
│   │   ├── repositories/      # DB query layer — the ONLY place SQL may live
│   │   ├── routes/fpl.ts      # /api/bootstrap, /api/player/:code[/career], /api/fixtures
│   │   ├── services/fplApi.ts # live FPL API client, cache; ingest source only
│   │   ├── verify/            # read-only cross-checks against other pipelines
│   │   │   └── history-past-check.ts  # npm run verify:history-past
│   │   └── types/
│   │       ├── wire.ts        # what upstreams send: strings, season-scoped ids
│   │       ├── domain.ts      # what the app means: numbers, codes, real nulls
│   │       └── api.ts         # the response bodies the client consumes
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx            # shell: nav, theme, SEASON SELECTOR, detail code
│   │   ├── App.test.tsx       # the selector, persistence, the detailPlayer fix
│   │   ├── types/fpl.ts       # domain types + UI constants + formatters
│   │   ├── services/api.ts    # fetch wrappers + ApiError (status, available)
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
│   │   │   ├── Dashboard.preseason.test.tsx  # the three empty rankings
│   │   │   ├── Players.tsx    # the list: own inline search, sort, expand
│   │   │   ├── Players.test.tsx       # disclosure + sort, by keyboard
│   │   │   ├── Fixtures.tsx   # by gameweek, with difficulty
│   │   │   ├── Fixtures.test.tsx      # the round collision across a season change
│   │   │   ├── PlayerDetail.tsx  # header / Upcoming / This Season / Previous
│   │   │   ├── PlayerDetail.test.tsx  # expand, collapse, cache reset
│   │   │   └── PlayerDetail.upcoming.test.tsx  # the remaining fixtures strip
│   │   └── components/
│   │       ├── ui/            # Card, Table, Badge, Switch, Input
│   │       │                  # + DisclosureButton: the one row toggle
│   │       ├── OpenPlayerButton.tsx # a player's name, as a link to their page
│   │       ├── PlayerHeader.tsx     # + the hot-linked player photo
│   │       ├── PlayerHeader.test.tsx  # the photo URL and its fallback
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

   **The boundary is not always a season, and one case proves it.** 2022-23
   carries `starts` and the expected family in its header from round 1 and its
   *values* from **round 16**; the scraper wrote `0` for the fourteen rounds
   before. `docs/data-profile.md` is right and unhelpful here, because it reports
   column presence rather than column content — the same caveat rule 16 records
   for `ea_index`. So the rule is applied per **fixture** as well as per season:
   `server/src/ingest/holes.ts` finds fixtures where a column totals zero across
   all 22 players who took the field, which is impossible for `starts` by the
   laws of the game, and stores NULL. Both gameweek writers apply it.

   **A partly measured column has no total, which is the same rule one layer
   up.** `sum()` skips NULLs, so a season aggregate would happily report the
   fourteen-round-short figure as a whole-season one. `measuredSum` in
   `repositories/players.ts` returns NULL unless every contributing row has a
   value — distinguishing **missing rows** (a blank gameweek, a January arrival,
   a season in progress: sum them) from **missing values** (no honest total
   exists).
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
   `selected_by_percent`, `status`, `news` and `chance_of_playing_next_round`
   describe the live game and are still null on every season — item 4 ingested
   the season's *structure*, not its per-sync snapshot; see Deferred, "live
   field sync". `fixtures[].code` is FPL's permanent fixture code, which was
   never ingested. The keys stay present so the shape does not move.

   `events[].deadline_time` was on this list and has come off it. It has a
   source now — the `events` table, filled by `ingest:live` — and is a real
   timestamp for 2026-27. It is still null for the ten CSV seasons, which have
   no `events` rows, because the historical files do not carry deadlines.
5. **`photo` and `points_per_game` are derived, because they genuinely are.**
   `photo` is `${fpl_code}.jpg`, which is how FPL builds it.
   `points_per_game` is total points over **matches appeared in**
   (`minutes > 0`), not over rounds — rule 13 requires saying which, and this is
   the one that reproduces FPL's own value. It rounds half-to-even, matching
   FPL's Python; Postgres `numeric` rounds half away from zero and disagreed
   with the live API on ten players before that was fixed.
6. **`is_current` / `is_next` are derived from the deadline and the clock, never
   stored.** Rewritten in item 4, which gave the app a live season and so made
   the old wording — "false on every event" — false itself. The reason it was
   false is kept, because nine of the eleven seasons are still completed and
   still report both as false.

   The definitions, which the rule has to state because they are not
   self-evident:

   - **`is_next`** is the earliest gameweek whose deadline is still in the
     future.
   - **`is_current`** is the latest gameweek whose deadline has passed.

   Before the first deadline of a season there is **no current gameweek at
   all**, which is the correct answer for a pre-season and is the state the app
   is in today.

   Derived rather than stored, and that is the substance of the rule. FPL
   publishes its own `is_current`/`is_next` on every bootstrap, and storing them
   would make them a snapshot: right at sync time and wrong an hour later, with
   nothing on screen to say which. Computed against `now()` they cannot go
   stale between syncs.

   **A season with no deadlines has both false on every round, by
   construction.** The ten CSV-backfilled seasons have no `events` rows, so the
   LEFT JOIN yields NULL and both comparisons are false — which is exactly the
   behaviour the original rule described, now arrived at from the data instead
   of from a hardcoded `false` in the route. Over a completed season there is
   still no current gameweek, and nominating the last one would still be a guess
   dressed as data.

   Known consequence, recorded rather than fixed: once 2026-27 finishes, its
   GW38 stays `is_current` until 2027-28 is ingested, because its deadline
   remains the latest one that has passed. That is the right answer at every
   other moment of a season's life, and the wrong-looking one only in the weeks
   between a season ending and the next being loaded.
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

   **Item 8 then put a `seasons: string[]` on the bootstrap response, and that
   is not a reversal of the sentence above.** What was refused on `/career` was
   a manifest *beside rows that each already name a season* — eleven copies of
   the same facts, free to drift apart. A bootstrap response is one season
   throughout: nothing in it answers "which others exist", so there is nothing
   for the field to duplicate and nothing for it to contradict. The two
   decisions turn on the same property, which is why they land differently.

   It is on the bootstrap **only**. `PlayerDetailResponse` and `FixturesResponse`
   do not carry it, deliberately: only the selector needs the list, the selector
   lives in the shell, and the shell is driven by bootstrap. Three copies of one
   constant is three things that can drift, which is the objection that killed
   the career manifest in the first place.

   The ordering is `listSeasons`'s, newest first, and **no consumer re-sorts**.
   Rule 8's TEXT format sorts correctly as text, so one ordering suffices and a
   second opinion would eventually disagree about something neither end states.

   The requirement is unchanged in substance. The database holds eleven seasons
   — all of them one click away since item 8, which raises the stakes rather
   than lowering them — and
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

`npm run ingest:live` loads the current season from the live FPL API. It is
safe to run at any time and as often as you like — the transfer window means it
is meant to be — and it reports whether anything actually changed:

```
Season 2026-27: teams=20 players=564 events=38 fixtures=380
No change: every table this ingest writes is byte-identical to before the run.
```

`npm run ingest:live-gameweeks` loads the live season's match rows. It has no
ordering constraint either — it refreshes fixture state itself before reading it
— and is safe to run mid-round: fixtures that have settled are ingested, ones
still in play are skipped, and a later run picks them up without touching what
is already there.

`npm run verify:history-past` diffs every player-season we hold against FPL's
`history_past` totals and prints where the two disagree, what the disagreement
is attributable to, and in which direction. **Read-only** — it never writes to
the database. It caches the 564 API responses under `data/raw/` so a re-run
costs nothing; `--refresh` re-fetches. It exits non-zero when a scoring column
disagrees, which it does today: see the 2022-23 `starts` entry in Known Issues.

**Item 7 did not change what it reports, and that is the expected result.** It
sums the stored rows with a bare `sum()`, which skips NULLs — so turning a holed
`0` into a NULL leaves every total identical, and the run still reports 1,524
drifts with 38 unexplained. Its detector is shared with the ingest
(`findHoles`), but called with all **nine** detectable columns rather than the
five the ingest fixes, so the ICT quartet nothing NULLs keeps its attribution.

`npm test` runs both suites. The server suite needs the database up and the
three CSV ingest scripts to have been run; the client suite needs neither and
can be run alone with `npm run test:client`.

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
- [x] The live season, ingested from the official API: clubs, roster, deadlines
      and fixtures for 2026-27, re-runnable through the transfer window
- [x] Real gameweek deadlines, and a countdown that counts down to one
- [x] Pre-season empty states on the three Dashboard rankings, worded from the
      data rather than the calendar
- [x] Upcoming fixtures on the detail page, with difficulty — populated for the
      first time, every previous season having been complete
- [x] The player's photograph on the header card, with a placeholder fallback
- [x] The incremental gameweek sync — **written and verified, not yet run**, so
      no 2026-27 match rows exist and the two empty states remain
- [x] A read-only cross-check of all ten seasons against FPL's own totals,
      which found 178 fixtures where the CSVs hold 0 for a column nobody
      measured
- [x] NULL rather than 0 where the source holed a column — 152 fixtures of
      2022-23 across `starts` and the expected family, applied by both gameweek
      writers; and a season aggregate that returns no total for a column
      measured on only part of a season
- [x] A season selector: all eleven seasons on every page, persisted, and
      validated by the server rather than by a second copy of its rule
- [x] The detail page survives a season change — header, gameweeks and career
      row all naming the same season, and a name-and-photo header for a season
      the player was not in the game for
- [x] `currentGameweek`/`nextGameweek` return null instead of a plausible wrong
      answer, so no completed season announces a played round as upcoming

The live FPL API proxy in `services/fplApi.ts` still exists with its 5-minute
cache, but no route calls it: it is the ingestion source for the live season.
`components/PlayerSearch.tsx` is an orphan from the original scaffold — the
Players page has its own inline search and nothing imports it.

## Known Issues

Every entry here is traced to the code before it is trusted. An issue that has
quietly been fixed is worse than no issue list, because the next session plans
around it.

- The five live-only fields (`form`, `selected_by_percent`, `status`, `news`,
  `chance_of_playing_next_round`) are `null` on every season, 2026-27 included,
  and the UI renders `—` for them. Every player on the Players list shows status
  "Unknown". **Item 4 did not fix this and was not meant to**: it ingests a
  season's *structure* — who is registered, for which club, at what price, on
  what schedule — and those five are a *snapshot* of the live game that is
  different every hour. Storing them needs somewhere to put a value that is
  never true for long, which is the "live field sync" item in Deferred. `form`
  and `selected_by_percent` were sortable columns on the Players page and are
  gone rather than shown empty. See API identity rule 4.
- `client/src/components/PlayerSearch.tsx` is dead: nothing imports it. The
  Players page has its own inline search.
- **RESOLVED in item 8: the player object on the detail page was a snapshot.**
  `App.tsx` stored the whole `Player` in `detailPlayer` when a row was clicked,
  so the header card kept rendering the object captured then while its season
  label came from the live `bootstrap`. Inert while nothing could change the
  season; a real defect the moment a selector existed. It now stores
  `detailCode` and re-resolves from `bootstrap.players` on every render, exactly
  as the entry predicted. Pinned by `App.test.tsx`, which is the first test
  `App.tsx` has had — and the mutation confirms it: reverting to a captured
  `Player` turns two tests red.
- **The Fixtures page labels a completed season's last round "Upcoming".**
  **Deferred, not blocked — the fix is one conditional and the information is
  already in hand.**

  On any of the ten completed seasons the two tabs read "GW38 Upcoming" and
  "GW38 Results" and show **the same ten matches**, one with difficulty ratings
  and one with scores. Pre-dates item 8 — true of every completed season since
  Phase 0 — but the selector changed the cost: it is now one click away on every
  page, on ten of the eleven seasons, rather than behind a hand-edited URL.

  The derivation is right and is named for what it is (`upcomingRound`, with
  `nextGameweek` now correctly returning null): a season with nothing upcoming
  still has a last round worth showing. It is the tab *wording* that asserts
  something the data does not.

  **The fix, stated because it is small.** `nextGameweek` returns null exactly
  when nothing is upcoming, and `Fixtures.tsx:19` already binds `next` — in
  scope at both label sites (`:86`, `:93`), which use `upcomingRound` and ignore
  it. So when `next` is null the tab is naming a round that does not exist as an
  upcoming one, and the label should say so rather than claim otherwise. One
  conditional on a value the page already holds; not a new capability, and in
  particular **not** the "does the page know whether a season is in progress"
  problem an earlier draft of this entry claimed it was — item 8 made that
  question answerable and this page already asks it.

  Left alone because item 8 was already carrying two surfaces more than it
  started with, and picking the replacement wording is a copy decision that
  wants doing deliberately rather than at the end of an unrelated item.

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
- **All four empty states are now reachable from the UI**, down from two
  unreachable at item 1 and one at item 4. "Not in the game that season" was the
  last, and item 8's selector is what reached it: choose a season the open
  player has no `player_seasons` row for and that is the state, with the header
  degraded to name and photo. Confirmed in the browser on Haaland in 2016-17 and
  De Bruyne in 2026-27, not inferred.

  "Registered, no rows yet" became real the day 2026-27 was ingested and is
  what every 2026-27 player's "This Season" section shows — confirmed in the
  browser, not inferred.

  **The state is a fact about the data, not about the date**: a
  `player_seasons` row exists and no `player_gameweeks` row does. Playing the
  matches does not end it; **ingesting** them does. So it stays reachable past
  21 Aug 2026 and until the incremental gameweek sync writes 2026-27's first
  match rows — a later item with no date on it. If that gap runs a month, this
  is what the page shows for a month into a season that has started.

  Which is the correction the Dashboard's "No matches recorded" wording already
  got, made here for the same reason: a calendar claim standing in for a data
  one is wrong in exactly the window between a season starting and its data
  landing.

  "Not in the game that season" is still unreachable: it needs a player the
  current squad does not contain, and the player list only holds players with a
  `player_seasons` row for the default season. Search across all players would
  reach it. Both remain rendered and asserted by `GameweekSection.test.tsx`.
- **We hold NULL for `defensive_contribution` in 2024-25 where FPL reports a
  real number, on 290 player-seasons — every reachable player in the season.**
  Item 5 measured it on 44 of a 60-player sample; item 6 ran the check over all
  348 reachable 2024-25 players and the figure is 290, up to 455 for one player
  with a median of 116. FPL retro-computed that aggregate for 2024-25 without
  publishing its components — `tackles`, `clearances_blocks_interceptions` and
  `recoveries` are all 0 there — and the CSVs carry no such column before
  2025-26. **It cannot be backfilled**: `history_past` gives season totals and
  there is no per-gameweek source, so distributing 455 across a season's matches
  would be invention. It is a real gap in what we hold rather than a rule 6
  artefact, and it will matter to anything that ranks on defensive contribution
  across seasons. It is the only gap of its kind: no column outside the
  defensive quartet has a single cell where we hold NULL and FPL holds a number.

- **RESOLVED for five columns in item 7; the ICT quartet is the entry below.**
  Whole rounds were missing from four columns of 2022-23 and from the ICT family
  in three seasons, stored as `0` rather than NULL. Measured in item 6, fixed in
  item 7 for `starts` and the expected family. Kept here as the record of what
  was found and where each half went.

  | Season  | Rounds                | Columns holed                                     | Fixtures | Now |
  | ------- | --------------------- | ------------------------------------------------- | -------- | --- |
  | 2022-23 | 1-6, 8-15             | `starts`, `expected_goals`, `expected_assists`, `expected_goal_involvements`, `expected_goals_conceded` | 136 | **NULL** |
  | 2022-23 | 29                    | `expected_goal_involvements` alone                | 16       | **NULL** |
  | 2022-23 | 16, 33, 38            | influence, creativity, threat, `ict_index`        | 15       | still 0 |
  | 2021-22 | 38                    | influence, creativity, threat, `ict_index`        | 10       | still 0 |
  | 2019-20 | 21                    | influence, creativity, threat, `ict_index`        | 1        | still 0 |

  The 2022-23 block is the upstream scraper starting to collect those five
  columns at round 16 and writing `0` for the fourteen rounds before, which is
  rule 6 violated at source. The single-round ICT holes are final-round or
  single-match scrapes that ran before FPL published.

  **What the old entry said the consequence was, and what it is now.** A
  2022-23 ever-present showed 24 starts against a real 38. It now shows the
  no-value marker, on the career table and the header card alike, for the 661 of
  778 players who played through the hole — and a real number for the 117 who
  did not. The per-match rows show `—` rather than `0.00` for xG, xA, xGI and
  xGC on rounds 1-15, switching to `0.00` at round 16, which is the source's own
  boundary made visible.

  **We still disagree with FPL by exactly as much as before, and that is
  correct.** `sum()` skips NULLs either way, so `verify:history-past` reports the
  same 1,524 drifts and the same 38 unexplained. What changed is that the app no
  longer presents a fourteen-round-short figure as a season total.

- **A sort on 2022-23 `starts` or the expected family would rank backwards. No
  such sort exists today, which is the only reason this costs nothing.** The
  players who lose their total are exactly the ones who played through rounds
  1-15 — the regulars — so they get NULL while the fringe players who arrived in
  January keep a real number. The column looks populated and orders the season's
  most-started players last or nowhere. Predicted in the Deferred entry before
  item 7 and now a real property of the data rather than a hypothetical.

  Traced rather than assumed, and re-traced in item 8 because the line numbers
  moved: the Dashboard ranks on total points (`Dashboard.tsx:82`), points per
  match with an appearance floor (`:93`) and ICT index (`:99`) — none affected,
  ICT being the quartet item 7 left alone. The Players list has no `starts`
  column and `CareerTable` has no sorting at all. It becomes real the day a
  per-90 toggle or a `starts` column lands, both of which are on the Deferred
  list, and whichever lands first owns deciding how a NULL sorts.

  **Item 8 raised the odds of someone meeting it**, without changing any of the
  above: 2022-23 used to be reachable only by hand-editing a URL, and is now one
  click away on every page.

- **26 fixtures still store 0 for the ICT quartet where nobody measured it, and
  this is a defect left in place with a reason rather than an open question.**
  `influence`, `creativity`, `threat` and `ict_index` are holed on 2022-23
  rounds 16, 33 and 38, 2021-22 round 38, and 2019-20 round 21 — 1,939 cells.
  Item 7 fixed the other five columns and stopped here deliberately.

  **Magnitude, measured in item 7 rather than borrowed.** The holed ICT cells
  drift from FPL by a median of **2.9% to 6.8%** depending on season and column
  — printed by `verify:history-past`'s attribution-split table, which item 7
  added because item 6 reported only a combined figure. (The 0.6-2.0% in the
  entry below are the medians of the 38 *unexplained* cells and are a different
  population; do not reuse them for this.) The expected family in 2022-23 drifts
  by **36.1% to 38.6%** on the same measure. An order of magnitude apart, and
  that gap is the argument.

  **Why representing it would cost more than the defect.** These holes are whole
  rounds, and round 38 is every club — so `measuredSum` would blank the ICT
  total for **every player in 2021-22 (737 of 737) and 2022-23 (778 of 778)**,
  plus 55 in 2019-20, to correct an error of one round in thirty-eight.
  Destroying 1,515 player-season totals to repair a ~3-7% discrepancy is the
  wrong trade. It would also need a migration: the four columns are `NOT NULL`
  in `initial-schema.ts`, an invariant that holds on all 253,509 rows but these,
  and dropping it is permanent and inherited by every future writer. Four
  domain/API/client type changes and the Dashboard's ICT sort follow from that.

  **What a real fix looks like, so this reads as declined rather than
  dismissed.** Blanking is the wrong instrument for one missing round in
  thirty-eight. The right one is a total that renders *with a marker saying a
  round is missing* — the number, kept, plus an honest annotation. That is a UI
  affordance nothing in the app has today, and it is named in Deferred.

  Detection is unaffected: `verify:history-past` calls `findHoles` with all nine
  detectable columns, not the five the ingest fixes, so these 26 fixtures keep
  their attribution.

- **The residue after that: 38 disagreements out of 51,705 cells compared, and
  they are genuinely unexplained.** 14 in 2019-20 and 14 in 2023-24 on the ICT
  family (median 0.6% and 2.0%), 9 in 2024-25 over four players, 1 in 2018-19.
  Maguire's 2024-25 ICT is among them — creativity 101.2 against FPL's 111.5,
  influence 409.4 against 411.4, threat 233 against 237, with all 38 rows
  present and no blank appearance to attribute it to. What item 5 could not
  establish for one player is now established for 1,486 of 1,524 drifts and
  still open for these.

  **Four of the 38 are in scoring columns, which nothing else in this project
  should be able to move.** Ferguson 2024-25 is 17 minutes, 1 point and 2 goals
  conceded short across a season where he has all 38 rows and no duplicate
  fixture; code 80201 is 3 minutes short in 2018-19. Both were traced to the
  CSV, which holds our exact figures, so it is upstream staleness rather than
  anything the ingest did.

- **`history_past` does not carry the pre-2019 defensive columns, and reports 0
  rather than omitting them.** We hold real `tackles`,
  `clearances_blocks_interceptions` and `recoveries` from the old Opta feed for
  2016-17 through 2018-19 — up to 391 recoveries in a season — and FPL reports
  zero for every one of them. It is the 2024-25 `defensive_contribution` gap
  pointing the other way, it costs us nothing, and it matters only because it
  means **the cross-check cannot verify those three columns for those three
  seasons**: there is nothing on the other side to compare them to.
- `Player` carries no `birth_date` and `Team` no `code`, both of which exist in
  the database. They are not in any response because nothing renders them.
- The UI has a working light/dark toggle, but neither theme is the one in Design
  Decisions: light is cream (`36 22% 95%`), dark is a warm near-black
  (`30 5% 10%`), and the accent is indigo (`228 36% 42%`) rather than
  `#0f0f23`/`#00ff87`. Reconcile the spec with the build before any styling work
  — the decision of which one wins is still open.
- **The Players list shows the 2026-27 roster with zero in every stat column**,
  which is honest and is not what the page is for. The recorded intent is a
  labelled split — this season's price and ownership beside the last completed
  season's totals, each saying which it is, deliberately unlike FPL's own site,
  which shows carryover totals under a "this season" heading. That was left out
  of item 4 on purpose and is a named item in Deferred: ownership has no storage
  yet, and the totals need a cross-season aggregate on the list query. Both are
  features, and item 4 was an ingest.

  **Item 8 made it survivable rather than fixing it.** Last season's real totals
  are now two clicks away instead of unreachable, so the zeros are no longer the
  only thing the app can show. The labelled split is still the right answer and
  still open.
- **After 2026-27 finishes, its GW38 will stay `is_current` until 2027-28 is
  ingested**, because `is_current` is the latest gameweek whose deadline has
  passed (API identity rule 6). Right at every other moment of a season; wrong
  only in the gap between one season ending and the next being loaded.
- **A postponed fixture disappears from the Fixtures page, which shows nine
  matches in a round of ten and gives no sign anything is missing.** Corrected
  in item 5 — the previous wording here said such a fixture "reaches the client
  with `event: null`", which was written from a plan rather than traced to the
  code and is wrong. `Fixtures.tsx` always calls `fetchFixtures(targetGw)`, so
  `listFixtures` filters `f.gw = $2` and a round-less fixture never reaches the
  page at all; `formatDay` already renders `'TBD'` for a null kickoff. The page
  looks complete and is not, which is the quiet-wrong-answer class this project
  keeps refusing to ship.

  `fixtures.gw` is nullable by design — the initial migration says so — because
  FPL leaves `event` empty on an unscheduled fixture and nulls it on a
  postponement until a new round is assigned. `listEvents` filters
  `gw IS NOT NULL`, so such a fixture can neither invent a round nor remove one
  that others still populate.

  **Why the obvious detection does not work:** a round holding fewer than ten
  fixtures is not a signal, because a genuine blank gameweek is exactly that and
  is entirely normal. The only signal is the *existence* of a round-less fixture
  in the season, so any fix has to look for those rather than count per round.

  **The consequential failure is not the missing tab**, and item 5 closed that
  half: match rows attached to a round-less fixture would sit in no gameweek at
  all, invisible to every per-round query. The gameweek sync refuses to write
  them and says why, with a test. Unreachable today either way — all 380 of
  2026-27's fixtures carry a round.
- **`end_cost` for 2026-27 is NULL and nothing will fill it until the season is
  over and the CSV backfill runs for it.** That is correct — a season in
  progress has not ended at a price — and the career row renders `Price` as
  `start → end`, so 2026-27 reads `£15.5 → —`.

  **That consequence is visible now, and the old wording said it was not.** The
  entry claimed it "cannot be seen today", on the grounds that the detail page
  files the default season under "This Season" and only *previous* seasons reach
  the career table, so it would take a newer season being ingested. Item 8's
  selector reaches it without one: select any earlier season and 2026-27 becomes
  a previous season on every career table. Observed on Haaland's, reading
  `£15.5 → —`.

  Showing `start → now` instead was considered and rejected: the column says
  "end", and a season that has not ended did not end at today's price.

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
                  start_cost, now_cost, end_cost, UNIQUE(season, fpl_element_id))
events           (season, gw, deadline_time timestamptz, PK(season, gw))
fixtures         (id, season, fpl_fixture_id, gw, home_team_id, away_team_id,
                  kickoff_time, finished, finished_provisional, home_score,
                  away_score, home_difficulty, away_difficulty,
                  UNIQUE(season, fpl_fixture_id))
player_gameweeks (player_id, season, gw, fixture_id, was_home, opponent_team_id,
                  <stat columns>, UNIQUE(player_id, fixture_id))
```

Index `player_gameweeks` on `(player_id, season)` and on `(season, gw)`. The unique
constraints make re-ingestion idempotent, which matters because these scripts will be
run many times.

**The three price columns are three different facts and item 4 is where that
started to matter.** `start_cost` is what the season opened at, written once.
`end_cost` is what it closed at, and stays NULL while a season is in progress
(rule 6 — a season that has not ended has not ended at a price). `now_cost` is
the price at the last sync, refreshed on every run of `ingest:live`, and is
**NULL on all ten completed seasons and deliberately never backfilled**:
duplicating one fact into two columns with nothing keeping them equal is the
failure this schema avoids everywhere else. NULL there means "that season is
over, ask `end_cost`", so `COALESCE(now_cost, end_cost)` reads correctly on
every row without the caller knowing which season it is looking at. That is what
`listPlayerTotals` does, and it is what finally makes its `AS now_cost` alias
true — it had been reading `end_cost` since step 6.

**`finished` and `finished_provisional` are two flags, and "settled" is the
conjunction.** FPL flips them at different moments — one at roughly full time,
the other once the round's bonus is confirmed — and **which is which cannot be
established from any season available today**: both are `True` on all 380 rows
of completed 2025-26 and `false` on all 380 of unplayed 2026-27, so only a match
in progress distinguishes them. The gameweek sync gates on the conjunction,
which is true only once both have fired — the later of the two under either
ordering — so it is right without needing the fact. **One cheap observation on
22 August settles it**: hit `/api/fixtures/` during a live match and record both
flags for a match in play and one that has just ended.

In SQL that test is **`finished AND COALESCE(finished_provisional, true)`**,
never the bare conjunction, and `SETTLED_SQL` in `sync-fixtures.ts` is the one
place it is written. `finished AND NULL` is NULL rather than false, so the bare
form silently excludes 2016-17 and 2017-18 — which have no `fixtures.csv` and
therefore no provisional flag — from anything asking whether a match had
settled, the exact opposite of the rule that NULL there means settled. Checked
when it was added: nothing else in the codebase tests settledness, so nothing
needed changing. The one to watch is `listEvents`'s `bool_and(f.finished)` —
folding the new column into it without the COALESCE would return `finished:
NULL` on every event of those two seasons, against a domain type that says
`boolean`.

`events` holds only deadlines. **Which rounds exist still comes from
`fixtures`**, and `listEvents` LEFT JOINs `events` onto that rather than the
other way round. Two independent lists of which rounds exist is a disagreement
waiting to happen, and the fixture-derived one is the one that has been right
about 2019-20 running to 47 and 2022-23 skipping round 7.

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

- [x] **4. The 2026-27 season, from the live API.** `ingest:live` loads clubs,
      roster, deadlines and the full fixture list from
      `bootstrap-static` and `fixtures`, into the same six tables the CSV
      backfill writes, plus a new `events` table. It writes **no**
      `player_gameweeks` rows. Verified twice over: the ingest asserts the whole
      season totals zero points through the same query the player list runs, and
      two tests build the rows from payloads that differ only in their stats and
      require the output to be identical.

      **The trap this item is mostly built around.** A pre-season bootstrap
      serves LAST season's totals on every element — Saka's read 2218 minutes,
      157 points, 25 starts, which are his 2025-26 acceptance values exactly, and
      400 of 564 elements carried nonzero stats. An ingest that took them would
      produce a 2026-27 that looks entirely plausible and is a copy of 2025-26.
      Nothing about it would look wrong.

      **The default season decision, which had to be made before anything was
      ingested.** `latestSeason()` is computed, so the moment 2026-27 had rows it
      became the default and every aggregate page pointed at a season with no
      matches. The default was kept following the data, and the pages were given
      honest empty states instead — reasoning in full beside `latestSeason()`.
      The alternative, defaulting to the newest season *with matches*, would have
      left the season everybody is playing invisible: there is no season selector
      yet, so it would have been reachable only as a career row filed under
      "Previous Seasons".

      **The Dashboard's wording is about the data, not the calendar**, and that
      distinction is the item's one non-obvious piece of UI. "No matches recorded
      for 2026-27 yet" is gated on every player having zero appearances — which
      is what the three rankings are computed from — and not on the date. The two
      come apart in a window this plan creates deliberately: GW1 is played on 21
      August, the incremental sync is a later item, and in between every player
      has zero appearances while Gameweek 1 is over. "Rankings start after
      Gameweek 1" would then be promising something that had already happened.
      It is item 1's empty-state distinction in the other direction, and the test
      asserts the absence of the wrong wording, not just the presence of the
      right one.

      **Two upsert rules that point opposite ways, stated together because they
      are easy to swap.** `start_cost` is written once, on insert, and is
      `now_cost - cost_change_start` rather than `now_cost` — the two are equal
      only while prices have not moved, and a first run made after GW1 would
      otherwise freeze the wrong number permanently, there being no second
      chance to write it. `deadline_time` is upserted on every run, because FPL
      moves deadlines and a write-once deadline counts down to a time that has
      passed.

      **Nothing is ever deleted.** A player sold in August simply stops appearing
      in the bootstrap; his `player_seasons` row stays. It records a registration
      that really happened, he may already have gameweek rows whose career row
      would otherwise vanish while the matches remained, and the feed that no
      longer mentions him cannot put him back.

      **Two writers, one column, and the flip-flop that found it.** `teams` and
      `players` began with `DO UPDATE` on names, and the result was that Hull
      became "Hull City" and Ipswich "Ipswich Town" on every live run and
      reverted on every `ingest:dimensions` — a stored value depending on which
      script ran last. It turned `career.test.ts` red, which is how it was found
      rather than shipped. Both are now `DO NOTHING`: new clubs and new players
      are inserted whole, existing rows are left alone. The tie is broken toward
      the source that is written once per season rather than re-read constantly.
      Cost, accepted: a name or birth date arriving on the live feed for a player
      already stored waits for the next CSV refresh.

      **Four preconditions in the CSV ingests had to be re-scoped**, and they
      would have failed loudly rather than quietly — `ingest:fixtures` did fail,
      on `team_seasons has 220 rows, expected 200`, which is how the fourth was
      found. All are now scoped to the ten CSV seasons rather than relaxed to a
      lower bound, so every pinned number is unchanged and still catches loss.

      **`ALL_TEN` had to become two constants first.** It answered "every season
      a career spans" and "every season with match rows" with one list, and those
      diverged the day this landed. Splitting it before touching either test is
      what stopped the `sum()` property test failing with a message that reads
      like a broken ingest.

      **Named additions, not scope that drifted in:** the Upcoming fixtures strip
      on the detail page (the payload has carried `fixtures` since step 6 and
      nothing rendered it, because it is empty for every completed season), and
      the header-card photograph. The photo URL was verified against the live
      host rather than recalled — `photo` is `{code}.jpg`, the asset is
      `.../photos/players/250x250/p{code}.png` — and the `onError` fallback is
      required rather than polish: five of the six newest 2026-27 codes had no
      photograph, and those are the players people look up in August. Confirmed
      in the browser on Burrowes, who renders the placeholder.

      **Verification.** `npm test`: 48 server, 51 client, both green. `tsc
      --noEmit` clean in both packages. `ingest:live` run twice, the second
      reporting "No change: every table this ingest writes is byte-identical".
      All three CSV ingests re-run green with the eleventh season present. The
      `sum()` property test passes because 2026-27 contributes no
      `player_gameweeks` group at all.

      **An independent check, from a different pipeline:** the ingest reads
      `/api/fixtures/`; the check reads `/api/element-summary/{id}/`, a different
      endpoint with a different shape, and compares one club's 38 matches on
      round, opponent and side. **0 mismatches.** The ingest's own assertions are
      likewise derived from the competition format rather than from the feed's
      counts: 20 clubs, 38 matches each, 19 home and 19 away. The per-round check
      — 10 fixtures, each club once — is commented as **publication-time only**,
      true of a freshly released schedule and false of a season in progress, as
      2022-23's missing round 7 and 2019-20's 39-47 already prove in this
      database.

      **Mutation-checked, measured, not assumed:**

      | Mutation | Result |
      | --- | --- |
      | `start_cost` added to the `DO UPDATE SET` clause | **red**, 1 test |
      | a stat field reaches a built row | **red**, 3 tests |
      | fixtures deleted and reinserted instead of upserted | **red**, 1 test |
      | players missing from the feed pruned | **red**, 1 test |
      | Dashboard wording changed to promise Gameweek 1 | **red**, 2 tests |
      | Dashboard gated on the calendar instead of appearances | **red**, 1 test |
      | photo `onError` fallback removed | **red**, 1 test |
      | upcoming opponent read off the wrong side of `is_home` | **red**, 1 test |

      **The browser pass, and what actually ends it.** A 2026-27 player's detail
      page renders "Data will appear here once the 2026-27 season is underway."
      from real data — the "registered, no rows yet" state item 1 wrote and
      could not reach. The task framed this as a check that could not be repeated
      after 21 Aug 2026, and the data says otherwise: the state is a
      `player_seasons` row with no `player_gameweeks` rows, so what ends it is
      the **incremental sync writing the first match rows**, not the matches
      being played. It survives the season starting and lasts as long as that
      item takes. The same page shows the
      Upcoming strip populated for the first time (`next 5 of 38 left to play`:
      GW1 COV (H) 2, GW2 AVL (A) 4, GW3 CHE (H) 4, GW4 SUN (A) 3, GW5 BHA (A) 3)
      and the photograph. The Dashboard shows all three rankings empty with the
      deadline counting down; the Fixtures page shows GW1's ten matches across
      21-24 August with both promoted clubs (HUL, COV) resolved. Price reads
      £9.5 from `now_cost`, which is the COALESCE working — `end_cost` is NULL.

- [x] **5. The incremental gameweek sync.** `ingest:live-gameweeks` loads match
      rows for the live season from `element-summary/{element_id}/`.
      **Written and verified; never run against 2026-27**, because no match has
      been played. The two "no matches recorded / no rows yet" empty states stay
      until it is, and `SEASONS_WITH_GAMEWEEKS` stays at ten.

      **The verification the task asked for was impossible, and that is the
      first finding.** Replaying the sync against 2025-26 and diffing needs the
      API to serve a previous season at gameweek granularity, and it does not:
      `element-summary/12/` returns `history: []` today. `history_past` carries
      eight seasons as totals and never per fixture. That is the same property
      that made the CSV backfill necessary, met from the other direction.

      **So verification is two results, deliberately never merged into one.**

      1. **The replay: 29,747 of 29,747 rows equivalent, no field mismatches.**
         All 29,757 rows of 2025-26's `merged_gw.csv` reshaped into the wire
         shape and run through the new mapper, compared column by column against
         what the CSV ingest stored; rule 12 removed exactly the ten known
         duplicates. **The reshape was written from `types/wire.ts` and the CSV
         header, never from the mapper** — otherwise it compares two copies of
         one belief. That is licensed by a three-way column comparison done
         before any of it was written: 11 columns the table stores were missing
         from `WireGameweekHistory` and were added; 15 exist in neither and are
         the Opta-era stats the live sync writes NULL for (rule 6); **0 wire
         fields lacked a CSV column**; and the 9 remaining CSV columns are
         upstream's own additions, every one already in `EXCLUDED_CSV_COLUMNS`.
         26 + 11 = 37 and 46 − 9 = 37, so nothing needed a default.

         What it proves: an equivalence between two independently written
         mappers over the same bytes. What it cannot prove: that the live
         endpoint agrees with the CSV. Nothing can, until a round is played.

      2. **The independent cross-check: 60 of 60 players match on all 27
         columns** for 2025-26, against `history_past` — a different pipeline.
         Sampling was adversarial rather than convenient: 15 per position, at
         most 4 per club, force-including a player who changed club mid-season
         (King), one with a double gameweek (Forster) and one registered all
         season who never played (Heaton). **Stated bias:** `history_past` only
         exists for players still in the game, so of 2025-26's 841 players
         **457 are reachable and 384 are not**.

      **The defensive-contribution divergence is real and it is a 2024-25
      problem, now measured.** The same check run over 2024-25 gives **16 of 60**
      — **44 of 60 players** have a non-zero `defensive_contribution` in
      `history_past` where we hold NULL, up to 356 for Tarkowski. FPL
      retro-computed that aggregate for 2024-25 without exposing its components;
      the CSVs have no such column before 2025-26, and no per-gameweek source
      for it exists, so it cannot be backfilled — season totals cannot be
      distributed across matches. Recorded in Known Issues with the number
      rather than fixed. **A second, smaller finding from the same run:** one
      player of the sixty (Maguire) disagrees on the ICT family in 2024-25
      (creativity 101.2 against 111.5, influence 409.4 against 411.4). He has all
      38 rows and his points and minutes agree, so it is not row loss; the cause
      is not established, and it is 2024-25 CSV data rather than anything this
      item wrote.

      **The settled gate is the conjunction of two flags**, because which of
      `finished` and `finished_provisional` flips first cannot be established
      from a completed season (both true) or a pre-season one (both false). See
      the schema section. It needed a column: `finished_provisional` was stored
      nowhere. The migration does not backfill, so `ingest:fixtures` was re-run
      and the result reported from the run rather than predicted — 380 non-null
      for each season from 2018-19, 0 for the two derived ones.

      **Three inherited pre-season assertions were replaced, not two.** The task
      named the per-round fixture count and the "no gameweek rows" check; the
      audit found a third, the carryover tripwire that asserts every player's
      totals are zero, which is correct before any match and false after one.
      All three are now **gated on the data**: the publication check runs only
      while the season has no finished fixture, and the other two only while it
      has no match rows. The "no rows" check became **"this ingest did not
      change the count"**, measured across the write — which was always the
      claim, and holds in every season state.

      **`syncFixtures()` has two callers now.** The gameweek sync refreshes
      fixture state itself rather than declaring `ingest:live` a prerequisite:
      every 2026-27 fixture is `finished: false` from item 4's load, so a sync
      that read the stored flags would write **zero rows after Gameweek 1,
      correctly, for a reason nothing on screen explains**. Item 4's claim that
      `ingest:live` has no ordering constraint still holds; what changed is that
      it no longer owns the live season's fixtures alone. The trap has a test:
      with the stored flags left stale, the sync must still ingest.

      **Four unscoped assertions in `ingest-gameweeks.ts` plus its test's
      precondition were scoped before they could break** — the same class item 4
      hit, found this time by reading rather than by a red run. Fourteen queries
      now carry `season = ANY($1)`. One of them needed an explicit empty
      parameter list, because it is scoped by a literal season and Postgres
      rejects a parameter a statement has no placeholder for.

      **The `sum()` property test was traced against a partial season rather
      than left for September, and it holds**: a season ingested round by round
      is partial in its *rows*, not its columns, so `count(col)` equals
      `count(*)` for the modern columns and 0 for the fifteen Opta-era ones. It
      fires only if FPL starts supplying a column mid-season, which is what it
      was written to catch.

      **Mutation-checked. Three came back green and were fixed rather than
      written up as covered:**

      | Mutation | Result |
      | --- | --- |
      | settled gate removed | **red**, 3 tests |
      | gate weakened to `finished` alone | **red**, 1 test |
      | round-less guard removed | **red**, 1 test |
      | fixtures refreshed *after* the build | **red**, 1 test |
      | dedup tiebreak reversed | **green** → test added → **red** |
      | `gw` read from the fixture, not the payload | **green** → test added → **red** |
      | a failed request swallowed | **green** → made injectable, test added → **red** |

      The three greens are the interesting ones. The dedup tiebreak is
      unobservable in 2025-26 — rule 12 says why: its ten duplicates are
      byte-identical, and the season where the choice matters (2019-20's
      postponed fixture) predates the columns the wire type needs, so it cannot
      be replayed. A synthetic pair that differs now pins it. The round source is
      unobservable too: the payload's `round` equals the fixture's `gw` in all
      253,509 stored rows. What *is* observable is the consequence — reading the
      payload and asserting against the fixture makes a disagreement **stop the
      run**, while reading the fixture makes the row agree with itself and
      absorbs it silently — so that is what the test pins. And the fetch path had
      no test at all because it needs the network, so `fetchAllHistories` now
      takes an injectable fetcher and a stub proves one failure aborts the run.

- [x] **6. The `history_past` cross-check, run wide.** `npm run
      verify:history-past` sums `player_gameweeks` per player-season and diffs
      it against FPL's `element-summary/{id}/history_past` — a different
      pipeline from the vaastav CSVs, and the only prior-season data the
      official API exposes. Read-only. Item 5 ran this by hand over 60 players
      in two seasons; this runs it over **every reachable player in all ten**:
      1,915 player-seasons, 27 columns, **51,705 cells**.

      **What it found, which is the point of the item.** The 38 unexplained
      cells at the end are the interesting number, and everything else is the
      work of getting there. Full write-ups in Known Issues; the shape:

      | | Cells |
      | --- | --- |
      | agreed absent (rule 6: ours NULL, theirs 0) | 8,000 |
      | gaps (ours NULL, theirs a number) | 290 |
      | disagreements | 1,915 |
      | — within the rounding envelope | 391 |
      | — drift, attributed to a hole in the source | 1,486 |
      | — drift, unexplained | **38** |

      **Drift direction is 1,516 low against 8 high**, which is the finding that
      pointed at the cause. Revision goes both ways; loss only goes down. The
      manual sample that opened the item found eleven drifts, all low, and asked
      for direction to be measured because nothing did — this is what it
      measured.

      **The buckets were the hypothesis, and the run falsified them.** Drift was
      predicted to be confined to the non-scoring derived columns, on the
      grounds that FPL can recompute the ICT and expected families freely while
      bonus points are awarded from BPS and cannot be revised without altering
      settled scores. 148 `starts` cells in 2022-23 and 4 others say otherwise
      — **and every one of the 148 is attributable to the same whole-round hole
      in the source, not to a revision.** So the underlying claim survives what
      the literal test rejected, and both are reported rather than the
      convenient one.

      Note that `starts` awards no points either, so its place in the scoring
      bucket is arguable. It does not matter to the conclusion: the cause is a
      hole under either classification.

      **Attribution is what turns "there is drift" into a cause, and it is two
      detectors, both derived from the competition rather than from the data.**
      A **blank fixture** is one where a column totals exactly zero across the
      22 players who took the field — impossible for `starts` (eleven a side by
      the laws of the game), for the ICT family (which scores nearly every
      action) and for `expected_goals_conceded` (which accrues to everyone on
      the pitch). That accounts for 1,441 drifts. A **blank row** is the same
      signal per appearance — 60 minutes or more registering zero influence AND
      zero creativity AND zero threat — and accounts for 45 more. The second is
      strong rather than certain, and the report prints the baseline that says
      how strong: 2 to 6 such rows in a clean season out of ~7,900, against 214
      in 2021-22 and 311 in 2022-23.

      **Only nine columns can be checked that way**, and the limit is stated in
      the code rather than left implied: a 0-0 with no cards and no own goals is
      an ordinary Tuesday, so a hole in a sparse column is undetectable by this
      method. The attribution can never be wider than that list.

      **One assertion came free and passes:** every played fixture in all ten
      seasons totals either 0 starts or exactly 22. Where the column is
      populated at all it is right, which is what separates "a hole in a column"
      from "a row missing from a fixture".

      **A third category the item had to invent.** Ours-measured against
      theirs-0 was landing in the drift count as 592 cells of "ours is higher",
      which read as a discrepancy and is not one: `history_past` simply does not
      carry `tackles`, `clearances_blocks_interceptions` or `recoveries` for
      2016-17..2018-19. It is now reported separately as the 2024-25
      `defensive_contribution` gap pointing the other way.

      **The rounding envelope, and why the run reports both sides of it.** Our
      totals are sums of per-match values the CSV already rounded, so a total can
      differ from FPL's by accumulated rounding with neither side wrong.
      Anything within `matches x halfUlp` is reported as within rounding and kept
      out of the drift count — 391 cells — and the count is printed rather than
      absorbed, so the choice of envelope is visible instead of load-bearing and
      silent.

      **Coverage is the check's one structural bias and it is reported per
      season.** `history_past` is served off an element, and an element exists
      only for a player still in this season's game, so reach runs from **39 of
      683 (5.7%) in 2016-17 to 457 of 841 (54.3%) in 2025-26**. Against that:
      **no reachable player-season for which FPL reports minutes is missing from
      our rows**, in any season.

      Responses are cached under `data/raw/` so a re-run costs nothing;
      `--refresh` re-fetches all 564 elements at concurrency 5.

- [x] **7. Store NULL where the source holed a column.** Item 6 measured the
      holes and changed nothing. This writes NULL for five of the nine
      detectable columns and stops the season aggregate summing a partly
      measured one. **152 fixtures, 9,704 rows, all in 2022-23.** Row count
      unchanged at 253,509.

      **The rule lives in `server/src/ingest/holes.ts`, once**, and both
      gameweek writers call it: the CSV ingest against the staging table between
      `assertStage` and `insertFromStage`, so the real table never holds the
      zeros even transiently; the live sync against `player_gameweeks` scoped to
      its season, after the write and inside the same transaction. One SQL
      implementation rather than a SQL one and a JS one.

      **Three conditions, each load-bearing, and the third is the subtle one.**
      The match was played (`sum(minutes) > 0`); the column totals 0 across the
      fixture **or** is NULL on every row of it; and the column holds a value
      somewhere else in that season. The second makes the rule idempotent — after
      a re-ingest the holes are NULL, and a detector that knew only the 0 shape
      would stop seeing what it had just fixed, silently, because `sum(col) = 0`
      over an all-NULL column is NULL rather than false. The third is what
      separates a hole from rule 6: without it, `starts` being NULL throughout
      2016-17 flags every fixture in three seasons.

      **That third clause is `count(col) > 0`, not `sum(col) > 0`, and the plan
      had it the other way round.** The plan predicted a blind spot — that a
      hole in round 1 of a live season would be undetectable, there being no
      later round to compare against — and asked for it to be documented as
      correct behaviour. It does not arise. The two formulations are identical
      across all ten CSV seasons, so the backfill cannot decide between them;
      they differ only where every stored value of a column is 0, which is
      exactly a live GW1. `count()` calls that measured, flags the fixtures and
      reports them, so the zeros never land. That is right because the premise
      holds in round 1 as in round 20: a played match totalling zero starts is
      not a football result, and no later round makes it more so. `holes.test.ts`
      asserts both sides of the boundary.

      **The aggregate: `measuredSum` on nine columns, two constants, two call
      sites.** NULL unless `count(col) = count(fixture_id)`. `count(fixture_id)`
      rather than `count(*)` because both callers LEFT JOIN, and a player-season
      with no rows null-extends to one. The distinction it draws is **missing
      rows versus missing values** — the first is a blank gameweek or a January
      arrival and sums correctly, the second has no honest total.

      **The ICT quartet was excluded, on proportion.** Full reasoning in Known
      Issues; the measured numbers are ICT holes drifting **2.9-6.8%** against
      FPL versus the expected family's **36.1-38.6%**, and blanking would cost
      every player in 2021-22 and 2022-23 their ICT total plus a migration to
      drop `NOT NULL` on four columns. Item 6's 0.6-2.0% figures are the
      *unexplained* cells and were not reused; the split-by-attribution table
      `verify:history-past` now prints exists to measure this properly.

      **The verify script had to change in the same session or the run would
      have looked catastrophic.** Its blank-fixture detector used `sum(col) = 0`,
      which stops matching once the holes are NULL — `blanks` empties, every
      drift falls through to `unexplained`, and the report flips from 38 to
      ~1,524 for no reason connected to the data. It now calls `findHoles` with
      all **nine** detectable columns rather than the five the ingest fixes,
      because the ICT quartet is attributed through the same map and nothing
      NULLs it. `fetchOurTotals` keeps its bare `sum()` deliberately, and its
      comment now says why it no longer mirrors the app's arithmetic.

      **Two premises in the plan were false and the data corrected them.** The
      round-1 blind spot above, and the claim that pointing the check at the
      narrow column set would turn "~1,900 explained cells into unexplained
      ones" — measured, it is **38 → 146**. The blank-*row* detector
      independently catches most of the ICT family, which is precisely why the
      mutation is worth pinning: the regression is real and does not announce
      itself.

      **The property test was replaced rather than adjusted** — see the
      `career.test.ts` entry in Current State for what the old form was right
      about and why its expectation could not simply be edited.

      **Verification.** `npm test`: **77 server, 51 client**, both green.
      `tsc --noEmit` clean in both packages. `ingest:gameweeks` re-run green:
      253,509 rows, 152 fixtures holed, 8,491 NULL cells per column and 9,704
      for `expected_goal_involvements`, all in 2022-23 and none in any other
      season. `verify:history-past` **unchanged**: 1,915 disagreements, 1,524
      drift, 1,486 attributed, **38 unexplained**, 1,516 low / 8 high.

      **Bootstrap cost, measured because CLAUDE.md pins one.** `listPlayerTotals`
      medians over 10 runs, warm: **2026-27 9ms before and after; 2025-26 98ms
      before, 99ms after.** The nine `count(col)` calls are over columns the
      `sum()` already scans, so they are effectively free and the no-cache
      decision is untouched. Worth noting separately that the recorded "~90ms
      per request" describes a *completed* season — the actual default is
      2026-27, which has no match rows and runs in 9ms.

      **Browser.** Maguire's 2022-23 career row reads `—` for Starts, xG, xA,
      xGI and xGC while 2023-24 keeps real numbers and ICT stays 25.2. Expanding
      it shows the boundary directly: those four columns read `—` for rounds
      1-15 and `0.00` from round 16, in the same column of the same table.
      Enzo Fernández's 2022-23 row keeps Starts 18, xG 0.78, xA 2.64 and xGC
      24.91 and loses `expected_goal_involvements` alone — round 29 is holed on
      that column only, and he played it as a double gameweek. Per player and
      per column, on one row.

      **Mutation-checked, measured:**

      | Mutation | Result |
      | --- | --- |
      | measured-elsewhere clause dropped | **red**, 2 tests |
      | detector knows only the 0 shape | **red**, 1 test |
      | `sum(minutes) > 0` gate dropped | **red**, 1 test |
      | aggregate back to a bare `sum()` | **red**, 5 tests |
      | verify called with the five, not the nine | **red**, 38 → 146 unexplained |

- [x] **8. A season selector.** All eleven seasons on every page. The API has
      accepted `?season=` since Phase 0 and nothing sent it except the detail
      page; now `App.tsx` owns the choice, and the ten completed seasons stopped
      being unreachable.

      **The selected season is `bootstrap.season`, not a fourth piece of state.**
      `App.tsx` holds `requested`, which is only ever *the season of a request in
      flight*; what the app is showing is whatever the server actually served.
      A second "current season" variable could disagree with the payload beside
      it, which is the class of bug API identity rule 7 exists to prevent. The
      selector's `value` is `requested ?? bootstrap.season`, so a pick shows
      immediately and then reconciles.

      **The app is never blanked mid-switch.** `if (!bootstrap) return
      <Loading/>` now fires on the first load only; a season change keeps the
      previous bootstrap mounted and swaps atomically, so during the transition
      every page shows the old season's data under the old season's label —
      internally consistent, which is the property that matters. `<main>` takes
      `aria-busy` and dims. The selector is **not** disabled while switching:
      disabling a focused control moves focus to `<body>`, the class of
      regression item 3 existed to remove.

      **The seasons list rides on the bootstrap, and the chicken-and-egg in that
      is the item's sharpest corner.** The list of valid seasons arrives *on* the
      bootstrap response, so a persisted season can only be validated by asking
      for it — and an invalid one 400s before any list comes back. Both halves
      of the fix are needed: `api.ts` now parses the failure into an `ApiError`
      carrying `status` and `available`, which is what distinguishes "unknown
      season" from "the network is down"; and on a 400 the client drops the
      stored value and **retries with no parameter**, letting `resolveSeason`
      pick the default. It does not read `available[0]` and call that the
      default — that would put a second copy of `latestSeason()`'s rule in the
      client, free to drift. Not hypothetical: it is what a fresh clone or a
      rebuilt container does. Verified in the browser with a stored `'2099-00'`.

      **What resets on a season change, and what deliberately does not.** The
      open player (a *code* now, so it re-resolves), the page and the theme
      survive. The Fixtures page clears its rows; the Players list closes its
      open row (a permanent code, but the player may have no row in the new
      season); `PlayerDetail` resets the round range. The Players list's search,
      position filter and sort are **kept** — every one is a choice over columns
      that exist in all eleven seasons, and resetting them would discard the
      user's intent for nothing.

      **`PlayerDetail`'s one effect became two, and that is what makes the rest
      work.** The career keys on the player alone, because it is
      season-independent; the season's gameweeks key on both. `loading` belongs
      to the career effect only, so a season change no longer blanks a header and
      a career table that are still valid. Two consequences beyond the saved
      request: `registeredIn` answers correctly the instant the season swaps, and
      the identity survives the change — which is what names a player who has no
      player-season in the newly selected one.

      **Keeping the per-season cache across a season change opened a window that
      had to be closed in the same stroke.** The cache is keyed by season and the
      player has not changed, so everything in it is still true — but the newly
      selected season is simply *absent* from it, `history` is `[]`, and
      `registeredIn` is true because the career does contain that season. So
      `GameweekSection` was handed "no rows, registered" and printed **"Data will
      appear here once the 2025-26 season is underway"** about a season that
      finished in May. The loading-versus-empty version of the
      calendar-versus-data mistake this project keeps refusing to ship.

      `GameweekSection` cannot fix it: it receives a `history` array, and an
      empty one is indistinguishable from an absent one from there. So "This
      Season" gates on the cache entry existing and renders a loading line
      instead — the **same** line the career table's expanded rows have always
      drawn, hoisted into one `SeasonLoading` rather than invented twice.

      **`currentGameweek` and `nextGameweek` return null now, fixed rather than
      worked around.** Both ended in a fallback chain that answered "which round
      is coming" with the last played round, so every completed season rendered
      "GW38 / Deadline / TBD" in the sidebar — a round played in May announced as
      upcoming. True since Phase 0 and invisible because the app showed one
      season. Hiding the sidebar block would have left the function lying for the
      next caller. **`currentGameweek` was a named addition**: identical defect,
      and fixing one twin and leaving the other is what the next reader trips on.

      The gate everywhere is **"there is no next gameweek"**, never "the season is
      complete". They coincide today and stop coinciding on 21 August 2026, when
      2026-27 has a next gameweek and is not complete. The fallbacks the helpers
      lost reappear in `Fixtures.tsx` under names that say what they are, because
      *which round to show* is a display decision and *which round is next* is
      not.

      **A bug this item introduced, found in the browser and not by a test.**
      Making `resultsRound` strictly "the last finished round" left it undefined
      on a season where nothing has been played: the effect returned early, the
      *previous tab's* fixtures stayed mounted, and the heading read "Gameweek ?
      results" over them. Stale rows under a wrong label — worse than the empty
      round the strictness was avoiding, and a direct contradiction of the
      "behaviour is unchanged" claim in the plan. Fixed by restoring the last
      link of the old chain, and now pinned by a test.

      **Verification.** `npm test`: **77 server, 69 client**, both green. `tsc
      --noEmit` clean in both packages. Browser: 2025-26 ranks real players
      (Haaland 239) where 2026-27 shows three empty states; 2019-20's round
      filter offers 1-29 then 39-47 with the Covid gap absent; a range narrowed
      to 20-38 on 2024-25 resets to 1-38 on 2023-24, which is the case the old
      `[firstRound, lastRound]` deps could not see; Haaland in 2016-17 and De
      Bruyne in 2026-27 both render the not-in-the-game state with a
      name-and-photo header and a full career table below; the season survives a
      reload; a stored `'2099-00'` comes up working on the default.

      **Mutation-checked, measured. One came back green and was fixed rather
      than written up as covered:**

      | Mutation | Result |
      | --- | --- |
      | selector sets state but `fetchBootstrap` sends no season | **red**, 7 tests |
      | `detailPlayer` reverted to a captured `Player` | **red**, 2 tests |
      | Fixtures effect deps back to `[targetGw]` | **red**, 3 tests |
      | the 400 recovery removed | **red**, 1 test |
      | `nextGameweek`'s fallback chain restored | **red**, 1 test |
      | header renders its stat grid for an absent player | **red**, 1 test |
      | "This Season" rendered without the loading gate | **red**, 1 test |
      | the `events[0]` results fallback dropped again | **red**, 1 test |
      | localStorage written from `requested` | **green** → test rewritten → **red** |
      | `detailBySeason` reset on season change | **green, expected** |

      The last two are the interesting ones. **Persisting `requested` instead of
      the served season is unobservable against today's server**, which either
      honours the parameter or 400s — so the two expressions are equal on every
      real path. The test now uses a mock that resolves a *different* season, a
      stand-in for a server that normalises rather than rejects; the contract
      being pinned is the client's, and it is worth pinning precisely because
      nothing in today's data would reveal it broken.

      **Resetting the cache also closes the false-empty-state window**, so that
      mutation is expected green. It is the reason the test asserts the loading
      line is *present* rather than only that the wrong sentence is absent —
      otherwise it would pass against the wrong fix.

## Deferred

The gate used to be "not until Phase 0 is complete". Phase 0 is complete, and
Phase 1 has started, so that sentence would now read as permission to start all
of this, which is the opposite of the intent.

What gates the list now: **each item is picked deliberately, as the subject of a
session, and never drifted into as a side effect of another task.** Nothing here
is a prerequisite for anything already built, so touching one while working on
something else is scope creep rather than progress. Two of them have a real
ordering constraint, marked below.

Also still open, from Known Issues rather than from this list: the **live field
sync**, which is what fills the five null fields and makes `form` and ownership
real again. Not to be confused with `ingest:live`, which item 4 built: that
loads a season's structure — roster, clubs, deadlines, fixtures — and runs to
completion in about a second. The field sync stores values that are different
every hour, and needs somewhere to put them and a policy for how often.

- **Run the gameweek sync, and cross-check it against `event/{gw}/live`.**
  The script exists (item 5); what is left is running it once a round has been
  played, and building the check that could not be written before then.

  **What the cross-check compares:** element-summary's per-fixture rows, summed
  per player per round, against `event/{gw}/live`'s per-round `stats`. **What it
  catches, which is the reason to build it:** if those disagree, one of the two
  endpoints is aggregating a double gameweek — and our per-fixture rows are
  wrong in exactly the rounds rule 13 exists for. Without that sentence the next
  reader sees a redundant assertion and deletes it.

  **And the reason to do it on 22 August rather than eventually:**
  element-summary is **one request per player** (564 a run) and `event/live` is
  **one request per round**. If the shapes agree, the cheap endpoint becomes
  viable for routine syncing with the expensive one kept for verification. That
  is a real saving, and it is only measurable while a round's data is fresh.

  First run also flips `SEASONS_WITH_GAMEWEEKS` to eleven and turns
  `career.test.ts` red, which is the intended announcement.

  **Watch the run output for a hole.** Item 7 made the sync apply the same
  NULL-for-a-hole rule the CSV ingest does, and print a loud block when it
  fires. On the live path it means FPL served a *settled* round with a column
  unpublished, which is an outage rather than a scraper gap — so **re-run the
  sync** once FPL has published and the upsert overwrites the NULL. Nothing in
  the database distinguishes a transient hole from a permanent one, so that
  block is the only trace that a re-run is worth doing.

  **When scheduling lands, that block has to become a signal rather than a log
  line.** Nobody reads the output of a cron job, and a hole that self-heals only
  if somebody notices does not self-heal. Belongs with the scheduling work, not
  before it.
- **A season total that says a round is missing, rather than blanking or
  lying.** The instrument item 7 wanted and did not have. `measuredSum` has two
  settings — a number, or the no-value marker — so a column measured for 37 of
  38 rounds has to pick between overstating completeness and destroying the
  figure entirely. For the five columns item 7 fixed that trade was easy: they
  are short by fourteen rounds and ~38%, so the marker is right. For the ICT
  quartet it is wrong, which is why those 26 fixtures still store 0 (see Known
  Issues): blanking 1,515 player-season totals to flag a ~3-7% gap costs more
  than it repairs.

  **What it needs is a third state**: the total, kept and rendered, carrying a
  visible mark that N of its rounds were never measured — with the count
  reachable on hover or in the cell's title. That is a wire-shape change (the
  denominator has to travel with the number) and a UI affordance, not an
  aggregate rule, which is why it is not a variation on item 7 and does not
  belong in an ingest session.

  Once it exists, the ICT quartet can be represented honestly without the
  migration that dropping `NOT NULL` on four columns would require, and the
  `starts` case gets better too: "24, and 14 rounds unmeasured" beats both "24"
  and "—". **Blocks nothing; blocked on nothing.**
- **The pre-season player list: this season's price and ownership beside the
  last completed season's totals, each labelled which it is.** Deliberately not
  FPL's approach of showing carryover totals under a "this season" heading. Left
  out of item 4 because it is two features rather than an ingest: ownership is a
  live-snapshot field with nowhere to be stored (see the live field sync above),
  and the totals need a second season's aggregate on the bootstrap query. Until
  it lands the list shows the new roster with zeros, which is recorded in Known
  Issues rather than left to look like a bug.
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
- ~~A season selector in the UI.~~ **Done — Phase 1 item 8.** It carried the
  `detailPlayer` snapshot fix with it, as this entry said it would.

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

## Agent skills

### Issue tracker

GitHub Issues on `meckgalen/fpl-lens`, via the `gh` CLI. **The Deferred list
above stays a personal scratchpad and is not migrated to issues** — only work
entering the spec/ticket flow becomes one. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root, neither of which
exists yet; they are created lazily when a term or decision actually resolves.
See `docs/agents/domain.md`.

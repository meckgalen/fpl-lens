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

| Table              | Rows                  | Populated by                        |
| ------------------ | --------------------- | ----------------------------------- |
| `teams`            | 35                    | `ingest:dimensions` + `ingest:live` |
| `team_seasons`     | 220 (20 per season)   | `ingest:dimensions` + `ingest:live` |
| `players`          | 2690                  | `ingest:dimensions` + `ingest:live` |
| `player_seasons`   | 7902                  | `ingest:dimensions` + `ingest:live` |
| `fixtures`         | 4180 (380 per season) | `ingest:fixtures` + `ingest:live`   |
| `events`           | 38 (2026-27 only)     | `npm run ingest:live`               |
| `player_gameweeks` | 253509                | `npm run ingest:gameweeks`          |

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
season still being played all produce _fewer rows_, and summing those is right;
a column NULL on _some of the rows that exist_ has no honest total.

**It degrades per player, not per season.** 661 of 778 2022-23 players lose
their `starts` total and 117 keep a real one. Per column too: Enzo Fernández
keeps `starts`, xG, xA and xGC and loses `expected_goal_involvements` alone,
because round 29 is holed on that column only and he played it as a double
gameweek.

**The drift against FPL is unchanged, and that is expected rather than a
disappointment.** `verify:history-past` still reports 1,524 drifts, 1,486
attributed, **38 unexplained** — identical before and after. Its
`fetchOurTotals` keeps a bare `sum()` on purpose: it asks what is _in the rows_
so it can be compared against FPL, and adopting `measuredSum` there would blank
our side of every holed player-season and make the drift vanish without a
stored value having changed. What item 7 buys is that the app no longer _shows_
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

`npm test` runs **two suites on two runners**: **110 server tests** and **187
client tests**, all passing. They are counted separately on purpose — two
runners print two summaries, and a combined figure would be maintained by hand
against neither of them.

**The client figure read 82 until item 12 and had been wrong since item 9**,
which is worth a sentence because the cause is not carelessness. Items 10 and 11
both changed it — to 111 and then to 134 — and **neither wrote a Phase 1
record**, so there was no place the number was being restated and nothing to
notice it drifting. Both records are stubs below now, and the working
agreement's "end each session by updating Current State" is what they were
missing.

The root script is `run-s --continue-on-error test:server test:client`, so the
client suite runs even when the server suite is red and the overall exit code is
still non-zero. `npm run test:server` and `npm run test:client` run either
alone. Not `&&`, which would hide the client result behind a database problem,
and not `;`, which reports only the last command's exit code and would let a red
server suite pass silently.

**Server — `node --import tsx --test`, against the populated database.** Eight
files:

- `server/src/repositories/defcon.test.ts` — the defensive contribution hit
  rule, on its own, for the reason `holes.test.ts` exists: it is the
  load-bearing rule in two queries and it is the **first scoring rule the app
  computes for itself**, so nothing upstream can be diffed against to catch a
  mistake. Two halves that cannot do each other's job. Synthetic rows in a
  rolled-back transaction are the only way to put a value *on* a boundary — real
  2025-26 has 9s and 10s but nothing guarantees it keeps them — and cover both
  thresholds either side, the goalkeeper case, the clause-order trap (a NULL-DC
  keeper row must be NULL, not 0), and the orphan row that pins the `LEFT JOIN`.
  Anchors against the real database are the only way to catch a rule that is
  self-consistently wrong: Gabriel 11, Senesi 26, Anderson 26, plus 2026-27 and
  2016-17 returning null for every player.

  **Its synthetic season is `'2098-99'`, not `'2099-00'`, and the reason is on
  the constant**: `live-season.test.ts` owns the latter, `node --test` runs files
  in parallel, and two transactions inserting the same
  `(season, fpl_fixture_id)` deadlocked on the unique index (Postgres 40P01).

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
  The `history_past` cross-check in the item 5 record (`CLAUDE-history.md`) is
  the other half, and the two are reported as two results rather than one
  verdict.

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
- `server/src/repositories/columns.test.ts` — the column availability
  predicate, on its own, because it decides what the Players list is *allowed to
  show* and a wrong cell is either a column of dashes or a partly measured
  column presented as a whole-season total. Two halves: `deriveSeasonAvailability`
  against hand-built fixtures, one per clause of the predicate; and the real
  database, where the **two derivations must agree** — the bootstrap's reduction
  over player aggregates against `/api/columns`'s `count(col) = count(*)` — over
  all eleven seasons, 90 cells plus the one unplayed season. Plus `measured_from`
  cross-derived against a `min(round)` computed in JS over separately fetched
  rows, 99 cells.

  **The unplayed season is where the two derivations deliberately diverge**, and
  it is asserted rather than skipped: the reduction lifts it to one
  `measured: false`, the matrix has no season-level field and flattens it to nine
  `none` cells. Both right, not interchangeable — which is why the client must
  read the pair together.

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

**Client — Vitest in jsdom, no database.** `playerColumns.test.ts` gained item
14's derived-column fold (the most-restrictive dependency, the tie-break that
makes `DCH/St` name DC's seasons rather than `starts`', and the three nulls in
hits-per-start including the `null / 5 === 0` coercion);
`Players.columns.test.tsx` gained the two picker entries; `StatsTable.test.tsx`
gained `St`/`DCH` and the assertion that `St` is **not** averaged. Components
are rendered and the API
is mocked at `services/api.ts`, not at `fetch`: mocking the transport would
additionally pin URL shapes and `res.ok` handling, which the server suite
already covers. `@testing-library/user-event` drives anything involving a
keyboard — `fireEvent` dispatches a synthetic click and so cannot tell a
`<button>` from a `<div onClick>`, which is the entire distinction item 3 turns
on. Eighteen files:

- `client/src/components/PlayerShirt.test.tsx` — the club shirt and its two
  fallbacks. URLs asserted **in full** rather than pattern-matched, for the
  reason the photograph test gives: the transformation is not the identity and
  every segment of it is separately capable of being wrong. Eleven tests: the
  outfield URL, the goalkeeper `_1` variant, both sizes, the badge step, the
  grey placeholder behind it, that a prop change clears a previous club's
  fallback, **both directions of the module-level shirtless set**, that both
  images are decorative, and `loading="lazy"`.

  **Queried by `src`, not by role**, and that is a consequence rather than a
  preference: the images carry `alt=""`, which keeps them out of the
  accessibility tree, so `getByRole('img')` cannot see them. One test pins that
  directly. It is also why `PlayerHeader.test.tsx`'s "no photo field" assertion
  still means what it always meant — `queryByRole('img')` still finds only the
  photograph, never the shirt behind it.

  `beforeEach(resetShirtCache)` is **required, not hygiene**. The set is module
  state shared across the file, and without clearing it the suite silently
  becomes order-dependent. Giving each test its own team code would hide the
  coupling rather than remove it. It is imported from `lib/shirtCache.ts` rather
  than from the component — see the Fast Refresh note in the item 9 record
  (`CLAUDE-history.md`) for why the cache lives there.

- `client/src/lib/playerColumns.test.ts` — how the picker describes the seasons
  a column *is* recorded in, which is prose generated from data and so is wrong
  in ways a type checker cannot see. Two shapes have to stay distinguishable:
  **"recorded from X"** (arrived and still being recorded) and **"recorded X to
  Y"** (recorded, then stopped). Holds the unplayed-newest-season case that
  shipped wrong — no handwritten fixture catches it, because a handwritten
  fixture stops at a season with data — its opposite, and the
  recorded/dropped/recorded-again shape that the defensive trio really has and
  that the UI cannot currently reach.

- `client/src/pages/Players.columns.test.tsx` — the picker, persistence and the
  sort fallback. **The load-bearing assertions are the negative ones**: that an
  unavailable column is disabled *with a reason* rather than silently missing,
  and that a hidden column is still *remembered*. Mocks `fetch` rather than
  `services/api`, which is this suite's one exception to its own rule and is
  required: mocking `fetchColumnHistory` would replace the module-scope memo the
  request-count test exists to pin.

- `client/src/App.test.tsx` — the shell, and **the first test `App.tsx` has ever
  had**. That absence is why item 3 could only pin the Dashboard's half of the
  click-through contract, and the `detailPlayer` fix cannot be tested anywhere
  else: it is a bug about which object the shell hands down. Twelve tests: the
  selector's options and their order, refetching with the new season, the app
  _not_ blanking mid-switch, persistence of the **served** season, recovery from
  a stored season the database does not have, a network failure _not_ being
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
  **not** appear when a season is registered but empty. All four are reachable
  from the UI now, three inside an expanded season and one at page level; this
  is still where the wording is pinned, and `NotInGame` is exported so the page
  renders the same sentence rather than a second copy of it.
- `client/src/pages/PlayerDetail.test.tsx` — expanding a career row issues one
  request, reopening after a collapse issues none, and changing player clears
  the cache. Payloads differ per (player, season) so a stale cache is visible
  rather than merely absent.

  **Item 12 added the merge and the filters.** That the selected season is a row
  in the same table rather than a section above it — the inverse of what this
  file used to assert — that its totals stay on screen when it is collapsed,
  that it alone is marked, and that it starts expanded. Then the per-season
  filters: two seasons open at once with different ranges, a range narrowed on
  one leaving the other alone, round options taken from the season rather than
  the selected one (the 2019-20-to-47 case), no filter bar over a season with no
  rows, and the filters resetting on a player change.
- `client/src/components/AveragesFootnote.test.tsx` — the footnote's three
  shapes through `StatsTable`, which is where the decisions live: one line when
  the denominators agree, a named group on a second line when they diverge, and
  the column labels instead when the divergent set is only part of a group. Plus
  the two cases the caller owns (zero appearances rather than `Infinity`, and no
  footnote at all with no rows), and two item 12 additions — the threshold read
  from the **unfiltered** season under a venue filter, and the boundary still
  reported when one column is holed again later, which is Haaland 2022-23's real
  shape and was found in the browser.
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
  header on that page, and the shirt's **wiring**: `PlayerShirt.test.tsx` proves
  the component builds a URL from the props it is handed, and this proves the
  list hands it the right ones. A row passing the wrong player's team code would
  pass every test in that file, so the assertion is that two rows on two clubs
  produce two different URLs.
- `client/src/pages/Dashboard.test.tsx` — every ranking opens the player it
  lists, by mouse and by keyboard, in all three. **Pins the Dashboard's half of
  the contract and no more**: `App.tsx` has no test, so the callback firing is
  not evidence the detail page opens. That half is a browser check.
- `client/src/components/StatsTable.sort.test.tsx` — the sort header is a button,
  reachable by Tab, activated by Enter and Space, `aria-sort` follows the state,
  and the arrow stays out of the accessible name. Also a class-level tripwire on
  the button filling its cell, which is worth having and worth knowing the limit
  of — see the Phase 1 item 3 record in `CLAUDE-history.md`.
- `client/src/pages/Dashboard.preseason.test.tsx` — the three rankings with
  nothing to rank. The load-bearing assertion is the **negative** one: the
  message must not promise Gameweek 1. See the item 4 record
  (`CLAUDE-history.md`) for the window in which that promise is false.
- `client/src/pages/PlayerDetail.upcoming.test.tsx` — the Upcoming strip: five
  of the remaining fixtures, the opponent read off the correct side of
  `is_home`, a difficulty per fixture, and **nothing at all** when the list is
  empty, which is every completed season.
- `client/src/components/PlayerHeader.test.tsx` — the photo URL built from
  `photo`, and the `onError` fallback, which is the common case for a newly
  published roster rather than an edge one. Item 9 changed both the size it
  asserts and what it falls back **to**: the full header degrades to the club
  shirt, and the partial header — a season the player has no `player_seasons`
  row for — degrades to the grey placeholder and **must never render a shirt**,
  because the only club available there is the previously selected season's.
  That is the stale-snapshot bug the partial header exists to prevent, arriving
  as an image; it has its own test and its own mutation.

Two runners rather than one, deliberately. The server suite's defining property
is that it talks to Postgres, and `node:test` was already there and works. The
client suite needs jsdom and a module mock, which is Vitest's job. Migrating the
server suite to Vitest would be a tooling change wearing a testing item's
clothes.

**Phase 1 step 1 is done: the player detail page shows a career.** The FPL site
shows a summary table of previous seasons and stops; expanding it is the app's
reason to exist. See "Phase 1" below for what the step decided.

**Item 12 then merged the selected season into that table, so the page is now
the header card, an Upcoming strip, and one career table.** One row per season,
newest first, every one of them expandable into that season's gameweeks with its
own GW-range and venue filters. The selected season is a row like any other,
marked "Selected" in place, and starts expanded. There is no "This Season"
section and no "Previous Seasons" heading: both named something that stopped
being true when item 8 added a selector — the first whenever the selector is off
the live season, the second on any season with later ones listed above it.

**Item 14 added the first scoring rule the app computes for itself.** Everything
else on screen is FPL's number or arithmetic over FPL's numbers; a defensive
contribution "hit" is a comparison we make. `server/src/repositories/defcon.ts`
holds `DEFCON_THRESHOLDS` (DEF 10, MID 12, FWD 12, no goalkeeper threshold) and
`defconHitSql(pg, ps)`, and **nothing else states the rule**: `getPlayerHistory`
gets the per-row 0/1 and `listPlayerTotals` gets the season count from the same
function. The client never compares a number to a threshold, because the Players
list needs a count only the server can compute and one rule in two languages is
free to drift.

**Goalkeepers are 0 rather than null, and FPL computing no DC for them was
measured rather than assumed.** DC is 0 on all 3,427 GK rows of 2025-26 *while
the components are not* — keepers recorded 24 tackles, 934 CBI and 6,195
recoveries in those same rows. The 0 is FPL declining to compute the stat.
`defensive_contribution` itself is a raw action count, not points: 5,117 of
29,747 rows carry an odd value, and the composition is position-dependent
(DEF = CBIT, MID/FWD = CBIRT) on 26,320 of 26,320 outfield rows.

**`getPlayerHistory` LEFT JOINs `player_seasons`, and the choice is about the
failure mode.** `player_gameweeks` has foreign keys to `fixtures`, `teams` and
`players` and **none to `player_seasons`**, so an orphan match row is
representable; but `player_seasons`' primary key `(player_id, season)` means the
join cannot multiply. Only one half of that invariant is enforced. An inner join
would **drop** an orphan and the gameweek would vanish with nothing on screen
saying so; the left join yields a NULL position, falls through the `ELSE`-less
`CASE` to NULL, and renders the no-value marker. Pinned by a test that inserts
an orphan and goes red under an inner join.

**All five routes read Postgres.** `GET /api/bootstrap`, `GET /api/columns`,
`GET /api/player/:code`, `GET /api/player/:code/career` and `GET /api/fixtures`
go through `server/src/repositories/`, and no SQL exists outside that directory.
`server/src/services/fplApi.ts` and its 5-minute cache are still there and still
unused by the routes — it is the ingestion source for the live season, not dead
code.

**`GET /api/columns` is the second route that spans seasons**, after `/career`,
and follows the same rule: no `?season=`, no top-level `season`, and a `season`
on every row (API identity rule 7). It returns 99 rows — eleven seasons by the
nine nullable columns — each saying whether that column is `full`, `partial` or
`none` there, and the round it starts at when it is partial. It exists for the
column picker's reason strings, which have to name seasons other than the one on
screen. Measured at 57 ms; the client fetches it once per page load, off the
critical path, and nothing blocks on it.

**`GET /api/bootstrap` also returns `columns`** — the same question for the
selected season alone, top-level because a bootstrap response is one season
throughout. It covers the **five** nullable columns that aggregate carries and
makes no claim about the other four, which live on the career query: `none`
means "no player has a value", and asserting that about a column nobody queried
is how the first draft came to say `tackles: none` on a season where tackles is
fully measured.

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

**Each career row also carries `rounds: number[]`** — every round that season
played, ascending, derived from `fixtures` by a correlated subquery. 2019-20 is
`[1..29, 39..47]` and 2022-23 is `[1..6, 8..38]`. It is what the per-season GW
filter offers, and it is a property of the **season** rather than of the player:
derived instead from the player's own gameweek rows, a gap in the list could
mean either that the season skipped the round or that he was not in the squad,
and nothing would distinguish them. Costs +0.77 ms and +1,274 B on an
eleven-season career, measured. See API identity rule 7 for why it rides on the
row rather than arriving as a map.

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
because that page derives its round from the _selected_ season's events and a
request without a season would ask the _default_ season for it; and the detail
detail page sends the season bootstrap resolved for the selected season's row,
and each other row's own season when it is expanded.

`GET /api/bootstrap` runs its aggregate per request. No cache and no
materialized view: it is fast enough, and a cache is a second source of truth.

**The cost depends on the season, and the recorded figure used to name neither.**
"~90ms" described a _completed_ season while the actual default, 2026-27, has no
match rows at all. Item 8 is where the distinction started to matter, because a
selector lets a user put the app on the expensive season deliberately. Measured
end to end — request to last byte, medians of 11 warm runs — which is what a
user actually waits for, rather than the query time alone:

| Season  | `/api/bootstrap` | Payload | Players | Was (item 8) |
| ------- | ---------------- | ------- | ------- | ------------ |
| 2026-27 | **23 ms**        | 333 KB  | 564     | 27 ms        |
| 2019-20 | 77 ms            | 406 KB  | 666     | 75 ms        |
| 2022-23 | **105 ms**       | 471 KB  | 778     | 91 ms        |
| 2025-26 | **121 ms**       | 501 KB  | 841     | 117 ms       |

**Re-measured in item 13, which added four columns to the aggregate**
(`start_cost`, `matches`, `saves`, `defensive_contribution`) **and the
`columns` availability block.** Three of the four seasons moved by less than the
run-to-run spread, which is what the plan predicted: the new columns ride on the
existing scan and the existing `GROUP BY`.

**2022-23 is the exception at +14ms, and it is the only season paying it.** It
is the one season with a `partial` column — `starts` and the expected family are
measured from round 16 and not before — and a partial column is the only thing
that needs `measuredFrom` run to find its boundary. Ten of the eleven seasons
run **zero** extra queries; 2022-23 runs one.

That query is **sequential rather than parallel, necessarily**: which columns
are partial is not known until the aggregate has been reduced, so it cannot be
fired alongside `listPlayerTotals`. Firing it unconditionally for all nine
nullable columns would make it parallel and would also make every season pay for
it, which is the trade the gating exists to avoid.

`GET /api/columns` — the eleven-season availability matrix, 99 rows, 8.3 KB —
measures **57 ms** on the same method. It is fetched once per page load on the
Players page, off the critical path, and nothing blocks on it. Note the shape it
is NOT: driving that aggregate from
`(SELECT DISTINCT season FROM player_seasons) LEFT JOIN player_gameweeks`, so a
season with no match rows still gets a row, measures **161 ms** against **51 ms**
for the same aggregate grouped straight on the fact table — 110 ms to carry one
row for a season that has no data. It is two cheap queries in one `Promise.all`
with the empty seasons folded in afterwards instead.

For comparison, item 7 measured `listPlayerTotals` alone at 9ms for 2026-27 and
99ms for 2025-26; the difference is serialisation and transfer, which the query
figure does not include. The worst case is a season change to 2025-26 at ~121ms,
which is why the shell keeps the previous bootstrap mounted rather than blanking
— see the item 8 record in `CLAUDE-history.md`.

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

**Image assets, hot-linked at render time and never ingested or proxied.** Three
patterns, all keyed on a permanent code, all verified against the live host
rather than written from memory — the shirt over all 35 team codes this database
holds:

```
photo   https://resources.premierleague.com/premierleague/photos/players/{40x40|110x140|250x250}/p{fpl_code}.png
shirt   https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_{fpl_team_code}[_1]-{66|110|220}.png
badge   https://resources.premierleague.com/premierleague/badges/{25|50|70|100}/t{fpl_team_code}.png
```

`_1` is the goalkeeper variant, confirmed by rendering both images: `shirt_3-110`
is Arsenal's red short-sleeved outfield shirt and `shirt_3_1-110` a white
long-sleeved keeper shirt. `_2`/`_3` 404, so it is one variant and not a kit
series. **The photo directory name is the CSS size, not the pixel size** — the
file served is 2x, so `250x250` is really 500x500 and 346 KB. Sizes outside those
lists 404 or 403; so do the `premierleague25`/`premierleague26` path prefixes
some seasons used.

**A missing shirt returns 404 to curl and 503 to a browser.** Both fire
`onError`, so nothing depends on which, but a reader checking by hand will see a
different status than the app does.

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
- **`event/{gw}/live/`** — one request per _round_ rather than per player, so
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
│   │   │   ├── defcon.ts      # the DC threshold: the one place the rule lives
│   │   │   └── defcon.test.ts # boundaries, GK, clause order, the orphan row
│   │   ├── test/
│   │   │   └── synthetic-seasons.ts  # one reserved season per suite; two
│   │   │                      # suites sharing one deadlocked on 40P01
│   │   ├── routes/fpl.ts      # /api/bootstrap, /api/columns,
│   │   │                      # /api/player/:code[/career], /api/fixtures
│   │   ├── services/fplApi.ts # live FPL API client, cache; ingest source only
│   │   ├── verify/            # read-only cross-checks against other pipelines
│   │   │   ├── history-past-check.ts  # npm run verify:history-past
│   │   │   ├── columns-check.ts       # npm run verify:columns
│   │   │   └── defcon-check.ts        # npm run verify:defcon — TWO results
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
│   │   │   ├── averages.ts    # normalization, rounding, the footnote model
│   │   │   ├── playerColumns.ts   # the column table, availability, persistence
│   │   │   ├── shirtCache.ts  # clubs known to have no shirt; + the test reset
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
│   │   │   ├── PlayerDetail.tsx  # header / Upcoming / one merged career table
│   │   │   ├── PlayerDetail.test.tsx  # expand, collapse, cache reset
│   │   │   └── PlayerDetail.upcoming.test.tsx  # the remaining fixtures strip
│   │   └── components/
│   │       ├── ui/            # Card, Table, Badge, Switch, Input
│   │       │                  # + DisclosureButton: the one row toggle
│   │       ├── OpenPlayerButton.tsx # a player's name, as a link to their page
│   │       ├── ColumnPicker.tsx     # which columns render, and why not
│   │       ├── PlayerShirt.tsx      # club shirt -> club badge -> grey avatar
│   │       ├── PlayerShirt.test.tsx # both URLs in full, both fallbacks
│   │       ├── PlayerHeader.tsx     # + the hot-linked player photo
│   │       ├── PlayerHeader.test.tsx  # the photo URL and its fallback
│   │       ├── GameweekFilters.tsx  # sticky left-0: it scrolls with the pane
│   │       ├── GameweekSection.tsx # a season's gameweeks + 3 empty states
│   │       │                  # + NotInGame, which the page renders itself
│   │       ├── GameweekSection.test.tsx  # all four, by their wording
│   │       ├── CareerTable.tsx     # EVERY season, incl. the selected one
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
├── CLAUDE.md                  # the rules: read every session
└── CLAUDE-history.md          # the Phase 1 item records: read on demand
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
   _values_ from **round 16**; the scraper wrote `0` for the fourteen rounds
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

   **And a COUNT needs a second guard that a SUM does not.** `fullyMeasured` —
   `count(col) = count(fixture_id)`, the shared half of `measuredSum` — reads
   TRUE **vacuously** over a player-season with no match rows, because both
   sides are 0. `measuredSum` survives that, since `sum()` over zero rows is
   NULL anyway. A `count(*) FILTER (…)` over zero rows is **0**, so any
   count-based aggregate must add `count(pg.fixture_id) > 0` itself. Measured on
   item 14's `defcon_hits`: without it, all **564** players of 2026-27 — the
   season the app defaults to — read a confident zero. This is item 13's
   vacuous-truth hole arriving in a second place.

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
   the season's _structure_, not its per-sync snapshot; see Deferred, "live
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
   the one that reproduces FPL's own value. Confirmed on **400 of 400** comparable
   players by `npm run verify:ppg`; the only disagreement in the whole run is one
   element whose *totals* differ, where FPL's own `history_past` backs ours.

   **The numerator is the whole season's points; only the denominator is filtered
   to appearances.** The two are not symmetric, and item 11 found out the hard way:
   some rows with no minutes still carry values, and FPL counts them in the season
   total. Filtering the numerator by `minutes > 0` as well looks obviously right, and
   it disagreed with FPL on **7 player-seasons**.

   **Nine of the 26 averaged columns can be non-zero on a row with no minutes.** An
   earlier draft of this entry said `total_points` was the only one; that was wrong
   and self-contradicting, since the rows were found *by* their yellow card. Measured
   over all ten seasons — **19 rows, 18 player-seasons, nine seasons (not 2018-19)**:

   | Column | Rows | Range | Column | Rows | Range |
   | --- | --- | --- | --- | --- | --- |
   | `bps` | 15 | −9 … 4 | `influence` | 2 | 1.0 … 2.0 |
   | `total_points` | 14 | −3 … −1 | `creativity` | 2 | 0.4 … 1.1 |
   | `yellow_cards` | 13 | 1 | `expected_goals_conceded` | 2 | 0.37 |
   | `ict_index` | 3 | 0.1 … 0.4 | `red_cards` | 1 | 1 |
   | | | | `threat` | 1 | 2.0 |

   The other seventeen are 0 on every such row: goals, assists, clean sheets, goals
   conceded, own goals, both penalty columns, saves, bonus, the expected family bar
   xGC, and the defensive quartet.

   **Those 19 rows are two disjoint populations, and only one of them has an
   established cause.** No row carries both a card and an ICT-family or xGC value —
   checked, the overlap is exactly 0.

   - **14 rows are bookings**, and these are fully accounted for: 13 yellows at
     −1 point / −3 BPS, and one red (Matheus N., 2022-23 round 28) at −3 / −9. The
     ICT family and xGC are 0 on every one. This explains `total_points`,
     `yellow_cards`, `red_cards`, and 14 of the 15 `bps` rows.
   - **5 rows carry attacking or defensive values with no card at all**, which a
     booking does not account for — a BPS penalty is negative, and a card generates
     no threat: De Bruyne 2016-17 r32 (creativity 1.1), Philip 2017-18 r37
     (influence 1.0), Kerkez and Kluivert 2023-24 r28 (xGC 0.37 each — same club,
     same round, a double gameweek), and Ferguson 2024-25 r24 (threat 2.0,
     influence 2.0, creativity 0.4, and the one **positive** BPS, +4).

   **The cause of that second group is not established and was not chased.** A
   minutes figure wrong at source is the obvious guess — threat implies a shot, xGC
   implies time on the pitch — but it is a guess and is recorded as one. It does not
   need settling: the arithmetic reproduces FPL at **400 of 400** either way, so
   whatever the source's story is, we tell the same one.

   **This changed the averages of all nine columns, not just Pts** — each numerator
   now includes rows its denominator does not count. That is correct for the same
   reason the points treatment is: it is what FPL's own totals do. `total_points` is
   simply the only one printed beside a second number that could expose a
   disagreement, which is why the PPG cross-check caught it and nothing else would
   have. Of the 13 player-seasons with a bench row carrying points, **7 differ once
   rounded to one decimal**; the rest are absorbed by the rounding.

   **It is sent unrounded, and rounded once on the client — changed in item 11.**
   It used to be rounded in SQL by `to_char(round((x * 10)::float8)…)`, which made
   it the **only value in the API arriving pre-formatted**, against rule 8. Worse,
   it put the same rounding rule in two languages: SQL here and `toFixed` in the
   averages row, free to disagree, which they did on 111 player-seasons. Rounding
   now happens in `roundHalfEven` (`client/src/lib/averages.ts`), in the one
   formatter that renders both this number and the averages row beneath it.

   The convention is unchanged and still matters: FPL computes in Python and rounds
   **half-to-even**, while Postgres `numeric` rounds half away from zero and
   disagreed with the live API on ten players before that was first fixed. Note
   that `toFixed` is **not** an implementation of the other convention — it is
   whatever the binary representation gives, so it must never be used for this.

   **A consequence worth expecting: sorting changed.** `ppm` on the Players list
   and the Dashboard's `bestPerMatch` sort on the real quotient now rather than on
   a value pre-rounded to one decimal. One decimal left only 54-62 distinct values
   for 624-865 players, with the largest tie group running 119-305 players ordered
   by FPL element code — so 4,206 of 7,338 player-seasons change position, moving
   out of an arbitrary order into a meaningful one. The Dashboard's top-3
   membership is unchanged in all ten seasons.
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

   **A season-scoped fact that is not a stat belongs on the row too, and item 12
   is the first case.** Career rows carry `rounds: number[]` — every round that
   season played, derived from `fixtures`. It is a property of the season rather
   than of the player, so the obvious alternative was a
   `Record<season, number[]>` map beside the rows. That is the manifest shape
   this rule refused for `season` itself, for the same reason: a map and the
   rows it describes are two statements of one fact that can disagree. On the
   row, the season naming itself and the rounds it played arrive together and
   cannot come apart. Measured cost of carrying it per row on an eleven-season
   career: +1,274 bytes, +0.77 ms.

   A top-level `season: null` on a career response was considered and rejected.
   Null already means "not measured" everywhere in this codebase (rule 6), and a
   second meaning for it is the ambiguity that rule exists to prevent; it would
   also be constant across every career response, so it would be ceremony rather
   than data. A `seasons: string[]` manifest was rejected for duplicating what
   the rows already carry, and so being able to disagree with them.

   **Item 8 then put a `seasons: string[]` on the bootstrap response, and that
   is not a reversal of the sentence above.** What was refused on `/career` was
   a manifest _beside rows that each already name a season_ — eleven copies of
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

`npm run verify:columns` checks that the column picker offers exactly what the
data can answer: it asks the **shipped** code what it would offer and compares
against a truth query written for the check alone, which counts NULLs directly
rather than reusing the availability predicate. **Read-only.** **275 cells**
across eleven seasons (up from 253 with item 14's two derived columns); exits
non-zero on any mismatch, which it does not today.

Its `DB_COLUMNS` maps a picker key to the **list** of database columns it reads,
so a derived column's truth is the AND over its inputs. Those lists are
**declared in the check rather than read off the shipped `dependsOn`** — the
file imports the shipped *logic* precisely so it tests what runs, and restates
the *data* precisely so it cannot agree with itself. Import the logic, restate
the data; that is not a reversal of item 13's move of `seasonAvailability` into
`columns.ts`.

`npm run verify:defcon` checks the defensive contribution hit count and prints
**two results that are deliberately never merged**, because FPL publishes no hit
count and there is nothing external to diff against. **Read-only.**

1. **Cross-derivation — plumbing, not the rule.** The season count from
   `listPlayerTotals` against the summed per-row flags from `getPlayerHistory`,
   every player-season in 2025-26: **841 of 841**. Both sides call
   `defconHitSql`, so **a wrong threshold agrees with itself and this part exits
   0**. It catches a guard applied on one side only, the join multiplying rows,
   or the two queries filtering differently.
2. **The audit's distribution, frozen as literals — this is the rule check.**
   Computed in SQL before `defcon.ts` existed and **compared** rather than
   printed, because a printed number nobody diffs is not a check. Swapping DEF's
   10 with MID's 12 moves it and nothing else in the codebase notices.

Exits non-zero on either. Same discipline as item 5's replay-plus-cross-check.

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
- [x] Filters on **every** expanded season, not just one: a GW range built from
      that season's own rounds, and home/away. State is per season, because the
      round sets differ — 2019-20 runs to 47, 2022-23 has no round 7
- [x] Averages row in stats table, nulls skipped, denominator stated — and a
      footnote that **names** the column group resting on a different number of
      appearances rather than printing a range spanning both
- [x] Dashboard, ranked on real aggregates: total points, points per match with
      an appearance floor, ICT index
- [x] Fixtures page with difficulty ratings, by gameweek
- [x] Every page header names the season it is showing
- [x] One career table with the selected season merged into it as a row — its
      totals in line with every other season when collapsed, its gameweeks
      underneath when expanded, and no "This Season" / "Previous Seasons"
      headings to be wrong about which is which
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
- [x] Club shirts on every player row — the Players list and all three Dashboard
      rankings — with the goalkeeper variant, falling back to the club badge for
      the fifteen stored clubs FPL no longer publishes a shirt for, and to the
      grey placeholder behind that
- [x] The header card's photograph at a third of its former weight, falling back
      to the club shirt; and `preconnect` to both image origins
- [x] Selectable columns on the Players list — thirteen by default, **twenty-five
      offered** since item 14 added two, persisted across sessions and season
      changes. A column is offered
      only where **every row of that season carries a value**, so 2022-23's
      expected family is withheld rather than shown as a fourteen-round-short
      total; an unavailable column is **disabled with the reason on screen**
      rather than hidden, and the reason names where the column *is* recorded
- [x] Games started per gameweek — the one thing the gameweek table could not
      say, since a row reading 45 minutes is either a start hooked at half time
      or a substitute brought on at half time
- [x] Defensive contribution **hits**: a per-gameweek 0/1 beside the raw count,
      and a season count plus hits-per-start on the Players list. The first
      scoring rule the app computes for itself, stated once on the server;
      goalkeepers score none, because FPL computes no DC for them at all
- [x] Derived columns in the picker (`dependsOn`), whose availability is the
      most restrictive of the columns they read — so both new entries are
      withheld on the ten seasons with no DC data, each naming where it *is*
      recorded

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
  season's _structure_ — who is registered, for which club, at what price, on
  what schedule — and those five are a _snapshot_ of the live game that is
  different every hour. Storing them needs somewhere to put a value that is
  never true for long, which is the "live field sync" item in Deferred. `form`
  and `selected_by_percent` were sortable columns on the Players page and are
  gone rather than shown empty. See API identity rule 4.
- `client/src/components/PlayerSearch.tsx` is dead: nothing imports it. The
  Players page has its own inline search.
- **FPL publishes shirts for the current season's twenty clubs and no others, so
  the shirt on a historical season is the wrong club's-kit-year, and for fifteen
  of our thirty-five clubs there is no shirt at all.** Two consequences of one
  fact, neither fixable, both discovered by probing all 35 stored team codes in
  item 9 — the twenty that returned an asset were **exactly** the twenty in
  2026-27, set equality rather than approximately.

  **Half one: coverage, which the badge fallback handles.** Nine of twenty clubs
  on 2016-17 have no shirt and render their club badge instead, and the badge
  covers all 35 codes including clubs relegated a decade ago. Measured in the
  browser on a full 200-row render of 2016-17: 115 rows shirt, 85 rows badge,
  zero broken images, zero grey placeholders — from 49 requests, being 40 shirt
  (22 × 200, 18 × 503) and 9 badge.

  **A missing shirt returns 503 to the browser, and that 503 is deterministic
  rather than a rate limit** — which matters, because `recordMissingShirt`
  writes its conclusion for the rest of the session and 200 rows hitting one
  origin at once is exactly the shape that draws a limit. Measured before the
  cache was trusted:

  - Five rounds of all 40 shirt URLs fired in parallel, cache-busted: **18
    failures every round, the failing set byte-for-byte identical across all
    five**, and exactly the nine shirtless clubs × two variants.
  - **No URL that should succeed ever failed**, in any round.
  - 40 simultaneous requests at a good URL: 40/40 succeeded. At a bad URL: 0/40.
    At a good URL *immediately after* the bad burst: 40/40. Every failure 503,
    never 429, under 40-way concurrency.

  **The qualification, which the evidence does not cover: the host is
  deterministic, the cache is not self-correcting.** `onError` carries no status,
  so it cannot tell "this asset does not exist" from "this request failed" — a
  dropped connection while 200 rows are painting would record that club as
  shirtless for the rest of the session, with nothing to detect or expire it.
  Left as is deliberately: the cost is bounded (a badge instead of a shirt, on
  historical seasons, until reload) and separating the two cases needs a status
  code, which an `<img>` cannot give. It would take a `fetch` per shirt, a
  heavier mechanism than the defect justifies.

  | Season | With a shirt | Season | With a shirt |
  | ------- | ------------ | ------- | ------------ |
  | 2016-17 | 11/20 | 2022-23 | 16/20 |
  | 2017-18 | 11/20 | 2023-24 | 15/20 |
  | 2018-19 | 12/20 | 2024-25 | 16/20 |
  | 2019-20 | 12/20 | 2025-26 | 17/20 |
  | 2020-21 | 13/20 | 2026-27 | 20/20 |
  | 2021-22 | 13/20 | | |

  **The set rotates every August**, so 2026-27 is full today and will not be:
  clubs relegated from it lose their shirt and their rows start falling back to
  badges, with nothing in the app detecting the change — the fallback simply
  fires. That is the fallback working, not a regression, and it is recorded here
  so the next reader does not go looking for a bug.

  **Half two: the shirt is the CURRENT kit, never the season's kit.** Select
  2016-17 and Arsenal's players render Arsenal's **2026-27** shirt. Right club,
  wrong year, on every season the app can show, and it has never been otherwise.
  **Not fixable**: the path carries a team code and a size and nothing else, and
  the older kits are gone from the host — no archived path exists, which was
  checked rather than assumed. It looks like a bug precisely because the club is
  right, which is why it is written down.
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
  still has a last round worth showing. It is the tab _wording_ that asserts
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
- **All four empty states are reachable from the UI**, down from two unreachable
  at item 1 and one at item 4. Item 8's selector reached the last of them; item
  12 moved three of them and had to relocate the fourth entirely. Where each one
  lives now, since the merge changed the answer:

  | State | Where it renders |
  | --- | --- |
  | Not in the game | **Page level**, above the career table |
  | Registered, no rows | Inside that season's expanded row |
  | Never played | Inside that season's expanded row |
  | Filtered out | Inside any expanded row — every season has filters now |

  **"Not in the game" could not stay in the table, and that is a structural fact
  rather than a layout choice.** It fires exactly when the player has no
  `player_seasons` row for the selected season — which is exactly when
  `getPlayerCareer` returns no row for it, so the merged table has nothing to
  attach the sentence to. The wording still lives in `GameweekSection.tsx`, as
  the exported `NotInGame` both callers use. Confirmed in the browser on Haaland
  at 2016-17: the sentence, a name-and-photo header, no season-scoped tiles, the
  career table intact, and **no row marked "Selected"** — correct, because the
  selected season has no row to mark.

  "Registered, no rows yet" became real the day 2026-27 was ingested and is what
  every 2026-27 player's row shows when expanded — confirmed in the browser.

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

  **A trailing paragraph claiming "Not in the game that season" was still
  unreachable was removed in item 12.** It contradicted this entry's own opening
  sentence and had been false since item 8. That is the failure mode the working
  agreement's "trace a claim to the code before repeating it" exists to catch,
  found here by reading the entry end to end rather than by testing anything.

  All four remain rendered and asserted by `GameweekSection.test.tsx`.

- **`DCH` means two different things one click apart, and both are labelled but
  neither label mentions the other.** In the gameweek table the AVG row divides
  by **appearances** — item 11's convention, stated by the footnote beneath it —
  so `AVG DCH 0.3` is hits per appearance. On the Players list `DCH/St` divides
  by **starts**, which its own name says. Gabriel 2025-26 is 0.3 on one screen
  and 0.37 on the other, and nothing on either says why.

  Both numbers are right and both are labelled where they render. Left as is
  because the alternatives are worse: breaking item 11's convention for one
  column, or naming a second denominator inside a footnote about the first. The
  Players-list column cannot use appearances — a substitute who clears the
  threshold without starting is exactly the case hits-per-start exists to show.
  Recorded so the next reader knows it was seen rather than missed.

- **Two elements read "Selected" on the same page, meaning different things.**
  `StatsTable` has an ownership column whose header is `Selected` (FPL's
  `selected_by`, a raw count), and item 12's marker on the selected career row
  is a badge reading `Selected`. Both are visible at once on a 1558px viewport:
  the badge in the pinned Season cell, the header ~31 columns right in the
  nested gameweek table.

  Found by a test collision rather than by eye — `getAllByText('Selected')`
  returned two nodes — which is why the assertion is scoped to the summary row.
  Left as is: contextually they are in different tables with different headers,
  the badge was chosen deliberately over "This season" (the word both removed
  headings got wrong), and renaming FPL's own column label is a bigger decision
  than this item should take on the way past. Recorded so the next reader knows
  it was seen rather than missed.

- **The averages footnote scrolls horizontally away inside an expanded season.**
  Pre-existing, not introduced by item 12 — it applies to every nested table
  item 10 built. The note sits outside the gameweek table but inside the
  `colSpan={34}` cell, so the career pane carries it sideways: scroll right to
  read BPS and the sentence describing the averages has gone off the left edge.

  Item 12 fixed exactly this for the **filter bar** (`sticky left-0 w-fit`,
  measured at -419px before the fix) and deliberately did not extend it to the
  note. The filter bar is three interactive controls and losing them is a
  functional defect; the note is a caption. The same one-line instrument would
  fix it whenever someone wants to.

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

  | Season  | Rounds     | Columns holed                                                                                           | Fixtures | Now      |
  | ------- | ---------- | ------------------------------------------------------------------------------------------------------- | -------- | -------- |
  | 2022-23 | 1-6, 8-15  | `starts`, `expected_goals`, `expected_assists`, `expected_goal_involvements`, `expected_goals_conceded` | 136      | **NULL** |
  | 2022-23 | 29         | `expected_goal_involvements` alone                                                                      | 16       | **NULL** |
  | 2022-23 | 16, 33, 38 | influence, creativity, threat, `ict_index`                                                              | 15       | still 0  |
  | 2021-22 | 38         | influence, creativity, threat, `ict_index`                                                              | 10       | still 0  |
  | 2019-20 | 21         | influence, creativity, threat, `ict_index`                                                              | 1        | still 0  |

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

  Traced rather than assumed, and re-traced in items 8 and 9 because the line
  numbers moved both times: the Dashboard ranks on total points
  (`Dashboard.tsx:83`), points per match with an appearance floor (`:93`) and
  ICT index (`:100`) — none affected,
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
  entry below are the medians of the 38 _unexplained_ cells and are a different
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
  thirty-eight. The right one is a total that renders _with a marker saying a
  round is missing_ — the number, kept, plus an honest annotation. That is a UI
  affordance nothing in the app has today, and it is named in Deferred.

  Detection is unaffected: `verify:history-past` calls `findHoles` with all nine
  detectable columns, not the five the ingest fixes, so these 26 fixtures keep
  their attribution.

  **Item 13's availability predicate cannot see these holes either, and that is
  not an exposure it creates.** `count(col) = count(*)` tests for NULLs, and a
  hole stored as `0` in a NOT NULL column has none — so `influence`,
  `creativity`, `threat` and `ict_index` read as available in all ten seasons,
  including the three where a round is missing. The picker offers them with no
  caveat.

  What makes that acceptable rather than a second defect: an **enabled** entry
  carries no sentence and so asserts nothing about completeness. The picker
  explains **absences** only. These four columns already render on the career
  table and the gameweek table with the same holes and the same silence, so
  nothing about their treatment changed. The instrument that would fix it
  properly is the third state named in Deferred — a total that renders with a
  mark saying N rounds are unmeasured.

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

  **Item 13 did not change this and deliberately does not hide it.** The column
  picker withholds every *nullable* column on 2026-27 with "No matches recorded
  for 2026-27 yet", but the NOT NULL columns — points, minutes, goals, assists,
  clean sheets, bonus, BPS, the ICT quartet — are genuinely 0 rather than
  unmeasured, and 0 is a measurement (rule 6). Withholding them would be the
  same overreach in the other direction. So the list still shows a roster of
  zeros; what changed is that the season now says so once, in the picker, in the
  Dashboard's own words.

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
  is entirely normal. The only signal is the _existence_ of a round-less fixture
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
  filed the default season under a separate "This Season" section and only
  _previous_ seasons reached the career table, so it would take a newer season
  being ingested. Item 8's selector reached it without one, and **item 12
  removed the premise entirely**: every season is a row in one table now, so
  2026-27 shows `£15.5 → —` on every career table whatever the selector is on.
  Observed on Haaland's.

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

Same rule as Phase 0: one item per session, committed between each.

**The full records live in `CLAUDE-history.md`, one file up the directory.** They
were split out in item 13, when this file reached 195k characters against a 150k
context budget — a fifth of it went unread every session, with nothing saying
which fifth, and the unread part included the working agreement and the data
rules. The entries there are the original text moved verbatim, not summarised:
several measurements exist nowhere else.

What is left below is a stub per item — three or four lines and a pointer, the
pattern items 10 and 11 already used. **A stub is not the record.** Before
planning around anything an item decided, read its entry in `CLAUDE-history.md`;
the working agreement's "trace a claim to the code before repeating it" applies
doubly to a four-line summary of a four-page argument.

> **ITEM 15 STARTS BY TRIMMING THIS FILE. Do it first, before any other work.**
>
> `CLAUDE.md` is at roughly **145k characters against a 150k context budget** —
> about 5,400 of headroom, which is **less than item 14's own entry consumed**.
> So the next item overflows it during the write-up, which is exactly when there
> is least appetite to do anything about it, and the overflow is silent: a fifth
> of the file simply stops being read with nothing saying which fifth.
>
> Trimming last is what put it here. Item 13 split the file precisely to fix this
> and the margin was eaten in one item, because a record written at the end of a
> session is written when the budget is already spent.
>
> **What moves:** prose in Current State that restates an item record, and any
> stub that has grown past its three or four lines. **What stays:** the data
> rules, the API identity rules, Known Issues, the schema notes and this working
> agreement — they are what the next session has to reason *from*, and they are
> the part that was being dropped.

**Commits go directly to `main`.** No branches, no `Co-Authored-By` trailer.
This is a solo repository with no reviewer and no CI, so a pull request has
nothing to serve: the working agreement above makes the session the unit of
work and the commit the boundary between units. Every commit in this history
was made this way. Standing guidance to branch before committing on a default
branch does not apply here, and flagging the conflict each session is
unnecessary once this line exists.

- [x] **1. Career history on the player detail page.** → `70003f4`

      `GET /api/player/:code/career`, one row per season, each expanding into
      that season's gameweeks by re-using `GET /api/player/:code?season=X` and
      the same `StatsTable`. Rewrote API identity rule 7 rather than satisfying
      it: a response spanning seasons labels every row, not the body. Empty
      states went from one to four. Found the StrictMode double-fetch — a fetch
      fired inside a `setExpanded` updater.

- [x] **2. Client-side testing.** → `a4cefed`

      Vitest in jsdom, React Testing Library, the API mocked at
      `services/api.ts`. Two runners rather than one, with root `test` as
      `run-s --continue-on-error` so a red server suite cannot hide the client
      result. The mutation check found the double-fetch test goes red only when
      **both** halves are reverted, which is why the record insists "either half
      alone is green" must not be read as "either half alone is fine".

- [x] **3. Keyboard reach and click-through.** → `6c01bb6`

      Career rows were `<tr onClick>` that no keyboard could reach, and the
      Dashboard's three rankings had no click handler at all. Four `<tr>`/`<th>`
      handlers became real `<button>`s, plus one focus bug. The browser pass
      caught a regression no class-level test could: the header row collapsed
      from 40px to 21px on every sortable table, with every asserted class
      present — jsdom does not lay out.

- [x] **4. The 2026-27 season, from the live API.** → `5a611de`

      `ingest:live` loads clubs, roster, deadlines and fixtures into the same six
      tables the CSV backfill writes, plus a new `events`. It writes **no**
      `player_gameweeks`. Built mostly around one trap: a pre-season bootstrap
      serves LAST season's totals on every element, so a naive ingest produces a
      plausible copy of 2025-26. Split `ALL_TEN` into `ALL_SEASONS` and
      `SEASONS_WITH_GAMEWEEKS`, which were one list until this landed.

- [x] **5. The incremental gameweek sync.** → `2e5918c`

      `ingest:live-gameweeks`, **written and verified, never run** — no 2026-27
      match has been played. The verification the task asked for was impossible,
      the API serving no previous season at gameweek granularity, so it is two
      results deliberately never merged into one: a 29,747-row replay of
      2025-26's CSV through the new mapper, and a 60-player `history_past`
      cross-check. Also found the 2024-25 `defensive_contribution` gap.

- [x] **6. The `history_past` cross-check, run wide.** → `59b1860`

      `verify:history-past` over every reachable player-season in all ten
      seasons: 1,915 player-seasons, 27 columns, **51,705 cells**. 1,524 drifts,
      1,486 attributable to 178 fixtures where a column is 0 on every row of a
      played match, **38 unexplained**. Drift direction — 1,516 low against 8
      high — is the measurement that pointed at the cause, since revision goes
      both ways and loss only goes down.

- [x] **7. Store NULL where the source holed a column.** → `cdb5407`

      The hole rule, `server/src/ingest/holes.ts`, applied by both gameweek
      writers: **152 fixtures, 9,704 rows, all in 2022-23**. `measuredSum` stops
      the season aggregate reporting a partly measured column as a whole-season
      total. The ICT quartet was excluded on proportion — its holes drift
      2.9-6.8% against FPL where the expected family drifts 36.1-38.6%, and
      blanking would cost every player in two seasons their ICT total.

- [x] **8. A season selector.** → `b34876b`

      All eleven seasons on every page. The selected season is
      `bootstrap.season` — the one the server actually served — rather than a
      second piece of state free to disagree with the payload on screen. Carried
      the `detailPlayer` snapshot fix, and made `currentGameweek`/`nextGameweek`
      return null instead of a plausible wrong answer.

- [x] **9. Club jerseys, and the photo loading work.** → `79950db`

      `PlayerShirt` on every player row, falling back shirt → club badge → grey.
      The audit ran first and reshaped the item: a shirt exists for **exactly**
      the twenty clubs in the current season and no others, so the planned grey
      fallback would have blanked half of 2016-17. The header photograph dropped
      to a third of its weight. Holds the preconnect A/B and the post-mortem on
      its stopping rule, which returned a null by construction.

- [x] **10. Sticky headers, pinned columns, row striping.** → `2ce4fd9`

      Column headings scrolled away vertically and the identifying column
      scrolled away horizontally on three wide tables. Adds sticky headers, pins
      Opp beside GW, pins the Player column, stripes all four tables, and moves
      row background colour from the cell to the row (`lib/rowSurface.ts`). The
      load-bearing discovery: `overflow-x: auto` with `overflow-y: visible`
      computes `overflow-y` to **auto**, so every wrapper was already an
      unbounded vertical scroller in which a sticky header never sticks.

      This entry was a stub before the split too — the commit message is the full
      record. Read `git show 2ce4fd9`.

- [x] **11. Averages divide by appearances, not fixtures.** → `5fad1b8`

      The averages row divided by every row shown while the career row six inches
      above divided by appearances. New: `client/src/lib/averages.ts`, holding
      the normalization strategies, per-column denominators, `roundHalfEven` and
      `fmtPpg`. The numerator and denominator filters are deliberately **not**
      symmetric, which API identity rule 5 now records in full.

      A stub before the split as well. Read `git show 5fad1b8`.

- [x] **12. The selected season merged into the career table.** → `0becf6d`

      One career table with the selected season as a row in it, marked in place
      and expanded by default. Both section headings went rather than being
      renamed — item 8's selector made "This Season" and "Previous Seasons" false
      claims. Filters moved onto every expansion, so their state is per season.
      `rounds: number[]` is new on every career row, derived from `fixtures`
      rather than the player's own rows. The averages footnote names its column
      group instead of printing a range spanning both denominators.

- [x] **13. Selectable stat columns on the Players list.**

      The list showed five fixed metric columns while the database held twenty-odd
      season aggregates. It has a column picker now — thirteen by default,
      twenty-three offered, persisted across sessions and season changes.

      The picker is the easy half. The load-bearing half is the **availability
      rule**: a column is offered for a season only when every row that season
      carries a value, so 2022-23's expected family, measured from round 16, is
      withheld rather than shown as a whole-season total. An unavailable column is
      **disabled with the reason on screen**, never hidden. New: `/api/columns`,
      `bootstrap.columns`, `npm run verify:columns`, and `Status` left the table
      to become a picker entry.

      Full record: `CLAUDE-history.md`.

- [x] **14. Games started per gameweek, and defensive contribution hits.**

      A season DC total does not say whether the player clears the threshold.
      Gabriel's 2025-26 is 277 over 30 starts — 9.2 a start against a defender's
      10 — and he hits **11 times in 38**. Three additions: `starts` as a
      per-gameweek column (`St`), a per-gameweek `defcon_hit` (`DCH`), and two
      Players-list entries — the season hit count and hits per start.

      **The first scoring rule the app computes for itself**, so it gets a module
      (`server/src/repositories/defcon.ts`) and the client never compares a number
      to a threshold: the server ships both the per-row 0/1 and the season count
      from one definition. Goalkeepers have no threshold — FPL computes no DC for
      them at all, measured rather than assumed.

      New: `dependsOn` on a column definition, which costs the server nothing
      because both dependencies were already in the bootstrap's five; and
      `npm run verify:defcon`, which reports **two** results that are never
      merged — a cross-derivation that a wrong threshold would pass, and the
      audit's distribution frozen as literals.

      Full record: `CLAUDE-history.md`.

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
  fires. On the live path it means FPL served a _settled_ round with a column
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
- ~~A per-90 toggle on the averages row.~~ **Still open**, and item 12 did not
  touch it — but note that `Normalization` in `lib/averages.ts` is still the
  seam, and the footnote now has a model (`buildFootnote`) that would need a
  third form of words for it. Whichever item lands it owns saying what "per 90"
  divides by in the sentence, since "appearances" stops being the denominator.

## Design Decisions

- Postgres is the source of truth. The FPL API cannot serve previous seasons at
  gameweek granularity, and current-season data is wiped at rollover.
- Tables first, charts later. Get the data layer right before adding visualisations.
- Dark theme (#0f0f23 background, #00ff87 FPL green accent). See Known Issues, the
  current UI does not match this.

## Working Agreement

- Read this file and `docs/data-profile.md` before starting any task.
- **`CLAUDE-history.md` is the other half and is deliberately not read by
  default.** It holds the full Phase 1 item records; this file holds a stub per
  item. Read the relevant record before planning around what an item decided,
  and before repeating any claim a stub makes — a stub is a four-line summary of
  a four-page argument and is exactly the kind of thing "trace a claim to the
  code before repeating it" exists to catch.

  The split exists because this file hit 195k characters against a 150k context
  budget: a fifth was being silently dropped, and nothing indicated which fifth.
  **Keep it that way.** New item records go in `CLAUDE-history.md` with a stub
  here; rules, invariants, Known Issues, Current State and schema notes stay
  here, because they are what the next session has to reason from.
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
- **After changing a module the client imports, force one HMR cycle and read the
  dev server log.** It must show `hmr update` with **no** `hmr invalidate` and no
  Fast Refresh warning. React Fast Refresh only handles a module whose exports
  are all components, so adding one non-component export turns every subsequent
  edit to that file into a full page reload.

  On the checklist because item 9 shipped exactly that defect and **nothing else
  could have caught it**: tests, `tsc` and the browser pass are all silent, since
  it degrades the edit loop rather than the app. It surfaced from a background
  task's exit code, by accident, after the item was written up.

  **The trigger must be a real content change.** `touch` alone produces no HMR
  event at all, and no event reads exactly like a pass.
- **Vary one condition at a time. A comparison that varies two measures
  neither**, and the failure is invisible, because the number it produces looks
  perfectly reasonable — there is no error, no outlier and nothing to notice.

  Item 9 briefly tabled a 706 ms cold sample against 394/399 ms ones as rival
  estimates of a single quantity. They differed in the preconnect links **and**
  in the asset size, so no subtraction between them meant anything. **Two
  readers checked that table carefully; both caught the first difference and
  both missed the second.** That is the argument for making it a rule rather
  than trusting review to catch it.

  Not a timing rule. It applies to any before/after in this project: an ingest
  re-run that changes both the source file and the scoping predicate, a query
  compared across two seasons *and* two column sets, a render measured on two
  page states.

  **Where a second condition genuinely cannot be held fixed, the comparison is
  not evidence.** Label it as such and report the two measurements separately,
  each with its conditions. Do not report a delta — a delta asserts that
  everything else was equal.
- **Pre-commit to the paired differences and to N, not to a range.** Both fixed
  before the first sample; that part of the discipline works and stays.

  The preconnect A/B pre-committed to comparing the between-arm difference
  against the **within-arm range**, and a range is fixed by the single worst
  sample and grows with N. One unexplained 1321 ms outlier set it at 962 ms, so
  **no effect under about half a second could have resolved** and the null was
  returned by the rule rather than by the data.

  An alternating A/B/A/B design carries its power in the **paired differences** —
  that is the entire reason for pairing — and testing the raw arms throws the
  pairing away. Pre-committing to the wrong statistic is not a safeguard; it
  just fixes the wrong answer in advance.
- **Never use `git checkout --` to revert a mutation in a working tree full of
  uncommitted work.** Item 14 reverted one mutated file with
  `git checkout -- server` and discarded every uncommitted item-14 edit to
  tracked server files with it; only the three new files survived, because they
  were untracked. **Copy the target file first and restore from the copy**, which
  is what the remaining ten mutations did.

  Same class as the `pkill -f` entry below: a blunt instrument whose blast radius
  is larger than the thing it is aimed at, and whose damage is silent — a
  reverted file type-checks perfectly.

- **Confirm the tree is clean before starting an item, and understand that this
  is what bounds the damage when something like the above happens.** It is not
  hygiene and it is not only about git.

  The item 14 restore was reconstructed **from conversation context, not from
  disk**. The claim that it was complete rests entirely on the tree having been
  clean at item start: everything `git checkout` could have discarded was
  therefore item 14's own work, all of it in the session that was rebuilding it.
  Start an item on a dirty tree and that argument disappears — some of what
  vanishes was written before the session began, nothing knows what it was, and
  the loss is silent.

  So the general rule, which outlives git: **a destructive operation's blast
  radius is bounded by how well you know what was in the working tree.** The
  clean-tree check at item start is what converts "restore from context" from a
  hope into a complete restore. Any recovery that leans on the session's own
  memory needs that precondition to have held, and it can only have held if it
  was checked.

- **`pkill -f` matches its own command line.** It killed the shell running it
  twice during item 9, once mid-task, because the pattern appeared in the `pkill`
  invocation itself.

  Mitigations, both already in use: start dev servers **detached** (`nohup … &`
  then `disown`) so they survive an unrelated kill, and match on something
  narrower than a substring that also appears in the kill command — a port, a
  full script path, or a recorded PID.
- **Check this file's size at the START of an item, not at the end.** The budget
  is 150k characters; item 14 ended at ~145k, and the trim it needed could only
  be scheduled for item 15 because by the time the record was written the room
  was already gone. A file that has to be trimmed is trimmed while there is still
  appetite to do it properly — see the boxed note at the top of Phase 1.

- End each session by updating the Current State section above so the next
  session starts from truth rather than a stale description, and by writing the
  item's record — **in `CLAUDE-history.md`**, with a stub here. Items 10 and 11
  skipped their record entirely and the client test count drifted from 82 to 134
  unnoticed across two items, because there was nowhere the number was being
  restated. The record is where a measurement survives; the stub is only a
  pointer to it.

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

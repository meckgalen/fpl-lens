# The test suite

A map of what `npm test` covers: which files exist, what each one pins, and the
reasoning behind the ones whose shape is not obvious.

**Moved out of `CLAUDE.md` in item 15, verbatim.** It lived in Current State and
was the single largest block in that file at 18,165 characters. It is a map of
the suite as it stands rather than a record of any one item, which is why it is
one file here instead of being split across `docs/items/`.

The conventions this suite is written to — mock at `services/api.ts` rather than
at `fetch`, drive keyboards with `@testing-library/user-event` rather than
`fireEvent`, two runners rather than one — are stated in `CLAUDE.md` and are not
restated as rules here. What follows is the catalogue.

---

## The counts

`npm test` runs **two suites on two runners**: **142 server tests** and **187
client tests**, all passing. They are counted separately on purpose — two
runners print two summaries, and a combined figure would be maintained by hand
against neither of them.

---

**Server — `node --import tsx --test`, against the populated database.** Ten
files, one of which touches no database — see `comparison/thresholds.test.ts`:

- `server/src/comparison/cohort.test.ts` — the comparison endpoint's data: the
  axis set, the band, the two quotients and the cohort floor. **Three kinds of
  test, and the split is the interesting part.**

  *Value anchors* reproduce the nine 2025-26 defender medians measured by hand in
  item 16 step 1, before this code existed. *The convention* is pinned separately
  on GK 2025-26, and has to be: that cohort is **even** (n=22), where
  `percentile_cont` gives 111 and the implemented `percentile_disc` gives 109 —
  the nine anchors are n=109, odd, where both conventions agree, so they pass
  under either and cannot test it. Confirmed by mutation: swapping in
  interpolation turns the GK test red and leaves all nine anchors green.

  *The floor* needs synthetic rows, because no real (season, position) has a
  cohort between 1 and 9 — the smallest is 20 goalkeepers — so nine defenders and
  ten, in a rolled-back transaction, is the only way to put a value on the
  boundary. Its synthetic season is `'2097-98'`, registered in
  `test/synthetic-seasons.ts`.

  Also here: the drift guard for the two quotients whose only other
  implementation is on the client, asserting the chart's `Pts/£` equals the Pts
  and Price columns rendered beside it for every one of 2025-26's defenders; and
  both null guards, because `null / 5` is `0` in JavaScript and an unguarded copy
  renders a confident `0.00` for a player nobody measured.

- `server/src/comparison/thresholds.test.ts` — the comparison chart's frozen
  axis thresholds, **shape only, and the split from the values is the point**.
  Pinning a ceiling here would restate the constant next to itself, where the two
  copies agree by construction; the values are checked by
  `npm run verify:thresholds`, which re-derives them from the database and is not
  in the suite because it needs the ten complete seasons ingested. What is left
  is what a test can hold and what survives any re-derivation: the canonical axis
  order preserved in all four pruned sets, the 7/10/10/8 memberships, saves
  belonging to the keeper alone, forwards having neither CS nor DCH/St, every
  threshold being drawable (floor strictly below ceiling) and carrying a
  non-empty ascending derivation set, and the re-derivation rule marking exactly
  DCH/St and xGI.

  **The only server file that touches no database**, so it needs no synthetic
  season and takes no part in the 40P01 reservation scheme.

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
  The `history_past` cross-check in the item 5 record
  (`docs/items/item-05-gameweek-sync.md`) is
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
  (`docs/items/item-09-club-jerseys.md`) for why the cache lives there.

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
  of — see `docs/items/item-03-keyboard-reach.md`.
- `client/src/pages/Dashboard.preseason.test.tsx` — the three rankings with
  nothing to rank. The load-bearing assertion is the **negative** one: the
  message must not promise Gameweek 1. See the item 4 record
  (`docs/items/item-04-live-season-ingest.md`) for the window in which that
  promise is false.
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

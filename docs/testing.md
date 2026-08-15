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

## The two suites

`npm test` runs **two suites on two runners**, and they report separately on
purpose — two runners print two summaries, and a combined figure would be
maintained by hand against neither of them.

**Neither total is written down here.** The figures that used to sit in this
paragraph drifted across several items and were wrong by 13 and 60 when item 20
measured them — while sitting directly under a sentence explaining why the
counts are kept apart, which lent them an authority they had not earned. The
number informs no decision: what a reader needs from this file is that there are
two suites, what each covers, and why. Read the counts off the runners, which
are the only thing that can be right about them.

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

- `server/src/repositories/hauls.test.ts` — the haul and floor counts, on its
  own, for the same reasons: a scoring rule the app computes for itself, and
  load-bearing for four columns. Synthetic season `'2096-97'`. Synthetic rows
  cover both thresholds either side (9/10/11 and 3/4/5), the inclusive relation,
  a **bench haul** — the seed must contain one or the gate test passes
  vacuously — a double gameweek counted as two fixtures rather than one round, a
  partly measured `starts` yielding NULL rather than an undercount, and the two
  cases that look alike and are not: a registered player with no matches
  (`hauls_started` NULL) against a player with matches and no starts
  (`hauls_started` a real 0, blanked on the client by `perStart`).

  **`describe('the 1.00 bound')` contains an assertion no current mutation can
  redden, and that is deliberate.** `hauls_started <= starts` is what the
  `Pts10+/St` gloss promises on screen, but no player in any season out-hauls his
  start count, so only the `floors_started` twin fires under the obvious
  mutation. The witness counts are in the test's own doc comment and in
  `docs/items/item-19-hauls-and-floors.md`; do not delete the clause for lacking
  a failing mutation. It also asserts its filtered set is non-empty per season
  and freezes 2022-23 at 117, since the "both non-null" filter excludes seven
  seasons outright and could otherwise pass on nothing.

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
gained `St`/`DCH` and the assertion that `St` is **not** averaged.

Item 19 added four more picker entries and the case that pulls in two
directions on one screen: on 2026-27 `Pts10+` and `Pts4+` stay **enabled** and
render `0` while `Pts10+/St` and `Pts4+/St` are **disabled** — the counts read a NOT NULL
column and have no unmeasured state, the ratios divide by `starts` and do. Note
`Players.columns.test.tsx`'s GW16 count went from four entries to **six**, and
that number is meant to move whenever a column starts depending on `starts`;
it is the signal, not the maintenance cost. Components
are rendered and the API
is mocked at `services/api.ts`, not at `fetch`: mocking the transport would
additionally pin URL shapes and `res.ok` handling, which the server suite
already covers. `@testing-library/user-event` drives anything involving a
keyboard — `fireEvent` dispatches a synthetic click and so cannot tell a
`<button>` from a `<div onClick>`, which is the entire distinction item 3 turns
on. Twenty-four files:

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
  **"from X"** (arrived and still being recorded) and **"X to Y"** (recorded,
  then stopped). Since item 21 `describeRecordedIn` returns the phrase **without
  a verb** and the two consumers add what they need — the sentence writes
  `· recorded {phrase}.`, the picker's tag renders it bare — so the file also
  pins the tag branches, and above all the three that decline a tag rather than
  compress into something false. Holds the unplayed-newest-season case that
  shipped wrong — no handwritten fixture catches it, because a handwritten
  fixture stops at a season with data — its opposite, and the
  recorded/dropped/recorded-again shape that the defensive trio really has and
  that the UI cannot currently reach.

  Also here since item 16 step 4: **the client half of the comparison chart's
  two-language guard.** `Pts/£` and `DCH/St` are computed in this file *and* in
  `server/src/comparison/cohort.ts`, where the band forces a copy. The server's
  own drift test restates the formula inline, so both sides of that assertion
  are server code and the client's `perMillion` is not in it at all. What ties
  the two together is that each is pinned to the same externally-derived
  number — item 16 step 1's psql table. Guéhi 2025-26 is 179 points at £5.1m and
  35.10 on both sides; Gabriel's `11 / 30` was already here from item 14.

  Item 19 added `describe('hauls and floors per start')`, covering the same
  three guards through the shared `perStart` — which `hitsPerStart` now
  delegates to, so the DCH/St cases above are simultaneously the regression test
  for that delegation. The case worth knowing is **"reads the gated numerator,
  not the ungated count beside it"**: `hauls` and `hauls_started` differ in the
  factory precisely so reusing the wrong one reads 0.24 instead of 0.20 rather
  than agreeing. Plus the 1.00 bound rendering as `1.00`.

- `client/src/pages/Comparison.test.tsx` — the comparison page's fetching and
  state (item 16 step 4). Twenty-six tests over three properties a chart cannot
  be built on top of if they are wrong, plus two the browser pass added. The geometry
  is not here — see `radar.test.ts` and `ComparisonRadar.test.tsx`.

  **The loading state is real**: serving the thresholds rather than compiling
  them in means the page has no axis configuration until they land, which item
  16 step 2 recorded as an accepted cost and this is what stops it being
  quietly dropped. **A trace is a (player, season) pair**: a trace added on one
  season is still asked for under that season after the selector moves.
  Confirmed by mutation — a player-keyed `plan` turns exactly three tests red.
  **An unavailable axis is dropped, never holed**, and the load-bearing case is
  the one an obvious implementation gets wrong: reading the axis list off the
  *selected* season alone passes when the selected season is the restrictive one
  (a 2016-17 band with a 2025-26 trace) and fails when it is the generous one.
  Both directions are tested; the mutation leaves the first green and turns the
  second red.

  **StrictMode is written out by hand** rather than reused from `renderInApp`,
  because these tests swap the provider's value with `rerender`. It is not
  ceremony: two tests here originally used `mockImplementationOnce`, which under
  a double-invoked effect answers the first call and resolves the second, so the
  loading state they exist for never rendered.

  **The band draws only when every trace sits on the selected season**, which
  is one condition covering two failures: traces on two seasons, where there are
  two cohort medians and the selector picks between them by accident, and traces
  all on one season that is not the selected one, where a median is drawn from a
  season with nothing on the chart. Four tests. Two of them exist to stop the
  condition being written wrong in either direction — two traces sharing one
  season keep their band, and zero traces keep theirs. Three mutations run:
  dropping the rule turns the spanning test red; `traces.length > 1` turns the
  shared-season test red while leaving it green; and session 1's narrower
  `distinct seasons > 1` turns *only* the not-the-selected-season test red.

  **A dropped axis is named with its reason**, from `resolveColumn` — the column
  picker's own function, because an axis key is a `PLAYER_COLUMNS` key. Two
  tests, and the second is the one that needed a factory fix rather than a code
  fix: the helper built every season's bootstrap with 2025-26's availability, so
  the page reported the wrong reason and nothing noticed. Fixed by making the
  availability move with the season, which is what let the *other* branch be
  pinned — an axis dropped because the OTHER season could not answer it, where
  this season's availability cannot explain the absence.

  **A season with no matches gets an empty state rather than a chart**, gated on
  `bootstrap.columns.measured`. Every value is 0 and 0 minutes is below the Min
  floor, so the chart drew bare spokes and a dot in the bullseye — and it is the
  default season. The axes are still named, which the test pins.

  **The axis captions are queried on the chart specifically.** The values table
  repeats every caption in its first column, so a bare `getByText('Pts/£')` now
  matches two nodes — the same collision item 12 hit with "Selected".

  **The trace limit states its reason rather than the rule.** "Maximum 4"
  restates the number; the sentence a reader can act on is that four is as many
  as colour can tell apart. Item 13's disabled-with-a-reason, applied to a
  control instead of to a column.

- `client/src/lib/radar.test.ts` — the radar's geometry as arithmetic (item 16
  step 4). Nineteen tests, each written against **the wrong
  implementation it would otherwise agree with** rather than against a plausible
  number: `v / ceiling` for `(v - floor) / (ceiling - floor)`, which is right on
  six of the eleven axes and puts a defender on exactly 1,200 minutes at 35% of
  the radius; `>=` for `>` on the clip test, which marks a value that is exactly
  at a ceiling — and `minutes` ceilings at 3,420, the maximum the competition can
  produce, so an ever-present player hits it; and filtering the nulls out before
  drawing, which closes the ring through a chord across the missing spoke at
  roughly the average of its neighbours.

  Also the re-spacing: a seven-axis chart is not a ten-axis chart with three
  spokes missing, so every spoke after the first sits somewhere different.

  **Both ends of the scale clamp, and both boundaries are pinned the same way.**
  Exactly at the ceiling is not marked (`minutes` ceilings at 3,420 = 38 × 90, so
  an ever-present player hits it — Virgil did, in the browser); exactly at the
  floor is not marked either, and that number is the cohort gate itself, so every
  player who scraped in has it. The floor marker points **inward** where the clip
  marker points outward, which is the whole distinction.

  Mutations run, and what each turned red: the ratio impostor → 2; `>=` on the
  ceiling → 2; `<=` on the floor → 2; the floor marker pointing outward → 1;
  filter-and-close → 3. Nothing else in the suite moved for any of them, which is
  what says the geometry is pinned here and nowhere by accident.

- `client/src/components/ComparisonRadar.test.tsx` — what the radar draws, once
  the shapes are in a document: ring count, spoke count, which shape a clipped
  vertex gets, whether an outline closes, and that the band is painted first so
  it sits underneath. Twelve tests, no API mock and no provider — the component
  takes one prop and fetches nothing.

  **The `radar-*` class names it queries are structural hooks, not styling.** An
  SVG shape has no role and no text, and the alternative was matching on `fill`,
  which would couple every structural assertion to a colour. This is not item 3's
  class-level assertion: these name what a shape *is*, and claim nothing about
  appearance that jsdom cannot see.

  The case worth the file is **two traces clipping the same axis**. Both clamp to
  the same point, so unmarked they are one triangle where there are two; the
  markers are fanned along the outer ring at a single radius and both true
  numbers are printed beside the caption.

  **Below the floor is the same case one end down**, and four tests cover it: the
  vertex is marked and the true number printed; exactly at the floor is not
  marked; several floored traces get **one** marker and a line each, because
  floored vertices coincide at the centre where no fan stays inside the axis's
  own sector; and a chart with one of each has markers pointing both ways.

- `client/src/components/ComparisonTable.tsx` has no file of its own: it renders
  through `Comparison.test.tsx`, and what it asserts there is the collision above
  — the captions it repeats are why the chart's own are queried structurally.

- `client/src/services/api.comparison.test.ts` — the thresholds memo, which is
  `fetchColumnHistory`'s with one clause **reversed**. `fetch` is mocked rather
  than `services/api.ts` — `Players.columns.test.tsx`'s exception, for its
  reason: the memo is the mechanism under test. The clause worth the file is the
  rejection. The column matrix memoizes its failure deliberately; these
  thresholds must not, because a page with no floors and ceilings has nothing to
  degrade to and a memoized failure leaves it dead for the session. Two opposite
  calls from one shape, which is the kind of thing later tidied into agreement.
  Proved by mutation: dropping the `.catch` turns it red.

- `client/src/pages/Players.columns.test.tsx` — the picker, persistence and the
  sort fallback. **The load-bearing assertions are the negative ones**: that an
  unavailable column is disabled *with a reason* rather than silently missing,
  and that a hidden column is still *remembered*. Mocks `fetch` rather than
  `services/api`, which is this suite's one exception to its own rule and is
  required: mocking `fetchColumnHistory` would replace the module-scope memo the
  request-count test exists to pin.

- `client/src/pages/Players.club.test.tsx` — item 18's club filter. The
  composition assertions are the point: a non-default sort, a search and a club
  are set together, then one is changed. Both halves of every filter assertion
  are named — "the list got shorter" is also true of a filter matching nothing.
  Two season-change tests, in opposite directions: a club present in the new
  season survives, one absent resets. The unconditional-reset mutation breaks
  everything and isolates nothing; the season-keyed one isolates exactly the
  survival test.

- `client/src/pages/Players.incremental.test.tsx` — the roster arriving in
  chunks. `IntersectionObserver` is **stubbed rather than mocked away**, so the
  test fires the callback itself and proves observing the sentinel is what grows
  the list — inside `act`, since the callback is not a React event and the state
  update is otherwise never flushed. The reset-on-filter test deliberately
  searches a term matching **every** player: an earlier version used a narrower
  one, which dropped the list under a chunk on its own and so held whether or not
  the reset existed.

- `client/src/pages/Comparison.candidates.test.tsx` — the picker offering
  everyone. The regression guard is the number **8**, the old cap, which the
  first test asserts it is now above. The match count in the header is the
  load-bearing part: it is what separates "these are all of them" from "these are
  the first sixty".

- `client/src/lib/comparison.axes.test.ts` — that every axis can explain itself.
  **The assertion it refuses to make is "eleven non-empty strings exist"**, which
  would pass against a description equal to the label, to the title, or to any
  placeholder. It asserts inequality with both instead, plus the specific facts
  items 13 and 14 settled for the two derived axes. The null-not-fallback case is
  the clause that stops someone tidying `axisDefinition` into symmetry with the
  Players list.

  **Item 21 added the converse, and it is a different kind of clause**: no
  `PLAYER_COLUMNS` entry outside `COMPARISON_AXES` may carry a `description` at
  all. The others ask whether each axis is explained; that one bounds the field.
  After item 21 moved the Players header hover to `gloss`, a `description` on a
  non-axis column is read by **no surface**, so it cannot be seen to be wrong and
  duplicates the `gloss` beside it — the two-fields-one-fact drift the split
  exists to prevent, arriving through the door the split opened.

- `client/src/lib/fixtures.test.ts` — where the Fixtures page opens, and how it
  steps. Every stepping test uses 2019-20 or 2022-23, because a `1..38` loop and
  a correct derivation agree on the other nine seasons. **The partly-played-round
  case is hand-built and is the mutation target**: no stored season has one, so
  reverting the rule to "the last finished round" turns that test and only that
  test red.

- `client/src/pages/Fixtures.navigation.test.tsx` — the same two hazards at page
  level, plus the two Results empty states and the difficulty restack. The
  restack test anchors on the **club**, not the rating: the FDR legend renders a
  chip for every value 1-5, so `getByText('2')` matches two nodes.

- `client/src/App.test.tsx` — the shell, and **the first test `App.tsx` has ever
  had**. That absence is why item 3 could only pin the Dashboard's half of the
  click-through contract, and the `detailPlayer` fix cannot be tested anywhere
  else: it is a bug about which object the shell hands down. Fourteen tests: the
  selector's options and their order, refetching with the new season, the app
  _not_ blanking mid-switch, persistence of the **served** season, recovery from
  a stored season the database does not have, a network failure _not_ being
  treated as one, the sidebar deadline block in both directions, the header and
  gameweeks agreeing across a season change, the no-false-empty-state window,
  and the not-in-the-game state — plus, since item 16 step 4, that the
  Comparison page is reachable from the nav and opens on its own loading state.

  It does **not** use `renderInApp`: that helper supplies a `BootstrapContext`,
  which is precisely what is under test here. StrictMode is applied by hand for
  the reason `render.tsx` gives.

- `client/src/pages/Fixtures.test.tsx` — six tests, and the page's first. The
  centrepiece is the **round collision**: two seasons that both end at round 38
  produce the same derived round, so an effect keyed on it alone cannot see a
  season change. Plus that the season is sent at all, that fixtures clear while
  the new ones load, that the chosen view survives one, and where each kind of
  season opens — the last-round/Results and first-round/Difficulty branches,
  each asserting the **tab as well as the round**, since the tab is half the
  rule and is what a wrong branch condition shows up in first. Rewritten in item
  18: three of these queried tabs by the names `GW38 Upcoming` / `GW38 Results`,
  which the two-views-of-one-round model retired.

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

# The item records

One file per Phase 1 item: `item-NN-<slug>.md`. **Every item has one, and a stub
is not the record** — read the file before planning around what an item decided.
The working agreement's "trace a claim to the code before repeating it" applies
doubly to a four-line summary of a four-page argument.

`CLAUDE.md` carries a one-line index of these, and nothing more. The stubs below
are what it used to carry: three to six lines each, moved here in item 17 when
sixteen of them had grown to 9,733 characters inside a file with a hard ceiling.
A stub's only honest job is helping a reader decide whether to open the file, and
a one-line entry does that as well.

Items 10 and 11 wrote no record at the time, so their files are their commit
messages, reconstructed in item 15 and labelled as such.

Phase 0 is one file, `phase-0.md`, covering all seven of its steps.

---

- [x] **1. Career history on the player detail page.** → `70003f4`

      `GET /api/player/:code/career`, one row per season, each expanding into
      that season's gameweeks by re-using `GET /api/player/:code?season=X` and
      the same `StatsTable`. Rewrote API identity rule 7 rather than satisfying
      it: a response spanning seasons labels every row, not the body. Found the
      StrictMode double-fetch — a fetch fired inside a `setExpanded` updater.

- [x] **2. Client-side testing.** → `a4cefed`

      Vitest in jsdom, React Testing Library, the API mocked at
      `services/api.ts`. Two runners rather than one, with root `test` as
      `run-s --continue-on-error` so a red server suite cannot hide the client
      result. The mutation check found a test that goes red only when **both**
      halves of a fix are reverted — so "either half alone is green" must never be
      read as "either half alone is fine".

- [x] **3. Keyboard reach and click-through.** → `6c01bb6`

      Career rows were `<tr onClick>` that no keyboard could reach, and the
      Dashboard's three rankings had no click handler at all. Four `<tr>`/`<th>`
      handlers became real `<button>`s, plus one focus bug. The browser pass
      caught a regression no class-level test could — every sortable table's
      header row collapsed with every asserted class present, because jsdom does
      not lay out.

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
      results **deliberately never merged into one**: a replay of 2025-26's CSV
      through the new mapper, which is strong about the new code and silent about
      the source, and a `history_past` cross-check, which is the other half. Also
      found the 2024-25 `defensive_contribution` gap.

- [x] **6. The `history_past` cross-check, run wide.** → `59b1860`

      `verify:history-past` diffs every player-season we hold against FPL's own
      totals, over all ten seasons and every column. Nearly all of the drift is
      attributable to **fixtures where a column reads 0 on every row of a match
      that was played**, which is what item 7 then fixed; a small residue is
      genuinely unexplained and is recorded as such. **Drift direction is what
      pointed at the cause** — ours is lower almost everywhere, and revision goes
      both ways while loss only goes down.

- [x] **7. Store NULL where the source holed a column.** → `cdb5407`

      The hole rule, `server/src/ingest/holes.ts`, applied by both gameweek
      writers, and `measuredSum`, which stops a season aggregate reporting a
      partly measured column as a whole-season total. **The ICT quartet was
      excluded on proportion**: its holes are an order of magnitude smaller than
      the expected family's, and blanking them would cost every player in two
      seasons their ICT total to flag a few percent.

- [x] **8. A season selector.** → `b34876b`

      All eleven seasons on every page. The selected season is
      `bootstrap.season` — the one the server actually served — rather than a
      second piece of state free to disagree with the payload on screen. Carried
      the `detailPlayer` snapshot fix, and made `currentGameweek`/`nextGameweek`
      return null instead of a plausible wrong answer.

- [x] **9. Club jerseys, and the photo loading work.** → `79950db`

      `PlayerShirt` on every player row, falling back shirt → club badge → grey.
      The audit ran first and reshaped the item: a shirt exists for **exactly**
      the current season's twenty clubs and no others, so the planned grey
      fallback would have blanked half of 2016-17. The header photograph got much
      lighter. Holds the preconnect A/B and the post-mortem on its stopping rule,
      which returned a null by construction.

- [x] **10. Sticky headers, pinned columns, row striping.** → `2ce4fd9`

      Column headings scrolled away vertically and the identifying column
      scrolled away horizontally on three wide tables. Adds sticky headers, pins
      Opp beside GW, pins the Player column, stripes all four tables, and moves
      row background colour from the cell to the row (`lib/rowSurface.ts`). The
      load-bearing discovery: `overflow-x: auto` with `overflow-y: visible`
      computes `overflow-y` to **auto**, so every wrapper was already a vertical
      scroller in which a sticky header never sticks.

- [x] **11. Averages divide by appearances, not fixtures.** → `5fad1b8`

      The averages row divided by every row shown while the career row six inches
      above divided by appearances. New: `client/src/lib/averages.ts`, holding
      the normalization strategies, per-column denominators, `roundHalfEven` and
      `fmtPpg`. The numerator and denominator filters are deliberately **not**
      symmetric, which API identity rule 5 now records in full.

- [x] **12. The selected season merged into the career table.** → `0becf6d`

      One career table with the selected season as a row in it, marked in place
      and expanded by default. Both section headings went rather than being
      renamed — item 8's selector made "This Season" and "Previous Seasons" false
      claims. Filters moved onto every expansion, so their state is per season.
      `rounds: number[]` is new on every career row, derived from `fixtures`
      rather than the player's own rows. The averages footnote names its column
      group instead of printing a range spanning both denominators.

- [x] **13. Selectable stat columns on the Players list.** → `5c61e16`

      A persisted column picker on the Players list. The picker is the easy half.
      The load-bearing half is the **availability rule** — a column is offered for
      a season only when every row that season carries a value, so 2022-23's
      expected family is withheld rather than shown as a whole-season total, and
      an unavailable column is **disabled with the reason on screen** rather than
      hidden. New: `/api/columns`, `bootstrap.columns`, `npm run verify:columns`.

- [x] **14. Games started per gameweek, and defensive contribution hits.** → `5aca74f`

      A season DC total does not say whether the player clears the threshold.
      Adds `starts` and a `defcon_hit` 0/1 per gameweek, and two Players-list
      entries. **The first scoring rule the app computes for itself**, so it gets
      a module (`server/src/repositories/defcon.ts`) and the client never compares
      a number to a threshold. Also new: `dependsOn` on a column definition, and
      `npm run verify:defcon`, which reports two results that are never merged.

- [x] **15. One record per item, and a size check that fails.**

      `CLAUDE.md` hit its read limit for the second time, item 13's split having
      been consumed by one item. One file per item under `docs/items/`, the test
      catalogue to `docs/testing.md`, Deferred to `docs/roadmap.md`. **The content
      test** — "would a reader need this to avoid writing wrong code tomorrow?" —
      moved out most of what a pure record-dissolution would have left, and most
      of that came from sections nominated to stay, because the mixing is *within*
      sections. Also resolved five flagged invariants and made the budget a
      failing test.

- [x] **16. The comparison chart's frozen thresholds.**

      Thresholds before any chart, because freezing them is what makes two
      seasons comparable and every other decision on the page rests on them. 35
      floors and ceilings, per position, served by
      `GET /api/comparison-thresholds` — **on the server so that re-deriving one
      is a server-only change**, and so the check can import them without a third
      cross-package import. **The ceilings pool ten seasons and the average band
      must not**: defensive contribution points broke the defender distribution
      at 2025-26, so a pooled band would render the typical modern defender
      permanently above it. Also killed a rule of its own: the clipping trigger
      fired on 18 of 36 axes as arithmetic rather than as data.

      Step 3 added `GET /api/comparison` — the values drawn against those scales,
      and **the band computed per season for the reason above**. It writes no SQL:
      every axis is a `PLAYER_COLUMNS` key, so it reads `listPlayerTotals`'s rows.
      The median is `percentile_disc` — an actual member value — and the test that
      pins it uses an **even** cohort, because every odd one agrees under both
      conventions and would pass either.

      Step 4 is the page, in three sessions of its own. **Session 1 is fetch and
      state, with no chart**: the route, the two fetches, the loading state the
      served thresholds make mandatory, and a trace keyed on **(player, season)**
      so cross-season comparison is reachable rather than a later rewrite. Also
      found step 3's drift guard comparing server code against server code, and
      gave it a client-side anchor on the same number.

- [x] **17. What `CLAUDE.md` is for.**

      A criterion rather than a fourth record move, because item 15 had already
      shown that moving records was no longer the lever: the sections that stay
      absorb ~4k an item regardless. The file is read in full before the task is
      known, so **a section earns its place only if a session that has not yet
      been told its task would write wrong code without it** — re-derivable and
      local both go. 117,987 to 98,258, and the fourteen invariants that were
      hiding in Current State became rules.

- [x] **18. Pre-deployment fixes.** → [`item-18.md`](item-18.md)

      Five browser-pass defects, four steps. Rendering the whole roster was
      **measured and refused** — 792ms to mount 865 rows against 215ms for 200,
      with memoization, `table-layout: fixed` and `content-visibility` each
      tried and each worth nothing — so both lists grow as they scroll and say
      what they are withholding. The Fixtures round rule reads the **deadline**,
      never `finished`: `bool_and` skips a partly played round, which no stored
      season can expose, so the test for it is hand-built and is the mutation
      target. A compile-time exhaustiveness guard written as an unused type
      alias is **inert**; it has to fail to construct. Two pre-committed gates
      are recorded as mis-calibrated rather than raised, and every apparent
      renderer freeze was `requestAnimationFrame` throttling in a hidden tab.

      **Step 4a**, a follow-up: the FDR bar it shipped was `w-full`, so width
      tracked the container and was **identical for a 1 and a 5** — the channel a
      reader reads magnitude in, occupied and answering something else. A cap
      halves that distance; only a fixed-width chip aligned to the club's own
      edge removes its cause. `FDRBar` deleted so the legend and the row are one
      component, since a legend has to key against the identical object.

- [x] **19. Hauls and floors on the Players list.** → [`item-19-hauls-and-floors.md`](item-19-hauls-and-floors.md)

      Four columns following item 14's shape. The ratio numerators are **gated
      on `starts = 1`**, so `H/St` and `F/St` cannot exceed 1.00 where `DCH/St`
      can — near-identical fragments that must not be shared, and the one
      definition this item got wrong twice. **`sum()` over zero rows is NULL and
      that does not help here**: the LEFT JOIN gives a player with no matches
      one null-extended row, and the `ELSE 0` makes it a hard zero, so all 564
      players of 2026-27 read a confident 0 until the count guard went back in —
      item 13's vacuous truth in a third place. The counts themselves are **0
      rather than NULL** on the unplayed season, matching `goals_scored` beside
      them, because `total_points` is NOT NULL and has no unmeasured state.
      Frozen distribution in two halves, because the ungated one pins the
      thresholds and pins **nothing** about the gate. A mutation caught the
      *check* rather than the code: part 2B restated its SQL inline, so it
      compared the database to itself and stayed green. Holds the 20 supplied
      findings re-derived against the shipped statistic, and the DEF/MID
      totals-versus-rates split.

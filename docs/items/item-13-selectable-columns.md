# Item 13 — Selectable stat columns on the Players list

Commit `5c61e16`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **13. Selectable stat columns on the Players list.**

      The Players list rendered five metric columns (Pts, PPM, Price, G, A) and
      offered no way to change them, while the database held twenty-odd season
      aggregates. It now has a **column picker**: thirteen defaults, twenty-three
      entries, persisted across sessions and season changes.

      **The picker is the easy half.** The risk was never the popover — it is the
      **availability matrix**, eleven seasons by twenty-three columns, where one
      wrong cell means either a column of dashes or, far worse and silently, a
      partly measured column presented as a whole-season total. That is the exact
      defect item 7 spent a session removing, and this item could have
      reintroduced it through a dropdown.

      **Everything rests on one predicate, stated once and measured:**

      > a column is **available** for a season when every row that season carries
      > a value.

      In SQL, `count(col) = count(*)`. Verified against an independent
      `NOT EXISTS (… WHERE col IS NULL)` derivation on all ten seasons with rows
      × nine nullable columns — **90 of 90 cells**. Against the weaker
      `count(col) > 0` the two disagree on **exactly one season and five
      columns**: 2022-23's `starts`, xG, xA, xGI and xGC, which is precisely the
      hole item 7 found. That single difference is the whole reason for the
      strict form.

      **The blind spot the audit found and the brief did not anticipate: the
      season the app defaults to.** 2026-27 has zero `player_gameweeks` rows, so
      `count(col) = count(*) = 0` and the predicate reads TRUE **vacuously** —
      every nullable column would claim to be available on the season the app
      opens on. Handled at the **season** level rather than per column, because
      it is one fact and not nine: `measured: false` with an empty `columns`
      array, and the client prints the Dashboard's own sentence once.

      **Two routes, and the split follows API identity rule 7 read rather than
      cited.** `bootstrap.columns` answers "what renders now" and is top-level,
      because a bootstrap response is one season throughout — the same argument
      that put `seasons: string[]` there in item 8. `GET /api/columns` answers
      "which seasons have this at all", spans all of them, and so carries a
      `season` on every row, like career rows do. A `Record<season, …>` map was
      the obvious alternative and is the manifest that rule refuses.

      **The cost claim, and how it was met.** The plan's premise was that the
      per-column state is already implied by rows the bootstrap computes:
      `measuredSum` returns NULL per player exactly when that player has an
      unmeasured row, so over the players of a season **with match rows** — NULL
      on every one is `none`, non-NULL on every one is `full`, mixed is
      `partial`. Cross-checked against the SQL form over the whole matrix and
      they agree cell for cell. So availability costs **no query**; only
      `measured_from`, the boundary round for a `partial` column, needs SQL, and
      only on a season that has one — 2022-23 alone.

      **The `matches > 0` filter is load-bearing rather than defensive.** A
      registered player with no match rows has a NULL aggregate for every column
      — not because the column is unmeasured but because he has nothing to sum.
      Counting him drags a fully measured season to `partial` the day the live
      sync starts writing rows mid-season, which is exactly when nobody would be
      looking for it.

      **Measured, end to end, medians of 11 warm runs:**

      | Season | Before | After |
      | --- | ---: | ---: |
      | 2026-27 | 27 ms | 23 ms |
      | 2019-20 | 75 ms | 77 ms |
      | **2022-23** | 91 ms | **105 ms** |
      | 2025-26 | 117 ms | 121 ms |

      Three of the four moved by less than the run-to-run spread; the four new
      aggregate columns (`start_cost`, `matches`, `saves`,
      `defensive_contribution`) ride on the existing scan and `GROUP BY`.
      **2022-23 is the exception at +14 ms and is the only season paying it**,
      being the only one with a partial column. The plan predicted 28 ms for that
      query; measured incrementally it is 14.

      **The boundary query is sequential, not parallel, and that is forced.**
      Which columns are partial is unknown until the aggregate has been reduced,
      so it cannot be fired alongside `listPlayerTotals`. Firing it
      unconditionally would make it parallel and make every season pay for it,
      which is the trade the gating exists to avoid. The plan says "in parallel";
      that phrasing is wrong and this is the correction.

      **`GET /api/columns` measures 57 ms**, 99 rows, 8.3 KB, fetched once per
      page load off the critical path. **The first implementation measured 170
      ms** — more than double the plan's 74-83 ms estimate — and the cause was
      the shape used to keep the unplayed season in the result: driving the
      aggregate from `(SELECT DISTINCT season FROM player_seasons) LEFT JOIN
      player_gameweeks` measures **161 ms** against **51 ms** for the same
      aggregate grouped straight on the fact table. 110 ms to carry one row for a
      season with no data. It is two cheap queries in one `Promise.all` now, with
      the empty seasons folded in afterwards.

      ### A defect the payload caught that no test would have

      `bootstrap.columns` first derived over all nine nullable columns while the
      bootstrap aggregate carries only five — so the four it never queried fell
      out as `"none"`. `none` is a **measured** claim that no player has a value,
      and it was being made about columns nobody had asked about. It read
      `tackles: none` on 2022-23, which is plausible, and would have read the
      same on 2016-17, where tackles is fully measured and `/api/columns` says
      so. Two sources of one fact, disagreeing, one click apart.

      Fixed by making the derivation take its column list explicitly
      (`BOOTSTRAP_NULLABLE_COLUMNS`), so a caller can only speak for what it
      measured. Found by reading the response, not by a failing test.

      ### A wording defect the browser caught that no fixture would have

      On 2016-17 the picker read **"Not recorded in 2016-17 · recorded 2022-23 to
      2025-26"**. Literally true of our rows, and it says xG was *discontinued*.
      It was not — 2026-27 simply has not been played. The cause: the newest
      season records nothing, so no run ever reaches it and every column fell to
      the closed-range form.

      Fixed by anchoring "reaches the present" to the newest season recording
      **anything**, derived from the matrix, rather than to the newest season.
      **No handwritten fixture would have caught this**, because a handwritten
      fixture stops at a season with data — which is why the unit test added
      afterwards builds a matrix whose newest season is deliberately empty, and
      why its opposite (a column that really did stop while later seasons kept
      recording, which must read as a closed range) sits beside it.

      ### The reason strings

      Every disabled entry carries a **complete, true sentence from the bootstrap
      alone**; the matrix only ever appends a trailing "· recorded from …"
      clause. So there is no window in which an entry is disabled and
      unexplained, and nothing changes meaning when the matrix lands. A failed
      fetch degrades to that state permanently and is not surfaced as an error.

      | Case | Shown |
      | --- | --- |
      | `none`, recorded later | "Not recorded in 2016-17 · recorded from 2022-23." |
      | `none`, recorded in blocks | "… · recorded 2016-17 to 2018-19, and 2025-26." |
      | `partial` | "Only recorded from GW16 in 2022-23." |
      | season with no matches | "No matches recorded for 2026-27 yet." |
      | ownership | "Ownership percentage is not stored. FPL publishes it live only." |
      | status | "Live-game field, not stored for a completed season." |

      **`none` deliberately never says "not measured".** That is a claim about
      the world; this app can only speak for its own rows. The distinction is not
      pedantic — after GW1 of a live season is ingested, a column the upstream
      has not populated yet reads `none`, and 2022-23 is the precedent that this
      really happens. "Not recorded in 2026-27" stays true either way.

      **The ownership sentence is the one reason string that is a fact about our
      pipeline rather than about FPL's data**, and is worded to say so. The raw
      manager count exists in `player_gameweeks.selected` for all ten seasons;
      what is missing is the total-managers denominator, which rides on the live
      bootstrap. So the percentage is computable for a live season and lost only
      for the historical ones — "does not exist" would be the wrong sentence.

      **Unavailable columns are disabled, not hidden**, with the reason as
      **visible text rather than a `title`**. Hiding them makes the app look like
      it has never heard of expected goals on 2016-17; a tooltip is invisible to
      exactly the reader the sentence is for.

      ### Persistence, and the one rule it runs on

      `localStorage['fpl-players-columns']` holds the **full** selection, never
      the visible subset; render is `stored.filter(available)`. So a column
      unavailable on the selected season stays selected and returns when the user
      goes back to a season that has it — no reconciliation step and no second
      piece of state. Storing what was rendered would silently forget the choice
      the first time somebody looked at 2016-17. Unknown keys are dropped at read
      against this build's own definitions, since there is no server to validate
      against.

      **The sort needed handling and the brief did not mention it**: if the
      sorted column is not in the rendered set after a season change, the sort
      falls back to the default rather than ordering by a column nobody can see.

      ### Two headers that had to be decided rather than inherited

      `PPM` has meant points per **match** on this page and the Dashboard since
      step 7. FPL's "value" columns are points per **million**. Reusing the
      abbreviation would have silently changed what an existing column means, so
      the two value columns are `Pts/£` (current price) and `Pts/£s` (the price
      the season opened at) — two different questions, and genuinely different
      numbers wherever a price moved. Both go through `fmtPpg`, never `fmtNum`:
      `fmtNum` ends in `toFixed`, which is not an implementation of any rounding
      convention, and item 11 measured the two disagreeing on 111 of 226 tied
      player-seasons.

      ### Build step 1: the width, measured before anything else

      The stopping rule was fixed before the measurement: **1440 must fit with
      real margin; 1366 is a bonus; if 1440 does not fit, trim now.** Trimming
      after the tests, the persistence and the picker all encode thirteen costs
      far more than one edit to the column definitions.

      Chrome refused to resize the maximized window and `devicePixelRatio` is
      1.1, so CSS pixels are not screen pixels; measured in a **same-origin
      iframe** instead, which gives an exact CSS-pixel viewport varying only in
      width.

      | Viewport | `<main>` | Table | Overflow |
      | ---: | ---: | ---: | ---: |
      | 1440 | 1211px | 1146px | 0 |
      | 1366 | 1138px | 1072px | 0 |
      | 1280 | 1051px | 986px | 0 |

      **The number that decides it is the table's min-content width, 921px.** The
      table fills its container and distributes slack, so the columns compress
      with the viewport and `overflow: 0` alone would have been the wrong thing
      to read — it only says "not yet past minimum". First overflow is at roughly
      a **1184px** viewport (0 at 1190, 3px at 1180). No clipping and no wrapping
      at any width; header row a constant 40px from 1440 down to 960.

      **Result: no trim, thirteen stands**, with 290px of headroom at 1440. The
      plan's estimate had predicted 1280 would scroll by ~55px; it clears by
      130px. Its `<main>` arithmetic was the source — it assumed 1152px of
      content at 1440 where the real figure is 1211px.

      ### Verification

      `npm test`: **98 server, 169 client**, both green. `tsc --noEmit` clean in
      both packages. HMR clean on every changed client module. Console clean.

      **Browser pass**, all of it:

      - **Width re-measured after the build and identical to step 1** — 1440:
        1146px in 1211px; 1366: 1072 in 1138; 1280: 986 in 1051; overflow 0 at
        all three, thirteen columns. Nothing grew.
      - **2016-17** — expected family and DC disabled with "recorded from
        2022-23"; tackles/CBI/recoveries are not offered at all, being career-only
        columns. Ten metric columns render.
      - **2022-23** — the four holed columns disabled with "Only recorded from
        GW16", and none of them rendering a partial total.
      - **2026-27** — all five nullable columns disabled with the season-level
        sentence, once each, in the Dashboard's wording.
      - **Add a column, 2025-26 → 2024-25 → back.** Added `Starts`; on 2024-25
        **DC drops while Starts stays** (DC is 2025-26 only, `starts` is full in
        2024-25) and both return on the way back, with 14 keys stored throughout.
        A better demonstration than the plan asked for: two nullable columns
        behaving differently in the same hop.
      - **Sort both directions with the pinned column scrolled right**, at a
        1100px viewport where the table genuinely overflows by 141px. Sorting by
        `Min` both ways preserves `scrollLeft` exactly, and the pinned Player
        column holds at the padding edge while the shirt column scrolls **under**
        it to `-30px` — the single-pin behaviour `PINNED_PLAYER` documents.
      - **Both themes**, with the picker open on 2016-17 so the disabled entries
        and their reasons are on screen in each.

      **`npm run verify:columns`** — new, read-only, and shaped like
      `verify:ppg`: it asks the **shipped** code what the picker would offer
      (importing `client/src/lib/playerColumns.ts`, as `verify:ppg` imports
      `averages.ts`) and compares against a truth query written for the check
      alone, counting NULLs **directly** rather than asking `count(col) =
      count(*)`. **253 cells, 253 agreed, 100%.** Of those, 55 are the genuinely
      derived ones (5 nullable columns × 11 seasons); the other 198 are schema
      facts about NOT NULL columns and are cheap rather than probative. Exits 1
      on mismatch, verified by mutation.

      **Mutation-checked, measured.** Two came back green and were fixed rather
      than written up as covered:

      | Mutation | Result |
      | --- | --- |
      | predicate weakened to `count(col) > 0` | **red**, 4 server tests |
      | `matches > 0` filter dropped | **red**, 3 |
      | season-level `measured` flag removed | **red**, 2 |
      | JS reduction broken, SQL untouched | **red**, 4 |
      | SQL boundary broken, JS min untouched | **red**, 1 |
      | derive over all nine regardless of caller | **red**, 1 |
      | `latestWithData` simplified to "the newest season" | **red**, 2 client |
      | run-splitting dropped (always "from X") | **red**, 1 |
      | availability filter dropped | **red**, 12 |
      | value column switched to `fmtNum` | **red**, 1 |
      | `Pts/£s` switched to `now_cost` | **red**, 1 |
      | matrix clause never appended | **red**, 4 |
      | unavailable columns hidden not disabled | **red**, 5 |
      | module-scope memo removed | **red**, 1 |
      | persistence stores a trimmed subset | **red**, 1 |
      | predicate weakened → `verify:columns` | **exit 1**, 4 mismatches |
      | **sort-key fallback removed** | **green** → test rewritten → **red** |

      **The green one is the entry worth reading.** The sort-fallback test
      unmounted and remounted between seasons, and a remount resets `sort` to the
      default — so the assertion was checking the default rather than the
      fallback, and passed against a fallback that had been deleted. Rewritten to
      change the season on the **mounted** component via `rerender`, which is
      what `App.tsx` actually does. The mutation then goes red.

      That is the same failure mode item 2 recorded for the double-fetch test:
      a test that passes for a reason unrelated to the thing it names.

      **Two test-harness problems found on the way**, both invisible rather than
      failing. `Players.test.tsx` had no API mock at all, so it made a **real
      `fetch`** that jsdom rejected and the page's deliberate `catch` swallowed —
      passing for the wrong reason. And the request-count test originally mocked
      `fetchColumnHistory`, which **replaces the very memo it exists to pin**; it
      mocks `fetch` instead now, leaving the real memo in place, and confirms one
      request across a mount, three picker opens, an unmount and a remount.


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The bootstrap latency measurements

_Was `CLAUDE.md` lines 535-581._

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
— see `docs/items/item-08-season-selector.md`.

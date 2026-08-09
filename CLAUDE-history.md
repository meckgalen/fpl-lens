# FPL Lens — Phase 1 item records

The full record of every Phase 1 item: what it changed, what it decided, what it
measured, and what it deliberately did not do.

**Split out of `CLAUDE.md` in item 13.** That file had reached 195k characters
against a 150k context budget, so roughly a fifth of it was going unread every
session with nothing saying which fifth — and the unread fifth included the
working agreement and the data rules every build reasons from.

**Nothing here was rewritten on the way across.** These entries are the original
text, moved verbatim. Several measurements — the preconnect A/B's twelve samples,
the 2016-17 shirt/badge request counts, the mutation tables — exist in no other
place, which is why the split copied rather than summarised.

**What stayed in `CLAUDE.md`** is what has to be in context every session: the
working agreement, the data layer rules, the API identity rules, Known Issues,
Current State, the schema notes and Deferred. Each item keeps a stub there —
three or four lines and a pointer here — following the pattern items 10 and 11
already used.

So: `CLAUDE.md` is what you must follow. This is where it came from. When a rule
there looks arbitrary, the reasoning is almost always in the item below that
introduced it.

| Item | | Commit |
| ---: | --- | --- |
| 1 | Career history on the player detail page | `70003f4` |
| 2 | Client-side testing | `a4cefed` |
| 3 | Keyboard reach and click-through | `6c01bb6` |
| 4 | The 2026-27 season, from the live API | `5a611de` |
| 5 | The incremental gameweek sync | `2e5918c` |
| 6 | The `history_past` cross-check, run wide | `59b1860` |
| 7 | Store NULL where the source holed a column | `cdb5407` |
| 8 | A season selector | `b34876b` |
| 9 | Club jerseys, and the photo loading work | `79950db` |
| 10 | Sticky headers, pinned columns, row striping | `2ce4fd9` |
| 11 | Averages divide by appearances, not fixtures | `5fad1b8` |
| 12 | The selected season merged into the career table | `0becf6d` |
| 13 | Selectable stat columns on the Players list | `422871b` |

Items 10 and 11 were already stubs before the split and stay that way: their
commit messages are detailed records in their own right, so `git show` is the
full account for those two.

---

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

      (**The `scroll` prop no longer exists.** Item 12 merged the standalone
      table into the career table, so every caller passed `false` and the other
      branch became unreachable — it was deleted and its reasoning moved onto the
      career `Card`. The behaviour described here is what `StatsTable` now does
      unconditionally.)

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

- [x] **9. Club jerseys, and the photo loading work.** Every player row drew a
      grey SVG blob where FPL's own site draws a club shirt. `PlayerShirt` now
      renders one on the Players list and all three Dashboard rankings, and
      behind the header card's photograph. The photograph itself dropped to a
      third of its weight and both image origins are preconnected.

      **The audit ran first and changed the plan, which is the point of running
      it first.** Every URL was probed against the live host over all 35 team
      codes the database holds, rather than written from memory — the task asked
      for that and it earned its keep three times over.

      **The finding that reshaped the item: a shirt exists for exactly the
      twenty clubs in 2026-27 and for no others.** Set equality, not
      approximately — the fifteen misses are every club not in the current
      season, West Ham included, which played ten of the eleven. So 2016-17 has
      nine of twenty clubs with no shirt, and the selector puts it one click
      away. The planned grey-placeholder fallback would have left roughly half
      that season's rows as blobs.

      **So the fallback became the club badge**, which returns 200 for all 35
      codes including clubs gone a decade. **Verified it is keyed on
      `fpl_team_code` by rendering the images** — `t25` really is Middlesbrough,
      `t88` really is Hull — because a badge keyed on some other id space would
      have shown the wrong club quietly, which is the failure this project keeps
      refusing to ship. Same origin as the photographs, so it costs no third
      preconnect. Chain: shirt → badge → grey.

      **The second half of that finding is not fixable and is now a Known Issue:
      the shirt is the current kit, never the season's.** 2016-17 renders
      Arsenal's 2026-27 shirt. Right club, wrong year, by construction — no
      archived path exists, which was checked rather than assumed.

      **`_1` is the goalkeeper variant, confirmed by rendering both images**
      rather than by recall, and then confirmed again in the browser the
      cleanest way available: Steele and Welbeck are both Brighton, and one
      draws the green long-sleeved keeper shirt while the other draws the blue
      outfield one. The suffix is written as `elementType === 1`, never by
      reusing the value — the shirt suffix being `_1` and the position code
      being `1` are unrelated numbering schemes that happen to agree.

      **A module-level `Set` of shirtless team codes, consulted before the first
      render**, was added on review rather than being in the first draft. What it
      buys is **determinism**, not a measured saving: without it the number of
      failed requests depends on whether the browser caches a 503 carrying a
      150-byte body and no cache headers, which is not a thing to rely on in
      either direction. Nothing was ever run with the cache disabled, so no
      before/after saving is claimed here.

      **One cold 2016-17 render, 200 rows, counted from a single run:**

      | | |
      | --- | --- |
      | Shirt requests | **40** — 20 clubs × 2 variants |
      | — succeeded | **22** — 11 clubs × 2 |
      | — failed, 503 | **18** — 9 clubs × 2 |
      | Badge requests | **9**, one per shirtless club, all 200 |
      | **Total** | **49** |
      | Rows showing shirt / badge | **115 / 85** |

      The × 2 is data rather than arithmetic: every one of the twenty clubs has
      both a goalkeeper and an outfield player inside the top 200, checked
      against the bootstrap rather than assumed.

      **Two earlier figures were measurement artefacts and are corrected here**,
      because both are the kind that look like findings. "17 successes" came from
      a network buffer cleared mid-run, so five successful requests landed in the
      window before the clear; all 22 are always requested. "16 failures" came
      from a run contaminated by the cache itself — it already held code 21 from
      a 2025-26 page viewed moments earlier, suppressing both West Ham variants.
      On a cold cache it is 18.

      **What the set cannot do, stated because the measurement shows it.** Both
      variants of a club fire before either error returns, so the first
      observation is never saved — only every render after it. That is visible
      in the numbers: `shirt_20-66` *and* `shirt_20_1-66` both 503, then all
      eleven Southampton rows show the badge.

      **And it persists across a season change, which was observed rather than
      inferred**: passing through 2025-26 before selecting 2016-17 suppressed
      `shirt_21` entirely. Correct — West Ham genuinely has no shirt — and the
      demonstration that the persistence is real.

      **The cache lives in `lib/shirtCache.ts`, and the reason is mechanical
      rather than aesthetic.** It began as a `resetShirtCache` export beside the
      component, and React Fast Refresh only handles a module whose exports are
      all components — so every edit to `PlayerShirt.tsx` logged
      `hmr invalidate … "resetShirtCache" export is incompatible` and forced a
      full page reload instead of a hot update. Found in the dev server log
      **after** the item was otherwise finished and written up, which is the only
      reason it is recorded here rather than silently fixed: nothing in the
      tests, the typecheck or the browser pass could have caught it, because it
      degrades the edit loop rather than the app. Splitting it costs one file and
      is the better seam anyway — module state with a lifetime of its own is not
      a rendering concern. Verified by forcing an HMR cycle afterwards: `hmr
      update` with no `hmr invalidate` and zero Fast Refresh complaints.

      **The photograph's size directory is the CSS size and the file is 2x**,
      which the old code did not know: `250x250` is really 500x500 and 346 KB
      for a box rendered at 56 pixels. `110x140` is 220x280 and 111 KB, still
      comfortably 2x. Interleaved A/B in the browser so both sizes saw identical
      network conditions — necessary, because absolute numbers taken minutes
      apart drifted by 60% during the session:

      | Measurement | Median of 9 |
      | --- | --- |
      | `250x250` | **404 ms** |
      | `110x140` | **170 ms** |

      **The preconnect is a separate question and the two must not be
      multiplied together.** An earlier draft of this record said the header
      photograph "goes from ~706 ms to ~170 ms". That figure was composed from a
      cold *before* and a warm *after*, so it counted the connection saving and
      the size saving as if they stacked, and one of its two numbers was wrong
      as well. It is withdrawn.

      **The cold measurements are not rivals, and an earlier draft of this record
      treated them as though they were.** It tabled 706 ms against 394/399 ms as
      competing estimates of one quantity and called the first an outlier. They
      are **different conditions**, and neither refutes the other. Labelled
      properly:

      | Cold first request | Asset | Preconnect links | Result |
      | --- | --- | --- | --- |
      | Item 9 pre-implementation baseline | `250x250` | **absent** | 706 ms (706, 729, 1021) |
      | Follow-up, fresh socket-pool partitions | `110x140` | **present** | 394 ms, 399 ms |
      | A/B present arm | `110x140` | **present** | median 393.5 ms |
      | A/B absent arm | `110x140` | **absent** | median 534.5 ms |

      Note the first two rows differ in **two** conditions, not one: the links
      *and* the asset size. That is why no subtraction between them means
      anything, and why the A/B — which varies only the links — had to be run.

      What survives of the correction is narrower and still worth keeping: the
      706/863 ms samples were taken by firing the photograph immediately after
      navigation, into contention with the app's own bootstrap, JS and font
      requests, so they carry page-load contention on top of the handshake. A
      first-request timing taken during page load measures bandwidth contention
      as much as connection setup. The audit's phase-level figures — DNS 4 ms,
      TCP 58 ms, TLS complete ~180 ms — remain the cleanest description of the
      handshake itself.

      **The controlled A/B, run to a stopping rule fixed before the first
      sample.** N = 6 pairs, alternating links-present / links-absent so drift is
      shared, each sample on a **fresh loopback alias** — Chrome partitions socket
      pools and the HTTP cache by top-level site, so every sample is both a cold
      socket and a cold cache. `vite --host` serves the aliases; the header
      photograph is read from `performance.getEntriesByType('resource')` on a real
      detail page.

      | Arm | Samples (ms) | Median | Spread |
      | --- | --- | --- | --- |
      | preconnect present | 892, 390, 1321, 375, 359, 397 | 393.5 | 962 |
      | preconnect absent | 540, 605, 423, 731, 529, 514 | 534.5 | 308 |

      **The absent arm is the first clean measurement of cold-without-preconnect
      this project has**, and is worth recording as such: **median 534.5 ms**,
      same asset and same method as the present arm, differing only in the two
      `<link>` tags. Everything before it either had the links in place or varied
      the asset size at the same time.

      **Two sample disclosures, both made because the record should not be read
      as six clean draws:**

      - **The 892 ms sample was the procedure-validation run** — the first pass
        through the click-through, written to check the measurement worked at
        all — and it entered arm A as sample 1 rather than being discarded.
        Dropping it leaves the present arm faster in **4 of 5** pairs with a
        paired-differences median of **170 ms**. The conclusion does not move,
        which is why this is a disclosure and not a re-run.
      - **The 1321 ms sample is an unexplained outlier.** No cause was
        established. It is the single value that sets arm A's 962 ms range, which
        matters for the stopping rule below.

      **What the numbers converge on.** The present arm's median of **393.5 ms**
      reproduces the **394 ms / 399 ms** fresh-partition samples taken on a
      different day by a different method — synthetic image loads rather than the
      app's own header photograph. That is a genuine independent replication of
      the *level*, and it is the strongest thing here, because it validates the
      apparatus rather than the hypothesis.

      On the *gap*: between-arm difference **141 ms**, paired-differences median
      **143.5 ms**, present arm faster in **4 of 6**. Those two statistics are
      computed from the same twelve samples, so they corroborate each other
      without being independent of each other.

      **Written at that strength and no higher: these are converging estimates of
      roughly 140–150 ms, not a significance claim.**

      **The pre-committed rule returned "not resolvable at N = 6 against this
      connection's noise", and the rule rather than the data is what returned
      it.** It compared the between-arm difference against the **range** within
      each arm — and a range is fixed by the single worst sample and grows with
      N. Against arm A's 962 ms range, set entirely by the 1321 ms outlier, **no
      effect smaller than about half a second could have resolved**, so a null
      was the only reachable outcome for an effect of this size. No further
      samples were taken, and none should be read into the verdict.

      Pre-committing was still right, and it did its job: it stopped a
      borderline-looking result from being sampled until it separated. **The
      statistic was the wrong choice.** A paired design should be tested on its
      **paired differences**, which is where its power lives, not on the spread of
      the raw arms — which throws the pairing away. A future measurement of this
      kind should pre-commit to the paired differences.

      **So the honest summary is that the A/B is uninformative about
      significance and informative about magnitude**: it did not resolve an
      effect, and it produced the project's first clean without-preconnect
      number and a gap estimate consistent with two others.

      **What ~155 ms is, and what it is not.** An earlier draft called it "the
      ceiling on what the links can buy". It is the opposite end of the
      transaction: ~395 ms cold **with** the links against ~240 ms warm, so it is
      the **residual** cost still being paid *after* the preconnect has done
      whatever it does. What the links appear to *buy* is the between-arm gap,
      **~141 ms**. The two numbers are close enough to swap by accident, which is
      how the error happened.

      **The links stay.** The measured gap points the right way at about the
      magnitude the mechanism predicts, and the mechanism holds independently of
      whether six pairs could resolve it. Neither link takes `crossorigin`:
      images are fetched in no-CORS mode and a crossorigin preconnect would warm
      a socket the image request cannot reuse.

      **The partial header deliberately gets no shirt.** A season the player has
      no `player_seasons` row for has no club, and the only club available is
      the previously selected season's — rendering it is the stale-snapshot bug
      item 8 fixed, reintroduced as an image in the one case where re-lookup
      cannot help. Confirmed in the browser: Yohanna on 2026-27 shows the
      Brighton shirt, and the same player on 2016-17 shows zero images and the
      grey placeholder.

      **A latent bug fixed while the file was open:** `PlayerPhoto`'s `failed`
      was a boolean that never reset, and the detail page reuses the component
      across players without a key, so one player's missing photograph would
      suppress the next player's real one. It now tracks *which* src failed.

      **Verification.** `npm test`: **77 server, 82 client**, both green.
      `tsc --noEmit` clean in both packages. Browser, console clean: 2026-27's
      Players list renders **39 distinct shirt URLs for 200 rows** — 20
      goalkeeper and 19 outfield, no badges, no broken images — which is the
      predicted ceiling of 40 rather than the 20 a per-club count suggests, the
      goalkeeper variant doubling it. 2016-17 renders 115 shirts and 85 badges
      with no broken image and no grey placeholder; Sigurdsson draws the Swansea
      swan. All three Dashboard rankings draw shirts on 2016-17; on 2026-27 they
      are the three empty states, so the Players list is that season's evidence.

      **Mutation-checked, measured:**

      | Mutation | Result |
      | --- | --- |
      | goalkeeper suffix dropped | **red**, 1 test |
      | badge stage removed | **red**, 5 tests |
      | `alt=""` replaced with a name | **red**, 2 tests |
      | partial header given a shirt | **red**, 1 test |
      | photo size reverted to `250x250` | **red**, 1 test |
      | module-level shirtless set never consulted | **red**, 1 test |
      | per-instance reset removed | **red**, 1 test |

- [x] **10. Sticky headers, pinned columns, row striping.** → `2ce4fd9`

      Column headings scrolled away vertically and the identifying column
      scrolled away horizontally on three wide tables. Adds sticky headers, pins
      Opp beside GW, pins the Player column, stripes all four tables, and moves
      row background colour from the cell to the row (`lib/rowSurface.ts`) so a
      pinned cell paints `--row-bg` and stripes in step instead of stepping away
      from it. The load-bearing discovery: `overflow-x: auto` with
      `overflow-y: visible` computes `overflow-y` to **auto**, so every wrapper
      was already an unbounded vertical scroller in which a sticky header
      silently never sticks — resolved per table rather than uniformly.

      **These two entries are stubs rather than full records**, written in item
      12 after the fact. Both commit messages are detailed records in their own
      right, so the entry's job is to say what the item was and point at the full
      account rather than restate it. Read `git show 2ce4fd9` for the whole thing.

- [x] **11. Averages divide by appearances, not fixtures.** → `5fad1b8`

      The averages row divided by every row shown while the career row six inches
      above divided by appearances — Tarkowski's 2025-26 read AVG Pts 4.5
      (170/38) under a career row saying PPG 4.6 (170/37). New:
      `client/src/lib/averages.ts`, a pure module holding the normalization
      strategies, per-column denominators, `roundHalfEven` and `fmtPpg`. The
      numerator and denominator filters are deliberately **not** symmetric — the
      null filter picks the numerator, the played filter only the denominator —
      which the wide verification run established and API identity rule 5 now
      records in full. `points_per_game` also stopped being rounded in SQL and is
      rounded once on the client by the same formatter as the row beneath it.

      Full account: `git show 5fad1b8`.

- [x] **12. The selected season merged into the career table.** The detail page
      showed the selected season twice in two shapes — a "This Season" block with
      filters and a `StatsTable`, and an absence, because the career table
      explicitly deleted that season from its rows. It is one table now, and the
      selected season is a row in it: totals in line when collapsed, gameweeks
      underneath when expanded, exactly like every other season.

      **Both section headings are gone rather than renamed**, because both
      asserted something false once item 8 landed a selector. "This Season" is
      wrong whenever the selector is off the live season; "Previous Seasons" is
      wrong on Haaland at 2022-23, where it filed 2026-27, 2025-26, 2024-25 and
      2023-24 — every one of them later — under "previous".

      **Filters moved from one season to every expansion**, which forced the
      state to be per season. The GW options are season-specific — 2019-20 runs
      to 47 after the Covid restart, 2022-23 has 37 rounds ending at 38 — so one
      shared pair would carry a round 47 into a season that never played one.
      `gwRange: null` means "the whole season" and is resolved at render against
      that season's rounds, which **deletes** the effect item 8 had to key on
      `b.season` rather than on `[firstRound, lastRound]`. It also fixed a
      pre-existing gap: neither filter reset on a player change.

      **`rounds: number[]` is new on every career row, and where it comes from is
      the point.** Checked rather than assumed: `events` holds 38 rows, all
      2026-27, so it cannot answer this for the ten CSV seasons. It is derived
      from `fixtures`, which is what "which rounds exist" has always come from
      here — complete for all eleven seasons, and reproducing 2019-20 as
      `[1..29, 39..47]` and 2022-23 as `[1..6, 8..38]`.

      **Deriving it from the player's own gameweek rows was rejected**, and this
      is the item's sharpest decision. That list would carry two different kinds
      of gap with nothing telling them apart: 2019-20 missing 30-38 because the
      season *skipped* them, and missing others because the player was not in the
      squad. A dropdown a reader cannot interpret is the same failure as the
      averages footnote below. Measured cost of doing it properly, on an
      eleven-season career: **+0.77 ms** (1.97 → 2.74 ms median of 15) and
      **+1,274 B** (7,774 → 9,048, +16.4%), fetched once per player. It rides on
      the row under API identity rule 7, so it cannot disagree with the season
      that row already names.

      **Row order and default expansion, decided rather than raised.** The order
      stays chronological with the selected row marked in place — pinning it to
      the top would reorder the table on every season change. The selected row
      starts expanded and every other collapsed, which is what "This Season"
      always did.

      **The expansion rule was rewritten by a measurement, not by argument.** The
      first version was additive: open the newly selected season, close nothing,
      so a season the user had deliberately expanded survived. In the browser, on
      Haaland's five-season career, four ordinary season changes left **all five**
      expanded — pane 1,986px → ~7,300px against a 920px scrollport, and season
      totals visible at once falling **5 → 2**. The feature undoing itself in four
      clicks. The rule is now ownership: the row the *selector* opened is the
      selector's to close, and a row the *user* opened is theirs to keep. After
      the fix, exactly one row is open after every change and the pane holds at
      ~1,966px.

      **A React purity bug inside that fix, worth recording because it looked
      right.** The first implementation assigned the ref and read it back inside
      the `setExpanded` updater. An updater does not run when it is scheduled — it
      runs at the next render — so it always found the "previous" season already
      equal to the new one and closed nothing: the accumulation the effect existed
      to stop, reintroduced by its own fix. Every ref is read before the updater
      now. Same rule the `loadSeason` comment states, arriving from the read side.

      **The averages footnote names its groups instead of spanning them.** Item
      11 printed "Averages over 23–35 appearances in 38 fixtures" on Haaland
      2022-23 — true, and silent about which columns own the 23 or why. Now:

      ```
      Averages over 35 appearances in 38 fixtures.
      Expected stats over 23, not measured before GW16.
      ```

      The second line renders only where the denominators diverge. The grouping
      is **read off the column set** — a `group` tag on the four expected columns
      in `StatsTable`'s `COLUMNS` — never a separate list of names that could fall
      out of step with the table. Inferring it from the `x` label prefix was
      rejected for the reason data rule 10 gives about `position`: not deriving
      meaning from a display string. A group is named only when the divergent set
      is **exactly** that group's rendered members, so a season holing xGI alone
      reads "xGI over 22" rather than claiming the family.

      **Two things about that sentence needed the browser to get right.**

      The threshold is a claim about the *season*, so it reads the unfiltered
      history — `StatsTable` gained `seasonHistory` for it, since `GameweekSection`
      hands it only the filtered rows. A contiguous GW range cannot expose this
      (a range showing both measured and unmeasured rows necessarily contains the
      boundary), so the test uses the **venue** filter, which is not contiguous in
      rounds.

      And a row counts as measured when **any** of the group is, not all of it.
      Haaland 2022-23 is NULL on all four columns for rounds 1-15 *and* NULL on
      `expected_goal_involvements` again at round 29, where he has a 0-minute row
      in item 7's holed fixture. Under `every` that is an unmeasured row above the
      boundary, the prefix test fails, and the clause vanishes from the one season
      it was written for. Found by looking at the page, not by a test.

      **`StatsTable`'s `scroll` prop and its bounded-`Card` branch are deleted.**
      Confirmed unreachable from the call sites first: `StatsTable` has one
      production caller (`GameweekSection`), which has two (`PlayerDetail`), and
      the merge removed the only one passing `true`. Its long `overflow-y`
      explanation moved to the career `Card`, now the page's only scroll
      container — dead code with a good explanation attached reads to the next
      person as a description of something live. One existing assertion in
      `TableSurface.test.tsx` would have **passed vacuously** after the deletion
      (`closest('[class*="overflow-auto"]')` returns null when no such ancestor
      exists anywhere), so it was rewritten against the nested render where the
      scrollport is real.

      **The filter bar is `sticky left-0 w-fit`.** It renders inside a
      `colSpan={34}` cell, so it scrolls with the career pane: measured at
      `scrollLeft: 700` in an 894px pane, the controls sat at **-419px** while the
      pinned Season and GW columns held at the edge. `w-fit` is load-bearing —
      a full-width box pinned at `left-0` does not appear to move. The averages
      note beneath still scrolls away; that is pre-existing and it is a caption
      rather than a control, so it is a Known Issue.

      **The four empty states, all confirmed in the browser.** Three moved into
      the expansion unchanged. "Not in the game" **could not**: a season the
      player has no `player_seasons` row for produces no career row, so there is
      nothing to attach it to. It is a page-level notice now, from an exported
      `NotInGame` in `GameweekSection.tsx` so the wording still lives in one
      place. Confirmed: Haaland at 2016-17 shows it with a name-and-photo header,
      no season-scoped tiles, the career table intact, and **no row marked** —
      correct, since the selected season has no row.

      One more found by looking: the filter bar was gated on the season having
      rounds, and 2026-27 has all 38 with no match played — so three controls
      drew above "Data will appear here once the season is underway". Gated on
      rows now. The season having rounds and the player having rows in them are
      different questions, which is what the empty states themselves turn on.

      **Verification.** `npm test`: **80 server, 149 client**, both green. `tsc
      --noEmit` clean in both packages. HMR clean on all five changed app modules
      — `hmr update`, no `invalidate`, no Fast Refresh warning. Browser pass on
      Haaland 2022-23 and Onana 2025-26, console clean, both themes.

      **Mutation-checked, measured:**

      | Mutation | Result |
      | --- | --- |
      | filter state shared across seasons | **red**, 1 test |
      | rounds derived from the player's rows (client) | **red**, 2 tests |
      | rounds derived from the player's rows (server) | **red**, 3 tests |
      | selected season filtered out of the career list again | **red**, 12 tests |
      | filters not reset on player change | **red**, 1 test |
      | selected row not seeded into `expanded` | **red**, 8 tests |
      | threshold read from the filtered rows | **red**, 1 test — the venue one |
      | footnote group named without the exactness check | **red**, 1 test |
      | "before GWn" prefix guard dropped | **red**, 1 test |
      | `Selected` marker never rendered | **red**, 1 test |


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

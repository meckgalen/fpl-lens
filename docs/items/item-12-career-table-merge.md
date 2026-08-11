# Item 12 — The selected season merged into the career table

Commit `0becf6d`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

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


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### How the client test count drifted

_Was `CLAUDE.md` lines 121-127._

**The client figure read 82 until item 12 and had been wrong since item 9**,
which is worth a sentence because the cause is not carelessness. Items 10 and 11
both changed it — to 111 and then to 134 — and **neither wrote a Phase 1
record**, so there was no place the number was being restated and nothing to
notice it drifting. Both records are stubs below now, and the working
agreement's "end each session by updating Current State" is what they were
missing.

### The merged detail page, as Current State recorded it

_Was `CLAUDE.md` lines 413-424._

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

### The paragraph item 12 removed from Known Issues

_Was `CLAUDE.md` lines 1490-1494._

  **A trailing paragraph claiming "Not in the game that season" was still
  unreachable was removed in item 12.** It contradicted this entry's own opening
  sentence and had been false since item 8. That is the failure mode the working
  agreement's "trace a claim to the code before repeating it" exists to catch,
  found here by reading the entry end to end rather than by testing anything.

---

## The four empty states, moved here from Known Issues in item 16

**Moved from `CLAUDE.md`, applying "a resolved Known Issue moves to the item
file that resolved it" retroactively.** The issue was *unreachable* empty states
— two at item 1, one at item 4 — and item 8's selector reached the last of them,
so the entry had become a statement of resolution. It lands in item 12's record
rather than item 8's because what it documents is the post-merge layout, which
is this item's doing. Its one still-live claim, that the "registered, no rows"
state ends on ingest rather than on the calendar, stays in `CLAUDE.md`'s Current
State, which already said it.

All four empty states are reachable from the UI, down from two unreachable at
item 1 and one at item 4. Item 8's selector reached the last of them; item 12
moved three of them and had to relocate the fourth entirely.

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
attach the sentence to. The wording still lives in `GameweekSection.tsx`, as the
exported `NotInGame` both callers use. Confirmed in the browser on Haaland at
2016-17: the sentence, a name-and-photo header, no season-scoped tiles, the
career table intact, and **no row marked "Selected"** — correct, because the
selected season has no row to mark.

"Registered, no rows yet" became real the day 2026-27 was ingested and is what
every 2026-27 player's row shows when expanded — confirmed in the browser.

**The state is a fact about the data, not about the date**: a `player_seasons`
row exists and no `player_gameweeks` row does. Playing the matches does not end
it; **ingesting** them does. So it stays reachable past 21 Aug 2026 and until the
incremental gameweek sync writes 2026-27's first match rows. Which is the
correction the Dashboard's "No matches recorded" wording already got, made for
the same reason: a calendar claim standing in for a data one is wrong in exactly
the window between a season starting and its data landing.

All four remain rendered and asserted by `GameweekSection.test.ts`.

---

## `rounds: number[]` on the career row, moved from API identity rule 7 in item 16

**The rule stays in `CLAUDE.md`; the argument for it lives here.** Same trim,
applied to a rule section rather than to Known Issues.

A season-scoped fact that is not a stat belongs on the row too, and item 12 is
the first case. Career rows carry `rounds: number[]` — every round that season
played, derived from `fixtures`. It is a property of the season rather than of
the player, so the obvious alternative was a `Record<season, number[]>` map
beside the rows. That is the manifest shape the rule refused for `season` itself,
for the same reason: a map and the rows it describes are two statements of one
fact that can disagree. On the row, the season naming itself and the rounds it
played arrive together and cannot come apart.

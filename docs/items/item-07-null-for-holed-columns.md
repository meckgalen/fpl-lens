# Item 7 — Store NULL where the source holed a column

Commit `cdb5407`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

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


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The hole rule and `measuredSum`, as Current State recorded them

_Was `CLAUDE.md` lines 72-104._

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

---

## The holes as found, moved here from Known Issues in item 16

**Moved verbatim from `CLAUDE.md`, applying the working agreement's "a resolved
Known Issue moves to the item file that resolved it" retroactively.** The entry
described itself as "the record of what was found and where each half went",
which is item-file content. Its still-live half — the ICT quartet that item 7
deliberately left storing `0` — remains a Known Issue in `CLAUDE.md` and states
the same rounds in prose.

Whole rounds were missing from four columns of 2022-23 and from the ICT family
in three seasons, stored as `0` rather than NULL. Measured in item 6, fixed in
item 7 for `starts` and the expected family.

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

**The consequence on screen.** A 2022-23 ever-present shows the no-value marker
rather than 24 starts against a real 38, on the career table and the header
card alike, and it degrades per player rather than per season. The per-match
rows show `—` rather than `0.00` for xG, xA, xGI and xGC on rounds
1-15, switching to `0.00` at round 16, which is the source's own boundary made
visible. `verify:history-past` reports exactly the drift it did before: `sum()`
skips NULLs either way, so nothing it compares moved.

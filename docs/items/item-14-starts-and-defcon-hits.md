# Item 14 — Games started per gameweek, and defensive contribution hits

Commit `5aca74f`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **14. Games started per gameweek, and defensive contribution hits.**

      A season DC total does not say whether the player clears the threshold.
      Gabriel's 2025-26 is **277 over 30 starts** — 9.2 a start, just under a
      defender's 10 — and that average cannot distinguish a player who hits most
      weeks from one who almost never does. Measured: **11 times in 38**. The
      Players list now carries the hit count and hits-per-start, and the gameweek
      table carries `St` and `DCH`.

      **This is the first scoring rule the app computes for itself.** Everything
      else on screen is FPL's number or arithmetic over FPL's numbers. That is
      why the rule gets a module (`server/src/repositories/defcon.ts`, modelled on
      `ingest/holes.ts`) rather than an inline `CASE` at two call sites, and why
      the verification is shaped the way it is: there is nothing upstream to diff
      against.

      ### The audit, which reshaped two decisions before any code was written

      **`defensive_contribution` is a raw action count, and its composition is
      position-dependent.** 2025-26 only, 29,747 rows, range 0-29, and **5,117
      rows carry an odd value** — a points field would be 0 or 2 and nothing
      else. The composition reproduces FPL's published rule exactly:

      | Pos | rows | `= T + CBI` | `= T + CBI + R` | max |
      | --- | ---: | ---: | ---: | ---: |
      | DEF | 9,733 | **9,733 (100%)** | 6,335 | 23 |
      | MID | 13,309 | 8,811 | **13,309 (100%)** | 29 |
      | FWD | 3,278 | 2,323 | **3,278 (100%)** | 15 |
      | GK | 3,427 | — | — | **0** |

      Defenders count CBIT, midfielders and forwards CBIRT — **26,320 of 26,320
      outfield rows**.

      **Goalkeepers: FPL computes no DC at all, and this was measured rather than
      read off a rules page.** DC is 0 on all 3,427 GK rows *while the components
      are not*: keepers recorded 24 tackles, 934 CBI and 6,195 recoveries in those
      same rows. So the 0 is FPL declining to compute the stat for the position,
      not a keeper doing nothing. There is no keeper threshold to get wrong
      because there is no keeper stat. `defcon_hit` is therefore **0** for a
      keeper, not null — the column answers "did he score the DC point", and null
      would say "not measured", the one meaning it must not carry.

      **The distribution, 2025-26, over the 841 players with a match row:**

      | Pos | players | min | median | max | zero-hit | total hits |
      | --- | ---: | ---: | ---: | ---: | ---: | ---: |
      | DEF | 270 | 0 | 1 | 26 | 129 | 821 |
      | MID | 379 | 0 | 0 | 26 | 261 | 587 |
      | FWD | 95 | 0 | 0 | 6 | 91 | 9 |
      | GK | 97 | 0 | 0 | 0 | 97 | 0 |

      1,417 hits over 29,747 rows — **4.8% of rows**, neither degenerate. This
      table is the tripwire, and it is **frozen as literals** in `verify:defcon`
      rather than recomputed and printed.

      > **SUPERSEDED BY ITEM 24.** The paragraph below records item 14's
      > decision to share one numerator between `DCH` and `DCH/St`, and to treat
      > a value above 1 as informative. **That is no longer what the app does.**
      > `DCH/St`'s numerator is gated on `starts = 1` since item 24, so the
      > ratio is bounded at 1.00 by construction; `DCH` is unchanged and still
      > counts bench hits. What this reasoning missed is that a numerator drawn
      > from appearances over a denominator of starts is a ratio of two
      > populations — and that item 19 later shipped `Pts10+/St` gated, leaving
      > two ratios under one `/St` suffix with opposite semantics. The 8 bench
      > hits below are the same 8; they now move 8 players' ratios down instead
      > of up. See `docs/items/item-24-dch-per-start-gated.md`.

      **Hits per start above 1 does not occur in 2025-26**, and the design is
      unchanged anyway. The mechanism is real — 8 hits came off the bench, the
      largest 19 DC in 67 minutes — but no player's count exceeds his starts. The
      maximum is exactly **1.00** (Igor 1/1, Colwill 2/2), both observed in the
      browser. Not clamped, denominator not switched to appearances, numerator not
      restricted to started games: the count column and the rate column share one
      numerator.

      ### The guard, which the plan got wrong and the review caught

      The first draft guarded the season count with `fullyMeasured` alone —
      `count(col) = count(fixture_id)`, the expression extracted from
      `measuredSum`. Over a player with **no match rows** that is `0 = 0`, which
      passes, and `count(*) FILTER (…)` over nothing returns **0**. Measured
      before the guard was written:

      | Season | players | `hits` NULL | `hits` 0 | `measuredSum` NULL |
      | --- | ---: | ---: | ---: | ---: |
      | 2016-17 | 683 | 683 | 0 | 683 |
      | 2025-26 | 841 | 0 | 539 | 0 |
      | **2026-27** | 564 | **0** | **564** | **564** |

      Every player of the season the app **defaults to** would have read a
      confident zero.

      **`measuredSum` does not inherit it, and the asymmetry is the thing worth
      keeping:** `sum()` over zero rows is NULL while `count()` over zero rows is
      0. So the extracted guard is sufficient for a sum and insufficient for a
      count, and that sentence now lives on `fullyMeasured` itself so the next
      caller does not reuse it blind. It is item 13's vacuous-truth hole arriving
      in a second place.

      ### `dependsOn`: derived columns cost the server nothing

      The two new picker entries have **no matrix cell of their own**. The key
      finding of the audit is that both dependencies —`defensive_contribution` and
      `starts` — are **already** in `BOOTSTRAP_NULLABLE_COLUMNS`, so a derived
      column's availability is a function of cells that already exist.
      `repositories/columns.ts` needed **no change at all**: `NULLABLE_COLUMNS`
      stays real table columns, `/api/columns` stays 99 rows,
      `bootstrap.columns` stays five entries.

      `resolveColumn` reads `col.dependsOn ?? [col.key]` and folds to the most
      restrictive, `undefined` above `none` above `partial`, ties by declaration
      order. Every pre-item-14 column is the degenerate one-dependency case, so
      this is one rule rather than a second branch.

      **Declaration order is load-bearing and visible in the browser.** On
      2016-17 both dependencies are `none`. `defensive_contribution` is declared
      first, so `DCH/St` reads "recorded from **2025-26**". Had `starts` won it
      would read "recorded from 2022-23" — true of `starts` and a lie about this
      column. The picker shows `Matches started · recorded from 2022-23` three
      rows above `DCH/St · recorded from 2025-26`, which is the tie-break visible
      in a single frame.

      ### `St` is not averaged, and the reason is not the one it looks like

      On 2022-23 `starts` is measured from GW16, exactly like the expected family.
      An averaged `St` joins the divergent denominator group, `groupLabel`'s
      exactness check fails — the divergent set becomes the expected group *plus*
      one column, which is not a group — and item 12's `Expected stats over 23,
      not measured before GW16.` degrades to a five-label list.

      **Not because the average is uninteresting.** Starts per appearance is a
      meaningful proportion: the share of a player's appearances he started. The
      average is worth having and the footnote is worth more. Both halves are
      recorded so a reversal is informed rather than a rediscovery. Confirmed in
      the browser on Haaland 2022-23: both footnote lines intact, and `St`
      switching from `—` to `1` at exactly GW16, the same boundary as xG.

      ### Verification: two results, deliberately never merged

      `npm run verify:defcon` is read-only and prints **two** verdicts, because
      folding them would let the weaker borrow the stronger's authority.

      1. **Cross-derivation — plumbing, not the rule.** The season count from
         `listPlayerTotals` against the summed per-row flags from
         `getPlayerHistory`, every player-season in 2025-26: **841 of 841,
         100%**. Both sides call `defconHitSql`, so **a wrong threshold agrees
         with itself and this part exits 0.** What it catches is narrow and real:
         a guard on one side only, the join multiplying rows, the two queries
         filtering differently. The output says so.
      2. **The distribution against frozen literals — this is the rule check.**
         The audit's figures, computed in SQL before `defcon.ts` existed, are
         compared rather than printed: a printed number nobody diffs is not a
         check. All four positions matched.

      Same discipline as item 5's replay-plus-cross-check, for the same reason.

      `verify:columns` extended to derived columns: `DB_COLUMN` became
      `DB_COLUMNS: Record<string, string[]>` and truth is the AND over the listed
      inputs. **253 → 275 cells, 275 agreed, 100%.** The dependency lists are
      **declared in that file rather than read off `dependsOn`** — this file
      already imports the shipped *logic* so it checks what runs; the *data* has
      to be restated or the check agrees with itself. That is not a reversal of
      item 13's move of `seasonAvailability` into `columns.ts`: same rule applied
      to two different things — **import the logic, restate the data**.

      `verify:ppg` unaffected at 7338/7338.

      ### Cost

      **The `player_seasons` join on `getPlayerHistory`, pre-measured** before the
      code was written — 11 alternating in-session pairs after 3 warm-up pairs,
      Gabriel 2025-26, 38 rows: before median **2.00 ms**, after **3.00 ms**,
      **paired difference median +1.00 ms** (range +0.00 to +3.00).

      **End to end**, medians of 11 warm runs, request to last byte, with an
      A/B/A design so drift is visible:

      | Route | Before | After | After again |
      | --- | ---: | ---: | ---: |
      | bootstrap 2026-27 | 23 ms | 23 ms | 31 ms |
      | bootstrap 2019-20 | 101 ms | 99 ms | — |
      | bootstrap 2022-23 | 104 ms | 103 ms | — |
      | bootstrap 2025-26 | 122 ms | 134 ms | 126 ms |
      | detail (38 rows) | 9 ms | 12 ms | 12 ms |

      **The bootstrap difference is not resolvable and is reported as such.** The
      two identical "after" arms differ by 8 ms on 2026-27 and 8 ms on 2025-26,
      which is as large as any before/after gap in that block — so the honest
      statement is that the added aggregate column rides on the existing scan and
      `GROUP BY`, exactly as item 13 found for its four, and the measurement
      cannot say more than that. The detail route moved **+3 ms and +1.0 KB**
      (26.7 → 27.7 KB), reproduced across both after arms, and the payload figure
      matches the audit's predicted +1,140 bytes.

      ### Tests

      `npm test`: **110 server** (was 98) and **187 client** (was 169), both
      green. `tsc --noEmit` clean in both packages. HMR clean on all four changed
      client modules — 8 `hmr update`, zero `invalidate`, zero full reloads, zero
      Fast Refresh warnings.

      **A deadlock the first full run found.** `defcon.test.ts` used season
      `'2099-00'`, which `live-season.test.ts` already writes. `node --test` runs
      files in parallel, so two open transactions inserting
      `fixtures (season, fpl_fixture_id) = ('2099-00', 1)` contended on the same
      unique index and Postgres raised **40P01**. Neither suite was wrong; they
      were sharing a namespace neither of them declared.

      **The first fix was one-sided and was replaced.** Renaming this suite's
      season to `'2098-99'` made the tests pass and left `live-season.test.ts`
      saying nothing about owning `'2099-00'` — indeed saying the opposite, that
      the season "cannot collide with anything", which was true of the real data
      and false of the other test files. The next suite needing a synthetic season
      reads that file, copies the constant, and reproduces the deadlock.

      **`server/src/test/synthetic-seasons.ts` is the registry**, one row per
      suite, claimed by suite path so the call site names the row it is taking.
      Adding a suite means adding a row, and the key type makes an unregistered
      name a compile error rather than a silently shared season. A module-level
      check rejects a duplicated value **at import**, because the deadlock it
      replaces is intermittent by nature — it needs both transactions open at once
      — so a duplicate could otherwise sit green for a while. Mutation-checked:
      pointing both rows at `'2099-00'` fails immediately with
      `synthetic-seasons: two suites share a season (2099-00, 2099-00)`.

      The season is the lever because the collision is on
      `(season, fpl_fixture_id)` and fixture ids restart at 1 in every suite —
      a test that had to remember which integers another file used would be worse
      than the registry. Three consecutive clean runs after the fix, and three
      more after the registry replaced it.

      ### Mutations, all measured

      | Mutation | Result |
      | --- | --- |
      | DEF/MID thresholds swapped (10 ↔ 12) | **red**, 4 server tests + `verify:defcon` **exit 1** |
      | GK branch removed | **red**, 1 |
      | NULL-DC clause moved below the GK clause | **red**, 1 |
      | `count(pg.fixture_id) > 0` dropped from the guard | **red**, 2 |
      | `fullyMeasured` dropped from the guard | **red**, 2 |
      | `LEFT JOIN player_seasons` → inner | **red**, 1 |
      | rule applied to the count but not the row flag | `verify:defcon` **exit 1**, 83.35% |
      | `dependsOn` ignored (`col.key` only) | **red**, 7 client + `verify:columns` **exit 1** |
      | `DCH/St` denominator switched to appearances | **red**, 4 |
      | `DCH/St` returning `0.00` at 0 starts | **red**, 2 |
      | `hits === null` dropped from `DCH/St` | **red**, 1 |

      **The last one is the entry worth reading.** `null / 5` is **0** in
      JavaScript, not `NaN`, so dropping that test renders a confident `0.00` for
      a player whose hit count was never measured — rule 6 defeated by a
      coercion, in a cell indistinguishable from a real zero. It is probably
      unreachable today, because the availability layer withholds the column on
      every season where the value can be null. It is guarded anyway: the server
      guard exists precisely so the value *can* be null, this is the only place
      the client divides by it, and a column whose correctness rests on another
      module's filter is one refactor from being wrong.

      **The `LEFT JOIN` needed a test built for it rather than a "green by
      design" note.** The first plan recorded that mutation as green, since both
      forms return the same 38 rows today. Checking the schema gave a better
      answer: `player_gameweeks` has foreign keys to `fixtures`, `teams` and
      `players` and **none to `player_seasons`**, so an orphan row is
      representable — while `player_seasons`' primary key `(player_id, season)`
      means the join **cannot** multiply. Only one half of the invariant is
      enforced, and it is the half `LEFT` addresses. The test inserts an orphan
      inside the rolled-back transaction and asserts it survives with
      `defcon_hit: null`; an inner join drops it and the test goes red.

      ### Browser pass

      - **2025-26 gameweek table**, Gabriel: 33 columns, `St` at index 5 directly
        after `Min` at 4, `DCH` at 24 directly after `DC` at 23. **GW4 v NFO
        reads DC 10 → DCH 1** — a defender exactly on the threshold, clearing it,
        in live data — with GW5 at 8 and GW8 at 9 correctly 0. The 38 rows sum to
        **11**, matching the season count. AVG row: `St` blank, `DCH` 0.3.
      - **The Players list**, sorted by DCH: Anderson 26, Senesi 26, Tarkowski
        22, Andersen 20, Garner 20 — the audit's top exactly. **Haaland reads DC
        104 · DCH 0 · DCH/St 0.00**, which is the argument for the whole item in
        one row: a large DC total that never once clears a forward's 12.
      - **2016-17**: all three DC entries disabled, each with
        `Not recorded in 2016-17 · recorded from 2025-26.`
      - **The 1.00 case**: Igor (BHA) 1 hit / 1 start and Colwill (CHE) 2/2, both
        rendering `1.00`, unclamped. Nothing above 1 exists in 2025-26.
        (Item 24: still the two maxima, and now bounded rather than merely
        unobserved — neither has a bench hit, so neither moved.)
      - **A zero-start player**: Heaton, 38 bench matches, 0 minutes — `DCH 0` (a
        measured zero, since DC exists for keepers) and **`DCH/St —`**, the
        placeholder rather than `0.00`.
      - **Persistence**: both columns survived a 2025-26 → 2016-17 → 2025-26
        round trip.
      - **Both themes**, with the picker open on 2016-17 so the disabled entries
        and their reasons are on screen in each.

      ### A process failure worth recording

      Mid-build I reverted a mutation with `git checkout -- server`, which also
      discarded every **uncommitted** item-14 edit to tracked server files —
      `players.ts`, `domain.ts`, `columns-check.ts`, `package.json`. The three new
      files survived only because they were untracked. Everything was restored
      from the conversation and re-verified green, and the remaining ten mutations
      used file copies in a scratchpad instead.

      **Two rules come out of this, and only the first is about git.**

      **One: never use `git checkout --` to undo a mutation in a working tree full
      of uncommitted work.** Copy the target file first and restore from the copy.
      Same class as the `pkill -f` lesson — a blunt instrument whose blast radius
      is larger than the thing it is aimed at, and whose damage is silent, since a
      reverted file type-checks perfectly.

      **Two, and it is the load-bearing one: the clean-tree check at item start is
      what bounded the damage.** The restore came from **conversation context, not
      from disk**, so the claim that it was complete rests entirely on the tree
      having been clean when the item began — everything `git checkout` could
      reach was therefore item 14's own work, all of it in the session that was
      rebuilding it. On a dirty tree that argument evaporates: some of what
      vanishes predates the session, nothing knows what it was, and nothing
      reports it missing.

      Stated generally, because it outlives git entirely: **a destructive
      operation's blast radius is bounded by how well you know what was in the
      working tree.** The check at the start is what turns "restore from context"
      from a hope into a complete restore, and it only counts if it was actually
      run. The working agreement now carries both rules; "do not use
      `checkout --`" alone would not have generalised.


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The defensive-contribution measurements

_Was `CLAUDE.md` lines 436-442._

**Goalkeepers are 0 rather than null, and FPL computing no DC for them was
measured rather than assumed.** DC is 0 on all 3,427 GK rows of 2025-26 *while
the components are not* — keepers recorded 24 tackles, 934 CBI and 6,195
recoveries in those same rows. The 0 is FPL declining to compute the stat.
`defensive_contribution` itself is a raw action count, not points: 5,117 of
29,747 rows carry an odd value, and the composition is position-dependent
(DEF = CBIT, MID/FWD = CBIRT) on 26,320 of 26,320 outfield rows.

### `verify:defcon`'s two results, in full

_Was `CLAUDE.md` lines 1209-1220._

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

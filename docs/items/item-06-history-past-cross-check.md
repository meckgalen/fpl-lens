# Item 6 — The `history_past` cross-check, run wide

Commit `59b1860`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

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


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The cross-check totals, as Current State recorded them

_Was `CLAUDE.md` lines 64-70._

**Item 6 checked what is in those 253,509 rows against a second source, and
found holes. Item 7 fixed five columns of them and deliberately left four.**
`npm run verify:history-past` sums every player-season we hold and diffs it
against FPL's `history_past` — 1,915 player-seasons, 27 columns, 51,705 cells.
**1,524 drifts, 1,516 of them with ours lower than FPL's**, and 1,486
attributable to **178 fixtures where a column is 0 on every row of a match that
was played**.

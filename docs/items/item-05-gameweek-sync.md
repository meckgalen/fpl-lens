# Item 5 — The incremental gameweek sync

Commit `2e5918c`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

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

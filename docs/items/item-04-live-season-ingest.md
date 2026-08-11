# Item 4 — The 2026-27 season, from the live API

Commit `5a611de`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

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


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The precondition scoping, as Current State recorded it

_Was `CLAUDE.md` lines 46-52._

**Every one of those preconditions is scoped to the ten CSV seasons**, which
item 4 had to change. They were counts over whole tables (`teams = 34`,
`player_seasons = 7338`), and the moment an eleventh season existed, re-running
any CSV ingest failed on a season it does not own. They were scoped rather than
loosened to `>=`: the numbers are exact because that is what catches a dropped
row, and a bound wide enough to admit a new season is wide enough to admit a
missing match. The pinned figures are unchanged.

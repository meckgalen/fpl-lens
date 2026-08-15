# Item 20 — A value-level check for withheld columns

`verify:columns` grows a part 2. Part 1 asks which columns the picker **offers**;
part 2 asks whether the withheld ones actually arrive **empty**. Nothing checked
the second question, and item 19 shipped a defect through the gap.

## 1. Why: the defect part 1 could not see

Item 19 shipped `hauls_started = 0` for all 564 players of 2026-27 — an
assertion that they started no 10-point fixture, on a season nobody has played.
The plan had argued the `count(pg.fixture_id) > 0` guard away on the grounds that
`sum()` over zero rows is NULL. It is, and there are not zero rows:
`listPlayerTotals` LEFT JOINs, a player with no match rows null-extends to
exactly **one** grouped row, and `sum(CASE … ELSE 0)` over one null row is a hard
`0`. The `ELSE`, not the aggregate, defeats the null.

A probe caught it. Nothing else could have: `verify:columns` compared what the
picker offered against what the rows held and never looked at a value, and on
2026-27 the availability layer disabled the columns that read the field anyway
— so the wrong number sat behind a disabled picker entry where nothing looked at
it. A grep for `ELSE 0` in `server/src/repositories/` is clean today, but that
grep catches one spelling; `COALESCE` around a nullable input and
`count(*) FILTER` over a null-extended row produce the same false zero, and §4
found one of those in a place nobody had described.

## 2. What part 2 asserts

Per season, per player row, per payload field:

- a field whose inputs are unmeasured **for that player** reads `null`;
- a field whose inputs are measured reads a **number**, never null — the
  direction that stops the opposite overreach, since `hauls` and `floors`
  correctly read `0` on 2026-27 and nulling them would be the symmetric bug.

**197,550 cells compared** — 7,902 player-seasons × **25 checked** fields — of
which **45,985** must be null. Part 1 is unchanged at **319**.

The run's own header says exactly that, and it is printed **after** the season
loop so the player-season count is derived from the payloads rather than written
down. It first read `11 seasons x 34 payload fields`, which does not multiply out
to the total printed four lines beneath it: 34 counts the nine skipped fields,
which are named but never compared. A header whose factors disagree with its own
total is worse than no header.

### Driven off the payload, not the picker

The defect was in `hauls_started`, which **has no picker key** — it is a wire
field the client divides with. A check driven off `PLAYER_COLUMNS` would have
missed precisely the bug that motivated it. So the unit is the field of
`PlayerSeasonTotals`, and `server/src/verify/payload-fields.ts` classifies all
**34** of them: 8 `measured`, 17 `always`, 9 `skip`.

**The map is in its own file so that a compiler sees it.** `server/tsconfig.json`
excludes `columns-check.ts` from the program — it imports client code across
`rootDir` — so a `satisfies` written there would be inert, the unused-type-alias
failure in a new costume. `payload-fields.ts` imports only types and stays in the
program, so the guard is real (mutation 3 below).

### Why both sides may be shipped code here

The payload comes from `listPlayerTotals` and the truth from counting NULLs in
`player_gameweeks` — **different derivations, and a guard bug moves only one of
them**, which mutation 1 measures rather than asserts.

That is *not* the `verify:haul` part 2B mistake. 2B hand-wrote SQL restating the
same expression the aggregate used, so a mutation to the shipped query moved
**neither** side and it stayed green. The doc comment says so explicitly, because
the visible shape ("both sides run our code") is the same and a later session
would otherwise "fix" this into a re-derivation by reading the truth out of
`seasonAvailability` or `measuredSum` — which would reproduce 2B exactly.

The truth query deliberately uses **no LEFT JOIN**: the null-extension that
caused the defect must not exist in the query that judges it. A player with no
match rows is simply absent from the map — a fact about the set, not a row of
zeroes to be interpreted.

## 3. The frozen table, and why the grain is the player

The checked set is empty on a fully measured season, so its size is pinned.

| season | reg | starts | xG | xA | xGI | DC | must be null |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2016-17 | 683 | 683 | 683 | 683 | 683 | 683 | **5,464** |
| 2017-18 | 647 | 647 | 647 | 647 | 647 | 647 | **5,176** |
| 2018-19 | 624 | 624 | 624 | 624 | 624 | 624 | **4,992** |
| 2019-20 | 666 | 666 | 666 | 666 | 666 | 666 | **5,328** |
| 2020-21 | 713 | 713 | 713 | 713 | 713 | 713 | **5,704** |
| 2021-22 | 737 | 737 | 737 | 737 | 737 | 737 | **5,896** |
| 2022-23 | 778 | 661 | 661 | 661 | **754** | 778 | **5,615** |
| 2023-24 | 865 | 0 | 0 | 0 | 0 | 865 | **1,730** |
| 2024-25 | 784 | 0 | 0 | 0 | 0 | 784 | **1,568** |
| 2025-26 | 841 | 0 | 0 | 0 | 0 | 0 | **0** |
| 2026-27 | 564 | 564 | 564 | 564 | 564 | 564 | 4,512 (derived) |

Ten frozen seasons total **41,473**; with 2026-27, **45,985**.

Two readings of that table are load-bearing:

- **2022-23 is partial per player, not per season.** 661 of its 778 players
  carry a holed `starts` row; the other 117 arrived after round 16 and keep a
  real total. A season-level `partial` cannot express that, which is why the
  truth query groups by player rather than reusing `seasonAvailability`.
- **xGI is 754, not 661**, because 2022-23 holes it at round 29 as well as
  through 1-15. One shared "the 2022-23 boundary" number would be wrong on one
  column in five, so the map is per field.

`2025-26: 0` is frozen as a real claim — the season measures everything — rather
than skipped. The ten are immutable **as an assumption, not a fact**: they hold
only while nobody re-ingests or backfills them, and if one moves the check fires,
which is the check working.

## 4. The `always` side was measured, and it found something

The must-be-null table was measured; the must-be-number side would otherwise have
been classified by **reading the source**, which is how the original defect got
shipped. So it was run first: `listPlayerTotals` over all eleven seasons,
counting payload rows reading null per candidate field.

**Result: 0 nulls on each of the 17 fields, across all 7,902 payload rows.**
Every entry correctly classified.

**The doubt was right about the mechanism even though the count came back
clean.** `points_per_game` is

```sql
COALESCE(sum(pg.total_points)::numeric
           / NULLIF(count(*) FILTER (WHERE pg.minutes > 0), 0), 0)
```

The `NULLIF` makes the division NULL for a player who never appeared, and the
**outer `COALESCE` turns it back into `0`** — item 19's `ELSE 0` in a second
spelling, a null defeated by the wrapper rather than by the aggregate. Every sum
in the list is `COALESCE`d the same way.

### The open question it raises, with two coherent readings

Provenance was traced and comes back **not traced**:

- `players.ts` justifies `COALESCE` to 0 **for columns present in all ten
  seasons**, and the `points_per_game` block argues the *denominator* and the
  *rounding*. Neither mentions the zero-appearance case; the `0` carries no
  comment.
- Item 11 **edited this exact expression** — stripping the `to_char` rounding —
  and left the `COALESCE` untouched without remark, while stating the opposite
  convention for the layer above: *"A player who never appeared now shows the
  placeholder across the row rather than 0.0 … No appearances means no
  per-appearance average"*, its largest visible change, on 119-304 player-seasons
  a season.

So the two layers answer the zero-appearance case differently: the gameweek
averages row reads `—`, while `points_per_game` reads `0`, rendered `0.0` by
`fmtPpg` on the Players list, the Dashboard, the player header and the career
table. **That is an open question between two coherent readings, not an
inconsistency** — calling it inconsistent invites a fix, and one reading makes
that fix a regression:

- **Reading A — the split is correct.** `points_per_game` reproduces a statistic
  **FPL publishes**, so it carries FPL's convention; the gameweek averages are
  the app's own computation and carry ours. An external statistic keeps its
  source's convention, an internal one keeps ours.
- **Reading B — the `0` is an unexamined `COALESCE`** and item 11's rule should
  have reached it.

**Nothing currently distinguishes them.** `verify:ppg` compares only players FPL
has a figure for, so it cannot. Reading FPL's own element for a zero-appearance
player would settle which reading is **right**; it would **not** recover what
item 11's author intended, which is probably unrecoverable — recorded so a later
session does not go hunting for it.

Classifying the field `always` **pins** the current `0`. If it is ever revisited,
the fix is a fourth `FieldRule` kind — a number where the denominator is
non-zero, null where it is zero — never a loosened assertion.

## 5. The two kinds of expectation, and the premise

Every season carries an expectation explicitly; none is skipped and none falls
through. Ten are **frozen literals**. 2026-27 is an **unplayed season**, whose
expectation is derived:

```
checked_cells == player_count × measured_field_count
```

**Both factors derived, neither written down.** A frozen 4,512 would redden at
the first `ingest:live-gameweeks` run — GW1 locks 21 August 2026 — and again
every round after, and a check that reddens routinely gets its number raised
instead of investigated, which is what `verify:thresholds` part 2 is built
around. The two factors move on independent schedules (the roster as FPL
registers players; the field count when an item adds a field, as item 19 did),
and a single product would hide which one moved.

**The premise is asserted as its own step.** The branch is only meaningful while
the season has no match rows; the moment it has some, a check that kept applying
it would pass by filtering everything away. That is item 13's vacuous truth
arriving **in the checking layer** — the same shape as the guard part 2 defends,
one level up. So it exits non-zero saying the premise has lapsed and the season
now needs a played season's treatment.

**The premise assertion is not redundant with the derived count, and that was
measured** — see mutation 4b, which is the whole reason it survived review.

## 6. Mutation results, measured

Each file copied first and restored from the copy — never `git checkout --`
(item 14's lesson) — with `md5sum` confirming byte-identical afterwards.

| # | mutation | predicted | observed |
| --- | --- | --- | --- |
| 1 | drop `count(pg.fixture_id) > 0` from `hauls_started` | part 2 red on 2026-27, 564 cells | **red, exit 1**, exactly **564** mismatches on 2026-27, all `hauls_started is 0 … must be null`. Part 1 unchanged at 319/319 |
| 2 | drop `fullyMeasured('starts')` from `hauls_started` | red on the pre-2022-23 seasons and on 2022-23's 661 | **red on 7 seasons**: 2016-17 683, 2017-18 647, 2018-19 624, 2019-20 666, 2020-21 713, 2021-22 737, and 2022-23 at exactly **661** — the per-player grain earning its keep. 2026-27 stayed green, its own guard intact |
| 3 | add an unclassified field to `PlayerSeasonTotals` | `tsc` errors on `PAYLOAD_FIELDS` | **`TS1360: … does not satisfy Record<keyof PlayerSeasonTotals, FieldRule>. Property 'mutation_probe' is missing`** |
| 4a | register a played season (2025-26) as unplayed | premise failure, not a silent pass | **`PREMISE LAPSED`, exit 1** — but its derived count (6,728) also disagreed, so this alone does not show the premise assertion is load-bearing |
| 4b | register **2016-17** as unplayed — every player has rows, every input column unmeasured | premise failure; count check alone insufficient | **`PREMISE LAPSED`, exit 1.** With only the premise assertion disabled it goes **green**, reporting `derived 683 x 8 = 5464` — the count agrees with itself precisely when the branch has stopped meaning anything |

Mutation 4 was **sharpened after 4a**, because 4a would have licensed a claim the
evidence did not support. 4b varies one condition (the premise assertion) against
a fixed season and is the measurement the comment now cites.

Mutation 4 was run **against the check rather than the database**: the script
runs in its own connection, so a `BEGIN … ROLLBACK` in another session is
invisible to it, and committing a phantom 2026-27 match row would write to the
season the whole app defaults to — flipping the empty states and
`SEASONS_WITH_GAMEWEEKS` if anything crashed mid-window. Registering a season
that *has* rows as unplayed exercises the identical branch with no write at all.

## 7. `columns.test.ts`'s vacuous CASE — confirmed, recorded, unchanged

`CASE WHEN count(pg.c) = count(pg.fixture_id) THEN 1 ELSE 0 END` returns `1`
vacuously for a player-season with no rows: both counts are 0, so it claims
"fully measured" about a player who measured nothing.

**Confirmed against the data**: zero-row player-seasons number **0 in every one
of the ten CSV seasons** and **564 of 564 in 2026-27** — no season is even mixed
today. And the vacuous `1` is **structurally unread** either way:
`deriveSeasonAvailability` filters `matches > 0` before computing a state, and
`listColumnHistory` groups on `player_gameweeks`, where such a player has no row.
Harmless, and harmless for a reason rather than by luck.

No behaviour change; a comment at the call site records it.

## 8. The rule this leaves behind

> **A guard against emptiness is written against the row count, never inferred
> from an aggregate's behaviour over an empty set** — because the **join**
> decides whether the set is empty, and the aggregate never sees the join.

And its corollary, which part 2 has to obey itself:

> **A check whose premise can expire asserts the premise**, or it degrades into
> passing on an empty set — the same vacuous truth, one layer up from the query.

## 9. What was deliberately not done

- **`PlayerCareerSeason` / `CAREER_EXTRA_AGGREGATE` is out of scope.** Every
  nullable field there is `measuredSum`-based, and `sum()` genuinely does null
  out over the null-extended row; the failure class this check exists for needs a
  count- or `ELSE`-based aggregate, and the career query has none. A later item
  could extend `PAYLOAD_FIELDS` to it — the map's shape already allows it.
- **Part 2 is not in `npm test`**, following the `thresholds.test.ts` /
  `verify:thresholds` precedent: it needs the ten complete seasons ingested,
  which the suite does not guarantee beyond its own synthetic seasons.
- **No browser pass**: nothing rendered changed.

## 10. Runtime, measured

`verify:columns` is the check most likely to be run casually, and part 2 added
eleven `listPlayerTotals` calls and 197,550 comparisons to it. Three runs,
in-process timers around each part:

| | part 1 | part 2 | in-process total | wall |
| --- | --- | --- | --- | --- |
| range over 3 runs | 1,236-1,279 ms | 1,294-1,361 ms | 2,573-2,613 ms | 3.18-3.34 s |

**Part 2 does not dominate — it roughly doubles the check, costing about what
part 1 costs.** That is not a coincidence: part 1's `seasonAvailability` already
calls `listPlayerTotals` once per season, so both parts pay for eleven of them
and part 2's extra work is its own truth query plus the comparisons, which are
cheap. Wall time carries roughly 0.6s of `tsx` startup on top.

No optimisation: ~3.2s for a read-only check run by hand is not a number worth
spending anything on. Recorded so a later session knows what it is paying for
rather than re-measuring.

## 11. The counts that were removed from `docs/testing.md`

That file opened with "142 server tests and 254 client tests". They were wrong by
**13 and 60** when this item measured them, having drifted across several items —
item 19 edited the file and did not touch them — while sitting directly beneath a
sentence explaining that the two counts are kept separate on purpose.

They are now **gone rather than corrected**, because correcting them only resets
the clock. The number informs no decision; deriving it would mean parsing runner
output into a document to keep true a figure nobody acts on, and asserting it in a
test would redden on every new test by design.

> **A hand-maintained figure sitting under a comment explaining why it is
> hand-maintained is worse than no figure, because the comment lends it
> authority.**

Same class as the defects these two items added checks for — a claim that looks
verified, is not, and is believed for that reason. In prose instead of SQL.

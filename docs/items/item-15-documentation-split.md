# Item 15 — One record per item, and a size check that fails

Phase 1 item record. Documentation restructuring: no production code changed, no
behaviour changed. The one code file added is `scripts/check-doc-size.ts`, which
runs in the test suite and touches nothing the app reads.

---

## The problem, which was not "the file is long"

`CLAUDE.md` ended item 14 at 147,250 characters against a 150,000 read limit.
That is the second time it has hit a wall: item 13 split every Phase 1 record into
a sibling `CLAUDE-history.md` when the file reached 195k, and **the margin that
bought was consumed by one item.**

So the diagnosis is not that the file was long. It is that the file was
**append-only and mixed two kinds of content**, and that the trim was always
scheduled for the end of a session — which is exactly when the budget has already
been spent and there is least appetite to restructure anything. Item 13's split
halved the growth rate once without changing the slope. Item 15 had to change the
slope.

The overflow's defining property is that it is **silent**. Past the limit a
portion of the file simply stops being read, with nothing saying which portion.
Both times, it was discovered by noticing a session reasoning from a stale claim.

## What moved

| Destination | What | Chars |
| --- | --- | ---: |
| `docs/items/item-NN-<slug>.md` | one file per item, 1 to 15 | — |
| `docs/testing.md` | the whole per-test-file catalogue | 18,165 |
| `docs/items/phase-0.md` | Phase 0's seven-step list | 3,894 |
| `docs/roadmap.md` | the Deferred work list | 7,163 |

`CLAUDE-history.md` was dissolved into the item files and deleted.

`CLAUDE.md`: **147,250 → 111,386 characters, a 24% reduction**, with 8,614 to
spare against the new 120,000 budget. Byte count for the same file is 112,767;
see "the unit" below.

### The two sections that left, and why they are not the same case

**The test catalogue** (`docs/testing.md`) was 18,165 characters describing what
each of 26 test files pins. The obvious move was to split it across the item files
that introduced each test. That was rejected: it is a **map of the current suite**,
not item archaeology, and splitting it by provenance would mean reading fourteen
files to answer "what does the suite cover" while making every future test's home
a judgement call.

**Phase 0's step list** (`docs/items/phase-0.md`) was always an item record in
everything but name — it says what each of seven steps decided. What it produced
stayed: the target schema, the acceptance test, "rounds are not 1..n", and all
eighteen Data Layer Rules.

**Deferred** (`docs/roadmap.md`) is a list of what might be built next, which
fails the content test cleanly. **One entry did not move in full**, and the
exception is the point: running the gameweek sync and cross-checking it against
`event/{gw}/live` is only possible while a round is in play, and GW1 of 2026-27
locks 21 August 2026. Moving a time-boxed instruction into a file nothing reads by
default is how a window closes unnoticed. A dated block stays in `CLAUDE.md`. The
`finished` / `finished_provisional` observation has the same window and already
lived in the schema notes, which stay.

## The content test, and what it caught that a record-dissolution would not

Step 2 was mechanical: move each item's record to its own file. Applied alone it
would have left `CLAUDE.md` around 145k, because **most of the bulk was never in
an item record.** It was in Current State, Known Issues, the API identity rules
and Getting Started — sections that stay.

So every line got a second question: **"would a reader need this to avoid writing
wrong code tomorrow?"** Passes: nullability rules, the 2022-23 partial holes,
round-numbering quirks, schema constraints, API identity rules, the Fast Refresh
gotcha. Fails: measurements, timings, test counts, what the browser found, what a
mutation turned red, how an estimate compared to reality.

What the test moved that step 2 alone would not have — **33,866 characters**:

| Block | Chars | Was in |
| --- | ---: | --- |
| The per-test-file catalogue | 18,165 | Current State |
| Rule 5's PPG measurements + sort consequence | 4,339 | **API Identity Rules** |
| Bootstrap latency tables | 2,952 | Current State |
| Shirt 503-determinism experiment | 2,609 | **Known Issues** |
| Current State's restatement of rule 6 | 2,589 | Current State |
| DC composition measurements | 1,172 | Current State |
| `verify:defcon`'s counts | 809 | **Getting Started** |
| Test-count drift narrative | 718 | Current State |
| Precondition-scoping narrative | 513 | Current State |

Three of those were in sections nominated to stay untouched. The test overrides
section boundaries, because the mixing is *within* sections — which is the whole
reason the file kept regrowing after a structural split.

### Two rules were promoted out of the catalogue rather than moved with it

Reading the catalogue line by line rather than moving it wholesale is what caught
these. Both existed **nowhere but inside a test-file description**, and both would
have left `CLAUDE.md` silently:

- **A rule that is load-bearing in more than one caller gets its own test file**,
  rather than coverage through its callers. Stated only inside the `holes.test.ts`
  and `defcon.test.ts` entries.
- **A test that writes to the real database writes a synthetic season inside a
  `BEGIN … ROLLBACK`, and each suite owns its own.** Stated only inside the note
  on why `defcon.test.ts` uses `'2098-99'` — two suites sharing one season
  deadlocked on the unique index (Postgres 40P01).

They are now conventions in `CLAUDE.md`, beside "mock at `services/api.ts`, not at
`fetch`" and "drive keyboards with `user-event`, not `fireEvent`".

### The rule-5 split, which is the case for reading rather than cutting

API identity rule 5 was to move as one block, lines 987-1053. Read line by line it
turned out to be three things: measurements (the 19-row table, the two
populations), **a rule** (rounded on the client, half-to-even, and `toFixed` is
*not* an implementation of that convention), and a further measurement (the
sort-order change). Moving the block whole would have put the rounding rule in an
archive file and left the authority copy nowhere.

Moved as two sub-blocks around the rule, which stays. A second amendment kept one
sentence of the measurement with it, and the reason generalises: the asymmetric
numerator/denominator filter **looks like a bug**, and without a line recording
that filtering the numerator too disagrees with FPL on 7 player-seasons, a future
item would "fix" it. Same shape as the ICT-quartet decision in Known Issues — a
deliberate-looking-wrong thing needs its reason kept where it is, or it gets
tidied away.

## Verification, split two ways

md5 proves a **verbatim** move and nothing else, and this pass had roughly twenty
passages that were trimmed, compressed or rewritten. Reporting one verdict over
both would be a check that appears to cover more than it does.

- **Verbatim moves**: 31 blocks, each md5'd at the source line range and located
  as an exact substring in the destination. All 31 matched. The 12 records out of
  `CLAUDE-history.md`, the 3 blocks into `docs/testing.md`, 14 measurement blocks
  into item files, and Phase 0 and Deferred.
- **Edited passages**: 22, each reported to the user as before-and-after text in
  full, because nothing mechanical can verify a rewrite.

Items 10 and 11 had no record anywhere — their commit messages `2ce4fd9` and
`5fad1b8` were the only account. Those are now their files, md5-verified against
`git show -s --format=%B` and **labelled as reconstructed rather than written at
the time**, so the one-file-per-item rule is not false on the day it is written.

## `docs:size`

`scripts/check-doc-size.ts`, wired as the first step of the root `test` script:
`run-s --continue-on-error docs:size test:server test:client`. Both paths were
exercised — pass at the real budget, and fail (exit 1) against a probe copy at
100,000.

Three decisions worth keeping:

**The threshold is 120,000 against a 150,000 limit.** The margin is the mechanism.
A check that fires at the limit fires when it is already too late to act calmly,
which is the failure this item exists to fix.

**It runs in the test suite rather than being a habit.** The working agreement had
said "check this file's size at the START of an item"; item 14 is the evidence
that a habit does not survive the end of a session. `--continue-on-error` means a
red size check does not mask the suites.

**The unit is characters, and the script says so at length.** `wc -c` reports
bytes and reads 1,381 higher on this file — multi-byte em dashes, `×`, `→`, and
accented names. A check written against the wrong unit is wrong in the permissive
direction. If the read limit turns out to be in bytes, the script should switch to
`Buffer.byteLength` rather than have its threshold lowered to compensate: a
threshold that silently encodes a unit conversion is one nobody can reason about
later.

## The five flagged invariants, and what each turned out to be

Flagged during the pass, deliberately not fixed in it — verifying means going back
to the database, and that has no finish line while a restructuring task does. All
five were then resolved in a second pass.

**1. "Defensive stats only from 2025-26" — wrong twice over.** Measured: `tackles`,
`clearances_blocks_interceptions` and `recoveries` carry real values in
**2016-17, 2017-18 and 2018-19** from the old Opta feed (up to 8 tackles in a
match, 4,388 positive tackle rows in 2016-17 alone), are NULL for the six seasons
after, and return in 2025-26. The trio is **recorded, dropped, recorded again** —
so any code reasoning from "first appearance" is wrong about three columns and six
seasons. Only `defensive_contribution` is 2025-26-only.

And the rule had **two states where the data has three**. Measured on 2025-26:
`defensive_contribution` is 0 on all 3,427 goalkeeper rows and positive on none,
while those same rows carry 24 tackles, 934 CBI and 6,195 recoveries — **765
goalkeeper rows read DC 0 with at least one component positive.** That zero is
neither "not measured" nor "nothing happened": it is FPL declining to compute the
stat for that position. Rule 6 now states three states and names the one case.

(115 outfield rows also read DC 0 with a component positive. Those are the *second*
state correctly: DEF composition is CBIT, which excludes recoveries, so a defender
with recoveries alone genuinely scores 0. Worth checking rather than assuming —
the two look identical in the column.)

**2. "The Players list has no `starts` column" — stale, and the hazard behind it
is real but held off.** `starts` has been a picker column since item 13
(`playerColumns.ts:261`), and `pts_per_start` and `defcon_hits_per_start` divide
by it. The entry had left a sentence owning an undischarged decision: "whichever
lands first owns deciding how a NULL sorts."

Checked in the browser on 2022-23, the one season where `starts` is NULL for 661
of 778 players. **It is offered in the picker but disabled**, reading *"Only
recorded from GW16 in 2022-23."* The checkbox is inert — clicking it leaves the
count at 16 and adds no column — and the choice is still remembered for seasons
where it is available. `verify:columns` agrees from its own derivation: 275 cells,
275 agreed, 2022-23 withholding 9 of 25.

**Discharged by construction**, by a rule written for a different purpose. The
entry now says so, and says what it costs: any future surface reading these
aggregates without consulting availability re-opens it. A per-90 toggle is the
next thing that would have to ask.

**3. "The eight other seasons are 38 and 38" — off by one since item 4.** Counted
from `fixtures`: nine seasons run 38 rounds ending at 38, with 2019-20 (38 rounds,
highest 47) and 2022-23 (37 rounds, highest 38) the exceptions. Written when the
database held ten seasons; 2026-27 made it nine.

**4. `docs/data-profile.md` under-covers the database, and cannot be made to
cover it.** Generated in Phase 0 over the ten backfilled seasons' **CSVs**. 2026-27
came from the live API and has no CSV to profile — the upstream repository
publishes them for completed seasons — so regenerating would add nothing. The
pointer now states what it covers, which was the only correct fix, and adds the
second limit it always had: it reports column **presence**, not **content**, so a
present-but-empty column is indistinguishable from a populated one.

**5. The GW1 window.** Not stale, but expiring: 21 August 2026. Kept visible in
`CLAUDE.md` when Deferred moved out, per the exception above.

## What this item did not do

The three-state total for a partly measured column, the ICT quartet's 26 fixtures,
and the pre-season player list are all untouched and remain in Known Issues and
`docs/roadmap.md`. `Starts` sorting is discharged, not fixed, because there is
nothing to fix.

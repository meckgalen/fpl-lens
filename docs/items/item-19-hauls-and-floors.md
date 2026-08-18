# Item 19 — Hauls and Floors on the Players list

Four columns on the Players list, following item 14's shape: the rule lives on
the server, the client never compares a number to a threshold.

| key | label | definition |
| --- | --- | --- |
| `hauls` | `Hauls` | fixtures where `total_points >= 10` |
| `floors` | `Floors` | fixtures where `total_points >= 4` |
| `hauls_per_start` | `H/St` | hauls **in started fixtures** ÷ starts |
| `floors_per_start` | `F/St` | floors **in started fixtures** ÷ starts |

The unit is the **fixture**, never the round (rule 13). Floors are **inclusive**
of hauls. The ratio numerators are gated on `starts = 1`, so `H/St` and `F/St`
are bounded at 1.00 — **unlike `DCH/St`, whose numerator is ungated and which
can exceed 1**.

> **Item 24 changed the second half of that sentence.** `DCH/St` is now gated on
> `starts = 1` too and carries the same 1.00 bound, for the reason this item
> established: two ratios under one `/St` suffix with opposite semantics is the
> defect. The contrast below is item 19's own reasoning and is kept as written;
> the two fragments are still separate, because they compare against different
> rules. See `item-24-dch-per-start-gated.md`.

Scope deliberately narrow: no per-fixture 0/1 columns (points are already
visible on every gameweek row, so a flag beside them restates the column), no
career table, no comparison chart. The chart exclusion is argued below.

---

## 1. The findings were measured against a different statistic

The item was specified with 20 frozen numbers — correlations of the ratio with
points per match, the share of each position at a haul rate of zero, and p99s.
**All 20 reproduce exactly, but only under an *ungated* numerator**
(`hauls_all / starts`), not the starts-gated ratio the app ships.

> The first audit divided ungated hauls by starts. FWD r_floor read 0.622
> and MID f_p99 read 0.741 under that definition; both are re-derived here
> against the gated numerator the app ships. GK is unchanged, since keepers
> almost never appear as substitutes.

Cohort — `minutes >= 1200`, `starts` fully measured, `starts > 0` — reproduces
exactly: **849** player-seasons, DEF 314 / MID 382 / FWD 85 / GK 68.

**Gated (shipped) figures. These are the ones to cite.**

| pos | n | r_haul | r_floor | % at zero haul rate | h_p99 | f_p99 |
| --- | --- | --- | --- | --- | --- | --- |
| DEF | 314 | 0.630 | 0.889 | 43.3 | 0.171 | 0.620 |
| FWD | 85 | 0.809 | 0.819 | 17.6 | 0.279 | 0.648 |
| GK | 68 | 0.467 | 0.904 | 27.9 | 0.126 | 0.519 |
| MID | 382 | 0.806 | 0.852 | 31.9 | 0.305 | 0.690 |

For reference, the original ungated table — kept only so a reader meeting those
numbers elsewhere can identify them, **not** as a description of any shipped
column:

| pos | r_haul | r_floor | % zero | h_p99 | f_p99 |
| --- | --- | --- | --- | --- | --- |
| DEF | 0.630 | 0.873 | 43.3 | 0.171 | 0.643 |
| FWD | 0.792 | 0.622 | 16.5 | 0.279 | 0.727 |
| GK | 0.467 | 0.904 | 27.9 | 0.126 | 0.519 |
| MID | 0.800 | 0.780 | 31.7 | 0.326 | 0.741 |

**The conclusion survives the correction, which is why the item went ahead.**
Haul rate is not a redrawing of points per match at any position — the strongest
is MID/FWD at ~0.81 and GK is 0.467. If it were a restatement of PPM the columns
would not be worth having.

## 2. Why the comparison chart is excluded

Three usable seasons, one of which breaks on half the positions, is too thin to
freeze a per-axis threshold.

Under the hole guard, 2022-23 collapses to **DEF 3, GK 1, MID 5 — and FWD 0**
(the last not mentioned in the original findings). So any starts-denominated
statistic is in practice **2023-24 onward, three seasons, not four**.

And **DEF's per-season median haul rate is 0.000 in 2024-25**, so a DEF haul
spoke would draw its median at the centre of the radar.

Revisit after 2026-27. Recorded here so it is not re-derived.

## 3. The 2025-26 break reaches MID, but only on rate statistics

The item was specified with "the break appears in exactly the two positions that
can earn DC points". Checked against the quantity item 16 actually measured, it
is **half true**, and the half matters.

| pos | median season pts 23-24 → 24-25 → 25-26 | median PPM 24-25 → 25-26 | median floors/start (gated) 23-24 → 24-25 → 25-26 |
| --- | --- | --- | --- |
| DEF | 68.5 → 73.5 → **95.0** | 2.58 → **3.19** | 0.278 → 0.283 → **0.381** |
| MID | 94.0 → 92.0 → 95.5 | 2.84 → **3.29** | 0.250 → 0.238 → **0.346** |
| GK | 86.0 → 111.0 → 111.0 | 3.47 → 3.41 | 0.281 → 0.292 → 0.289 |
| FWD | 102.5 → 127.0 → 112.5 | 4.03 → 3.40 | 0.403 → 0.433 → 0.358 |

On **season totals** the break is DEF-only: MID moves +3.8%, inside its own
year-to-year noise. On **rate** statistics it reaches MID — PPM +15.8%, floor
rate +38% over its prior maximum. GK and FWD move on neither, and they are
exactly the two positions FPL awards no defensive contribution points to.

So item 16's framing was right about what item 16 measured. `CLAUDE.md`'s
frozen-constant rule was amended to scope the DEF-only claim to totals and name
the rate case, rather than being left to read as wrong.

## 4. Rendering: two decimals, measured

Item 11 found one decimal collapsing PPG into 54-62 distinct values across
624-865 players, with tie groups of 119-305. Checked for the same failure on
2025-26 `H/St` at two decimals:

| pos | players | distinct @2dp | distinct @3dp | non-zero values rounding to 0.00 | largest **non-zero** tie group |
| --- | --- | --- | --- | --- | --- |
| DEF | 173 | 18 | 45 | **0** | 9 |
| MID | 209 | 23 | 56 | **0** | 12 |
| FWD | 53 | 15 | 22 | **0** | 5 |
| GK | 39 | 9 | 17 | **0** | 3 |

The large `0.00` group (DEF 93 of 173) is **entirely genuine zeros** — not one
non-zero value rounds into it, so two decimals destroys nothing. Nothing like
item 11's collapse. Two decimals via `fmtQuotient(…, 2)`, matching `DCH/St`.

## 5. Hauls are 0 on the unplayed season, not NULL

The item was specified the other way, on the argument that `0` on 2026-27 claims
564 players failed to haul. The codebase already answers this: `SEASON_AGGREGATE`
does `COALESCE(sum(pg.goals_scored), 0)`, and goals, minutes, points, BPS and the
ICT quartet all render `0` there. CLAUDE.md defends it — *"the NOT NULL columns
are genuinely 0 rather than unmeasured, and 0 is a measurement (rule 6)"*.

`total_points` is NOT NULL, so a haul count has **no unmeasured state** the way
`defcon_hits` does. A roster that has played nothing has hauled zero times in
exactly the sense that it has scored zero goals. Verified on screen: `Hauls 0`
and `Floors 0` render beside `G 0` on 2026-27.

The `_started` pair is the opposite and genuinely NULL there — not because
nothing was played, but because `starts` was never measured.

## 6. The guard that the plan argued out of existence, and the data put back

**`sum()` over zero rows is NULL. That is true, and it does not apply here.**

The plan reasoned that the gated numerators needed no `count(pg.fixture_id) > 0`
guard, unlike `defcon_hits`: item 14 needed one because `count(*) FILTER` over
zero rows is `0`, whereas `sum()` over zero rows is NULL, so a sum-based count
should null out by itself.

Measured, all **564** players of 2026-27 read `hauls_started = 0`.

The reason is that **there are not zero rows**. `listPlayerTotals` LEFT JOINs
`player_gameweeks`, so a player with no match rows null-extends to exactly **one**
grouped row — confirmed directly: `count(pg.fixture_id) = 0` while
`count(*) = 1`. And `sum(CASE … ELSE 0)` over one null row is a hard `0`.

**The `ELSE`, not the aggregate, is what defeats the null.** A `sum` with no
`ELSE` would have nulled out as the argument assumed. This is item 13's
vacuous-truth hole arriving in a **third** place, after item 13's availability
predicate and item 14's `defcon_hits`.

## 7. The frozen audit distribution

`npm run verify:haul`, two parts never merged into one verdict. Part 1 is
plumbing — it re-counts from `getPlayerHistory`'s per-row `total_points` and
compares against the aggregate; both sides read `POINT_THRESHOLDS`, so a wrong
threshold agrees with itself. Part 2 is the rule check.

**Part A — ungated, all ten seasons.** Pins both thresholds and the inclusive
relation.

| season | player-seasons | hauls | floors | max hauls | with ≥1 haul | floors<hauls |
| --- | --- | --- | --- | --- | --- | --- |
| 2016-17 | 683 | 469 | 2647 | 11 | 209 | 0 |
| 2017-18 | 647 | 431 | 2675 | 15 | 197 | 0 |
| 2018-19 | 624 | 460 | 2619 | 11 | 212 | 0 |
| 2019-20 | 666 | 435 | 2609 | 10 | 205 | 0 |
| 2020-21 | 713 | 432 | 2651 | 12 | 205 | 0 |
| 2021-22 | 737 | 472 | 2669 | 11 | 214 | 0 |
| 2022-23 | 778 | 448 | 2657 | 11 | 201 | 0 |
| 2023-24 | 865 | 482 | 2625 | 10 | 227 | 0 |
| 2024-25 | 784 | 426 | 2551 | 18 | 195 | 0 |
| 2025-26 | 841 | 512 | **3221** | 12 | 235 | 0 |

**Part B — the gate, 2022-23 onward.** Every column in Part A describes an
ungated count, so Part A pins **nothing about `starts = 1`** — the one definition
this item got wrong once already.

| season | player-seasons | hauls | started | **bench** | floors | started | **bench** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2022-23 | 117 | 12 | 12 | **0** | 82 | 70 | **12** |
| 2023-24 | 865 | 482 | 464 | **18** | 2625 | 2356 | **269** |
| 2024-25 | 784 | 426 | 414 | **12** | 2551 | 2310 | **241** |
| 2025-26 | 841 | 512 | 503 | **9** | 3221 | 2966 | **255** |

**The hole guard is not optional and its absence is not subtle.** Without
`count(starts) = count(fixture_id)`, 2022-23 reports `started_hauls` 282 and
`bench_hauls` **166** — and those 166 are not bench appearances at all.
`starts = 1` is NULL for rounds 1-15, the `CASE` falls to `ELSE 0`, and fourteen
rounds of real starts read as bench games. Guarded, it collapses to 12/12/0.

2022-23's own gate signal is in **floors only** (`bench_floors` 12 → 0 if the
gate is dropped); its `bench_hauls` of 0 is genuine, and the row is frozen for
both reasons.

## 8. Test 9's witness table — read this before deleting an assertion

The `H/St` and `F/St` descriptions promise on screen that neither can exceed
1.00. That rests entirely on `numerator <= starts`; the inclusive relation and
`hauls_started <= hauls` compare a numerator to another numerator and imply
nothing about the denominator. So `hauls.test.ts` asserts both.

**One of the two clauses cannot currently fail, and this was derived before the
test was written rather than discovered afterwards.** Dropping the gate sets
each numerator to its ungated count, so the bound breaks only where an ungated
count exceeds the start count. Guarded rows where that happens:

| season | guarded rows | ungated hauls > starts | ungated floors > starts |
| --- | --- | --- | --- |
| 2022-23 | 117 | **0** | **0** |
| 2023-24 | 865 | **0** | 15 |
| 2024-25 | 784 | **0** | 13 |
| 2025-26 | 841 | **0** | 13 |

**No player in any season out-hauls his start count.** So
`hauls_started <= starts` ships as an assertion that **no current mutation can
redden**; only `floors_started <= starts` fires, on the last three seasons.
2025-26 witnesses: Chiesa (`223541`, 1 start / 3 floors), Onyeka (`428580`, 0/2),
Enes Ünal (`168636`, 0/1), Yates (`204968`, 2/3), Awoniyi (`210156`, 3/4).

**Do not delete the haul clause for lacking a failing mutation.** It is the half
the on-screen description promises, and a future season can make it falsifiable.

The test also asserts its filtered set is non-empty per season, and freezes
2022-23 at **117** — the "where both are non-null" clause excludes seven seasons
outright, so without that the property could pass by filtering everything away.

## 9. Mutation results, measured

Files copied before each mutation and restored from the copy — never
`git checkout --` (item 14's lesson). All three verified byte-identical
afterwards by md5.

| mutation | predicted | observed |
| --- | --- | --- |
| swap thresholds (HAUL 4, FLOOR 10) | floors≥hauls red | **7 tests red**, both invariants included |
| drop `pg.starts = 1` | bench-haul red; test 9 **floors clause only** | **4 red**; failure was `1 started floors > 0 starts` (Enes Ünal). Haul clause green, as the witness table predicted |
| drop `fullyMeasured('starts')` | undercount red | **2 red**, `1 !== null` |
| drop `numerator === null` in `perStart` | client guard red | **2 red** — both DCH/St *and* the new ratios |
| point `hitsPerStart` at the wrong numerator | existing DCH/St red | **5 red** |

**One mutation found a flaw in the check itself.** `verify:haul` part 2B first
stayed **green** when the gate was dropped, because its SQL was hand-written
inline — so it compared the *database* against frozen literals and never read
the shipped aggregate at all. That is a check that cannot fail for the reason it
exists. Rewritten to read `listPlayerTotals` (as `defcon-check.ts` part 2 does),
it now reddens on all four seasons with every bench figure collapsing to 0.

The frozen literals remain the independent derivation; the shipped code is what
is under test. Restating the hand-written SQL *as the thing being run* had
quietly inverted that.

## 10. Browser pass

- **2025-26** — all four offered and enabled.
- **2022-23** — `H/St` and `F/St` disabled reading *"Only recorded from GW16 in
  2022-23."*; `Hauls` and `Floors` enabled.
- **2026-27** — both ratios disabled reading *"No matches recorded for 2026-27
  yet."*; both counts enabled and rendering `0` beside `G 0`.
- **Bench haul on screen** — Watkins (`178301`): `Hauls 5` but `H/St 0.12`. The
  ungated 5/33 would read `0.15`, so the gate is visible in the UI.
- **Zero starts** — Onyeka (`428580`): `Floors 2`, `F/St —`. His bench returns
  count; the rate correctly has no answer.
- **Sorting** — `H/St` descending tops out at 0.50 (nothing above 1.00);
  ascending puts real `0.00` values first with zero placeholders in the top 50,
  so nulls sort last in both directions. `Hauls` sorts numerically (12, 10, 8, 6,
  6 — matching the frozen max of 12).
- **HMR** — one real content change to `playerColumns.ts` produced `hmr update`
  with no `hmr invalidate` and no Fast Refresh warning.

A nice incidental demonstration from the `Hauls` sort: the season's top
haul-scorer has 12 hauls on 235 points, while the 239-point top scorer has 10;
and a 154-point player has 8 hauls against a 209-point player's 6. That gap is
the thing a points total cannot say and these columns can.

## 11. Availability, and what did not change

`repositories/columns.ts` and `/api/columns` are untouched. The counts derive
from a NOT NULL column, so they are `nullable: false` — like `Pts/£` — and are
never withheld. The ratios carry `dependsOn: ['starts']` and inherit item 13's
disabled states for free.

`verify:columns` needed the two ratios added to its restated `DB_COLUMNS` (it
throws on a nullable picker key with no mapping) and now compares **319** cells
rather than 275 — four new columns across eleven seasons — still at 100%.

`hitsPerStart` was rewritten to delegate to the shared `perStart`, so the three
null guards exist once rather than twice. Every existing `DCH/St` test stayed
green with no edit, which is what makes the delegation exact rather than
approximate.

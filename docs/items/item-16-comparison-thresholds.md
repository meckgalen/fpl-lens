# Item 16 — The comparison chart's frozen thresholds

Phase 1 item record. Two sessions: **step 1** derived and audited the numbers,
**step 2** froze them, put them on the wire and built the check.

No chart exists yet. This item deliberately produced no client work at all — the
thresholds are the thing every other decision on the comparison page depends on,
so they were derived and audited before anything was drawn, the way item 13's
width measurement went first.

---

## Why the thresholds come first

The chart draws raw values against fixed per-axis floors and ceilings. **Freezing
them is what makes two seasons comparable to each other.** An axis rescaled per
season puts every season's best player on the outer ring, which answers "who was
best in 2016-17" and refuses to answer "is 2016-17's best as good as 2025-26's" —
the only question a cross-season comparison page exists for.

A frozen constant that is quietly wrong is worse than a missing one, so the
numbers were measured, audited from a second direction, and given a check that
can fail.

---

## The cohort

`player_seasons` where the player's summed `player_gameweeks.minutes` is
**≥ 1,200**, over 2016-17 … 2025-26. 2026-27 has no match rows and is excluded by
the gate anyway.

**2,827 player-seasons.**

| Season | GK | DEF | MID | FWD | Total |
| --- | --- | --- | --- | --- | --- |
| 2016-17 | 24 | 101 | 125 | 33 | 283 |
| 2017-18 | 24 | 112 | 123 | 34 | 293 |
| 2018-19 | 22 | 106 | 119 | 28 | 275 |
| 2019-20 | 21 | 108 | 116 | 34 | 279 |
| 2020-21 | 21 | 107 | 129 | 33 | 290 |
| 2021-22 | 21 | 108 | 122 | 35 | 286 |
| 2022-23 | 23 | 111 | 120 | 27 | 281 |
| 2023-24 | 25 | 106 | 122 | 32 | 285 |
| 2024-25 | 20 | 96 | 129 | 25 | 270 |
| 2025-26 | 22 | 109 | 126 | 28 | 285 |
| **Pooled** | **223** | **1,064** | **1,231** | **309** | **2,827** |

**FWD is thin everywhere** — 25 to 35 a season. That is why every threshold is
pooled across the ten seasons rather than derived per season and averaged: a
per-season forward statistic is computed on ~30 rows, and the per-season p99
table below shows what that noise looks like.

`COALESCE(now_cost, end_cost)` is non-NULL on all 2,827 rows, so `Pts/£` has no
missing denominator anywhere in the cohort.

### Axis definitions, read off the shipped code

Not reconstructed from the spec. Each was traced to the module that computes it
for the Players list, so the chart and the list cannot disagree about what a stat
means:

| Axis | Definition | Source |
| --- | --- | --- |
| Pts, CS, G, A, Bon, Sv, Min | `sum()` per `SEASON_AGGREGATE` | `server/src/repositories/players.ts:126` |
| PPM | `sum(total_points) / count(minutes > 0)`, unrounded | `players.ts:170` |
| Pts/£ | `total_points / (COALESCE(now_cost, end_cost) / 10)` | `players.ts:331`, `client/src/lib/playerColumns.ts:100` |
| xGI | `measuredSum('expected_goal_involvements')` | `players.ts:123` |
| DCH/St | `defcon_hits / starts`, both `measuredSum`-guarded | `players.ts:372`, `playerColumns.ts:127` |

The DC hit rule is `defconHitSql`'s clause set — DEF ≥ 10, MID ≥ 12, FWD ≥ 12,
GK 0, NULL tested first (`server/src/repositories/defcon.ts:81`).

### The cross-check

Working agreement: verification must not share its derivation with the thing it
verifies. The cohort aggregate reproduces the **pinned acceptance values** for
Saka 2025-26 exactly — **157 points, 2,218 minutes, 25 starts**. Those come from
FPL's `history_past`, a different pipeline from the CSVs the rows were ingested
from, and are pinned independently in `player-gameweeks.test.ts`.

---

## Availability, stated rather than silently averaged over fewer seasons

| Axis | Seasons | Pooled n (DEF / MID / FWD) |
| --- | --- | --- |
| Pts, CS, G, A, Bon, Min, PPM, Pts/£ | all ten | 1064 / 1231 / 309 |
| Sv | all ten, GK only | GK 223 |
| xGI | **2023-24 → 2025-26** (three) | 311 / 377 / 85 |
| DCH/St | **2025-26** (one) | 109 / 126 / 28 |

**2022-23 is excluded from xGI**, and it is the exclusion most likely to look
like an oversight. The column exists from 2022-23, but that season measures it
only from GW16, so `measuredSum` blanks exactly the players who played through
rounds 1-15 — the regulars — and keeps a real total for the January arrivals.
Pooling it would sample the fringe and call it the population. Item 13 already
treats the column as unavailable for that season at aggregate level; this is the
same call for the same reason.

Inside the included seasons nothing is silently dropped either: the xGI cohorts
(311 / 377 / 85) and the DCH/St cohorts (109 / 126 / 28) equal the plain cohort
sizes for those seasons exactly, so every cohort member carries a value for every
axis its position draws. Checked rather than assumed.

---

## The distribution table

Pooled over the seasons listed above. Percentiles are `percentile_cont`.

| Pos | Axis | n | min | p50 | p95 | p97 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GK | Pts | 223 | 32 | 115 | 160 | 163.4 | 175.1 | 186 |
| GK | CS | 223 | 0 | 8 | 16 | 17.3 | 20.0 | 21 |
| GK | Min | 223 | 1215 | 3037 | 3420 | 3420 | 3420 | 3420 |
| GK | PPM | 223 | 2.00 | 3.56 | 4.45 | 4.53 | 4.66 | 4.89 |
| GK | Pts/£ | 223 | 7.27 | 23.64 | 30.76 | 31.95 | 33.46 | 35.09 |
| GK | Bon | 223 | 0 | 8 | 17.9 | 19.3 | 21.8 | 27 |
| GK | Sv | 223 | 24 | 90 | 141.9 | 144.3 | 152.1 | 166 |
| DEF | Pts | 1064 | 11 | 77.5 | 146 | 160 | 181.4 | 213 |
| DEF | CS | 1064 | 0 | 6 | 13 | 15 | 17.4 | 21 |
| DEF | G | 1064 | 0 | 1 | 4 | 4 | 5 | 8 |
| DEF | Min | 1064 | 1201 | 2235 | 3302 | 3378.7 | 3420 | 3420 |
| DEF | PPM | 1064 | 0.61 | 2.86 | 4.53 | 4.82 | 5.48 | 6.53 |
| DEF | DCH/St | 109 | 0.00 | 0.24 | 0.62 | 0.66 | 0.71 | 0.71 |
| DEF | A | 1064 | 0 | 1 | 6 | 7 | 10 | 15 |
| DEF | Pts/£ | 1064 | 2.82 | 16.53 | 27.27 | 28.09 | 31.13 | 35.10 |
| DEF | xGI | 311 | 0.19 | 2.56 | 6.11 | 6.60 | 8.60 | 9.10 |
| DEF | Bon | 1064 | 0 | 5 | 16 | 19 | 22.4 | 39 |
| MID | Pts | 1231 | 25 | 87 | 177 | 199 | 234.7 | 344 |
| MID | CS | 1231 | 0 | 7 | 14 | 15 | 17 | 21 |
| MID | G | 1231 | 0 | 3 | 12 | 14.1 | 19 | 32 |
| MID | Min | 1231 | 1200 | 2112 | 3138.5 | 3232 | 3366.5 | 3420 |
| MID | PPM | 1231 | 1.08 | 2.89 | 5.29 | 5.72 | 6.62 | 9.05 |
| MID | DCH/St | 126 | 0.00 | 0.13 | 0.51 | 0.54 | 0.56 | 0.70 |
| MID | A | 1231 | 0 | 3 | 11 | 12 | 15 | 24 |
| MID | Pts/£ | 1231 | 5.32 | 16.04 | 25.78 | 27.80 | 29.21 | 38.73 |
| MID | xGI | 377 | 0.22 | 5.91 | 15.58 | 17.68 | 25.70 | 33.69 |
| MID | Bon | 1231 | 0 | 5 | 20 | 24 | 30 | 55 |
| FWD | Pts | 309 | 33 | 106 | 197.2 | 210.8 | 238.1 | 272 |
| FWD | G | 309 | 0 | 8 | 21 | 22.8 | 28.8 | 36 |
| FWD | Min | 309 | 1202 | 2033 | 3130.2 | 3246.3 | 3324.8 | 3406 |
| FWD | PPM | 309 | 1.43 | 3.44 | 5.73 | 6.07 | 6.92 | 7.77 |
| FWD | DCH/St | 28 | 0.00 | 0.00 | 0.04 | 0.07 | 0.13 | 0.16 |
| FWD | A | 309 | 0 | 3 | 10 | 11 | 12.9 | 18 |
| FWD | Pts/£ | 309 | 5.74 | 16.18 | 25.40 | 26.30 | 27.88 | 32.35 |
| FWD | xGI | 85 | 3.59 | 10.94 | 22.81 | 23.93 | 28.74 | 31.75 |
| FWD | Bon | 309 | 0 | 13 | 32 | 34.8 | 40.9 | 48 |

### Top three per axis

Read for sanity rather than for interest, and it is where the DEF structural
break below was found.

| Pos | Axis | 1st | 2nd | 3rd |
| --- | --- | --- | --- | --- |
| GK | Pts | Martinez 20-21 (186) | A.Becker 21-22 (176) | A.Becker 18-19 (176) |
| GK | CS | A.Becker 18-19 (21) | Ederson 21-22 (20) | Ederson 18-19 (20) |
| GK | Min | Ryan 19-20 (3420) | Pope 19-20 (3420) | Ederson 18-19 (3420) |
| GK | PPM | Martinez 20-21 (4.89) | A.Becker 21-22 (4.89) | Lloris 19-20 (4.67) |
| GK | Pts/£ | Martinez 20-21 (35.09) | Raya 22-23 (34.58) | Etheridge 18-19 (33.48) |
| GK | Bon | Martinez 20-21 (27) | Pope 19-20 (23) | Pickford 23-24 (22) |
| GK | Sv | Johnstone 20-21 (166) | Raya 22-23 (154) | Flekken 24-25 (153) |
| DEF | Pts | Robertson 18-19 (213) | Alexander-Arnold 19-20 (210) | Gabriel 25-26 (209) |
| DEF | CS | Robertson 18-19 (21) | Virgil 21-22 (21) | Virgil 18-19 (20) |
| DEF | G | Dallas 20-21 (8) | Alonso 17-18 (7) | Virgil 25-26 (6) |
| DEF | Min | Collins 24-25 (3420) | Gibson 16-17 (3420) | Tarkowski 23-24 (3420) |
| DEF | PPM | Gabriel 25-26 (6.53) | Alexander-Arnold 21-22 (6.50) | Robertson 21-22 (6.41) |
| DEF | DCH/St | Canvot 25-26 (0.71) | Danso 25-26 (0.71) | Senesi 25-26 (0.70) |
| DEF | A | Alexander-Arnold 19-20 (15) | Alexander-Arnold 18-19 (13) | Robertson 19-20 (12) |
| DEF | Pts/£ | Guéhi 25-26 (35.10) | Truffert 25-26 (34.38) | Senesi 25-26 (33.65) |
| DEF | xGI | Pedro Porro 23-24 (9.10) | Alexander-Arnold 24-25 (9.01) | O'Reilly 25-26 (8.79) |
| DEF | Bon | Trippier 22-23 (39) | Alexander-Arnold 21-22 (32) | Gabriel 25-26 (30) |
| MID | Pts | M.Salah 24-25 (344) | M.Salah 17-18 (303) | M.Salah 21-22 (265) |
| MID | CS | M.Salah 18-19 (21) | Ødegaard 23-24 (19) | Mané 18-19 (19) |
| MID | G | M.Salah 17-18 (32) | M.Salah 24-25 (29) | Sánchez 16-17 (24) |
| MID | Min | Ward-Prowse 19-20 (3420) | Ward-Prowse 20-21 (3420) | Cork 17-18 (3420) |
| MID | PPM | M.Salah 24-25 (9.05) | M.Salah 17-18 (8.42) | M.Salah 21-22 (7.57) |
| MID | DCH/St | Anderson 25-26 (0.70) | Bentancur 25-26 (0.57) | Florentino 25-26 (0.56) |
| MID | A | B.Fernandes 25-26 (24) | De Bruyne 19-20 (23) | De Bruyne 16-17 (21) |
| MID | Pts/£ | Palmer 23-24 (38.73) | Xhaka 22-23 (31.88) | Anderson 25-26 (31.58) |
| MID | xGI | M.Salah 24-25 (33.69) | M.Salah 23-24 (28.36) | Palmer 24-25 (26.32) |
| MID | Bon | M.Salah 24-25 (55) | B.Fernandes 25-26 (41) | B.Fernandes 20-21 (36) |
| FWD | Pts | Haaland 22-23 (272) | Kane 22-23 (263) | Kane 20-21 (242) |
| FWD | G | Haaland 22-23 (36) | Kane 22-23 (30) | Kane 17-18 (29) |
| FWD | Min | Bowen 25-26 (3406) | Kane 22-23 (3406) | Watkins 20-21 (3328) |
| FWD | PPM | Haaland 22-23 (7.77) | Kane 16-17 (7.47) | Haaland 23-24 (7.00) |
| FWD | DCH/St | Bowen 25-26 (0.16) | Mané 25-26 (0.05) | Thiago 25-26 (0.03) |
| FWD | A | Watkins 23-24 (18) | Kane 20-21 (14) | Vardy 20-21 (14) |
| FWD | Pts/£ | Mateta 23-24 (32.35) | Morris 23-24 (31.06) | Bamford 20-21 (29.39) |
| FWD | xGI | Haaland 23-24 (31.75) | Haaland 25-26 (28.17) | Haaland 24-25 (23.94) |
| FWD | Bon | Kane 22-23 (48) | Haaland 25-26 (43) | Cunha 24-25 (41) |

---

## The stopping rule, fixed before the numbers

Ceiling = p99 rounded **up** to a friendly number. Floor = 0, with two exceptions
that exist because the cohort gate puts the floor somewhere else: **Min floors at
1,200** (the gate itself) and **PPM floors at the cohort's p01**.

"Friendly" needs a definition or it is a per-axis judgement dressed as a rule, so
a ladder was fixed before any ceiling was looked at: significand ∈ **{1, 1.2, 1.5,
2, 2.5, 3, 4, 5, 6, 8} × 10^k**, and the ceiling is the smallest rung ≥ p99.

### Two amendments and one direction correction

**FWD xGI = 30 and Min = 3,420** were decided after step 1 reported them unset or
ladder-derived.

`Min`'s ceiling is the one not produced by rounding p99 up. The rung above p99 is
4,000, which is unreachable: **38 matches × 90 minutes = 3,420**, and that is the
observed max on GK, DEF and MID. A 4,000 ceiling would put every ever-present at
85% of the axis and leave a sixth of it permanently empty. It is a
law-of-the-game constant, the same class as Min's floor.

**A floor rounds DOWN where a ceiling rounds up**, which step 1's display table
obscured by rounding to nearest. GK PPM p01 is 2.278596 and MID's is 1.487931;
rounded to nearest those are 2.28 and 1.49, both *above* the quantile they name,
so the floor would clip marginally more than the 1% it claims to. Rounding is
directional and a floor's safe direction is the opposite of a ceiling's. Frozen:
**GK 2.27, DEF 1.14, MID 1.48, FWD 1.73.**

### The frozen values

| Pos | Axis | p99 | max | **Ceiling** | Floor | Clips at ceiling |
| --- | --- | --- | --- | --- | --- | --- |
| GK | Pts | 175.1 | 186 | **200** | 0 | 0 |
| GK | CS | 20.0 | 21 | **20** | 0 | 1 (0.45%) |
| GK | Min | 3420 | 3420 | **3420** | 1200 | 0 |
| GK | PPM | 4.66 | 4.89 | **5** | 2.27 | 0 |
| GK | Pts/£ | 33.5 | 35.1 | **40** | 0 | 0 |
| GK | Bon | 21.8 | 27 | **25** | 0 | 1 (0.45%) |
| GK | Sv | 152.1 | 166 | **200** | 0 | 0 |
| DEF | Pts | 181.4 | 213 | **200** | 0 | 6 (0.56%) |
| DEF | CS | 17.4 | 21 | **20** | 0 | 2 (0.19%) |
| DEF | G | 5.0 | 8 | **5** | 0 | 6 (0.56%) |
| DEF | Min | 3420 | 3420 | **3420** | 1200 | 0 |
| DEF | PPM | 5.48 | 6.53 | **6** | 1.14 | 4 (0.38%) |
| DEF | DCH/St | 0.71 | 0.71 | **0.8** | 0 | 0 |
| DEF | A | 10.0 | 15 | **10** | 0 | 9 (0.85%) |
| DEF | Pts/£ | 31.1 | 35.1 | **40** | 0 | 0 |
| DEF | xGI | 8.60 | 9.10 | **10** | 0 | 0 |
| DEF | Bon | 22.4 | 39 | **25** | 0 | 7 (0.66%) |
| MID | Pts | 234.7 | 344 | **250** | 0 | 7 (0.57%) |
| MID | CS | 17.0 | 21 | **20** | 0 | 1 (0.08%) |
| MID | G | 19.0 | 32 | **20** | 0 | 9 (0.73%) |
| MID | Min | 3366.5 | 3420 | **3420** | 1200 | 0 |
| MID | PPM | 6.62 | 9.05 | **8** | 1.48 | 2 (0.16%) |
| MID | DCH/St | 0.56 | 0.70 | **0.6** | 0 | 1 (0.79%) |
| MID | A | 15.0 | 24 | **15** | 0 | 10 (0.81%) |
| MID | Pts/£ | 29.2 | 38.7 | **30** | 0 | 8 (0.65%) |
| MID | xGI | 25.7 | 33.7 | **30** | 0 | 1 (0.27%) |
| MID | Bon | 30.0 | 55 | **30** | 0 | 12 (0.97%) |
| FWD | Pts | 238.1 | 272 | **250** | 0 | 2 (0.65%) |
| FWD | G | 28.8 | 36 | **30** | 0 | 1 (0.32%) |
| FWD | Min | 3324.8 | 3406 | **3420** | 1200 | 0 |
| FWD | PPM | 6.92 | 7.77 | **8** | 1.73 | 0 |
| FWD | A | 12.9 | 18 | **15** | 0 | 1 (0.32%) |
| FWD | Pts/£ | 27.9 | 32.4 | **30** | 0 | 2 (0.65%) |
| FWD | xGI | 28.7 | 31.8 | **30** | 0 | 1 (1.18%) |
| FWD | Bon | 40.9 | 48 | **50** | 0 | 0 |

**35 thresholds.** GK draws 7, DEF and MID draw the same 10, FWD draws 8.

### FWD DCH/St is dropped, not unset

Step 1 left it unset under the >1% rule. It is now removed from the forward axis
set entirely, on a measurement rather than a convention: **25 of the 28 forwards
in the 2025-26 cohort recorded exactly 0.00**, with p25 and p75 both 0.00. Nine
forwards in ten would sit on the floor. Compare DEF at 5.5% zeros and MID at
23.8%, where the axis discriminates.

An unset ceiling is a number nobody chose; this is an axis nobody should draw.

---

## The two pieces of reasoning worth more than the numbers

### 1. DEF has a structural break at 2025-26, and that is why the band is per season

This was not on the brief. It came out of the top-three table: **DEF Pts/£'s top
three are all 2025-26** — Guéhi, Truffert, Senesi — which is not what ten pooled
seasons should look like.

| Season | DEF median Pts | DEF median PPM | DEF median Pts/£ |
| --- | --- | --- | --- |
| 2016-17 … 2024-25 (range) | 68.5 – 85 | 2.43 – 3.10 | 15.34 – 17.33 |
| **2025-26** | **95.0** | **3.19** | **20.45** |

2025-26 is above the **maximum of the previous nine** on all three: Pts +11.8%,
Pts/£ +18.0%. The cause is not in doubt — 2025-26 is the season FPL introduced
defensive contribution points, which pay defenders for exactly the actions the
DCH axis counts.

**This is the evidence for computing the cohort average band per season rather
than pooling it.** A pooled band puts the typical defender where the game *was*,
so today's average defender renders above it on Pts, PPM and Pts/£ — every
season, permanently, by construction, and the chart would be quietly asserting
that the average modern defender is above average.

**The ceilings stay pooled and are unaffected**, which is the part worth being
precise about. 2025-26's per-season p99s sit inside the pooled range on every DEF
axis; only Pts/£ at 34.3 is the ten-season high. A ceiling is a scale and wants
to be stable across seasons; a band is a description of a population and has to
describe the population being shown. They are different objects and the break
moves only one of them.

### 2. The original clipping trigger could not fire informatively

Step 1's stopping rule said: if p99 clips more than 1% of the cohort, leave the
ceiling unset. Applied to p99 itself, **it fired on 18 of 36 axes — as
arithmetic, not as data.**

The count strictly above `percentile_cont(0.99)` over n rows is
`ceil(0.01 × (n − 1))` whenever no values tie at the boundary, and that exceeds
1% of n for every n. GK: 3/223 = 1.35%. DEF: 11/1064 = 1.03%. MID: 13/1231 =
1.06%. FWD: 4/309 = 1.29%. The test never discriminated; it reported the
discreteness of the estimator.

Read against the **chosen ceiling** — the number that actually clips anything on
screen — it fires on exactly two axes: FWD DCH/St (3.57%, n=28) and FWD xGI
(1.18%, n=85). Both thin cohorts, both a single player over the line.

**A rule that is true of half its subjects by construction is not a rule.** The
wording that survives is *"if the chosen ceiling clips more than 1%"*.

---

## Decision 3, and the re-derivation rule it produced

**Can DCH/St and xGI carry frozen thresholds on one and three seasons?** They are
not equally shaky and did not get one answer.

**DCH/St — one season.** Not "a small sample" but a sample with *no
between-season variance information at all*: there is no way to tell whether
DEF's 0.71 p99 is where the metric lives or where it lived once. The rule
generating it is itself one season old — `defcon.ts` says outright that a second
value makes it a per-season lookup — so an FPL threshold change would move the
whole distribution with nothing in the app noticing.

**xGI — three seasons.** Materially better: three independent seasons, DEF and
MID cohorts in the hundreds. FWD is the weak leg at n=85, where the p99 is
Haaland's worst of three Haaland seasons.

Both are still the best estimate available, and leaving axes unfrozen defeats the
page. So: **freeze, and record the provenance so staleness is visible rather than
inferred.** Provenance is part of the data structure rather than a comment above
it, which is what makes the rule enforceable — `verify:thresholds` reads it.

> **The rule.** A threshold derived from fewer than five seasons is re-derived
> when a season is added. Five or more is frozen and re-derived only
> deliberately. A re-derived threshold records the old value beside the new one
> and the season that triggered it, because re-deriving breaks cross-season
> comparability on that axis — the one thing frozen thresholds exist to protect —
> so it has to be visible rather than inferable from a git log. A change to
> `DEFCON_THRESHOLDS` invalidates every DCH/St threshold outright, not at the
> next season boundary.

Five is defensible rather than derived: it is the point at which a statistic's
per-season spread stops being one season wide.

**The wire choice is what makes this practical, and it was the deciding argument
for it** — see below. Re-derivation is a server-only change: a constant compiled
into the client moves only when the client is rebuilt and every cached bundle has
expired.

### The consequence that is an axis question, not a threshold one

On this evidence DCH/St earns its place as a DEF axis, is defensible as a MID
axis, and was dropped for FWD. Recorded here so the next reader knows the
asymmetry was measured rather than arbitrary.

---

## Decisions 1 and 2, with their evidence

### Mean or median for the cohort band → **median**

Both, per position per axis, on the 2025-26 cohort. `Δ%` is (mean − median) as a
percentage of the median.

| Pos | Axis | n | Mean | Median | Δ% |
| --- | --- | --- | --- | --- | --- |
| GK | Pts | 22 | 106.68 | 111.00 | −3.9 |
| GK | CS | 22 | 8.27 | 8.00 | +3.4 |
| GK | Min | 22 | 2768.6 | 2960.0 | −6.5 |
| GK | PPM | 22 | 3.42 | 3.41 | +0.1 |
| GK | Pts/£ | 22 | 21.94 | 23.77 | −7.7 |
| GK | Bon | 22 | 7.09 | 7.00 | +1.3 |
| GK | Sv | 22 | 86.18 | 92.00 | −6.3 |
| DEF | Pts | 109 | 95.72 | 95.00 | +0.8 |
| DEF | CS | 109 | 6.73 | 6.00 | +12.2 |
| DEF | G | 109 | 1.14 | 1.00 | +13.8 |
| DEF | Min | 109 | 2268.0 | 2195.0 | +3.3 |
| DEF | PPM | 109 | 3.24 | 3.19 | +1.7 |
| DEF | DCH/St | 109 | 0.26 | 0.24 | +11.6 |
| DEF | A | 109 | 1.94 | 2.00 | −2.8 |
| DEF | Pts/£ | 109 | 20.23 | 20.45 | −1.1 |
| DEF | xGI | 109 | 2.96 | 2.67 | +10.8 |
| DEF | Bon | 109 | 5.57 | 5.00 | +11.4 |
| MID | Pts | 126 | 101.63 | 95.50 | +6.4 |
| MID | CS | 126 | 6.78 | 7.00 | −3.2 |
| MID | G | 126 | 3.69 | 3.00 | **+23.0** |
| MID | Min | 126 | 2105.5 | 1952.5 | +7.8 |
| MID | PPM | 126 | 3.30 | 3.29 | +0.3 |
| MID | DCH/St | 126 | 0.17 | 0.13 | **+34.6** |
| MID | A | 126 | 3.91 | 4.00 | −2.2 |
| MID | Pts/£ | 126 | 17.49 | 16.67 | +4.9 |
| MID | xGI | 126 | 6.56 | 5.50 | **+19.3** |
| MID | Bon | 126 | 7.96 | 7.00 | +13.7 |
| FWD | Pts | 28 | 115.50 | 112.50 | +2.7 |
| FWD | G | 28 | 9.96 | 9.00 | +10.7 |
| FWD | Min | 28 | 2105.1 | 1937.0 | +8.7 |
| FWD | PPM | 28 | 3.46 | 3.40 | +2.0 |
| FWD | DCH/St | 28 | 0.01 | **0.00** | *undefined* |
| FWD | A | 28 | 3.04 | 2.00 | **+51.8** |
| FWD | Pts/£ | 28 | 17.37 | 17.39 | −0.1 |
| FWD | xGI | 28 | 11.14 | 9.65 | +15.5 |
| FWD | Bon | 28 | 14.46 | 13.00 | +11.3 |

The gap is small where expected — Pts ≤ 6.4%, PPM ≤ 2.0%, Pts/£ ≤ 4.9% — and
large exactly on the count axes with a long right tail, where the mean sits above
roughly 60% of the cohort.

**The argument the gap alone does not show: the skew reverses sign by position.**
Every GK axis except CS and Bon has mean *below* median (Pts/£ −7.7%, Min −6.5%,
Sv −6.3%), because the 1,200-minute gate admits part-season keepers who drag a
mean down where outfield tails pull one up. A mean is wrong in both directions
depending on position; a median is stable in both.

**The one real cost**, stated because it is real: FWD DCH/St's median is exactly
0.00. That was an argument about whether the axis should exist, and it was
resolved by dropping it.

### Is p99 the right quantile → **yes**

At the rounded ceiling, 34 of 36 axes clip under 1% and 22 clip zero or one row
out of hundreds. The alternatives do not pay: p95 clips 5% by construction (62
MID rows, 54 DEF), which pins every elite player to the same outer ring and loses
the one thing the page is for; p97 is the same objection at 3%; max would let
Salah's 344 set the MID Pts axis and put the median midfielder at 28% of it.

---

## How the thresholds cross the wire

**A dedicated route: `GET /api/comparison-thresholds`.** Not the bootstrap.

**The payload size is not the argument, and was measured before deciding.**

| Response | Bytes |
| --- | --- |
| `/api/comparison-thresholds` | **6,671** |
| `/api/columns` | 8,257 |
| `/api/bootstrap` (2026-27) | 352,232 |
| `/api/bootstrap?season=2025-26` | 527,096 |

At 1.3% of a 2025-26 bootstrap the bandwidth genuinely would be free. Three other
things are not:

1. **A bootstrap response is one season throughout** — the premise `season`,
   `seasons` and `columns` all rest on. A block derived from ten seasons at once
   has no honest place on it, and putting it there would make API identity rule
   7's single-season form false of its own carrier. This is the argument that put
   `/api/columns` on its own route.
2. **The bootstrap is refetched on every season change.** These constants do not
   vary by season, so riding along would re-send them on every switch to answer a
   question with the same answer.
3. **Every page blocks on the bootstrap at mount; one page needs these.** The
   bootstrap already runs 23-121 ms depending on season.

**And the deciding argument, which is about the rule rather than the request:
re-derivation is a server-only change.** Two axes are expected to move. A
constant compiled into the client moves when the client is rebuilt and every
cached bundle has expired; a constant served from here moves when the server
restarts.

**The accepted cost, recorded as such:** the client has no axis configuration
until the response lands, so the comparison page needs a loading state rather
than rendering axes from a compiled-in constant. That is a real consequence of
this choice and not a detail to be discovered later.

### Rule 7's many-seasons form, applied to something that is not a season

The response has no top-level `season` and every axis carries
`derivedFrom.seasons`. That set **is** the label: a threshold is not drawn from
one season but from ten, or the three that measure xGI, or the one that measures
DC, and a consumer showing an axis is showing a claim about exactly those
seasons. Same shape as `/career` and `/columns`, for the same reason.

`?season=` is **rejected rather than ignored**, following `/career`: accepting a
parameter and silently doing something else with it is how a caller ends up
certain it filtered when it did not.

### Where the module lives, and the import that did not happen

`server/src/comparison/thresholds.ts`. The obvious home was `client/src/lib/`,
which is where the client-side rule modules live and where the Fast Refresh rule
would have put it.

It is on the server because **`verify:thresholds` has to import the constants** —
restating them in the check would make the check agree with itself — and a
`client/src/lib/` module would have made that the **third** cross-package import
in the repo. `server/tsconfig.json` records that two is the line and that a third
means a shared package rather than a wider `rootDir`. Server-side ownership means
the check imports them inside the server program with full type checking, no
third `exclude` entry arrives, and item 13's rule is untouched.

**The axis keys are `PLAYER_COLUMNS` keys.** All eleven axes already existed as
columns the Players list can offer, so the chart and the list name the same stat
identically and there is no second vocabulary. The `label` is carried separately
because a radar axis and a table header have different width budgets — `Sv` here
against the picker's `S` is the one place they differ.

**Every position's set is built by filtering one canonical pool**, so "a pruned
set preserves the relative order" is structurally true rather than four
hand-maintained arrays that agree today.

---

## `npm run verify:thresholds`

Two parts, deliberately never merged, following `verify:defcon`. Read-only.

**Part 1 — the constants against their own derivation set. This one fails.** Over
exactly the seasons each threshold records: the cohort size must be the recorded
one, the ceiling must be ≥ p99, and the floor must be what the rule says. It
re-derives over the *recorded* seasons rather than everything available, so it
stays green as seasons are added. All 35 pass today.

**Part 1 checks the invariant, not the arithmetic.** It asserts `ceiling >= p99`
rather than re-running the friendly ladder and comparing: re-running the ladder
would reproduce the constant by construction and prove only that the same
function was called twice. `ceiling >= p99` is the property the ceiling exists to
have and is checkable from the data alone.

**Part 2 — what a re-derivation today would say. Informational, never fails.**
Today's p99, the ceiling the ladder would pick from it, and the current clip count
and percentage per axis. **A frozen threshold drifting from a fresh derivation is
the expected state, not an error**, and a check that went red for doing its job
would get its threshold raised.

"Re-derived today" means the recorded seasons **plus every complete season newer
than the newest recorded one**. That is the trigger the rule names — a season
being added — and it deliberately does not re-open the availability judgement
that kept 2022-23 out of xGI. Today no axis gains a season, so part 2 reports zero
drift, and will until 2026-27 completes.

### The import direction, which is the opposite of `verify:columns`

`verify:columns` restates its `DB_COLUMNS` so it cannot agree with itself, and
imports the shipped *logic*. Here the frozen numbers **are** what is being
checked, so a restated copy would pass whenever the two copies matched, including
when both were wrong — the constants are imported and the **SQL for each axis** is
restated instead. That derivation genuinely is independent, and writing it in the
check is what lets the check disagree. `defconHitSql` is imported for the same
reason: a check restating the DC threshold could not catch a wrong one.

### Proved it can fail

Three mutations, one per assertion, applied together and then restored from a
copy (not `git checkout --`):

| Mutation | Reported |
| --- | --- |
| MID Pts ceiling 250 → 200 | `ceiling 200 is BELOW p99 234.7000` |
| MID PPM floor 1.48 → 1.49 (rounded to nearest) | `floor: recorded 1.49, rule says 1.48` |
| DEF xGI cohort 311 → 312 | `cohort: recorded 312, measured 311` |

Exit code 1, three MISMATCHes, part 2 unaffected. The floor mutation is the one
worth noting: it proves the truncate-don't-round rule is enforced rather than
merely written down.

---

## What step 2 did not do

No chart, no comparison route, no client rendering, and no client code at all.
The thresholds are served and checked; nothing consumes them yet.

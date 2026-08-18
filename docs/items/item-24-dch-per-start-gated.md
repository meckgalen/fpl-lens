# Item 24 — DCH/St counts only hits made in starts

`DCH/St` divided `defcon_hits` — every hit, bench included — by `starts`. The
numerator drew from a population the denominator did not cover, so the ratio was
inflated for any player with a bench hit. It is now gated on `starts = 1` and
bounded at 1.00 by construction. **`DCH` is unchanged and still counts every
hit.**

## Why it moved, which is not the 0.07

The defect was small and the inconsistency was not. Item 14 chose the shared
numerator deliberately, reading a value above 1 as "hits more often than he
starts" — informative rather than broken — and its audit found nothing above
1.00. Item 19 then shipped `Pts10+/St` and `Pts4+/St` with **gated** numerators,
for exactly the reason item 14 declined to. The app therefore shipped two ratios
under one `/St` suffix with opposite semantics and nothing on screen telling them
apart.

The denominator was **not** switched to appearances. That was the other way to
make the populations agree; it mixes very different minute distributions and
would have left `DCH/St` the odd one out against `Pts10+/St` instead of matching
it.

## The scope miss: the radar axis was not in the brief

The brief named the Players column. `defcon_hits_per_start` is **also a
comparison radar axis** (`comparison/cohort.ts`, `comparison/thresholds.ts`),
drawn under the same `DCH/St` label one page away and computed from the same
ungated quotient. Gating only the Players column would have shipped the
inconsistency the item exists to remove, one surface further along.

It came in, and it is recorded here rather than folded in silently, because the
item's own framing is what missed it: the defect was described as a Players-list
defect when it was a defect in a *quantity* that two surfaces render.

## The frozen thresholds were re-derived and did not move

Gating the numerator lowers every value, so p99 moves and the frozen ceilings had
to be re-derived — the re-derivation rule puts `DCH/St` in the re-derive-freely
bucket anyway (one season, below `RE_DERIVE_BELOW_SEASONS`).

**Rounding direction: ceilings round UP, floors round DOWN.** A ceiling is the
smallest rung of `RUNGS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8] × 10^k` at or
above p99. Rounding is directional, and the reason is item 16 step 2's: a floor
rounded *to nearest* can land above the quantile it names and clip more than the
1% it claims to, so a floor's safe direction is down and a ceiling's is up. Both
DCH/St floors are 0 and unaffected; only the ceilings were re-derived.

**The instrument was gated before it was trusted.** The hand-written SQL used
here reproduces both frozen ceilings from the *old* definition first — DEF p99
0.705628 → rung 0.80, MID 0.563913 → rung 0.60, matching the shipped constants —
so its new figures are a measurement rather than the new code paraphrasing
itself.

| Position | cohort | p99 (old) | p99 (new) | ceiling (old) | ceiling (new) |
| -------- | ------ | --------- | --------- | ------------- | ------------- |
| DEF | 109 | 0.705628 | 0.699820 | 0.80 | **0.80** |
| MID | 126 | 0.563913 | 0.563913 | 0.60 | **0.60** |

**Neither ceiling moves, so `supersedes` is NOT set** and
`thresholds.test.ts`'s assertion that every threshold's `supersedes` is
`undefined` stays green. Setting it would record a change that did not happen.

**That makes the documentation the only record that a re-derivation happened**,
which is why it is stated twice: here, and in a comment on `DCH_SEASONS` in
`thresholds.ts` where a reader of the constants will meet it. There is no data
field for "re-derived, unchanged" — `derivedFrom` holds seasons and cohort, both
of which are also unchanged — and inventing one for a single case would be a
shape pretending to information. **Do not read the outcome as a general result:**
it held because the affected players sat away from the percentile, not because
gating a numerator is harmless. A future redefinition gets its own derivation.

Why: only 3 DEF and 4 MID cohort members change at all. MID's affected players
top out at 0.467 against a p99 of 0.564, so its percentile is untouched to six
decimals; DEF's include the cohort maximum (Canvot, 0.714 → 0.706), which moves
p99 slightly but not off the 0.80 rung. `verify:thresholds` confirms both from
its own independently-restated SQL.

FWD and GK have no `DCH/St` axis, so neither is affected.

## The zero-start case, checked rather than assumed

Gating the numerator makes a zero-start player's value undefined. The question is
whether cohort membership already excludes such players.

**It does not guarantee it — the cohort gate is 1,200 MINUTES, not a starts
floor** — but empirically no cohort member is close: the least-started member of
the 2025-26 DCH cohort has **13 starts**, and no outfield player in that season
has a hit without a start at all. So the band is unaffected as a matter of
measurement, not of construction.

**Traces are not cohort-gated**, so any player the picker offers can be drawn.
Both surfaces guard the case identically and already did before this item:
`cohort.ts`'s `hitsPerStart` and `playerColumns.ts`'s `perStart` both return
`null` on a zero or null denominator, which renders the no-value marker in the
table and breaks the radar outline over the spoke (rule 19). The guard is on the
**denominator**, so gating the numerator did not change it.

One correction to the brief: it called "0 starts with a non-zero DCH" *newly*
reachable. It was already reachable and already guarded — and no outfield player
in 2025-26 is actually in it, so it is pinned by unit test rather than in the
browser.

## `verify:defcon`: the frozen literals did not move, and a second set was added

The brief expected part 2's literals to move. **They do not** — `EXPECTED`
freezes the distribution of `defcon_hits`, the total, which this item leaves
alone. Editing them would have recorded a change that did not happen and lost the
check on the count that did not move.

So a **second** frozen distribution was added beside it, derived by hand in SQL
with the thresholds restated as literals and no shipped code imported. The same
instrument reproduces all four rows of the item 14 block, which is what gates it.

| Position | players | median | zero-hit | total hits (all) | total hits (started) |
| -------- | ------- | ------ | -------- | ---------------- | -------------------- |
| DEF | 270 | 1 | 129 → **130** | 821 | **817** |
| MID | 379 | 0 | 261 | 587 | **583** |
| FWD | 95 | 0 | 91 | 9 | 9 |
| GK | 97 | 0 | 97 | 0 | 0 |

4 + 4 = **8 bench hits**, which is item 14's audit figure arrived at from the
other side. One defender's only hit was off the bench, which is the zero-hit
column moving by one.

## A prediction that was wrong, and measured to be wrong

The brief said, and this record originally said, that part 1 could not catch a
wrong population because both sides call the same fragment. **Measured: it
does.** Removing `defconHitCountSql`'s gate reddens part 1 with **8
disagreements**, one per bench hit, naming O'Nien, Janelt, C.Jones, Ballard and
four more.

The reason is that part 1's started-only comparison gates in **SQL** on the
aggregate side and in **TypeScript** on the row side, so the gate is genuinely
stated twice. What part 1 still cannot see is a wrong *threshold* — `defconHitSql`
really is on both of its sides. The comments in `defcon-check.ts` were corrected
to the measured behaviour rather than left as the prediction.

## Mutation results

Each mutation applied to a file copied to the scratchpad first and restored from
the copy — never `git checkout --`, per the item 14 loss.

| Mutation | Result |
| -------- | ------ |
| `defconHitCountSql`'s gate → `''` | **3 server tests red** (synthetic divergence, the Canvot/Ballard anchors, the 8-bench-hit total); `verify:defcon` exits 1 on **both** parts |
| Drop `fullyMeasured('starts')` from the aggregate | **2 server tests red** (NULL start, partly-measured starts) |
| Drop `count(pg.fixture_id) > 0` from the aggregate | **2 server tests red** (the synthetic unplayed player, and 2026-27's whole roster) |
| Client `hitsPerStart` → `p.defcon_hits` | **6 client tests red** |

**The vacuous-zero mutation initially reddened only one test, and the missing
one was the case that ships.** The synthetic unplayed player was covered; 2026-27
— 564 registered players, no match rows, the season the app defaults to — was
not, because the existing real-database assertion only checked `defcon_hits`. The
test was written before committing.

**That guard is load-bearing here in a way it is not in the module this mirrors.**
`hauls_started` is built from `sum(CASE … ELSE 0)`; `count(*) FILTER` returns 0
over *anything*, nothing included. Both are defeated by the LEFT JOIN's
null-extended row, so both need the guard — but a bare `sum()` over genuinely
zero rows would at least have been NULL, so the sum shape fails in a
recognisable direction where the filtered count fails silent.

The restore was verified byte-identical with `diff -q` against each copy.

## `verify:columns` moved, and the delta was derived not pasted

Adding `defcon_hits_started` to `PAYLOAD_FIELDS` moved nine of the ten frozen
per-season cell counts. The delta was derived independently in SQL rather than
read off the failing run: the field is null wherever DC **or** `starts` is
unmeasured, and DC is unmeasured on every player of every season before 2025-26 —
counted against `player_gameweeks` — so each of those nine seasons gains exactly
its own roster and 2025-26 gains nothing. Each literal is written `old + roster`
in the source.

2026-27's expectation is **derived** rather than frozen and auto-adjusted from
`564 × 8` to `564 × 9`, which is the factored design in that file working as
documented.

## Browser pass

2025-26, Chrome, both themes.

| Check | Result |
| ----- | ------ |
| Canvot | `DCH 10`, `DCH/St` **0.64** (was 0.71) |
| Ballard | `DCH 15`, `DCH/St` **0.58** (was 0.62) |
| Gabriel (control, no bench hit) | `DCH 11`, `DCH/St` 0.37 — unmoved |
| Sort by `DCH/St` desc | max **1.00** (Igor 1/1, Colwill 2/2); nothing above |
| Alese, 0 starts / 38 bench matches | `DCH 0`, `DCH/St` **—** (not 0.00, not Infinity) |
| Comparison page, Canvot trace | `DCH/St` **0.64**, agreeing with the Players list |
| Comparison scale line | `DCH/St 0–0.8`, band `median of 109 DEFs` — both unchanged |
| Light and dark | both render; radar and table correct in each |

**2026-27 checked directly, not only through a mutation.** The bootstrap serves
`defcon_hits_started: null` on all **564** players — never 0 — alongside
`hauls: 0`, which is the rule 6 pair behaving correctly on one payload.
`GET /api/comparison?season=2026-27&position=DEF` serves **8 axes with
`defcon_hits_per_start` absent entirely**, so nothing plots a fabricated 0.00.

On screen the page goes further than dropping the axis: with a trace added it
withholds the whole chart and says why — *"No matches recorded for 2026-27 yet,
so no values and no cohort"*, followed by the ten axes DEFs *will* be drawn on,
`DCH/St` named among them. That empty state predates this item; what matters is
that it is the reachable path, since the comparison page opens on 2026-27 while
the Players picker merely disables the column.

The two surfaces reading the same number is the item's actual acceptance
criterion, and it is the row above that says so.

## HMR

`hmr update` on `playerColumns.ts`, no `hmr invalidate`, no Fast Refresh warning.
Triggered by a real content change (an appended comment, then removed), not
`touch` — which produces no event at all, and no event reads exactly like a pass.

## Files

- `repositories/defcon.ts` — `defconHitCountSql(pg, ps, { startedOnly })`, the
  structural mirror of `pointCountSql`. Wraps `defconHitSql`, so a threshold
  change cannot reach one aggregate and miss the other.
- `repositories/players.ts` — `defcon_hits_started`, with **three** guards where
  `defcon_hits` has two.
- `comparison/cohort.ts` — `hitsPerStart` reads the gated field.
- `client/lib/playerColumns.ts` — same, plus the rewritten gloss and description.
- `verify/defcon-check.ts`, `verify/thresholds-check.ts`, `verify/columns-check.ts`,
  `verify/payload-fields.ts`.

## One structural difference from `Pts10+/St`, and why it is not a second pattern

`pointCountSql` uses `sum(CASE … ELSE 0)`; `defconHitCountSql` uses
`count(*) FILTER`. Each keeps the form its own module already used. The
difference is inert here: `sum()` over zero rows is NULL where `count(*) FILTER`
is 0, but **neither caller ever sees zero rows** — the LEFT JOIN gives an
unplayed player exactly one null-extended row, over which both produce a hard 0.
So both need the same `count(pg.fixture_id) > 0` guard, and the `startedOnly`
option — the part that matters — is identical in both.

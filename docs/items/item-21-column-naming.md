# Item 21 — Column naming, the description split, picker tags, and a default swap

Four changes to the Players list's vocabulary, plus one field split that fell out
of the second and turned out to be the substantive part.

## 1. The threshold goes in the header

| key (unchanged) | was | now |
| --- | --- | --- |
| `hauls` | `Hauls` | `Pts10+` |
| `floors` | `Floors` | `Pts4+` |
| `hauls_per_start` | `H/St` | `Pts10+/St` |
| `floors_per_start` | `F/St` | `Pts4+/St` |

**Why.** "Haul" has no agreed threshold in FPL — 10, 12, or just "a big week"
depending who is talking — so the old name hid the one choice the reader needs to
see. "Floor" is worse than merely vague: it normally describes a player's
*baseline*, so a column of counts under that heading reads as a level rather than
a tally. `Min10+` was considered and rejected — `Min` is minutes played and sits
in the same header row, so it would parse as a minutes threshold.

The two ratio **titles** changed with their labels ("Hauls per start" →
"Matches of 10 or more points, per start"). The picker renders title and label
side by side, so keeping the old title would have put the word back on screen
beside the label that replaced it.

### The keys did not change, and one of them now lies

All four keys keep the old wording. They are what `loadSelectedColumns` reads out
of `localStorage` under `fpl-players-columns`, and unknown keys are dropped at
read — so a rename silently discards that column from every existing selection,
with nothing to detect it. **Verified in the browser rather than argued**: an
18-column selection stored by a previous session survived the rename intact and
rendered under the new labels.

The payload and domain field names (`PlayerSeasonTotals.hauls`, `.floors`,
`.hauls_started`, `.floors_started`) also keep the old words. They are not
display text and not persisted keys; renaming them reaches the repository, the
domain and API types, `verify:haul` and `hauls.test.ts` for no user-visible gain.

**`_per_start` now means two unrelated things**, and that is recorded in
`playerColumns.ts` between `perMillion` and `perStart` — the one place both are
visible — as *accepted rather than missed*:

- `pts_per_start` divides by the season's **opening price**. "Start" is the start
  of the season.
- `hauls_per_start` / `floors_per_start` divide by **games started**.

This item is what made it worth writing down: it put `/St` into user-facing
labels for the first time, so on screen the suffix now reliably means "per game
started" while `pts_per_start` goes on meaning something else in the source. A
reader who notices and "fixes" one of the names is the failure the note prevents.

## 2. The description split — `gloss` vs `description`

The brief was "trim the descriptions". Trimming the one field would have broken
`comparison.axes.test.ts`, which forbids a radar tooltip being a restatement of
its own caption: 7 of the 11 axis descriptions would have fallen under its
25-character floor, and `Goals scored.` differs from `title: 'Goals scored'` only
by a full stop.

That guard is not incidental. A Players header sits in a table that already names
the season and the player, so expanding the abbreviation is the whole job. A
radar spoke has no header row and no picker beside it, so its tooltip has to
*teach* — which is why `axisDefinition` deliberately refuses to fall back. **One
field cannot do both jobs**, which is the same argument that made `title` and
`description` two fields in the first place, one step on.

So `PlayerColumn` now has four name fields, distinguished by which surface reads
which:

| field | read by | shape |
| --- | --- | --- |
| `label` | the table heading, the radar spoke | `DCH/St` |
| `title` | the picker, as visible text | a noun phrase |
| `gloss` | the Players header `title=` hover | one short sentence |
| `description` | the radar spoke's hover, and nothing else | a definition |

Named `gloss` rather than `short` because `label`/`title`/`short`/`description`
gives no clue which surface reads which.

**No existing `description` was edited.** All eleven axes keep theirs verbatim —
confirmed in the browser, where all ten DEF spokes still render their full
definitions.

**Exceptions carrying one clause past the expansion**, because the expansion
alone is not enough: `DCH/St`, `Pts10+/St` and `Pts4+/St` state the denominator
(per *start*, not per game) and what counts; `Pts/£` says "at the current price",
since the picker also offers the season-opening variant; `PPM` says "not per
round"; `Pts10+`/`Pts4+` give the threshold, the inclusion, and that the unit is
the **fixture**, so a double gameweek counts each match separately.

### `description` is now bounded to the eleven axes, in both directions

The four renamed columns were the only non-axis columns carrying a description,
and they lost it — after the header hover moved to `gloss`, a `description` on a
non-axis column is read by **no surface at all**, so it cannot be seen to be
wrong and it duplicates the `gloss` beside it.

`comparison.axes.test.ts` gained two clauses:

- **Forward:** every axis key has a `description`. Honest about what it adds —
  the existing `not.toBeNull()` already goes red on that path, since
  `axisDefinition` is `columnByKey(axis)?.description ?? null`. It closes no open
  hole; it buys the failure *message*, which names the field a reader who just
  added a `gloss` needs to see.
- **Converse:** no `PLAYER_COLUMNS` entry outside `COMPARISON_AXES` carries a
  `description`. **This is the half that makes the invariant real** — without it
  the field regrows on a column nothing reads it for, which is the
  two-fields-one-fact drift the split was made to avoid, reappearing through the
  door the split opened. Asserted on the key *list* rather than a count, so a
  failure names the column.

`COMPARISON_AXES` rather than the server's `AXIS_POOL`: this is a client suite,
and `COMPARISON_AXES` is the same eleven keys, already type-guarded against
`ComparisonAxisKey` in both directions so it cannot drift to ten.

## 3. Picker tags

`resolveColumn` now returns `tag` alongside `reason`, **produced in the same
branch** — one derivation, two renderings. `Comparison.tsx` still reads `reason`
and was not touched. `ColumnPicker` renders `tag ?? reason`, the tag inline
beside the label and a sentence on its own line.

`describeRecordedIn` changed contract: it returns the phrase **without** the verb
(`from 2022-23`), and the sentence builder writes `· recorded ${where}.`. That is
what makes the tag and the sentence one derivation rather than the tag being
sliced back off the sentence with a `replace(/^recorded /, '')`.

### Six terminal branches, not the four the brief assumed

| # | branch | tag | |
| --- | --- | --- | --- |
| 1 | `col.unavailable` (`Status`, `Own%`) | — | keeps its sentence |
| 2 | `!measured` | `no matches yet` | ✅ |
| 3 | `cell === undefined` | — | keeps its sentence |
| 4 | `partial`, `measured_from` set | `from GW16` | ✅ |
| 5 | `partial`, `measured_from` null | `partly recorded` | ✅ |
| 6a | `none`, one run reaching the data | `from 2022-23` | ✅ |
| 6b | `none`, multiple runs | `2016-17 to 2018-19, and 2025-26` | truthful, not short |
| 6c | `none`, no matrix | — | keeps its sentence |

**Shape 1 cannot compress.** `Own%`'s sentence says the gap is in *our pipeline*
— the raw manager count is stored for all ten seasons, the total-managers
denominator is not — where `Status`' says the field describes a live game. A
shared `not stored` tag collapses exactly that distinction.

**Shape 6b compresses only to a range list.** `from 2025-26` would be false about
the six seasons in between. Truthful and long beats short and wrong, and since
the derivation is shared there is no second rule to get wrong.

> **Finding: shape 6b has no live picker entry.** `tackles`,
> `clearances_blocks_interceptions` and `recoveries` are in `NULLABLE_COLUMNS`
> but not in `BOOTSTRAP_NULLABLE_COLUMNS`, and no `PLAYER_COLUMNS` entry exists
> for any of them — `listPlayerTotals` carries no value, so the Players list
> cannot render them. Every nullable Players column resolves to a **single** run.
> Confirmed in the browser: 2016-17 shows `from 2022-23` and `from 2025-26`,
> never a range list. Shape 6b is exercised by unit test only, and stays
> implemented because `describeRecordedIn` is shared and the trio becomes a
> column the day `CAREER_EXTRA_AGGREGATE` reaches the bootstrap.

### The framing line, and a first draft that was false

Shipped: *"Greyed-out columns can't be shown for {season}. Each says why; a few
need a full sentence."*

It must name the season, because `from GW16` is a boundary **within** the
selected season and reads as a claim about a different one without it.

The first draft was *"a tag says when the stat is recorded; anything else says
why"* — and it is **false for two of the five live tags**: `no matches yet` and
`partly recorded` are both tags and both *whys*. The axis it summarised by was
the wrong one; the real split between a tag and a sentence is **length, not
kind**. Recorded in the component beside the line so it does not get re-proposed.

## 4. Default column swap

Out: `bonus` (`Bon`), `pts_per_start` (`Pts/£s`). In: `hauls` (`Pts10+`),
`floors` (`Pts4+`). **Thirteen before, thirteen after**, so item 13's 1440px
measurement still holds. Both removed columns remain in the picker, pinned by a
new test that selects each and checks it renders.

`DEFAULT_KEYS` is the render order — `Players.tsx` maps `selected` — so the array
was reordered to match, and `hauls`/`floors` moved above the
`// ---- available, not default ----` divider with `bonus`/`pts_per_start` moving
below it, keeping the divider true.

## Verification

- `npm test` — **155 server, 322 client**, all green. `npx tsc --noEmit` clean.
- `npm run verify:columns` — 197,550 cells compared, 45,985 must-be-null,
  **0 failures**. Availability logic is unchanged and stayed green.
- **Browser pass**, all four seasons, tags read out of the live DOM:
  - 2025-26 — only `Status` and `Own%` disabled, both with full sentences.
  - 2022-23 — `from GW16` on six entries (xG, xGI, xA, Starts, Pts10+/St,
    Pts4+/St), `from 2025-26` on the DC three.
  - 2016-17 — `from 2022-23` / `from 2025-26`. No range list, per the finding.
  - 2026-27 — `no matches yet` on all nine nullable entries; `Pts10+`/`Pts4+`
    still enabled and rendering `0`.
- Defaults with a cleared store: `Pts · Price · Min · G · A · CS · Pts/£ · PPM ·
  Pts10+ · Pts4+ · xG · xGI · DC` — thirteen, in order.
- Glosses render as header `title=` attributes; all ten DEF radar spokes still
  render their full descriptions.
- **Rendered width, measured rather than assumed:** min-content **932px**,
  against item 13's recorded 921px for its thirteen. The swap costs 11px — the
  new headers are marginally wider — and stays far inside 1440.
- HMR: two `hmr update` events on a real content edit to `playerColumns.ts`, **no
  `hmr invalidate`**, no Fast Refresh warning.

## One test helper was quietly broken and is now fixed

`entryExact` in `Players.columns.test.tsx` built its matcher with
`label.replace('/', '\\/')` — a single un-anchored `replace`, escaping the first
slash of one label and nothing else. `Pts10+` compiles as "Pts1" followed by
one-or-more "0", which **matches the wrong thing silently rather than throwing**.
Replaced with a full metacharacter escape. Worth recording because the old form
looked deliberate and had been correct for every label that existed when it was
written.

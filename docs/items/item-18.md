# Item 18 — Pre-deployment fixes

Five defects found in a browser pass, all of them things a first-time visitor
hits within a minute. Four steps, one commit each.

| Step | Commit |
| --- | --- |
| 1. A club filter on the Players list | `3e580db` |
| 2. Axis definitions on hover, from one source | `bd7db8e` |
| 3. Both lists reach the whole roster | `54f80cc` |
| 4. Gameweek navigation, and FDR that is not a scoreline | `492490a` |

CLAUDE.md was **102,196** characters at item start (85% of the 120,000 budget)
and the tree was clean.

---

## Step 1 — A club filter on the Players list

Extracted rather than written twice: the Comparison page already had the dropdown
inline at `Comparison.tsx:344-366`, so it became `components/ClubFilter.tsx` and
both pages render it. The only change the extraction needed was **`id` as a
prop** — it was the hard-coded literal `comparison-team`, and the `htmlFor`/`id`
pair only works while one instance is mounted.

The compose requirement is satisfied by construction: every filter on the page is
an independent `useState` and nothing writes across them. So the tests aim at the
two ways that could stop being true rather than at the happy path.

**The club resets to All only when the new season lacks that club.** A club code
is permanent, so Arsenal is worth carrying across a season change — the same
argument `search` and `sort` get. But only twenty of the thirty-five clubs stored
are in any one season, so keeping Leeds into 2021-22 leaves a filter matching
nobody, behind a `<select>` whose value matches no option, which browsers render
blank.

### Mutations

| Mutation | Result |
| --- | --- |
| Filter clause removed | all 4 red |
| Reset made unconditional (deps incl. `team`) | all 4 red — too blunt to isolate |
| Reset keyed on season only | **only** "keeps the club" red |
| Reset removed entirely | **only** "resets to All clubs" red |

The second is worth recording as a *failed* mutation design: with `team` in the
effect's deps an unconditional reset undoes every selection immediately, so it
breaks everything and isolates nothing. The third is the one that discriminates.

### Browser

Arsenal survives 2026-27 → 2016-17 (34 rows in 2016-17); Leeds (24 rows in
2026-27) resets to All clubs on the same move, with the select reading "All
clubs" and not blank. Compose: sort by Min **ascending** (away from the default),
search `a`, then change club — 200 → 22 rows with the ascending sort and the
search both intact.

---

## Step 2 — Axis definitions on hover, from one source

The eleven radar axes were unexplained abbreviations. They now carry the same
sentence the values table shows, read from `PLAYER_COLUMNS` through
`columnByKey` — an axis key **is** a column key, which is what lets a caption and
its explanation share a source.

**`title` could not carry it.** `ColumnPicker.tsx:113` renders `col.title` as
*visible* text, not as a tooltip, so a definition-length string blows out every
row of the picker. Hence a separate `description` field. Labels stay
server-supplied: a spoke and a table header have different width budgets, which
is why `Sv` and `S` differ.

**The fallback is deliberately asymmetric.** Players renders
`description ?? title`; `axisDefinition` does **not** fall back. A tooltip that
restates the caption it hangs off looks like a working tooltip and explains
nothing — the exact failure the step exists to fix.

SVG `<text>` takes no `title` attribute, so the caption's tooltip is a `<title>`
**child**, the pattern the clip markers in that file already use. It also becomes
the caption's accessible name, so a spoke announces the sentence rather than
`DCH/St`.

### The guard, and why the obvious form is inert

`COMPARISON_AXES` is the first runtime list of the axis keys. A bare
`type _Exhaustive = Exclude<…> extends never ? true : never` would be a **no-op**
— an unused type alias evaluating to `never` compiles clean. The guard has to
fail to *construct*:

```ts
export const COMPARISON_AXES = [...] as const satisfies readonly ComparisonAxisKey[];
const _exhaustive: Exclude<ComparisonAxisKey, (typeof COMPARISON_AXES)[number]> extends never
  ? true : never = true;
```

| Mutation | `satisfies` | `_exhaustive` |
| --- | --- | --- |
| Twelfth member added to `ComparisonAxisKey` | silent | **red** (TS2322) |
| Key removed from the array | silent | **red** (TS2322) |
| Invented key put in the array | **red** (TS2322) | silent |

The two clauses catch opposite mistakes and neither alone suffices. Deleting one
`description` turns exactly that axis's `it.each` case red, 14 passing.

### What the tests refuse to assert

"Eleven non-empty strings exist" would pass against `description = label`,
`description = title`, or any placeholder. The assertions are instead that each
resolves to a description **not equal to** the label or the title, that `Pts/£`
names its sibling `Pts/£s`, that `PPM` says "not points per million", and that
`DCH/St` says a value above 1 is meaningful and why (bench hits in the numerator,
starts only in the denominator — item 14's finding).

`ComparisonRadar.test.tsx` dropped its hand-written `KEYS` array for the shipped
list. `Comparison.test.tsx`'s `spokeLabels` now reads the caption's own text
nodes: a `<title>` is an element, so `textContent` folded the whole sentence in
front of the label and `toContain('xGI')` stopped matching. **That failure was
the test doing its job**, and the fix was to make the helper measure what it
means rather than to weaken it.

### Browser

2025-26, DEF: all ten captions carry a `<title>` parented to the caption, none
echoing it, and all ten table rows carry the identical string. The `Scale` row
correctly carries none.

---

## Step 3 — Both lists reach the whole roster

### Where the caps were

Both were client-side slices, not server limits — established before choosing a
fix, as asked.

- `Players.tsx:309` — `list.slice(0, 200)`. The **only** cap in the path:
  `listPlayerTotals` ends `GROUP BY … ORDER BY p.fpl_code` with no LIMIT and no
  limit parameter; the bootstrap route reads no `req.query.limit`;
  `fetchBootstrap` returns the body untouched; the `list` memo has no slice.
- `Comparison.tsx:34` — `MAX_CANDIDATES = 8`, applied as a sort-then-take after
  the position, club, search and already-added filters. **Eight, not nine.**

Both were silent. The Players count printed the true `list.length`, so the page
read "865 players" above 200 rows; the picker showed 8 of 278 defenders with no
total at all. The cap was also applied *after* the sort, so re-sorting silently
changed which players existed.

### Roster sizes, measured against the database

| Season | Players | | Season | Players |
| --- | ---: | --- | --- | ---: |
| 2016-17 | 683 | | 2022-23 | 778 |
| 2017-18 | 647 | | 2023-24 | **865** |
| 2018-19 | 624 | | 2024-25 | 784 |
| 2019-20 | 666 | | 2025-26 | 841 |
| 2020-21 | 713 | | 2026-27 | 564 |
| 2021-22 | 737 | | | |

(2024-25 is 784 here against `data-profile.md`'s 804: the twenty Assistant
Manager elements are excluded at ingest by rule 11.)

### Rendering everything was tried first, and the browser refused

2023-24, default columns, position ALL, empty search, one instrument, varying
only the cap:

| rendered | mount | re-sort |
| --- | ---: | ---: |
| 200 | 215ms | 160ms |
| 865 | 792ms | 408ms |

Three cheaper fixes were measured against the full set and each rejected:

| Attempt | Re-sort | Mount |
| --- | ---: | ---: |
| baseline (865) | 408ms | 792ms |
| `memo(PlayerShirt)` | 428ms | — |
| `table-layout: fixed` | 400ms | — |
| `content-visibility: auto` | 371ms | 736ms |

The memo was **reverted** rather than kept: it bought nothing measurable, and
leaving a wrapper with a comment claiming a benefit it does not deliver is worse
than not having it. The cost is React reconciling 865 rows of 15 cells, not
layout or paint — which is why only rendering fewer rows moves it.

### Two notes on the measurements, mattering more than the numbers

**The pre-committed sort gate of 150ms was mis-calibrated.** The *shipped*
200-row code already missed it at 160ms, so it could not discriminate between
"this change is too slow" and "this page was always like that". Recorded rather
than quietly raised. The mount gate of 500ms did discriminate — 215ms against
792ms — and is what the decision rests on.

**Every "the renderer is frozen" reading during this work was an artifact.**
Chrome throttles `requestAnimationFrame` to zero and `setTimeout` to ~1s in a
**hidden** tab. Several measurement loops appeared to hang the app for 45s; the
tab was simply backgrounded. Confirmed directly: `document.visibilityState` was
`hidden` and a raced `requestAnimationFrame` never fired within 1.5s. The final
numbers use a `MutationObserver`, which is not throttled. **No app-level hang
ever existed**, and a timing taken through rAF is only valid while the tab is
foregrounded.

### What shipped

Incremental rendering, **not pagination**: no page controls and no page number,
one continuous list that grows as it is scrolled and resets to the first chunk
when the ordering or filters change, so a sort click never pays the full-roster
cost. It says what it is holding back — `Showing 200 of 865 · scroll for more` —
which is the surface rule and closes the older silent-truncation defect rather
than reproducing it at a different number.

Verified live: the list grew 200 → 400 → 600 → 800 → 865 on scroll, with the
sentinel disappearing at the end.

The picker is the same instrument at `CANDIDATE_CHUNK = 60` over a fixed-height
scrolling pane, with the match count in the header. Worst case measured — MID on
2023-24, **374** candidates (DEF 278, FWD 113, GK 100), full pool → one-character
filter — median **14.7ms** against the pre-committed 100ms budget.

### Mutations

| Mutation | Result |
| --- | --- |
| Chunk reset removed | both "drops back to one chunk" tests red |
| Full list rendered | 4 of 6 incremental tests red |
| Picker cap restored to 8 | all 4 picker tests red |

One test started **green** under the first mutation: the filter-reset case
searched a term that already matched fewer than one chunk, so it held whether or
not the reset existed. Rewritten to match every player, which is the only version
that can fail.

---

## Step 4 — Gameweek navigation, and FDR that is not a scoreline

### The round list needed no new derivation

`listEvents` already builds rounds from `fixtures.gw`, and the client already
holds the result whole as `bootstrap.events`. Item 12's career `rounds` is inline
correlated SQL rather than a helper, so reusing it would have **created** the
third derivation the brief warns about. No server change at all.

Verified against the database and then live:

| Season | Rounds | Highest | Shape |
| --- | ---: | ---: | --- |
| 2019-20 | 38 | 47 | `{1…29, 39…47}` |
| 2022-23 | 37 | 38 | `{1…6, 8…38}` |

Live: 2019-20 offers 38 rounds reaching 47 with no round 30; the arrows step
29 → 39 and 6 → 8, because they step by **position**, never `round + 1`.

### The opening round cannot be driven by `finished`

`events[].finished` is `bool_and(f.finished)` — true only when *every* fixture in
the round is done — so "the last finished round" **skips a partly played round**,
opening on last week all Saturday afternoon, every week from GW1. Nothing in the
database can catch it: the ten CSV seasons are wholly complete (380/380 settled)
and 2026-27 wholly empty (0/380).

The rule reads the **deadline against the clock**, and computes that itself
rather than borrowing `is_current`. Checked rather than assumed: `is_current` is
not ingested — `listEvents` derives it in SQL as `deadline_time <= now()`, so
rule 6 holds — but it is evaluated *when the bootstrap was served*, making it a
snapshot that goes stale in a tab left open across a deadline.

**Branch 2's condition is "every deadline is null", not "there are no events".**
`listEvents` derives its rows from `fixtures.gw` and only LEFT JOINs `events`, so
each CSV season arrives with a full 38-element array of null deadlines. Written
as `length === 0` the branch never fires and all ten historical seasons open on
GW1/Difficulty. (`bootstrap.ts:18` says those seasons "have no `events` rows at
all" — true of the *table*, and exactly the sentence that leads there.)

| Mutation | Result |
| --- | --- |
| Rule reverted to the finished-round form | **only** the hand-built partly-played test red, 8 pass |
| Branch 2 written as `length === 0` | both completed-season tests red |

`now` is a parameter, so the rule is pure and its tests pin a moment rather than
relying on fixed deadlines staying in the past.

### The tabs, and the race the round state introduced

Two views of **one** round. A per-tab cursor means switching tab silently changes
the week; a shared cursor makes the alternative the same thing plus dead state.
Retrospective difficulty on a played round is a feature — FDR against the actual
result is only comparable when both views sit on the same round. The old wording
went with it, which **resolves the deferred "GW38 Upcoming" Known Issue** as a
consequence rather than by a copy edit.

Moving the round into state introduced a stale pair the previous derivation could
not have: the season changes first, leaving one render with the new season and
the old round. The existing round-collision fix addresses the *opposite* failure
and neither catches nor prevents it. Both measures were taken — the re-seed
happens **during render**, and the fetch is guarded on the round existing in this
season — because the guard alone still double-fetches when the old round exists
in both seasons. Pinned by a test that 47 is never requested for a 38-round
season.

The round re-seeds on a season change; the chosen **view** does not, since which
view is a choice about the page rather than a fact about the season.

### Empty states

`noMatchesRecorded` moved to `lib/emptyStates.ts` — a neutral third module, so a
fixtures page does not import from a player-columns one and `playerColumns.ts`
does not import from a fixtures one. The string is unchanged, so the four suites
pinning it stay green; that is the point of extracting rather than copying.

The gate is **per fixture**, not the round's `bool_and` flag, so a partly played
round still shows its results. `roundNotPlayed` is the one piece of new copy,
unavoidable because the season sentence is *false* for a future round of a season
already under way — reachable the moment GW1 of 2026-27 is ingested.

Live on 2026-27: opens on GW1/Difficulty, and Results reads
`No matches recorded for 2026-27 yet.` where ten rows of `– – –` used to be.

### The FDR restack

The root cause is worth naming: the difficulty row was *structurally identical*
to the results row one tab away — `flex-1` | centre | `flex-1`, with the centre
between two adjacent numbers — so `BOU 1 vs 3 LEI` parsed as a 1-3 defeat. It is
a scoreline layout with difficulty numbers in the score slots.

Each club now sits over its own bar with the kickoff time between them, a time
nothing on the page showed before (`formatDay` takes the date and drops it). Both
formatters use the browser's locale and zone with no `timeZone` option, so they
cannot disagree about the day; checked on a 19:00Z kickoff rendering **10:00 PM**
under its own Saturday heading in UTC+3.

The colour map is hoisted to one module-local `FDR` array of complete Tailwind
strings, read by both the bar and the legend.

### Browser measurements

Double gameweeks are worse than the brief assumed — measured across all eleven
seasons rather than taken from 2025-26:

| Season | Max fixtures in one round | Rounds ≠ 10 |
| --- | ---: | ---: |
| 2020-21 | **17** | 81 |
| 2021-22 | 16 | 125 |
| 2022-23 | 16 | 109 |
| 2025-26 | 13 | 35 |
| 2026-27 | 10 | 0 |

2025-26 GW33 renders 13 fixtures with exactly the six clubs the database says
appear twice (BHA, BOU, BUR, CHE, LEE, MCI), spread across five day headings.

**Row width was measured, not chosen.** Left to fill the card, a bar rendered
**956px** wide on a 2327px viewport with its rating **478px** from its own club —
stacking that has stopped meaning anything. Capped at `max-w-3xl`, the bar is
**344px** and the distance **172px**. Applied to the results row too, since the
two tabs are two views of one round and letting them disagree about geometry
would make them look unrelated.

At a **390px** phone width the row shrinks to 280px with **zero** horizontal
overflow, and the type holds at 10px (rating), 14px (club), 11px (time). Item
16's SVG-scaling failure cannot apply to plain HTML — checked rather than
assumed.

---

## Follow-up

`docs/roadmap.md` gained one entry: the other ~19 Players columns keep short
`title` tooltips, so the page is uneven until someone fills them, and **nothing
will complain** — `description` is optional, so no type error, no failing test,
no red check. A defect confined to one file, hence roadmap rather than Known
Issues.

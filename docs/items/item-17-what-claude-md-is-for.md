# Item 17 — What `CLAUDE.md` is for

A criterion, not a fourth record move.

## Why this needed its own item

`CLAUDE.md` reached its ceiling for the **third consecutive item**: 117,987 of
120,000, with 2,013 to spare against a session that still had to write a record
and whatever the browser pass produced. Trimming afterwards means writing into a
budget that has already failed.

Item 13 split every record into a sibling `CLAUDE-history.md`. Item 15 dissolved
that into one file per item, moved the test catalogue to `docs/testing.md`, and
made the budget a failing test. Both halved the growth once without changing the
slope, and **item 15 had already found out why**: the sections that stay absorb
roughly 4k an item regardless of where records go. Step 3 of item 16 measured
it — 4,077 characters added by a step whose entire record went to `docs/items/`.

So a third move would have bought one item of headroom. The question was not
where the records live. It was what the file is **for**.

## The criterion

The file is read **in full, before the task is known**. That is the only property
separating it from every other document in the repo, and it gives the test:

> **A section earns its place if a session that has not yet been told its task
> would write wrong code without it.**

Not "is it useful" — nearly all of it was. The test is whether it is useful
*unconditionally*, because unconditional is what a full pre-task read buys and is
the only thing it buys. Anything a session can look up once it knows what it is
doing was being paid for at the wrong time, by every session.

Two corollaries did the actual work:

- **Re-derivable ⇒ out.** A row count, a timing, a response shape is answered by
  one query or by opening the file that defines it — and it can drift silently in
  a way the code cannot.
- **Local ⇒ out.** If the only session that needs a fact is one already editing
  the file it concerns, that session is one grep away and the other twenty paid
  for it.

### The observation that made a third record move pointless

**The pointer tax applies to records, not to descriptions.**

A record has to be *findable by name*, so moving one leaves a stub behind worth
roughly half what it removed — which is precisely why item 15's move bought less
than it looked like it would. A description of code needs no pointer at all. It
needs re-deriving, and re-deriving is free when the subject is the codebase or
the database.

That is the difference between what item 15 did and what this item did, and it is
why the same file could be cut by 17% twice for different reasons.

## Verdict by kind

| Kind | Before | Verdict |
| --- | --- | --- |
| Rules — data layer, API identity, working agreement | 34,598 | **Stay, all of it.** Prohibitions. You need them to know you are about to violate one, and you cannot look up a rule you do not know applies. This is the whole justification for a full read. |
| Known Issues | 20,939 | Split by locality — **held back**, see below |
| Current State | 18,811 | Split by kind |
| Item stubs (Phase 1) | 9,733 | Becomes an actual index |
| Getting-started material | 28,802 | Mostly out; the traps buried in it are rules and were promoted |

## The three moves taken

**117,987 → 98,258.**

### 1. Sixteen stubs become a one-line index — ~7,500

The Working Agreement already says *"a stub is not the record"* and *"read the
item file before planning around what an item decided."* So a stub's only honest
job is triage — deciding whether to open the file — and one clause does triage as
well as six lines. The full stubs moved to `docs/items/README.md`.

**This was the section with unbounded growth**: one entry per item, forever,
inside a hard ceiling. Everything else grows with the project; this grew with the
calendar.

### 2. `What's Built` deleted — 5,253

Thirty lines of "we did this", answered by the code. Item 16 step 3 nominated it
and declined on the grounds that *"deleting a section outright is a shape change
deserving its own decision."* This item was that decision. Nothing was identified
that a session loses.

### 3. Current State, 18,795 → ~4,400

Read closely it was **three different things under one heading**:

- **Invariants stated as state** (~9,000) — *"the band is the selected season's
  cohort and never a pooled one"*, *"`getPlayerHistory` LEFT JOINs, and the
  choice is about the failure mode"*, *"goalkeepers score no hits"*. These are
  **rules that were never filed as rules**. They stayed in the file and moved
  into the rules sections, where they would have gone had anyone noticed.
- **Facts** (~3,400) — the row-count table, "564 players, 20 clubs", the 23–121ms
  bootstrap timings. One query each.
- **A tour of the API surface** (~5,300) — nine paragraphs restating
  `types/api.ts` and `routes/fpl.ts` in a place they can drift from.

The promotion is the part that matters, and it is why the section will not
refill: a heading whose job can be named can be defended against the next
paragraph.

## What was held back, and the second reason

**Splitting Known Issues by locality, worth ~5,780.** Roughly a third of the
entries — the back-link label, the two "Selected" elements, DCH's two
denominators, the averages footnote, the Fixtures "Upcoming" tab, the dead
`PlayerSearch.tsx`, the missing `birth_date`, the theme mismatch — are confined
to the file they concern. The rest can bite a session that never opens that file,
and the 2022-23 `starts` sort hazard is the type case: it fires on a per-90
toggle three files away.

Two reasons for holding it:

1. Known Issues is the section whose density is why this project does not ship
   silently-wrong data, and the other three moves cleared enough headroom that it
   did not have to be touched under pressure.
2. **The entries it would have moved were exactly the surfaces the same session's
   browser pass was about to touch.** You do not relocate something you are about
   to edit — the general form of the `git checkout --` lesson from item 14, and it
   is written into the Working Agreement as such.

## Rules added

Three, and the third is the point of writing this down now.

- **Current State holds invariants, not descriptions.** A paragraph belongs there
  only if code could contradict it. A row count, a timing or a response shape is
  re-derivable and belongs in the item file that measured it.
- **A Known Issues entry must be non-local** — it must be able to bite a session
  that never opens the file it concerns. A defect confined to one file is roadmap
  work.
- **The levers are finite, and this is the order they run out in.** The file is
  ~98k, of which ~40k is rules that cannot leave under the criterion above. Next
  is Known Issues by locality, worth about 5,800. **After that there is nothing
  left but splitting the rules themselves** — which means a session would stop
  reading all the prohibitions before it starts, and that is a different kind of
  file.

The last of those was written while it is still a choice rather than discovered
at 119,000. That is the same instinct as making the budget a failing test in item
15: the point is to be told by something other than a session that has already
spent its context.

## The promoted invariants arrived as rules, and that was checked

They land in the one part of the file that can never be trimmed under its own
criterion, so **anything that went in prose-shaped would stay prose-shaped
forever**.

The instrument already existed: `docs:size` prints the largest rule in each
numbered list. If a promoted invariant had become the new largest, it had been
pasted rather than rewritten.

| | Largest | 2nd | Median | New rules |
| --- | --- | --- | --- | --- |
| Data Layer, before | 4,083 (#6) | 2,369 (#14) | 444 | — |
| Data Layer, after | 4,164 (#6) | 2,369 (#14) | 444 | #19=559, #20=424, #21=593, #22=296 |
| API Identity, before | 3,663 (#7) | 2,397 (#5) | 749 | — |
| API Identity, after | 3,663 (#7) | 2,397 (#5) | 749 | #9=749 |

Nothing promoted became the largest anything, and every new rule sits between the
median and the second-largest. Rule 6 grew by 81 characters — one clause folding
in the DC composition (MID/FWD are CBIRT, the column is an action count and not
points), which was the only part of the goalkeeper paragraph rule 6 did not
already say. The rest of that paragraph was a duplicate and went.

New Data Layer rules: **a null has no position on a scale** (rule 6 in geometry);
**no SQL outside `repositories/`**; **LEFT JOIN `player_seasons`, because only
half the invariant is enforced**; **the ingest preconditions stay exact**. New API
identity rule 9: **a scoring rule the app computes for itself lives on the server
and is stated once.**

## What this item did not do

No code changed. No test changed. `npm test` is 142 server / 244 client before
and after, which is the check that a documentation item has stayed one.

# Roadmap

The deferred work list. Moved out of `CLAUDE.md` in item 15: it is a list of what
might be built next, not something that stops wrong code being written tomorrow.

**One entry did not move in full.** "Cross-check the gameweek sync against
`event/{gw}/live`" can only be done while a round is actually in play, so a short
block naming it stays in `CLAUDE.md`, which is the file that gets read; the full
entry is below. It used to be dated — the window was GW1 of 2026-27, locking
21 August 2026 — and is no longer, because the sync half is done and the
remaining half has a window every round rather than once a season.

The `finished` / `finished_provisional` observation lives in `CLAUDE.md`'s schema
notes and stays there. It is no longer an open question: GW2 supplied one round
of evidence that `finished_provisional` leads and `finished` waits for round
processing (item 25).

---

The gate used to be "not until Phase 0 is complete". Phase 0 is complete, and
Phase 1 has started, so that sentence would now read as permission to start all
of this, which is the opposite of the intent.

What gates the list now: **each item is picked deliberately, as the subject of a
session, and never drifted into as a side effect of another task.** Nothing here
is a prerequisite for anything already built, so touching one while working on
something else is scope creep rather than progress. Two of them have a real
ordering constraint, marked below.

Also still open, from Known Issues rather than from this list: the **live field
sync**, which is what fills the five null fields and makes `form` and ownership
real again. Not to be confused with `ingest:live`, which item 4 built: that
loads a season's structure — roster, clubs, deadlines, fixtures — and runs to
completion in about a second. The field sync stores values that are different
every hour, and needs somewhere to put them and a policy for how often.

- **Cross-check the gameweek sync against `event/{gw}/live`.**
  **Half of this entry is discharged.** The sync has been run: by hand for GW1
  and GW2 on 3 September 2026, and daily on cron since (item 25). What is left is
  the check, which could not be written before a round existed and now can.

  **What the cross-check compares:** element-summary's per-fixture rows, summed
  per player per round, against `event/{gw}/live`'s per-round `stats`. **What it
  catches, which is the reason to build it:** if those disagree, one of the two
  endpoints is aggregating a double gameweek — and our per-fixture rows are
  wrong in exactly the rounds rule 13 exists for. Without that sentence the next
  reader sees a redundant assertion and deletes it.

  **And the reason to do it while a round is fresh rather than eventually:**
  element-summary is **one request per player** (564 a run) and `event/live` is
  **one request per round**. If the shapes agree, the cheap endpoint becomes
  viable for routine syncing with the expensive one kept for verification. That
  is a real saving, and it is only measurable while a round's data is fresh.

  The first run flipped `SEASONS_WITH_GAMEWEEKS` to eleven and turned
  `career.test.ts` red, which was the intended announcement. That fallout is open
  and separate: the database-backed suites written when 2026-27 held no match
  rows now rest on a false premise.

  **Watch the run output for a hole.** Item 7 made the sync apply the same
  NULL-for-a-hole rule the CSV ingest does, and print a loud block when it
  fires. On the live path it means FPL served a _settled_ round with a column
  unpublished, which is an outage rather than a scraper gap — so **re-run the
  sync** once FPL has published and the upsert overwrites the NULL. Nothing in
  the database distinguishes a transient hole from a permanent one, so that
  block is the only trace that a re-run is worth doing.

  **Done in item 25.** `scripts/refresh-prod.sh` greps the run for the block and
  raises `logs/last-hole`, a sticky marker that survives until somebody acts on
  it — because a hole exits 0 and nobody reads the output of a cron job. The
  matched string is exported as `HOLE_SENTINEL` and pinned by a test, so a
  reworded block cannot silently stop being detected.

- **A season total that says a round is missing, rather than blanking or
  lying.** The instrument item 7 wanted and did not have. `measuredSum` has two
  settings — a number, or the no-value marker — so a column measured for 37 of
  38 rounds has to pick between overstating completeness and destroying the
  figure entirely. For the five columns item 7 fixed that trade was easy: they
  are short by fourteen rounds and ~38%, so the marker is right. For the ICT
  quartet it is wrong, which is why those 26 fixtures still store 0 (see Known
  Issues): blanking 1,515 player-season totals to flag a ~3-7% gap costs more
  than it repairs.

  **What it needs is a third state**: the total, kept and rendered, carrying a
  visible mark that N of its rounds were never measured — with the count
  reachable on hover or in the cell's title. That is a wire-shape change (the
  denominator has to travel with the number) and a UI affordance, not an
  aggregate rule, which is why it is not a variation on item 7 and does not
  belong in an ingest session.

  Once it exists, the ICT quartet can be represented honestly without the
  migration that dropping `NOT NULL` on four columns would require, and the
  `starts` case gets better too: "24, and 14 rounds unmeasured" beats both "24"
  and "—". **Blocks nothing; blocked on nothing.**

- **The pre-season player list: this season's price and ownership beside the
  last completed season's totals, each labelled which it is.** Deliberately not
  FPL's approach of showing carryover totals under a "this season" heading. Left
  out of item 4 because it is two features rather than an ingest: ownership is a
  live-snapshot field with nowhere to be stored (see the live field sync above),
  and the totals need a second season's aggregate on the bootstrap query. Until
  it lands the list shows the new roster with zeros, which is recorded in Known
  Issues rather than left to look like a bug.
- **Fill `description` on the other Players columns.** Item 18 added a long-form
  definition to `PlayerColumn` and wrote it for the **eleven comparison axes
  only** — those are the shorthands with no picker and no header row beside them,
  so a radar spoke reading `DCH/St` is all the reader gets. The remaining ~19
  columns fall back to `title`, so the Players list is **uneven**: hover eleven
  headers and get a sentence, hover the rest and get a noun phrase.

  **Nothing will complain**, which is why this is written down rather than left
  to be noticed. The field is optional, so there is no type error, no failing
  test and no red check — `comparison.axes.test.ts` enforces the eleven and is
  silent about everything else. The uneven state is invisible to every
  instrument in the project.

  A defect confined to one file, so it is roadmap work rather than a Known
  Issue. Blocks nothing; blocked on nothing.

- **Data view improvements:** fixture difficulty colouring, totals row, per-90 toggle,
  rolling form, multi-player comparison, styling polish.
- **Expected points prediction:** transparent weighted formula, not black-box ML,
  because explainability matters for FPL managers. Requires a backtest harness fitted
  on earlier seasons and evaluated on a held-out one, benchmarked against a trailing
  five-gameweek average and against FPL's own `ep_next`. The historical data it
  needs now exists. **Blocked on nothing; blocks the captaincy model.**
- **A real captaincy model.** The Dashboard ranks by points per match with an
  appearance floor, which is honest but is not a captain pick. A real one needs
  fixture difficulty, minutes risk, form and ownership. **Blocked on the
  expected points work above** — without it there is no per-fixture projection
  to captain on, and the live sync, for form and ownership.
- **LLM scouting reports.**
- **Deploy on karpuz-prod** alongside TechRelative (Docker Compose, Nginx),
  README with screenshots. ~~responsive design~~ — **done in item 22**, in the
  containment sense rather than the redesign sense: every surface reachable and
  operable at 380px, degrading into horizontal scroll where the columns genuinely
  need the width. The three entries above are what item 22 deliberately left.
- ~~A season selector in the UI.~~ **Done — Phase 1 item 8.** It carried the
  `detailPlayer` snapshot fix with it, as this entry said it would.
- **The comparison radar at narrow widths is a scrolling window onto a shape,
  and that is a known limitation rather than a defect.** After item 22 the radar
  sits in a 302px pane holding its fixed 580px SVG — a 1.92× scroll, the same
  ratio a wide table degrades to. **It is not the same quality of scroll.** A
  table is read column by column, so a window over it loses nothing; a radar is
  read as a **single shape**, and seeing half of it at a time degrades the one
  thing the chart exists to do — compare outlines at a glance.

  **Do not reach for the viewBox.** Every fix that makes the whole shape fit at
  380 scales the SVG, and the captions scale with it: that is item 16's hazard,
  where 11px text rendered at **7.3px**, and the fixed 580×500 in an
  `overflow-x: auto` wrapper is the fix for it. Item 22 confirmed it still holds
  (`shrunk: 0` at every width). A real answer needs the captions decoupled from
  the geometry — fixed-size text positioned against a scaled chart — which is a
  chart change and was explicitly out of item 22's scope.

  Recorded so a future reader does not discover the scroll, assume nobody
  noticed, and re-introduce the caption bug fixing it.

- **Touch targets that are small but not destructive.** Item 22 sized up only the
  controls where a mis-tap costs something irreversible — the comparison position
  pills and the trace remove, both of which destroy a built-up selection. Left
  under 44px, deliberately: the Players position pills and the Fixtures tab pills
  (~26px, a mis-tap re-filters or switches a view and is undone by tapping
  again), the sortable column headers (40px tall, full column width), and the
  player-name disclosure buttons (~20px tall, but the whole 62px row is also a
  click target). All are usable; none is ideal. A pass that raises the lot is
  worth doing as its own item, with the pill groups' geometry decided once rather
  than per page.

- **The player detail page spends about half its pane on pinned columns at
  380px.** Two nested levels of pinning: the career table's Season column
  (172.88px) on summary rows, and the nested gameweek table's GW + Opp (115.14px)
  on match rows. Against a 337px pane that leaves **164.12px readable (48.7%)**
  on the worst row and 221.86px (65.8%) on the others, with 1,895px of content
  behind a 5.62× scroll.

  **Ugly, not unreachable** — every column is reachable by scrolling, which is
  why item 22 recorded it instead of fixing it. **The shell change cannot help
  it**: the career card is its own scroll context at every width (measured), so
  it is independent of the breakpoint entirely. Options if it is ever taken up:
  unpin GW/Opp on the nested table below `lg`, narrow or unpin the Season column,
  or accept it. Note that unpinning is not free — item 10 added the pins because
  scrolling right lost your place, and at 380 that argument is stronger, not
  weaker.

- ~~A per-90 toggle on the averages row.~~ **Still open**, and item 12 did not
  touch it — but note that `Normalization` in `lib/averages.ts` is still the
  seam, and the footnote now has a model (`buildFootnote`) that would need a
  third form of words for it. Whichever item lands it owns saying what "per 90"
  divides by in the sentence, since "appearances" stops being the denominator.

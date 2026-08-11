# Roadmap

The deferred work list. Moved out of `CLAUDE.md` in item 15: it is a list of what
might be built next, not something that stops wrong code being written tomorrow.

**One entry did not move in full.** "Run the gameweek sync, and cross-check it
against `event/{gw}/live`" can only be done while a round is actually in play,
and Gameweek 1 of 2026-27 locks 21 August 2026. A dated block naming that window
stays in `CLAUDE.md`, which is the file that gets read; the full entry is below.
The same applies to the `finished` / `finished_provisional` observation, which
lives in `CLAUDE.md`'s schema notes and stays there.

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

- **Run the gameweek sync, and cross-check it against `event/{gw}/live`.**
  The script exists (item 5); what is left is running it once a round has been
  played, and building the check that could not be written before then.

  **What the cross-check compares:** element-summary's per-fixture rows, summed
  per player per round, against `event/{gw}/live`'s per-round `stats`. **What it
  catches, which is the reason to build it:** if those disagree, one of the two
  endpoints is aggregating a double gameweek — and our per-fixture rows are
  wrong in exactly the rounds rule 13 exists for. Without that sentence the next
  reader sees a redundant assertion and deletes it.

  **And the reason to do it on 22 August rather than eventually:**
  element-summary is **one request per player** (564 a run) and `event/live` is
  **one request per round**. If the shapes agree, the cheap endpoint becomes
  viable for routine syncing with the expensive one kept for verification. That
  is a real saving, and it is only measurable while a round's data is fresh.

  First run also flips `SEASONS_WITH_GAMEWEEKS` to eleven and turns
  `career.test.ts` red, which is the intended announcement.

  **Watch the run output for a hole.** Item 7 made the sync apply the same
  NULL-for-a-hole rule the CSV ingest does, and print a loud block when it
  fires. On the live path it means FPL served a _settled_ round with a column
  unpublished, which is an outage rather than a scraper gap — so **re-run the
  sync** once FPL has published and the upsert overwrites the NULL. Nothing in
  the database distinguishes a transient hole from a permanent one, so that
  block is the only trace that a re-run is worth doing.

  **When scheduling lands, that block has to become a signal rather than a log
  line.** Nobody reads the output of a cron job, and a hole that self-heals only
  if somebody notices does not self-heal. Belongs with the scheduling work, not
  before it.

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
- **Deploy on karpuz-prod** alongside TechRelative (Docker Compose, Nginx), responsive
  design, README with screenshots.
- ~~A season selector in the UI.~~ **Done — Phase 1 item 8.** It carried the
  `detailPlayer` snapshot fix with it, as this entry said it would.
- ~~A per-90 toggle on the averages row.~~ **Still open**, and item 12 did not
  touch it — but note that `Normalization` in `lib/averages.ts` is still the
  seam, and the footnote now has a model (`buildFootnote`) that would need a
  third form of words for it. Whichever item lands it owns saying what "per 90"
  divides by in the sentence, since "appearances" stops being the denominator.

# Item 11 — Averages divide by appearances, not fixtures

Commit `5fad1b8`. Phase 1 item record.

**Reconstructed from the commit message in item 15, not written at the time.**
Items 10 and 11 ended their sessions without writing a record — the working
agreement's "end each session by writing the item's record" is exactly what
they were missing, and the client test count drifted from 82 to 134 unnoticed
across the two of them as a result. Their commit messages were detailed enough
to stand as the record, so the body below is that message verbatim. It is the
only account either item has; it was never a `CLAUDE-history.md` entry.

---

Item 11: averages divide by appearances, not fixtures

The averages row divided by every fixture row shown, whether or not the
player was on the pitch, while the career row six inches above it
divided by appearances. Tarkowski's 2025-26 read AVG Pts 4.5 (170/38)
under a career row saying PPG 4.6 (170/37), with nothing on screen
saying they were different quantities. points_per_game has divided by
appearances since Phase 0, so this makes the gameweek table agree with
the convention the career table already documents.

New: client/src/lib/averages.ts, a pure module holding the normalization
strategies, the per-column denominators, roundHalfEven and fmtPpg. No
React import, both because the verification script imports it and
because it keeps StatsTable.tsx a module whose exports are all
components.

The numerator and denominator filters are NOT symmetric, and the wide
verification run is what established that. The null filter picks the
numerator; the played filter picks only the denominator. Filtering the
numerator by minutes > 0 as well looks obviously right and disagreed
with the career row on 7 player-seasons. Nineteen rows across the ten
seasons carry a value with zero minutes, and they are two disjoint
populations, overlap exactly 0:

  14 bookings taken without coming on. 13 yellows at -1 point and -3
  BPS, one red (Matheus N., 2022-23 round 28) at -3 and -9. FPL counts
  these in the season total, so total points over appearances includes
  them. This accounts for the card and points columns and 14 of the 15
  BPS rows.

  5 rows carrying attacking or defensive values with no card at all,
  which a booking cannot explain: a card's BPS is negative and generates
  no threat. De Bruyne 2016-17 r32, Philip 2017-18 r37, Kerkez and
  Kluivert 2023-24 r28 (same club, same round, a double gameweek), and
  Ferguson 2024-25 r24, which carries threat 2.0 and the only positive
  BPS in the set. Cause unestablished and deliberately not chased: the
  arithmetic reproduces FPL at 400 of 400 either way, so whatever the
  source's story is, we tell the same one.

Nine of the 26 averaged columns can be non-zero on such a row, so this
changed nine averages rather than one. total_points is simply the only
one printed beside a second number that could expose a disagreement,
which is why the PPG cross-check caught it and nothing else would have.
An earlier draft of rule 5 claimed total_points was the only affected
column; that was wrong and self-refuting, since the rows were found by
their yellow card.

The footnote states what the averages rest on, in one sentence with one
substitution:

  Averages over 37 appearances in 38 fixtures      (denominators agree)
  Averages over 12-16 appearances in 38 fixtures   (2022-23, and only there)

Per-column denominators diverge in 2022-23 and no other season, because
item 7 NULLed the expected family before round 16 and xGI additionally
at round 29, so one player-season can carry three. A range says that in
one line; naming the groups would be a three-clause footnote on the
majority of that season. Only columns that render a number contribute a
denominator, which leaves the set empty exactly when nothing rendered.
Math.min() of an empty array is Infinity, so the caller owns that case
and AveragesNote stays free of it.

Three caller cases: no rows shown renders no footnote at all, and
GameweekSection's "None of X's N matches match the selected filters."
says the useful thing instead; rows shown with no appearances renders
"Averages over 0 appearances in N fixtures" with every average showing
the placeholder; otherwise the range, collapsing when min equals max.

A player who never appeared now shows the placeholder across the row
rather than 0.0. That is the largest visible change here, on 119 to 304
player-seasons per season. No appearances means no per-appearance
average, and it agrees with the "played none of them" line already on
screen, which currently sits above a row of zeroes contradicting it.

points_per_game now crosses the wire unrounded and is rounded once, on
the client, by the same formatter that renders the averages row beneath
it. It used to end in to_char(round((x * 10)::float8), 'FM9990.0'),
which made it the only value in the API arriving pre-formatted, against
rule 8, and put the same rounding rule in two languages free to
disagree. They did, on 111 player-seasons. The convention is unchanged
and still matters: FPL computes in Python and rounds half to even, while
Postgres numeric rounds half away from zero. toFixed is not an
implementation of either one, it is whatever the binary representation
gives, so it must never be used for this.

Sorting changed, and this is a fix in its own right rather than a side
effect. ppm on the Players list and the Dashboard's bestPerMatch sorted
on a value pre-rounded to one decimal, which left only 54 to 62 distinct
values for 624 to 865 players, with the largest tie group running 119 to
305 players ordered by FPL element code. So 4,206 of 7,338 player-seasons
change position, moving out of an arbitrary order into a meaningful one.
Sixteen players enter the rendered top 200 across all ten seasons, and
the Dashboard's top-3 membership is unchanged in every season.

The averages take which normalization to use as a parameter rather than
hardcoding per-appearance, because the deferred per-90 toggle is the same
mechanism with a third option. The parameter selects a strategy yielding
a denominator per column rather than a count, since per-90 divides by
sum(minutes)/90 and a seam passing only an integer would forbid it. This
ships one strategy and no toggle.

Verification. verify:ppg runs two checks and reports them separately
because only one is independent. Self-consistency across all ten seasons:
7,338 of 7,338, including all 226 player-seasons that land on an exact
rounding tie. Against FPL's own points_per_game from the pre-season
bootstrap carryover, 2025-26, 400 players: 399 exact, 0 differing by
tie-rounding, 1 real mismatch, which is code 448089 disagreeing on totals
rather than on the denominator, and where FPL's own history_past backs
ours. Compared under half to even at one decimal, stated in the output.

The script imports the shipped averages module rather than reimplementing
it, since a check that reimplements what it checks proves nothing. It
lives in server/src/verify/ and is excluded from the server's tsc program:
tsx runs the cross-package import fine but tsc raises TS6059 on rootDir,
relaxing rootDir would re-root the emit and break npm start, and moving
the script to the client package needs pg, which lives only in the
server's node_modules. Cost, stated because it is real: that one file is
not typechecked.

134 client and 77 server tests, tsc clean both packages, nine mutations
measured red, HMR clean on all six changed modules. Browser pass across
six observations including the divergent 2022-23 footnote with three
denominators in one row, the zero-appearance case reached via the GW
filter, and the reordered PPM group.

CLAUDE.md rule 5 amended: the numerator asymmetry and its two
populations, the rounding move, the toFixed warning, and the sorting
consequence.


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The points-per-game measurements, as API identity rule 5 recorded them

_Was `CLAUDE.md` lines 987-1031._

   **Nine of the 26 averaged columns can be non-zero on a row with no minutes.** An
   earlier draft of this entry said `total_points` was the only one; that was wrong
   and self-contradicting, since the rows were found *by* their yellow card. Measured
   over all ten seasons — **19 rows, 18 player-seasons, nine seasons (not 2018-19)**:

   | Column | Rows | Range | Column | Rows | Range |
   | --- | --- | --- | --- | --- | --- |
   | `bps` | 15 | −9 … 4 | `influence` | 2 | 1.0 … 2.0 |
   | `total_points` | 14 | −3 … −1 | `creativity` | 2 | 0.4 … 1.1 |
   | `yellow_cards` | 13 | 1 | `expected_goals_conceded` | 2 | 0.37 |
   | `ict_index` | 3 | 0.1 … 0.4 | `red_cards` | 1 | 1 |
   | | | | `threat` | 1 | 2.0 |

   The other seventeen are 0 on every such row: goals, assists, clean sheets, goals
   conceded, own goals, both penalty columns, saves, bonus, the expected family bar
   xGC, and the defensive quartet.

   **Those 19 rows are two disjoint populations, and only one of them has an
   established cause.** No row carries both a card and an ICT-family or xGC value —
   checked, the overlap is exactly 0.

   - **14 rows are bookings**, and these are fully accounted for: 13 yellows at
     −1 point / −3 BPS, and one red (Matheus N., 2022-23 round 28) at −3 / −9. The
     ICT family and xGC are 0 on every one. This explains `total_points`,
     `yellow_cards`, `red_cards`, and 14 of the 15 `bps` rows.
   - **5 rows carry attacking or defensive values with no card at all**, which a
     booking does not account for — a BPS penalty is negative, and a card generates
     no threat: De Bruyne 2016-17 r32 (creativity 1.1), Philip 2017-18 r37
     (influence 1.0), Kerkez and Kluivert 2023-24 r28 (xGC 0.37 each — same club,
     same round, a double gameweek), and Ferguson 2024-25 r24 (threat 2.0,
     influence 2.0, creativity 0.4, and the one **positive** BPS, +4).

   **The cause of that second group is not established and was not chased.** A
   minutes figure wrong at source is the obvious guess — threat implies a shot, xGC
   implies time on the pitch — but it is a guess and is recorded as one. It does not
   need settling: the arithmetic reproduces FPL at **400 of 400** either way, so
   whatever the source's story is, we tell the same one.

   **This changed the averages of all nine columns, not just Pts** — each numerator
   now includes rows its denominator does not count. That is correct for the same
   reason the points treatment is: it is what FPL's own totals do. `total_points` is
   simply the only one printed beside a second number that could expose a
   disagreement, which is why the PPG cross-check caught it and nothing else would
   have. Of the 13 player-seasons with a bench row carrying points, **7 differ once
   rounded to one decimal**; the rest are absorbed by the rounding.

### The sort-order consequence

_Was `CLAUDE.md` lines 1047-1053._

   **A consequence worth expecting: sorting changed.** `ppm` on the Players list
   and the Dashboard's `bestPerMatch` sort on the real quotient now rather than on
   a value pre-rounded to one decimal. One decimal left only 54-62 distinct values
   for 624-865 players, with the largest tie group running 119-305 players ordered
   by FPL element code — so 4,206 of 7,338 player-seasons change position, moving
   out of an arbitrary order into a meaningful one. The Dashboard's top-3
   membership is unchanged in all ten seasons.

# Item 8 — A season selector

Commit `b34876b`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **8. A season selector.** All eleven seasons on every page. The API has
      accepted `?season=` since Phase 0 and nothing sent it except the detail
      page; now `App.tsx` owns the choice, and the ten completed seasons stopped
      being unreachable.

      **The selected season is `bootstrap.season`, not a fourth piece of state.**
      `App.tsx` holds `requested`, which is only ever *the season of a request in
      flight*; what the app is showing is whatever the server actually served.
      A second "current season" variable could disagree with the payload beside
      it, which is the class of bug API identity rule 7 exists to prevent. The
      selector's `value` is `requested ?? bootstrap.season`, so a pick shows
      immediately and then reconciles.

      **The app is never blanked mid-switch.** `if (!bootstrap) return
      <Loading/>` now fires on the first load only; a season change keeps the
      previous bootstrap mounted and swaps atomically, so during the transition
      every page shows the old season's data under the old season's label —
      internally consistent, which is the property that matters. `<main>` takes
      `aria-busy` and dims. The selector is **not** disabled while switching:
      disabling a focused control moves focus to `<body>`, the class of
      regression item 3 existed to remove.

      **The seasons list rides on the bootstrap, and the chicken-and-egg in that
      is the item's sharpest corner.** The list of valid seasons arrives *on* the
      bootstrap response, so a persisted season can only be validated by asking
      for it — and an invalid one 400s before any list comes back. Both halves
      of the fix are needed: `api.ts` now parses the failure into an `ApiError`
      carrying `status` and `available`, which is what distinguishes "unknown
      season" from "the network is down"; and on a 400 the client drops the
      stored value and **retries with no parameter**, letting `resolveSeason`
      pick the default. It does not read `available[0]` and call that the
      default — that would put a second copy of `latestSeason()`'s rule in the
      client, free to drift. Not hypothetical: it is what a fresh clone or a
      rebuilt container does. Verified in the browser with a stored `'2099-00'`.

      **What resets on a season change, and what deliberately does not.** The
      open player (a *code* now, so it re-resolves), the page and the theme
      survive. The Fixtures page clears its rows; the Players list closes its
      open row (a permanent code, but the player may have no row in the new
      season); `PlayerDetail` resets the round range. The Players list's search,
      position filter and sort are **kept** — every one is a choice over columns
      that exist in all eleven seasons, and resetting them would discard the
      user's intent for nothing.

      **`PlayerDetail`'s one effect became two, and that is what makes the rest
      work.** The career keys on the player alone, because it is
      season-independent; the season's gameweeks key on both. `loading` belongs
      to the career effect only, so a season change no longer blanks a header and
      a career table that are still valid. Two consequences beyond the saved
      request: `registeredIn` answers correctly the instant the season swaps, and
      the identity survives the change — which is what names a player who has no
      player-season in the newly selected one.

      **Keeping the per-season cache across a season change opened a window that
      had to be closed in the same stroke.** The cache is keyed by season and the
      player has not changed, so everything in it is still true — but the newly
      selected season is simply *absent* from it, `history` is `[]`, and
      `registeredIn` is true because the career does contain that season. So
      `GameweekSection` was handed "no rows, registered" and printed **"Data will
      appear here once the 2025-26 season is underway"** about a season that
      finished in May. The loading-versus-empty version of the
      calendar-versus-data mistake this project keeps refusing to ship.

      `GameweekSection` cannot fix it: it receives a `history` array, and an
      empty one is indistinguishable from an absent one from there. So "This
      Season" gates on the cache entry existing and renders a loading line
      instead — the **same** line the career table's expanded rows have always
      drawn, hoisted into one `SeasonLoading` rather than invented twice.

      **`currentGameweek` and `nextGameweek` return null now, fixed rather than
      worked around.** Both ended in a fallback chain that answered "which round
      is coming" with the last played round, so every completed season rendered
      "GW38 / Deadline / TBD" in the sidebar — a round played in May announced as
      upcoming. True since Phase 0 and invisible because the app showed one
      season. Hiding the sidebar block would have left the function lying for the
      next caller. **`currentGameweek` was a named addition**: identical defect,
      and fixing one twin and leaving the other is what the next reader trips on.

      The gate everywhere is **"there is no next gameweek"**, never "the season is
      complete". They coincide today and stop coinciding on 21 August 2026, when
      2026-27 has a next gameweek and is not complete. The fallbacks the helpers
      lost reappear in `Fixtures.tsx` under names that say what they are, because
      *which round to show* is a display decision and *which round is next* is
      not.

      **A bug this item introduced, found in the browser and not by a test.**
      Making `resultsRound` strictly "the last finished round" left it undefined
      on a season where nothing has been played: the effect returned early, the
      *previous tab's* fixtures stayed mounted, and the heading read "Gameweek ?
      results" over them. Stale rows under a wrong label — worse than the empty
      round the strictness was avoiding, and a direct contradiction of the
      "behaviour is unchanged" claim in the plan. Fixed by restoring the last
      link of the old chain, and now pinned by a test.

      **Verification.** `npm test`: **77 server, 69 client**, both green. `tsc
      --noEmit` clean in both packages. Browser: 2025-26 ranks real players
      (Haaland 239) where 2026-27 shows three empty states; 2019-20's round
      filter offers 1-29 then 39-47 with the Covid gap absent; a range narrowed
      to 20-38 on 2024-25 resets to 1-38 on 2023-24, which is the case the old
      `[firstRound, lastRound]` deps could not see; Haaland in 2016-17 and De
      Bruyne in 2026-27 both render the not-in-the-game state with a
      name-and-photo header and a full career table below; the season survives a
      reload; a stored `'2099-00'` comes up working on the default.

      **Mutation-checked, measured. One came back green and was fixed rather
      than written up as covered:**

      | Mutation | Result |
      | --- | --- |
      | selector sets state but `fetchBootstrap` sends no season | **red**, 7 tests |
      | `detailPlayer` reverted to a captured `Player` | **red**, 2 tests |
      | Fixtures effect deps back to `[targetGw]` | **red**, 3 tests |
      | the 400 recovery removed | **red**, 1 test |
      | `nextGameweek`'s fallback chain restored | **red**, 1 test |
      | header renders its stat grid for an absent player | **red**, 1 test |
      | "This Season" rendered without the loading gate | **red**, 1 test |
      | the `events[0]` results fallback dropped again | **red**, 1 test |
      | localStorage written from `requested` | **green** → test rewritten → **red** |
      | `detailBySeason` reset on season change | **green, expected** |

      The last two are the interesting ones. **Persisting `requested` instead of
      the served season is unobservable against today's server**, which either
      honours the parameter or 400s — so the two expressions are equal on every
      real path. The test now uses a mock that resolves a *different* season, a
      stand-in for a server that normalises rather than rejects; the contract
      being pinned is the client's, and it is worth pinning precisely because
      nothing in today's data would reveal it broken.

      **Resetting the cache also closes the false-empty-state window**, so that
      mutation is expected green. It is the reason the test asserts the loading
      line is *present* rather than only that the wrong sentence is absent —
      otherwise it would pass against the wrong fix.


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The selector, as Current State recorded it

_Was `CLAUDE.md` lines 106-114._

**Item 8 gave the app a season selector, and with it the ten completed seasons.**
Every page is now reachable on any of the eleven: the selector is a `<select>`
in the sidebar, its state lives in `App.tsx`, and **the selected season is
`bootstrap.season`** — the one the server actually served — rather than a second
piece of state that could disagree with the payload on screen. The list of
seasons rides on the bootstrap response as `seasons: string[]`. Item 8 also
fixed the `detailPlayer` snapshot that had been in Known Issues since item 1,
made `currentGameweek`/`nextGameweek` return null instead of a plausible wrong
answer, and made the last of the four empty states reachable.

### The default-season argument after the selector

_Was `CLAUDE.md` lines 520-523._

**Item 8 removed the "no selector yet" half of that argument without changing
the conclusion.** The completed seasons are one click away now, so defaulting to
2026-27 no longer hides anything — it just decides what the app opens on, which
is still the season being played.

### The `detailPlayer` snapshot, as Known Issues recorded it

_Was `CLAUDE.md` lines 1403-1411._

- **RESOLVED in item 8: the player object on the detail page was a snapshot.**
  `App.tsx` stored the whole `Player` in `detailPlayer` when a row was clicked,
  so the header card kept rendering the object captured then while its season
  label came from the live `bootstrap`. Inert while nothing could change the
  season; a real defect the moment a selector existed. It now stores
  `detailCode` and re-resolves from `bootstrap.players` on every render, exactly
  as the entry predicted. Pinned by `App.test.tsx`, which is the first test
  `App.tsx` has had — and the mutation confirms it: reverting to a captured
  `Player` turns two tests red.

---

## Why `bootstrap.seasons` is not a reversal, moved from API identity rule 7 in item 16

**The rule stays in `CLAUDE.md`; the argument for it lives here.** Applying the
trim rule to a rule section: what a rule *is* stays, why a past decision went the
way it did moves to the item that decided it.

Item 8 put a `seasons: string[]` on the bootstrap response, and that is not a
reversal of rule 7's refusal of a manifest. What was refused on `/career` was a
manifest _beside rows that each already name a season_ — eleven copies of the
same facts, free to drift apart. A bootstrap response is one season throughout:
nothing in it answers "which others exist", so there is nothing for the field to
duplicate and nothing for it to contradict. The two decisions turn on the same
property, which is why they land differently.

# Item 1 — Career history on the player detail page

Commit `70003f4`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **1. Career history on the player detail page.** Three sections — header
      card, "This Season", "Previous Seasons". The last is
      `GET /api/player/:code/career`, one row per season, and each row expands
      into that season's gameweeks by re-using `GET /api/player/:code?season=X`
      and the same `StatsTable`. Responses are cached per season on the client,
      so collapsing and reopening issues no request.

      **API identity rule 7 was rewritten rather than satisfied.** A career
      spans ten seasons and has no single one to name. `season: null` was
      rejected for overloading null, which means "not measured" everywhere else
      (rule 6); `seasons: string[]` for duplicating what the rows carry. The
      rule now scopes by response: one season means a top-level key, many means
      a key on every row.

      **Two premises in the task were false and the data corrected them.**
      Saka's career is **8** seasons, not 9 — his first is 2018-19, and a ninth
      arrives with 2026-27. And no player-season in the ten has zero gameweek
      rows, so "the season has not started" is unreachable on current data.

      Empty states went from one to **four**, because "no rows" turned out to
      have two causes and only one of them is about time: a player never
      registered for that season (Cresswell has nine seasons and no 2025-26) will
      never fill in, while one the season has not reached yet will. The other two
      are rows that are all zero — Onana's 2025-26 is 38 of them, and the table
      renders — and rows excluded by the filters.

      Two things the columns forced. The club is **denormalised onto the career
      row** (`team_name`, `team_short_name`): a career crosses Middlesbrough,
      Hull, Sunderland and Cardiff, which no single season's team list can name,
      and the summary would print a bare integer on its oldest rows. For the
      same reason in the other direction, `GET /api/player/:code?season=X` now
      returns that season's `teams` — the opponent differs on every gameweek row,
      so denormalising is not an option there.

      At ~30 columns both tables scroll horizontally, so the Season and GW
      columns are pinned left with the expand chevron in the Season cell. The
      nested gameweek table takes `scroll={false}` and shares the outer scroll
      container: `position: sticky` resolves against the nearest scrolling
      ancestor, and its own `overflow-x-auto` would never be narrow enough to
      scroll, so GW would have slid away with everything else.

      (**The `scroll` prop no longer exists.** Item 12 merged the standalone
      table into the career table, so every caller passed `false` and the other
      branch became unreachable — it was deleted and its reasoning moved onto the
      career `Card`. The behaviour described here is what `StatsTable` now does
      unconditionally.)

      One bug found in the browser and not by the tests: the per-season fetch
      was fired **inside a `setExpanded` updater**, and React StrictMode
      double-invokes updaters precisely to surface effects hidden in one — every
      expand issued two requests. Moved out of the updater, with the in-flight
      guard in a ref rather than in state, since a state guard is read from the
      render that scheduled the click and two calls in a tick both see it empty.

# Item 3 — Keyboard reach and click-through

Commit `6c01bb6`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **3. Keyboard reach and click-through.** Two gaps that were the same
      problem stated twice: the career rows were `<tr onClick>` that no keyboard
      could reach and nothing announced as a disclosure, and the Dashboard's
      three rankings had no click handler at all — not a broken one, none — so
      the career view was reachable only through the Players list.

      **The audit found the defect in two more places**, and the scope grew
      because leaving them would have been worse than a consistent gap. The
      Players row toggle had it identically. And **sortable column headers** had
      it on both the Players list and every `StatsTable` — which is the one that
      settled it, because `StatsTable` renders inside every expanded career row:
      fixing the toggle alone would have let a keyboard user open a season and
      then not sort the table they had just opened. Nested, not parallel. Total:
      four `<tr>`/`<th>` handlers replaced, one focus bug fixed.

      **A real `<button>` inside the cell, never `role="button"` on the row.** A
      button gets Enter, Space, focus order and the right role for free; a
      hand-rolled focusable element scrolls the page on Space unless that is
      suppressed, and the suppression gets written once and omitted at the
      second call site. Confirmed in the browser: Space toggles a season and the
      scroll position does not move.

      **The button wraps the chevron *and* the text, never the chevron alone.**
      An icon-only button has no accessible name — 200 Players rows would
      announce "button" 200 times. Wrapping the season names that button
      "2024-25"; wrapping the player's name names that one "Saka". **No
      `aria-label` anywhere**, so there is nothing that can drift out of
      agreement with what is on screen. The chevron and the sort arrow are
      `aria-hidden` for the same reason.

      **`stopPropagation` lives in `DisclosureButton`, not at the call sites.**
      Both tables keep their row `onClick`, because clicking anywhere on the row
      is how a mouse has always worked here — and dropping it would also have
      broken `PlayerDetail.test.tsx`, which item 2 requires to stay green
      unmodified. Without the guard the button's click bubbles into the row and
      toggles back, netting to closed, which looks exactly like a click that did
      nothing. Pinned by count in two files, and the mutation confirms it:
      removing `stopPropagation` turns four tests red with "expected 1 times,
      but got 2 times".

      **`aria-controls` is emitted only while expanded; `aria-expanded` always.**
      The expanded row exists only when open — rendering every season's panel
      and hiding it would defeat the lazy per-season fetch — and pointing
      `aria-controls` at an id that is not in the document is an ARIA violation:
      a dangling reference is worse than none, because a screen reader following
      it lands nowhere. The test resolves the id through `document.getElementById`
      rather than comparing the attribute against the string that produced it.

      **The browser pass caught a regression the class-level test did not, and
      that is the entry worth reading.** Moving the sort handler onto a button
      meant moving the padding with it, or the mouse target would shrink from a
      padded cell to two or three characters of label on 31 columns. The first
      attempt put `h-10 px-3` on the button and left the `<th>` at `p-0` — and
      the header row **collapsed from 40px to 21px on every sortable table**,
      because the button carried both `h-10` and `h-full`, `h-full` wins in
      Tailwind's cascade, and `height: 100%` then resolved against a cell with
      no height of its own. Every class the test asserted was present. The fix
      is that the **cell owns the height and the button owns the padding**:
      `h-10 px-0` on the `<th>`, `w-full h-full px-3` on the button. Verified by
      a real click 119px to the left of a label, in a `StatsTable` nested inside
      an expanded career row, which sorted the column. The test was rewritten
      against the arrangement that fixed it and now fails if the pair goes back
      on one element — but the lesson stands: asserting classes in jsdom is a
      tripwire, not proof, because jsdom does not lay out.

      **One focus bug fixed**, found by the audit rather than reported: the
      Players search input had a bare `outline-none` with no ring replacement,
      so focus landed in a text field with nothing on screen saying so. The ring
      goes on the bordered wrapper rather than the borderless input, with
      `focus-within` — for a text field it fires with `:focus-visible` anyway,
      since browsers match that on text inputs even when clicked. `FOCUS_RING`
      in `lib/cn.ts` now names the convention the three new controls share; the
      three components that already spelled it out inline keep their copy, since
      retrofitting them is restyling this item did not need.

      **`user-event` is now a client dependency**, as item 2 said it would be:
      `fireEvent` dispatches a synthetic click and cannot tell a `<button>` from
      a `<div onClick>`, which is the entire distinction here.

      **What the Dashboard tests do not cover.** `Dashboard.test.tsx` pins that
      activating a player calls `onOpenDetail` with that player. `App.tsx` is
      what turns that into a detail page and `App.tsx` has no test, so the
      callback firing is not evidence the feature works. Checked in the browser
      instead, all three rankings, each confirmed by the player's name on the
      page that opened. The back link's stale label was found doing it — see
      Known Issues.

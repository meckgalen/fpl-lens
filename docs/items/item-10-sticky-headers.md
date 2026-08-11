# Item 10 — Sticky headers, pinned columns, row striping

Commit `2ce4fd9`. Phase 1 item record.

**Reconstructed from the commit message in item 15, not written at the time.**
Items 10 and 11 ended their sessions without writing a record — the working
agreement's "end each session by writing the item's record" is exactly what
they were missing, and the client test count drifted from 82 to 134 unnoticed
across the two of them as a result. Their commit messages were detailed enough
to stand as the record, so the body below is that message verbatim. It is the
only account either item has; it was never a `CLAUDE-history.md` entry.

---

Item 10: sticky headers, pinned columns, row striping

Three tables in this app are wide, long, or both, and scrolling either
axis lost your place: the column headings scrolled away vertically and
the identifying column scrolled away horizontally. This adds sticky
column headers to StatsTable and the Players list, pins Opp alongside
GW, pins and caps the Player column, and stripes all four tables.

The refactor underneath it moves row background colour from the cell to
the row. Every cell paints var(--row-bg), which its row sets, so a
pinned cell holds the row's colour and stripes and hovers in lockstep
with the cells beside it. Previously the pinned cell carried its own
opaque bg-card while the rest of the row hovered to a translucent
muted/50, which put a visible 8 to 10 unit step at the boundary and made
the pinned column look like the only thing highlighted.

New: client/src/lib/rowSurface.ts, holding the three level z ladder, the
two edge mechanisms, the four row surfaces and the striped/hoverInert
parity helpers. It lives in lib/ rather than in ui/Table.tsx because a
single non-component export there turns every subsequent edit to
Table.tsx into a full page reload. Item 9 shipped exactly that defect
with resetShirtCache and it took a dev server log to find.

Moves page padding from <main> to an inner div. This is not tidying and
it is the one change here that is not about the three tables. <main> is
the scroll container, and a scroll container's padding sits inside its
own scrollport, so content scrolls through it and a sticky header
resolves against the content box. The Players header stuck at 32px with
rows visibly scrolling above it. On an inner element the same 32px is
ordinary content that scrolls away. Visually identical at rest, which is
why it reads as a no-op and is not one. Affects every page.

Scroll panes. A sticky header only works inside a bounded scroll
container, and per the overflow spec, overflow-x: auto with overflow-y:
visible computes overflow-y to auto, so every wrapper in the app was
already an unbounded vertical scroller in which a header silently never
sticks. Resolved per table rather than uniformly:

  StatsTable standalone   bounded pane, max-h-[70vh]
  CareerTable             bounded pane, max-h-[75vh]
  Players list            no overflow, sticks against <main>

The career card has to be the bounded one because the nested gameweek
tables cannot be given a scroller of their own: each lives inside a
colSpan={34} cell as wide as the whole outer table, so it never scrolls
horizontally. The Players list stays unbounded because 200 rows is the
primary browse surface and a 70vh box inside a page that barely scrolls
is worse than one scrollbar. Accepted cost: horizontal scroll moves the
whole main area on Players and only the card on the career table.

overscroll-behavior is deliberately left at its default on both bounded
cards so the wheel chains onto the page once a pane bottoms out.

Borders go separated. border-separate border-spacing-0 on Table, because
a collapsed border belongs to the table rather than the cell and scrolls
out from under a sticky element. A consequence worth stating because it
is invisible: in the separated model a <tr> cannot have a border at all,
so this is what removed the row separators and the header underline app
wide. The stripe does that work now and the header is defined by its
fill and its box-shadow.

Two constraints found during implementation, both of which would have
shipped as classes that look right in the DOM and do nothing:

  Tailwind's scanner only sees literal class strings, so a variant
  assembled at runtime generates no rule. Independent classes
  concatenate freely, but a variant and its base must be literal
  together. hoverInert spells both branches out for this reason.

  Two shadow-[...] utilities on one cell are two box-shadow declarations
  of equal specificity whose winner depends on emission order, and the
  corner cell needs both edges at once. The pinned rule is a border-r,
  legal now that borders are separated, and the header edge stays a
  box-shadow, so they compose instead of competing. The same reasoning
  made the pinned constants z-free geometry with the level stated once
  per call site.

Corrections to the plan, measured rather than assumed:

  3rem is 48px, below GW's 51.3px intrinsic width, so Opp at left: 3rem
  would have overlapped it by about 3px. Both pinned columns are w-14 /
  left-14 with about 5px of headroom.

  Opp measured 119.6px, and the cause was the averages row's
  "over 38 fixtures" sitting in that column at 95.6px of nowrap text,
  not the three letter opponent codes. That note is a line beneath the
  table now, taking its denominator as a prop and rendering only what it
  is handed. A footnote must not dictate a pinned column's width. The
  value is unchanged.

  The Players list is not uniform either: it renders a conditional
  sibling <tr> for the open row, so nth-child parity fails there too.
  All four tables stripe by map index.

  Only one of the three Dashboard rankings is a <Table>. The other two
  are div lists and take the same fill on the same indices, so the page
  reads as one system rather than one striped table beside two bordered
  lists.

The four row tokens are opaque rather than an alpha on muted, for two
reasons. A translucent value reintroduces the see-through pinned cell
the indirection exists to remove. And the same alpha reads differently
per theme: light card is 99% lightness against muted's 92%, dark is 14%
against 17%, so an alpha tuned to be subtle in light is invisible in
dark. --row-head was retuned after the browser pass, where it landed 2
units from a striped row in dark and 1 point off hover in light. The
order is now header, hover, stripe, plain in both themes.

Verification: 77 server and 111 client tests (82 existing, unmodified,
plus 29 new), tsc clean both packages, ten mutations measured red, HMR
clean on all seven changed modules. jsdom does not lay out, so no test
here is evidence that anything sticks, that the pinned pair lines up, or
that a stripe runs unbroken through a pinned cell. Those rest on the
browser pass: header stuck at exactly 0 on Players and flush inside the
bounded pane on StatsTable; GW's right edge and Opp's left edge at the
same coordinate to 0.00px scrolled fully right; pinned cell byte
identical to its neighbours on striped, plain and hovered rows in both
themes; clean header handoff with two seasons expanded.

Left open: empty state 3 (never played) was not re-confirmed in the
browser because the search input would not take focus. It is asserted in
GameweekSection.test.tsx and nothing here touches it. With the filters
excluding everything the footnote reads "Averages over 0 fixtures",
which is the figure the old cell printed; whether it should render at
all in that state is a copy decision the denominator item owns.

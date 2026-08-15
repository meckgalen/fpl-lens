# Item 22 — Narrow viewports: containment, not responsiveness

Phase 1 item record.

The app is built for desktop on purpose and the columns need the width. This item
does not change that. It makes every surface **reachable and operable at 380px**,
degrading honestly into horizontal scroll where the content genuinely needs the
room.

**The triage rule was fixed before the browser pass**, so the pass could not
expand into a redesign: *fix anything unusable or unreachable; record anything
merely ugly in `docs/roadmap.md`.*

---

## What was actually wrong: one number

`App.tsx` was `flex h-screen overflow-hidden` with a `w-56 flex-shrink-0`
sidebar. At 380px that is **224px of sidebar, 156px of `<main>`, 92px of content**
after the inner `p-8`, and the sidebar could not be dismissed. Every other finding
sat underneath it, which is why the shell was fixed first and everything else was
re-measured against the corrected shell rather than against the old one.

`index.html` carries `width=device-width`, so a phone really does lay out at 380
CSS px. The 92px was real.

Before this item the whole client held **three** responsive utilities, all `xl:`
on `Comparison.tsx`. This establishes `lg` for the shell and leaves item 16's
`xl` for the radar stacking exactly where it was — a coherent two-token
convention rather than one arbitrary breakpoint.

---

## The instrument, and the four faults it caught in itself

`scripts/viewport-audit.js`: a same-origin iframe at exact CSS-pixel sizes, item
13's technique. Chrome refuses to resize a maximised window and `devicePixelRatio`
is 1.1, so the window is not an instrument.

**A pre-flight gate ran before any new number was read**: reproduce item 13's
recorded 1440 figures — `<main>` 1211, table 1146, overflow 0, 13 metric columns.
A divergence there is an *instrument fault, not a finding*, and stops the run.
It fired on the first attempt and on three later occasions:

| # | Fault | Symptom | Cause |
| --- | --- | --- | --- |
| 1 | wrong box | main 1216.01 vs recorded 1211 | `getBoundingClientRect()` includes the 5px `::-webkit-scrollbar`; item 13 measured `clientWidth` |
| 2 | phantom column drift | 16 columns vs "thirteen stands" | counted all `<th>`; 16 = 3 non-metric + 13 metric |
| 3 | phantom shrunk text | 75 findings/page at **every** width incl. 1440 | scale derived as fractional `rect.width` ÷ integer `offsetWidth`; a ratio of two differently-rounded measurements is not a scale factor. Now reads the transform chain via `DOMMatrixReadOnly` |
| 4 | double-counted pins | "288px pinned, 75.79%" on the detail page | `pinned()` used a descendant query, so the career table's entry absorbed the **nested** table's GW/Opp — two tables' pinned columns that never share a row |

**Fault 4 was reported to the user as fact and corrected afterwards, so its blast
radius was checked rather than assumed:** the Players list has no nested table
and Comparison has no pinned columns, so `detail@*` was the **only** affected
cell. Every other pinned figure in step 1 stands.

Four instrument faults in one audit is the argument **for** the checked-in
script, not against it. Each was caught because a second reading contradicted a
first; a pasted snippet edited between runs would have produced four plausible
numbers and no contradiction.

Two **state** errors were caught the same way, and would have mislabelled cells
rather than corrupted them:

- **Fixtures defaults to Results, not Difficulty.** `initialFixturesView` opens a
  played round on results, so four cells were Results under a Difficulty label.
- **The selected season's career row arrives already expanded** (item 12), so the
  click meant to expand it *collapsed* it. Four `detail@*` cells were measuring a
  closed career table.

`sr-only` labels were excluded too: a 1px clipped box holding 34px of text reads
as a 34× overflow and is the technique working.

---

## The shell (3a)

Two layout modes, and **the breakpoint decides which element scrolls**:

| | below `lg` | `lg` and up |
| --- | --- | --- |
| shell | block, `min-h-screen` | `flex h-screen overflow-hidden` |
| `<aside>` | full-width strip, in document flow | `w-56` column |
| `<main>` | no `overflow-y` | `overflow-y-auto`, the scrollport |
| page scrollport | the **document** | `<main>` |
| inner padding | `p-4` | `p-8` |

**The strip is not sticky, and that was the requirement.** A sticky shell above
item 10's sticky `<thead>` would make the header's top offset depend on the
strip's rendered height — a coupling jsdom cannot see. In flow it costs nothing
once scrolled past. Verified in the browser: scrolling 500px takes the strip from
top 0 to **top −500** while the table header sits at **top 0**, with no offset
inherited.

**One DOM node, not two.** Rendering the nav twice behind `hidden lg:flex` is the
obvious alternative and breaks: two `id="season-select"` attributes, and
`App.test.tsx` finds the control by its visible label, which `getByLabelText`
requires to be unique. Suffixing the id does not help — the accessible name *is*
the visible word. Two `Countdown`s would also mean two intervals. So the markup
is written once and the scrollport moves instead. Below `lg` the theme switch is
reordered into the first row with `order`, which reshuffles it visually without
moving it in the DOM.

**Blast radius: one table, measured not assumed.** For every sticky element the
audit walked to the first ancestor with non-`visible` overflow:

| Surface | Sticky cells | Resolves against |
| --- | --- | --- |
| Players list | 200 `<td>` left:0, 15 `<th>` top:0, 1 corner | **`<main>`** |
| Career table | 44 `<td>` left:0 (Season) | its Card, `overflow-auto max-h-[75vh]` |
| Nested gameweek table | 31 `<th>` top:0, 39 `<td>` left:56px | the same Card |
| Gameweek filter bar | 1 `div` left:0 | the same Card |

Identical at 380 and 1440. So only the Players list could be affected by the
shell change; `CareerTable` and `StatsTable` are their own scroll contexts at
every width and are untouchable by it.

It also removed an iOS defect for free: `h-screen` is `100vh`, the *large*
viewport, so with `overflow-hidden` the theme switch sat under the URL bar with
no way to scroll to it.

### Item 10's criterion, re-run

| Width | Mode | Sticky context | Header top after scrollTop 1200 | Player cell left after scrollLeft |
| ---: | --- | --- | --- | --- |
| 380 | strip | viewport | 396 → **0** | 77 → **0** (at left 400) |
| 768 | strip | viewport | 268 → **0** | 77 → **0** (at left 185) |
| 1024 | strip | viewport | 242 → **0** | no h-overflow |
| 1440 | sidebar | **`<main>`** | 161 → **0** | unchanged |

---

## The effective boundary is engine-dependent: 1025 in Chrome, 1024 elsewhere

Below `lg` the document scrolls, and a **classic** scrollbar reserves gutter that
the media query excludes. This project sets `::-webkit-scrollbar` to 5px, so in
Chrome a 1024px viewport evaluates as 1019 and stays in strip mode.

Measured in Chrome:

| Viewport | `documentElement.clientWidth` | `matchMedia(min-width:1024px)` | Mode |
| ---: | ---: | --- | --- |
| 1022 | 1017 | false | strip |
| **1024** | **1019** | **false** | **strip** |
| 1025 | 1025 | true | sidebar |
| 1026+ | = viewport | true | sidebar |

**This is a Chrome fact, not a CSS one, and the earlier flat "fires at 1025" was
wrong to state it as universal.** The offset is exactly the reserved gutter, so
the boundary is `1024 + gutter`:

| Scrollbar behaviour | Gutter | Boundary | At a 1024px viewport |
| --- | ---: | ---: | --- |
| Overlay (mobile Safari, Chrome Android, Firefox on macOS) | 0 | **1024** | **sidebar** |
| This project's `::-webkit-scrollbar` (Chrome/Blink) | 5px | **1025** | **strip** |
| A platform default classic bar (Firefox on Windows/Linux, which ignores the `-webkit-` rule) | ~12–17px | ~1036–1041 | strip |

**So the outcome at exactly 1024 does differ by engine** — strip in Chrome,
sidebar where scrollbars overlay — because `min-width: 1024px` is **inclusive**
and an overlay engine's query sees the full 1024. It is a one-pixel-wide
disagreement and benign either way: 1024 yields 960px of content as a strip and
736px as a sidebar, both usable. It is recorded because "the outcome is the same
everywhere" is the kind of reassurance that stops the next reader checking.

The width it actually matters at is **iPad landscape, 1024**, which gets the
sidebar on iOS Safari — the plain `lg` behaviour, and the one the breakpoint was
chosen for.

**The loop is closed** — mode decides document scroll, scroll decides the
scrollbar, the scrollbar decides the query width, the query decides the mode — so
two stable states at one width were plausible, and repetition from one starting
path could not rule it out. **Tested by path instead**, four ways at each of
1024/1025/1026/1028: fresh load; descending from 1440; ascending from 380; and
oscillating 380 → 1440 → target. **All four agree at every width.** Not bistable:
the second fixed point is unreachable because Chrome reserves the gutter even
coming from sidebar mode.

Accepted rather than nudged. It matches the reason `lg` was chosen — 224px is
worth more as table width than as permanently visible nav on a tablet — and
1024 is iPad landscape, which now gets the strip and 704px of content instead of
480px of sidebar-constrained table.

---

## Decisions measured and **rejected**

Recorded as rejected rather than "not needed", because both were predicted to be
levers and the measurement says otherwise. Without this they get proposed again.

### The pinned Player column: no change

At 380 the table renders **932px wide with a 123.59px Player column**. Forcing
`table { width: min-content }` gives **exactly 932px and exactly 123.59px** — the
table is already at its minimum, so `w-44` and `max-w-[11rem]` are both **inert**
there and no narrower ceiling reclaims anything. The floor concern was right in
principle and has no target: you cannot pin *above* min-content.

Going narrower requires `truncate`, and the cost was measured over all 841
`web_name`s in 2025-26 at the cell's own computed font
(`normal 500 13px "DM Sans"`, chrome 39.99px = 24 padding + 11.99 caret + 4 gap):

| Column width | Text budget | Truncated | % |
| ---: | ---: | ---: | ---: |
| 176 (the cap) | 136.01 | 0 | 0% |
| 144 | 104.01 | 6 | 0.71% |
| 128 | 88.01 | **16** | 1.90% |
| 123.59 (today at 380) | 83.60 | 22 | 2.62% |
| 112 | 72.01 | 61 | 7.25% |
| 96 | 56.01 | 240 | 28.54% |

Today nothing truncates: long names **wrap to two lines** (rows 82px against the
normal 62px) — two of the first 60 at 380, none at 1440.

**This width is data-dependent.** 123.59px tracks the longest `web_name` in the
roster, so a future season shifts it. That is fine and expected, but it should
not surprise anyone reading these numbers back.

At 1024 the column now reaches its full 176px, because strip mode gives the table
enough room to come off min-content.

### Chunk size and `rootMargin`: no change

2023-24 (865 players), tab foregrounded, `MutationObserver` (never `rAF`), 3 runs,
varying **only** viewport width:

| Width | Mount median | Runs | Re-sort median | Runs |
| --- | ---: | --- | ---: | --- |
| 380 | 816.9ms | 870.7, 816.9, 760.7 | 62.8ms | 62.8, 64.8, 62.7 |
| 1440 | 808.3ms | 792.1, 808.3, 822.9 | 67.6ms | 67.6, 62.0, 73.0 |

Differences of 8.6ms and 4.8ms sit inside within-width spreads of 110ms and 11ms.
Chunk growth is identical (200 → 400 → 600 → 800 → 865). Row height 62px at both.

**The prediction was that `rootMargin: '600px'` — not `CHUNK` — was the lever,
because 600px is a larger fraction of a short viewport. It is wrong.** 600px is a
fixed pixel lead, so it buys the same ~9.7 rows at both widths; measured, growth
fires with 141px (2 rows) still below the fold at 380 against 68px (1 row) at
1440, which favours the narrow viewport. Neither constant should vary.

**These timings are not comparable to item 18's 215ms/160ms** — this instrument
times iframe creation plus bootstrap fetch plus first render, where item 18 timed
React mount with data already loaded. The valid comparison is 380 against 1440 on
one instrument. CPU throttling was unavailable (`Emulation.setCPUThrottlingRate`
is not exposed through the extension), so these are unthrottled and labelled so;
only the absolute phone figure is missing.

### The Dashboard's zero-width buttons: dissolved, not fixed

At 380 the Dashboard rendered four player links at **0 × 19.49px** — unclickable
controls inside `flex-1 min-w-0 truncate`, squeezed by an unresponsive
`grid-cols-2`. After the shell change they measure 29.01 × 19.49 with no code
touching them. **No responsive grid variant was added for this**, and it is
recorded so nobody re-adds one for a symptom that no longer has a cause.

A *different* Dashboard defect did survive and was fixed — see below.

---

## What was fixed (3b), weighted by the cost of a mis-tap

Size alone does not decide it. A mis-tap on a trace remove destroys a selection
the reader assembled by searching; a mis-tap on a nav pill navigates somewhere
they can leave. Same 20px, different consequence.

| Fix | Measured | Why |
| --- | --- | --- |
| **Dashboard `grid-cols-2` stacks below `lg`** | cards 163px vs 313px of content; the club/pos/price line collapsed to **2px** holding 113px of text | a row rendering on top of itself. The three stat cards at 105px overflow nothing and **keep their row** |
| **`ColumnPicker` wrapper full-width below `lg`** | panel ran to x=468 in a 380 viewport — **88px off-screen** | a popover you must scroll the page sideways to read. Full-width wrapper puts it at 16 → 336 with 44px clearance, no clamp or flip logic. `right-0` fails the mirror case |
| **Picker label rows `min-h-11`** | checkbox 13×22, row 36px | the row is the target, not the box |
| **Comparison position pills 44px** | ~26px | **destructive**: `changePosition` clears every trace. The identical-looking Players pills only re-filter and were left alone |
| **Trace remove 44px** | 15.97×20 → 43.99×43.99 | the most destructive control on the page, and it measured the smallest |
| **Theme `Switch` hit area 44×60** | 18×34 painted | expanded via `::before`, not resized: its size is its design. Safe *here* because nothing else is within reach — the chips are the opposite case and were sized up instead |

---

## Before → after, at 380

```
                 pgOv        unint      worst      maxRatio       smallest target
dashboard    0 →   0     17 →   1    181 → 13     2.29 → 0     0x19.49 → 29.01x19.49
players      0 → 569      3 →   2    846 → 590    6.39 → 0     unchanged
detail       0 →   0      2 →   0    106 →  0    23.40 → 5.62  unchanged
comparison   0 →   0     70 →   4    166 → 21    12.61 → 1.92  15.97x20 → 43.99x43.99
fixtures     0 →   0     12 →   1    117 → 13     1.56 → 0     unchanged
```

**Rising `pgOv` is the predicted conversion, not a regression.** The old shell
clipped horizontal overflow with `overflow-hidden`, so it was invisible rather
than absent; below `lg` that clip is gone and what was hidden is now reachable
page scroll. Players needs 569px more than a 380px viewport — its min-content
width — which is the intended honest degradation.

**The residual `unint = 1` on every page is the Switch's own hit area** (`cw=30
sw=43`), the 13px `::before` extending past its box. Nothing is clipped or
unreachable; it is the audit correctly reporting an expanded target, and it will
recur on every future run.

The other two residuals: the Players table overflowing its card by 590px (item
10's deliberate no-overflow Card, now scrolling the document) and three SVG
`<text>` nodes on the comparison chart that overflow their layout box by 9–21px
at **every** width including 1440 — pre-existing, constant, nothing clips them.

**Item 16's caption fix holds.** `shrunk: 0` at every cell and every width,
including comparison at 380 — a width item 16 never checked. The fixed 580×500
SVG in its `overflow-x: auto` wrapper does exactly what it was built to do.

---

## Verification

- **322 client tests pass, unchanged.** `App.test.tsx` needed no edit, which was
  the pre-stated signal that the one-DOM-node structure is right.
- `tsc --noEmit` clean.
- **HMR clean on all five changed modules** — `hot updated` for `App.tsx`,
  `Dashboard.tsx`, `ColumnPicker.tsx`, `Comparison.tsx`, `ui/Switch.tsx`, with no
  `page reload`, no `invalidate`, no Fast Refresh warning. Each exports exactly
  one component, so Fast Refresh is safe by construction. `index.css` updates
  alongside because Tailwind regenerates for the new `lg:`/`max-lg:` classes.
- **Pre-flight re-passed identically after every change**: 1211 / 1146 / 0 / 13.
  Desktop is byte-identical to before the item.
- **Browser pass, both themes, at 380**: strip scrolls fully away (top 0 → −500)
  with the sticky header at 0; Dashboard ranking card full-width with the club
  line intact and squeezed containers **0** (was 3); comparison chips stacking
  with visible 44px removes; light and dark both correct.

## What this item did NOT verify

**Every measurement here was taken in desktop Chrome, through a same-origin
iframe. No phone or tablet browser was involved at any point.** That is sound for
layout, which is what the item was about — an iframe at 380 CSS px lays out
exactly as a 380 CSS px viewport does, and the pre-flight proves the instrument
against a recorded number. Three things sit outside it, and the record should not
be read as covering them.

**The iOS `100vh` claim is reasoned from source, not observed.** 3a's comment says
dropping `h-screen`/`overflow-hidden` below `lg` frees the theme switch from under
the URL bar. `100vh` is the *large* viewport and an `overflow-hidden` box that
size genuinely cannot be scrolled to reveal what the bar covers, so the reasoning
holds — but **an iframe has no URL bar**, so nothing here observed it. The claim
stays; it is labelled unverified.

**Engine differences beyond the boundary arithmetic.** The 1024/1025 table above
is Chrome-measured with the overlay-engine column derived, not run. Nothing in
this item was opened in Safari, Firefox or any mobile browser.

**Touch behaviour, entirely.** None of this was tested with a finger:

- whether momentum scrolling feels right on a document that is now the scrollport
- the **double-scroll** case — a horizontally scrolling table inside a vertically
  scrolling document — which is the interaction most likely to feel wrong on
  Players at 380 and which a mouse wheel does not reproduce
- whether the 44px targets actually land under a thumb, as opposed to measuring
  44px. A control can be the right size and still be in the wrong place.

The 44px figure is a convention this item applied, not a result it validated.

### The audit script's disposal

Kept in `scripts/`, deliberately. It is stale-able — it hard-codes selectors,
route states and a breakpoint — but the pre-flight gate is what makes it worth
keeping: it is the only thing in the repo that will tell a future session
*whether its own measurement of this app can be trusted*, by reproducing a
recorded number before reading a new one. A future editor should expect to fix
its selectors; the gate is the part to preserve.

It was served to the browser during the item by a symlink at
`client/public/viewport-audit.js` (Vite's `fs.allow` refuses `/@fs/` outside
`client/`). **The symlink is removed at commit** — it is a delivery mechanism,
not the artefact, and leaving it would ship the script in the client build.

# Item 23 — A "System" option on the theme toggle

## What it was

The theme was a boolean. `App.tsx` held
`useState(() => localStorage.getItem('fpl-theme') === 'dark')` and one effect
toggled `.dark` on `<html>` and wrote back `'dark'` or `'light'`. The device's own
preference was never consulted, so a dark-mode user got a light app until they
found the switch and nothing followed an OS change.

Three modes now: `light | dark | system`, with the **choice** persisted rather
than its result.

## The rule, and the one thing it is protecting

`client/src/lib/theme.ts` is the only place resolution happens:

```ts
readStoredMode(raw: string | null): ThemeMode   // anything unrecognised -> 'system'
resolveTheme(mode, prefersDark): AppliedTheme   // prefersDark read ONLY under 'system'
```

Both pure; the media query arrives as a `boolean` parameter, so the rule is
testable without a DOM and no component compares a string to `'system'`.

**What the whole item turns on: `system` is a standing instruction, `dark` is a
decision, and persisting the resolved theme collapses them.** Store `'dark'`
where the user picked System and the page paints identically — nothing looks
wrong — while the app has silently stopped tracking the device from the next
reload onward. That is the defect the pinned test targets.

## Four corrections that came out of the plan review

The plan was approved with four changes, and the first is the substantive one.

### 1. Subscribe to the media query always, not only under `system`

The plan had the effect subscribe only while the mode was `'system'` and
unsubscribe otherwise, with a `followsDevice` helper to keep the string
comparison out of the component. That is the obvious shape and it makes the test
that matters vacuous.

With the listener detached under an explicit pick, a stored `'light'` on a light
device means `setPrefersDark(true)` reaches nobody. `prefersDark` stays `false`,
so "an explicit Light does not follow the device" holds because **nothing
moved**, not because anything ignored it — and it would then pass against a
`resolveTheme` mutated to always read the device, which is the exact mutation it
exists to catch.

Subscribing unconditionally makes `prefersDark` genuinely flip under an explicit
mode, so `resolveTheme` ignoring it is a real branch being exercised.
`followsDevice` lost its only consumer and was deleted.

**Measured, not argued.** With `resolveTheme` mutated to
`(_mode, prefersDark) => prefersDark ? 'dark' : 'light'`, the test
*does not follow an OS change once a theme is picked explicitly* goes **red**,
along with four others. Under the planned design it would have stayed green.

This also dissolved a trade the plan had accepted rather than fixed: the
`System · Dark` hint would have gone stale under an explicit pick, because the
value it reads only updates while subscribed. Considered, then made impossible
rather than documented.

### 2. The persistence test was vacuous as written

It started from nothing stored, which already means `system` — so the click was a
no-op and the assertion read the value the mount had written. It now seeds an
explicit `'light'` first, making the click a real transition into `system`.

### 3. Persistence moved out of the effect and into the click handler

Writing the key from an effect writes it on mount. Three consequences: "nothing
stored" becomes unreachable after the first load, every returning visitor carries
an explicit record of a default they never chose, and an OS flip rewrites a key
whose value — the choice — did not change. The effect keeps only the `classList`
toggle; `selectTheme` is the only writer.

### 4. `:root.dark`, not `.dark`, for `color-scheme`

`:root` and `.dark` are both specificity 0-1-0, so `color-scheme: light` on
`:root` and `color-scheme: dark` on `.dark` would resolve on source order — the
same equal-specificity race as the two shadow utilities in `lib/rowSurface.ts`,
where every asserted class is present and one silently loses in the browser.
Only `color-scheme` is raised to 0-2-0; the token block keeps its existing
arrangement, which predates this item.

## First paint

There was **no pre-paint script at all** — `index.html` had none and `main.tsx`
only mounts `<App />`, so the class landed in React's first effect and dark users
got a light flash on every reload. A `system` default made that worse: a dark
device would flash light on a *first* visit too.

The script now sits first in `<head>` and duplicates the rule, because a script
that must run before any module loads cannot import from one. Comments on both
sides name the other.

**What it buys depends on the build, which is worth knowing before measuring
it.** `index.css` is imported from `main.tsx`, so in dev Vite injects it through
JavaScript and a flash remains whatever the script does. The production build
extracts it to a render-blocking `<link>`. Verified in `dist/index.html`: the
script is at offset **1722**, the module script at **4862**, the bundled
stylesheet at **4942** — the class is on `<html>` before the CSS is even fetched.

The unrecognised-value fallback is the `raw === …` chain, **not** the `try`/`catch`.
The catch is for localStorage being unavailable at all (private mode, cookies
disabled). A throw there would leave the document with no class and nothing in
the console anyone would look for.

## The drift guard

`client/src/test/prepaint.test.ts` extracts the script from the shipped
`index.html` **at run time and never pastes it**. A pasted copy pins the copy, so
the real script could drift freely with the suite green.

- Existence of `index.html` and a non-empty extraction are asserted in
  `beforeAll`, **before any case runs**. A regex that stops matching would
  otherwise leave every case running nothing, applying no class, and reporting a
  row of passes for a file it never read — item 20's vacuous-truth failure one
  layer up.
- Eight cases: `[null, 'light', 'dark', 'system'] × [device dark, device light]`.
  `null` is its own row because it is the first visit, the one case where the
  default decides everything.
- A ninth: an unrecognised value falls back and does not throw, asserted **on the
  resulting class** rather than on not throwing — the script has a catch-all, so
  a no-throw assertion alone would pass with the rule inside broken.

One assertion had to be weakened for a real reason: it cannot check that the
script lacks the string `color-scheme:`, because the media query it *reads*
contains it. It checks for `.style` instead — no attempt to *set* it.

## Mutation results

| Mutation | Result |
| --- | --- |
| `resolveTheme` always reads the device | **5 red**, incl. the explicit-pick test — the point of change 1 |
| Persist the resolved theme, not the mode | **1 red**: *stores system itself…* |
| Drop the effect cleanup | **1 red**: *drops its listener on unmount* |
| Change the rule **inside `index.html`** | **2 red** — proves the extraction reads the shipped file |
| Point the extraction regex at nothing | `beforeAll` fails, **11 skipped, 0 passed** |

Files were copied to the scratchpad and restored from the copies. `git checkout --`
was not used, per the working agreement.

## Browser pass

Dev server for the interaction, production preview for first paint.

- **First visit on a dark device** (fresh preview origin, `fpl-theme` null):
  class `dark`, `color-scheme` `dark`, System pressed, and
  **`localStorage` still null** — change 3, confirmed against a real browser.
- **Picking System** stored `'system'`, not `'dark'`, with the page dark.
- **Explicit Light on a dark device**: class cleared, `color-scheme: light`,
  body `rgb(245,243,239)`, device still reporting dark.
- **A stored `'light'` from the old two-mode toggle** loaded and held on a dark
  device — requirement 4, no migration.
- All four pages in dark, `pgOverflow` 0 on each.

### Item 22's boundary does not move

`color-scheme: dark` can change native scrollbar metrics, and item 22's `lg`
boundary at 1025px depends on the document reserving a 5px gutter. Measured by
toggling only the class on one page: scrollbar width **5px in light and 5px in
dark**. The explicit `::-webkit-scrollbar { width: 5px }` holds it.

### Containment at 380

Run through `scripts/viewport-audit.js`, gated on its preflight, which reproduced
item 13's recorded 1440 figures exactly (main 1211, table 1146, overflow 0, 13
columns).

The control is 171px wide and shares the strip's top row with the brand, as the
34px switch did. At 380 it sits at x=188.3 with its right edge at **359.5** —
inside the viewport — and `clientWidth === scrollWidth` on the group and all
three buttons.

Against item 22's recorded Players row: `pgOv` **569** and worst **590**, both
unchanged, with `unint` **2 → 1**. The residual that went is the one item 22
predicted would recur forever — the `Switch`'s 13px `::before` hit area — because
the component was deleted. **`scripts/viewport-audit.js`'s docblock was rewritten
in place**, since a comment promising a finding that can no longer occur is worse
than no comment.

### HMR

One real content edit to `App.tsx`, with a browser client connected:
`hmr update /src/App.tsx, /src/index.css`, no `hmr invalidate`, no Fast Refresh
warning. `THEME_LABELS` went in `lib/theme.ts` rather than `App.tsx` precisely to
keep that module's exports all components.

## The test harness gained two things

`client/src/test/matchMedia.ts`, because **jsdom implements no `matchMedia` at
all** — measured, not assumed: on jsdom 29.1.1 `typeof window.matchMedia` is
`undefined`, and Vitest adds no polyfill (its jsdom environment copies the key
only *if present*). `App` reads the query in a lazy initialiser, so without the
stub all 14 of `App.test.tsx`'s tests throw before asserting anything.

Two details that make it an instrument rather than a prop:

- **`matches` is a getter, not a snapshot.** `App` holds one MediaQueryList
  across a device flip; a frozen boolean would let the follow-the-device test
  pass while reading a value that never moved.
- **`listenerCount()`** exists so unsubscription is asserted as the property —
  no listener remains — rather than through a spy on `removeEventListener`,
  which would go green for the right listener removed from the wrong object.

`setup.ts` also now clears `.dark` from `<html>` in an `afterEach`. RTL's
`cleanup` unmounts the container and touches nothing on the document, so a test
resolving dark would leak the class into every test after it.

## Counts

- 351 client tests over 33 files, all green; `tsc --noEmit` clean.
- 29 of those are this item's: 11 in `lib/theme.test.ts`, 11 in
  `test/prepaint.test.ts`, 10 in `App.theme.test.tsx` (`App.test.tsx` unchanged).
- `client/src/components/ui/Switch.tsx` deleted — one importer, no test.

### The live device flip, against a real MediaQueryList

**This is a property the suite structurally cannot reach, and the first pass of
this item wrongly treated the unit test as covering it.** `App.theme` #6
dispatches a synthetic `change` on our own stub, so it pins the **handler
wiring** — that a listener is attached and does the right thing when called. It
says nothing about whether a real `MediaQueryList` emits. The production
first-visit check proved `THEME_QUERY` **matches at load**, which is a third,
different property.

Driven through CDP `Emulation.setEmulatedMedia` — the method DevTools' Rendering
panel calls for "Emulate CSS `prefers-color-scheme`" — against headless Chrome on
the dev server, so the renderer re-evaluates the query and dispatches genuine
events. **11/11.**

The instrument is gated before any app assertion, and **the gate caught a fault
in it**: the first run counted one event across two flips and stopped. Headless
had inherited this machine's dark OS setting, so the opening `emulate('dark')`
was a no-op emitting nothing — the count was right and the expectation was wrong.
Forcing a light baseline first makes every later flip a real transition.

| Leg | Observed |
| --- | --- |
| System, device dark → light | class `dark` → `""`, `color-scheme` dark → light, bg `rgb(27,26,24)` → `rgb(245,243,239)` |
| System, suffix | `System · Dark` → `System · Light` |
| Explicit Light, device → dark | class **stayed `""`** with `matchMedia` reporting dark |
| Explicit Light, suffix | still tracked the device, `System · Dark` → `System · Light` |

Two guards make those readings mean something. A **load token** stamped on
`window` was unchanged throughout, so nothing was a reload. And an
**independent listener** on the real `MediaQueryList`, separate from the app's,
counted **4 → 6** across the explicit-Light leg — proving the device genuinely
flipped while the theme did not move. Without that count the negative assertion
would be satisfied by an absence of stimulus, which is the same vacuity that
change 1 removed from the unit test.

That last row also confirms change 1 end to end: the suffix keeps tracking the
device under an explicit pick **because** the subscription is unconditional.

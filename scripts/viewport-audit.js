/*
 * Item 22's measurement instrument: a narrow-viewport audit, run in the browser.
 *
 * NOT app code and not imported by anything. It is pasted into a tab already at
 * http://localhost:5173 and driven from the console (or `javascript_tool`).
 *
 * **Why it is a checked-in file rather than an ad-hoc paste.** Step 4 re-measures
 * after the fixes and diffs against step 1, and the working agreement's
 * one-condition rule means those two numbers are only comparable if the thing
 * doing the measuring did not also change. A pasted snippet edited between runs
 * varies two conditions and measures neither.
 *
 * **The technique is item 13's**: a same-origin iframe at an exact CSS-pixel
 * size. Chrome refuses to resize a maximised window and this machine's
 * devicePixelRatio is 1.1, so screen pixels are not CSS pixels and the window is
 * not an instrument. The iframe is same-origin, so it shares `localStorage` with
 * the host page — which is how a route and a season are selected without
 * clicking anything.
 *
 * Usage:
 *   await __VPAUDIT.preflight()      // MUST pass before anything else is read
 *   await __VPAUDIT.cell({ page: 'players', season: '2025-26', w: 380, h: 740 })
 *   await __VPAUDIT.matrix()         // the whole 6 x 4
 *   await __VPAUDIT.names('2025-26') // the truncation distribution
 *   await __VPAUDIT.perf(380, 740)   // mount / re-sort / chunk count
 */
window.__VPAUDIT = (function () {
  'use strict';

  const FRAME_ID = '__vpaudit_frame';

  /* ---------------------------------------------------------------- utility */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 15000, step = 50, what = 'condition' } = {}) {
    const t0 = performance.now();
    for (;;) {
      let v;
      try {
        v = fn();
      } catch {
        v = null;
      }
      if (v) return v;
      if (performance.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
      await sleep(step);
    }
  }

  /** A short, readable identity for an element. Not a valid selector; a label. */
  function path(el) {
    if (el === el.ownerDocument.documentElement) return 'html';
    if (el === el.ownerDocument.body) return 'body';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    let depth = 0;
    for (let p = el.parentElement; p; p = p.parentElement) depth++;
    return `${tag}${id}${cls}@${depth}`;
  }

  const round = (n) => Math.round(n * 100) / 100;

  /* ------------------------------------------------------------------ frame */

  function destroyFrame() {
    const old = document.getElementById(FRAME_ID);
    if (old) old.remove();
  }

  /**
   * A fresh iframe at exactly (w x h) CSS pixels, with the app loaded and
   * rendered.
   *
   * `prep` writes localStorage BEFORE navigation, so the app reads it on first
   * render rather than being switched afterwards — a switch would measure a
   * transition rather than a state.
   */
  async function frame({ w, h, prep, ready }) {
    destroyFrame();
    if (prep) prep();

    const f = document.createElement('iframe');
    f.id = FRAME_ID;
    f.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'z-index:2147483647',
      'border:0',
      'background:#fff',
      `width:${w}px`,
      `height:${h}px`,
    ].join(';');
    f.src = '/';
    document.body.appendChild(f);

    await new Promise((res, rej) => {
      f.onload = res;
      f.onerror = () => rej(new Error('iframe failed to load'));
    });

    const win = f.contentWindow;
    const doc = f.contentDocument;

    // The shell is up once <main> exists and the bootstrap has resolved into a
    // heading. Before that every measurement would describe "Loading FPL data…".
    await waitFor(() => doc.querySelector('main h1'), { what: 'app shell' });
    if (ready) await waitFor(() => ready(doc, win), { what: 'route content' });

    // One more frame so layout has settled after the last state commit.
    await sleep(120);
    return { f, win, doc, w, h };
  }

  /* -------------------------------------------------------------- preflight */

  /**
   * Two things must be true before any number this file produces means anything.
   *
   * 1. **Media queries resolve against the IFRAME's viewport**, not the host
   *    window. Asserted directly with `matchMedia` rather than by probing a
   *    Tailwind `lg:` utility: the scanner only emits rules for classes present
   *    in source, and at step 1 time no `lg:` class exists — the probe would go
   *    red while the property held perfectly.
   *
   * 2. **The harness reproduces item 13's recorded 1440 figures.** If it cannot
   *    reproduce a number already in the record, its 380px numbers are worthless.
   *    A divergence here is an INSTRUMENT FAULT, not a finding, and the run stops.
   */
  async function preflight() {
    const out = { mediaQuery: null, item13: null, ok: false, faults: [] };

    // --- 1. the property itself -------------------------------------------
    const narrow = await frame({ w: 380, h: 740 });
    const mqNarrow = narrow.win.matchMedia('(min-width: 1024px)').matches;
    const innerNarrow = narrow.win.innerWidth;

    const wide = await frame({ w: 1440, h: 900 });
    const mqWide = wide.win.matchMedia('(min-width: 1024px)').matches;
    const innerWide = wide.win.innerWidth;

    out.mediaQuery = {
      at380: { matchesMin1024: mqNarrow, innerWidth: innerNarrow },
      at1440: { matchesMin1024: mqWide, innerWidth: innerWide },
      hostInnerWidth: window.innerWidth,
      pass: mqNarrow === false && mqWide === true && innerNarrow === 380 && innerWide === 1440,
    };
    if (!out.mediaQuery.pass) {
      out.faults.push(
        'media queries do not resolve against the iframe viewport — the whole audit is invalid'
      );
    }

    // --- 2. item 13's recorded figures ------------------------------------
    // Recorded in docs/items/item-13-selectable-columns.md, build step 1:
    // viewport 1440 -> <main> 1211px, Players table 1146px, overflow 0.
    const p = await frame({
      w: 1440,
      h: 900,
      prep: () => {
        localStorage.setItem('fpl-page', 'players');
        localStorage.setItem('fpl-season', '2025-26');
        localStorage.removeItem('fpl-players-columns'); // the DEFAULT selection
      },
      ready: (d) => d.querySelectorAll('table tbody tr').length > 10,
    });

    const main = p.doc.querySelector('main');
    const table = p.doc.querySelector('table');
    /*
     * **`clientWidth`, not `getBoundingClientRect()`, and the gate is what
     * established that.** The first run read the border-box rect and came back
     * with main 1216.01 against item 13's recorded 1211 — a 5.01px miss that
     * looked like an app change and was the instrument. `getBoundingClientRect`
     * includes the scrollbar, and `index.css` sets `::-webkit-scrollbar` to
     * exactly 5px; `<main>` has a vertical scrollbar here because 200 rows
     * overflow it. Under `clientWidth` both figures reproduce to the integer.
     *
     * Recorded rather than silently corrected, because the same 5px sits on
     * every width this file measures and the next reader needs to know which
     * box these numbers are.
     */
    const observed = {
      main: main.clientWidth,
      table: table.clientWidth,
      overflow: Math.max(0, table.scrollWidth - table.clientWidth),
      // Metric columns only — the 3 leading cells are the shirt, Player and Pos.
      // Counting all <th> gives 16 and reads as drift from item 13's thirteen.
      metricColumns: p.doc.querySelectorAll('table thead th').length - 3,
    };
    const expected = { main: 1211, table: 1146, overflow: 0, metricColumns: 13 };
    out.item13 = {
      expected,
      observed,
      // Exact. `clientWidth` is an integer and both figures reproduce on the
      // nose, so a tolerance here would only hide the next instrument fault.
      pass:
        observed.main === expected.main &&
        observed.table === expected.table &&
        observed.overflow === expected.overflow &&
        observed.metricColumns === expected.metricColumns,
    };
    if (!out.item13.pass) {
      out.faults.push(
        `harness does not reproduce item 13 at 1440 — instrument fault, not a finding. ` +
          `expected main ${expected.main}/table ${expected.table}/overflow ${expected.overflow}, ` +
          `got main ${observed.main}/table ${observed.table}/overflow ${observed.overflow}`
      );
    }

    out.ok = out.faults.length === 0;
    destroyFrame();
    return out;
  }

  /* ------------------------------------------------------- (a) overflow */

  /**
   * Horizontal overflow, split by whether the element was meant to scroll.
   *
   * **Item 22's expected residual is GONE as of item 23, and that is not a fix
   * to go looking for.** It used to report the theme `Switch` as unintended
   * overflow at roughly `cw=30 sw=43` on every page — the 13px of its `::before`
   * hit area, a deliberate 44x60 target on an 18x34 control. Item 23 replaced
   * that switch with a three-segment theme control and deleted the component, so
   * the pseudo-element and its finding went with it. The segments are ordinary
   * buttons that report `cw === sw`.
   *
   * Measured at 380 on Players after the change: `pgOv` 569 and worst 590, both
   * exactly item 22's recorded figures, with `unint` 2 -> 1. The one that
   * remains is the Players table overflowing its card by 590px, which is item
   * 10's deliberate no-overflow Card scrolling the document.
   *
   * Kept at the point the finding is PRODUCED, rather than only in
   * `docs/items/item-22-narrow-viewports.md`, so the next session does not spend
   * an hour investigating its predecessor's fix — or, now, hunting for a
   * residual that is supposed to be absent.
   */
  function overflow(win, doc, viewportW) {
    const intended = [];
    const unintended = [];

    for (const el of doc.querySelectorAll('*')) {
      const cw = el.clientWidth;
      // clientWidth is 0 on inline and replaced elements, which cannot scroll.
      // <= 1 also excludes the `sr-only` pattern — a 1px clipped box holding
      // its full text, which reports a 34x overflow ratio and is the technique
      // working exactly as intended rather than a containment defect.
      if (cw <= 1) continue;
      const sw = el.scrollWidth;
      if (sw <= cw + 1) continue;

      const cs = win.getComputedStyle(el);
      const ox = cs.overflowX;
      const rec = {
        el: path(el),
        scrollWidth: sw,
        clientWidth: cw,
        over: sw - cw,
        ratio: round(sw / cw),
        overflowX: ox,
        node: el,
      };
      if (ox === 'auto' || ox === 'scroll') intended.push(rec);
      else unintended.push({ ...rec, clipped: ox === 'hidden' || ox === 'clip' });
    }

    // An overflowing child makes every ancestor report overflow too. The
    // innermost one is the finding; the rest are its shadow.
    const mark = (list) => {
      for (const r of list) {
        r.innermost = !list.some((o) => o !== r && r.node.contains(o.node));
        delete r.node;
      }
      return list.sort((a, b) => b.over - a.over);
    };

    const de = doc.documentElement;
    return {
      page: {
        docScrollWidth: de.scrollWidth,
        viewportWidth: viewportW,
        horizontalOverflow: Math.max(0, de.scrollWidth - viewportW),
      },
      intended: mark(intended),
      unintended: mark(unintended),
    };
  }

  /* --------------------------------------------------- (b) touch targets */

  const TARGET_SELECTOR =
    'button, a, input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [tabindex], th[aria-sort]';

  function targets(win, doc) {
    const set = new Set(doc.querySelectorAll(TARGET_SELECTOR));
    const explicit = new Set(set);

    /*
     * The cursor sweep, which is here for `<tr onClick>`.
     *
     * `Players.tsx` and `CareerTable.tsx` both make the row itself clickable —
     * a primary interaction with no role, no tabindex and no tag to select on.
     * `Table.tsx` gives it `cursor-pointer`, so that is the only handle.
     *
     * `cursor` INHERITS, so every cell inside a clickable row computes `pointer`
     * as well. Taking only elements whose PARENT is not already pointer yields
     * the row and not its fifteen cells.
     */
    for (const el of doc.querySelectorAll('*')) {
      if (set.has(el)) continue;
      if (win.getComputedStyle(el).cursor !== 'pointer') continue;
      const par = el.parentElement;
      if (par && win.getComputedStyle(par).cursor === 'pointer') continue;
      set.add(el);
    }

    const rows = [];
    for (const el of set) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered
      rows.push({
        el: path(el),
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32),
        w: round(r.width),
        h: round(r.height),
        min: round(Math.min(r.width, r.height)),
        area: round(r.width * r.height),
        via: explicit.has(el) ? 'selector' : 'cursor:pointer',
      });
    }

    const under = rows.filter((r) => r.min < 44).sort((a, b) => a.area - b.area);
    return {
      total: rows.length,
      under44: under.length,
      // Both dimensions kept, sorted by area: a 40x120 sort header and a 20x20
      // remove button both trip "under 44 in either dimension" and only one of
      // them is a defect.
      worst: under.slice(0, 25),
    };
  }

  /* ------------------------------------------------- (c) rendered font size */

  function tinyText(win, doc) {
    const found = [];

    for (const el of doc.querySelectorAll('*')) {
      const direct = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      if (!direct) continue;

      const cs = win.getComputedStyle(el);
      const declared = parseFloat(cs.fontSize);
      if (!declared) continue;

      // The item 16 case: text inside an SVG scales with the viewBox, so the
      // declared size is not the rendered size. getScreenCTM().a is the true
      // horizontal scale at the point of rendering.
      let scale = 1;
      if (el.ownerSVGElement || el.tagName.toLowerCase() === 'svg') {
        try {
          const m = el.getScreenCTM();
          if (m) scale = m.a;
        } catch {
          /* not rendered */
        }
      } else {
        /*
         * An HTML ancestor with `transform: scale()` shrinks text the same way.
         *
         * **Detected from the transform chain, never from rect/offsetWidth.**
         * The first version divided `getBoundingClientRect().width` (fractional)
         * by `offsetWidth` (integer), which on a 34px element reads as a 3%
         * shrink from rounding alone — 75 false positives per page, at every
         * width including 1440 where nothing is scaled at all. A ratio of two
         * differently-rounded measurements is not a scale factor.
         */
        for (let a = el; a; a = a.parentElement) {
          const t = win.getComputedStyle(a).transform;
          if (t && t !== 'none') {
            const m = new win.DOMMatrixReadOnly(t);
            scale *= m.a;
          }
        }
      }

      const rendered = declared * scale;
      if (rendered < 11) {
        found.push({
          el: path(el),
          text: el.textContent.trim().slice(0, 24),
          declared: round(declared),
          scale: round(scale),
          rendered: round(rendered),
          /*
           * **The two populations are different problems and must not be summed.**
           *
           * `shrunk` is item 16's hazard: text rendering SMALLER than it was
           * written, because it scaled with a viewBox or a transform. Nothing
           * in the source says 7.3px; the drawing invented it. That is a defect
           * wherever it appears.
           *
           * Everything else is text the app deliberately declares below 11px —
           * `text-[9.5px]` section labels, `text-[10px]` club codes — which is a
           * design choice made at every width, not a narrow-viewport finding.
           * Roughly 70 per page, so summing the two buries the one that matters.
           */
          shrunk: scale < 0.99,
        });
      }
    }
    return found.sort((a, b) => a.rendered - b.rendered);
  }

  /* ----------------------------------- (c-bis) the sticky resolution map */

  /**
   * What each sticky element ACTUALLY resolves against.
   *
   * Not assumed from the page's scrollport: `overflow-x: auto` computes the
   * other axis to `auto` (the rule item 10 was bitten by), so a table's own pane
   * may already be the containing scroll context. Item 22's shell change only
   * touches the tables whose nearest scroll container is `<main>`.
   *
   * `overflow: hidden` DOES create a scroll container (scrollable, just without
   * scrollbars). `overflow: clip` does not — noted, and neither appears here today.
   */
  function stickyMap(win, doc) {
    const groups = new Map();

    for (const el of doc.querySelectorAll('*')) {
      const cs = win.getComputedStyle(el);
      if (cs.position !== 'sticky') continue;

      let ctx = null;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = win.getComputedStyle(p);
        if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
          ctx = p;
          break;
        }
      }

      const ctxLabel = ctx ? path(ctx) : 'viewport (no scroll-container ancestor)';
      const ctxOverflow = ctx
        ? `${win.getComputedStyle(ctx).overflowX}/${win.getComputedStyle(ctx).overflowY}`
        : '—';
      const key = `${el.tagName.toLowerCase()} top:${cs.top} left:${cs.left} -> ${ctxLabel}`;

      if (!groups.has(key)) {
        const r = el.getBoundingClientRect();
        groups.set(key, {
          tag: el.tagName.toLowerCase(),
          top: cs.top,
          left: cs.left,
          context: ctxLabel,
          contextOverflow: ctxOverflow,
          example: path(el),
          exampleText: (el.textContent || '').trim().slice(0, 20),
          width: round(r.width),
          count: 0,
        });
      }
      groups.get(key).count++;
    }
    return Array.from(groups.values()).sort((a, b) => b.count - a.count);
  }

  /* ------------------------------------------------- (d) the pinned budget */

  function pinned(win, doc, viewportW) {
    const out = [];
    doc.querySelectorAll('table').forEach((t, ti) => {
      const cells = [];
      for (const c of t.querySelectorAll('th, td')) {
        const cs = win.getComputedStyle(c);
        if (cs.position !== 'sticky' || cs.left === 'auto') continue;
        const r = c.getBoundingClientRect();
        const label = (c.textContent || '').trim().slice(0, 12);
        const key = `${cs.left}|${round(r.width)}`;
        if (cells.some((x) => x.key === key)) continue;
        cells.push({
          key,
          left: cs.left,
          label,
          width: round(r.width),
          pctOfViewport: round((r.width / viewportW) * 100),
        });
      }
      if (cells.length === 0) return;
      const total = cells.reduce((s, c) => s + c.width, 0);
      out.push({
        table: `table[${ti}]`,
        cols: t.querySelectorAll('thead th').length,
        tableWidth: round(t.getBoundingClientRect().width),
        pinnedCells: cells.map(({ key, ...rest }) => rest),
        pinnedTotal: round(total),
        pinnedPctOfViewport: round((total / viewportW) * 100),
      });
    });
    return out;
  }

  /* ------------------------------------------------------------ one cell */

  const READY = {
    dashboard: (d) => d.querySelectorAll('table tbody tr').length > 0 || d.body.textContent.includes('No matches'),
    players: (d) => d.querySelectorAll('table tbody tr').length > 0,
    fixtures: (d) => !d.body.textContent.includes('Loading fixtures'),
    comparison: (d) => !d.body.textContent.includes('Loading axis scales'),
  };

  async function cell({ page = 'players', season = '2025-26', w = 380, h = 740, after, label }) {
    const ctx = await frame({
      w,
      h,
      prep: () => {
        localStorage.setItem('fpl-page', page);
        localStorage.setItem('fpl-season', season);
      },
      ready: READY[page],
    });
    if (after) {
      await after(ctx.doc, ctx.win);
      await sleep(250);
    }

    const { win, doc } = ctx;
    return {
      cell: label || `${page} @ ${w}x${h} · ${season}`,
      viewport: { w, h, innerWidth: win.innerWidth, innerHeight: win.innerHeight },
      overflow: overflow(win, doc, w),
      targets: targets(win, doc),
      tinyText: tinyText(win, doc),
      sticky: stickyMap(win, doc),
      pinned: pinned(win, doc, w),
    };
  }

  /* ------------------------------------------- the truncation distribution */

  /**
   * How many player names a narrower pinned column would cut.
   *
   * Measured with the cell's OWN computed font — read off a rendered cell rather
   * than written from the class list, since `font-family` resolves through a
   * webfont that may or may not have loaded.
   */
  async function names(season = '2025-26', widths = [176, 144, 128, 112, 96]) {
    const ctx = await frame({
      w: 1440,
      h: 900,
      prep: () => {
        localStorage.setItem('fpl-page', 'players');
        localStorage.setItem('fpl-season', season);
      },
      ready: (d) => d.querySelectorAll('table tbody tr').length > 10,
    });

    // The button carrying the name, inside the pinned cell.
    const sample = ctx.doc.querySelector('table tbody tr td button');
    const cs = ctx.win.getComputedStyle(sample);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

    // The cell's horizontal padding, and the disclosure caret's own box: both
    // eat into the width a name can use.
    const cellCs = ctx.win.getComputedStyle(sample.closest('td'));
    const padding = parseFloat(cellCs.paddingLeft) + parseFloat(cellCs.paddingRight);
    const caret = sample.querySelector('span[aria-hidden]');
    const caretW = caret ? caret.getBoundingClientRect().width : 0;
    const gap = parseFloat(ctx.win.getComputedStyle(sample).gap) || 0;
    const chrome = round(padding + caretW + gap);

    const res = await fetch(`/api/bootstrap?season=${season}`);
    const data = await res.json();
    const namesList = data.players.map((p) => p.web_name);

    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    g.font = font;

    const measured = namesList
      .map((n) => ({ name: n, px: round(g.measureText(n).width) }))
      .sort((a, b) => b.px - a.px);

    const dist = widths.map((w) => {
      const budget = w - chrome;
      const cut = measured.filter((m) => m.px > budget);
      return {
        columnWidth: w,
        textBudget: round(budget),
        truncated: cut.length,
        pct: round((cut.length / measured.length) * 100),
        longestCut: cut.slice(0, 5).map((m) => `${m.name} (${m.px}px)`),
      };
    });

    destroyFrame();
    return {
      season,
      players: measured.length,
      font,
      cellChrome: { padding, caretW: round(caretW), gap, total: chrome },
      widest: measured.slice(0, 10),
      distribution: dist,
    };
  }

  /* ------------------------------------------------------- the perf baseline */

  /**
   * Players mount, re-sort, and how many chunks a scroll to the bottom pulls.
   *
   * `MutationObserver`, never `requestAnimationFrame`: Chrome throttles rAF to
   * zero in a hidden tab, and every "the renderer is frozen" reading during item
   * 18 was that artifact rather than the app. Keep the tab FOREGROUNDED.
   */
  async function perf(w = 380, h = 740, season = '2023-24') {
    if (document.visibilityState !== 'visible') {
      throw new Error('tab is hidden — rAF and setTimeout are throttled, every number would be an artifact');
    }

    const t0 = performance.now();
    const ctx = await frame({
      w,
      h,
      prep: () => {
        localStorage.setItem('fpl-page', 'players');
        localStorage.setItem('fpl-season', season);
      },
      ready: (d) => d.querySelectorAll('table tbody tr').length > 10,
    });
    const mount = round(performance.now() - t0);

    const { win, doc } = ctx;
    const tbody = doc.querySelector('table tbody');

    // Re-sort: click a sortable header, wait for the rows to be replaced.
    const settle = (fire) =>
      new Promise((resolve) => {
        const start = performance.now();
        let last = start;
        const mo = new MutationObserver(() => {
          last = performance.now();
        });
        mo.observe(tbody, { childList: true, subtree: true });
        fire();
        const poll = setInterval(() => {
          if (performance.now() - last > 250 && last > start) {
            clearInterval(poll);
            mo.disconnect();
            resolve(round(last - start));
          }
        }, 20);
      });

    const headers = doc.querySelectorAll('table thead th button');
    const sortTarget = headers[headers.length - 1] || headers[0];
    const resort = await settle(() => sortTarget.click());

    // Chunk growth: scroll to the bottom repeatedly and count how many times the
    // rendered row count increases. rootMargin is 600px against a viewport this
    // tall, which is the number decision 3 turns on.
    const before = tbody.querySelectorAll('tr').length;
    const steps = [];
    const main = doc.querySelector('main');
    const scroller = win.getComputedStyle(main).overflowY === 'auto' ? main : doc.scrollingElement;
    for (let i = 0; i < 12; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(400);
      const n = tbody.querySelectorAll('tr').length;
      steps.push(n);
      if (steps.length > 1 && n === steps[steps.length - 2]) break;
    }

    const total = doc.body.textContent.match(/of (\d+) · scroll/);
    destroyFrame();
    return {
      viewport: { w, h },
      season,
      mountMs: mount,
      resortMs: resort,
      sortedColumn: (sortTarget.textContent || '').trim(),
      rowsAfterMount: before,
      chunkGrowth: steps,
      rosterHint: total ? Number(total[1]) : null,
      note: 'unthrottled unless CDP CPU throttling was applied out of band; tab foregrounded',
    };
  }

  return { preflight, cell, names, perf, frame, destroyFrame, waitFor, sleep };
})();
'__VPAUDIT ready';

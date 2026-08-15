/*
 * Item 23's measurement instrument: the theme following a REAL device change.
 *
 * NOT app code, not imported by anything, and deliberately NOT part of `npm
 * test` — it needs Chrome, an open debugging port and a running dev server, none
 * of which the suite has. Run it by hand after touching the theme.
 *
 * Usage:
 *   # 1. dev server
 *   cd client && npx vite --port 5199
 *
 *   # 2. Chrome with a debugging port, on a throwaway profile
 *   google-chrome --headless=new --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/theme-check-profile --no-first-run --disable-gpu about:blank
 *
 *   # 3. this file
 *   node scripts/theme-emulation-check.mjs
 *
 * Exit 0 all pass, 1 an assertion failed, 2 INSTRUMENT FAULT (see below).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: what the client suite structurally cannot reach
 *
 * `App.theme.test.tsx` dispatches a synthetic `change` on the suite's own
 * `matchMedia` stub. That pins the HANDLER WIRING — a listener is attached and
 * behaves when called — and says nothing about whether a real `MediaQueryList`
 * emits. The production first-visit check proved `THEME_QUERY` MATCHES AT LOAD,
 * which is a third property again. Item 23 collapsed all three into the stub
 * test once; this file is the correction, so do not let it happen again.
 *
 * ---------------------------------------------------------------------------
 * WHAT `Emulation.setEmulatedMedia` ACTUALLY REACHES, AND WHAT IT DOES NOT
 *
 * It is the exact CDP method DevTools' Rendering panel calls for "Emulate CSS
 * prefers-color-scheme". The renderer re-evaluates the media query and
 * dispatches REAL `change` events on REAL `MediaQueryList` objects. That is the
 * layer the app touches, so it is the layer worth checking.
 *
 * It does NOT exercise the OS-to-browser link — how Chrome learns the desktop
 * changed appearance. That is Chrome's own code and is correctly out of scope:
 * this project does not test its browser. Recorded explicitly so a later session
 * reads the emulation as the right instrument for the app's layer, rather than
 * as a shortcut somebody settled for because flipping the real OS was awkward.
 *
 * ---------------------------------------------------------------------------
 * THE BASELINE TRAP — a finding, not a step
 *
 * Headless Chrome INHERITS THE HOST MACHINE'S OS APPEARANCE. On a dark machine
 * the page therefore starts dark, so an opening `emulate('dark')` changes
 * nothing, dispatches nothing, and the event count comes up one short of the
 * number of flips issued.
 *
 * That is exactly how this was discovered: the first run counted 1 event across
 * two flips and the gate stopped it. The count was RIGHT and the expectation was
 * wrong. So `preflight()` forces a known LIGHT baseline before counting
 * anything, and every later flip is a genuine transition.
 *
 * The consequence worth keeping: the event count is the instrument's own health
 * check, not a formality. If it ever reads low again, suspect the baseline and
 * the host's appearance setting BEFORE suspecting the app — a run whose flips
 * silently do nothing would otherwise report a theme that "correctly did not
 * change" for every assertion in the file.
 *
 * ---------------------------------------------------------------------------
 * THE TWO GUARDS, AND WHY EACH IS THERE
 *
 * 1. A LOAD TOKEN stamped on `window` and re-read with every observation. The
 *    requirement is that the theme follows WITHOUT A RELOAD, and a reload would
 *    reproduce every expected value from `localStorage` and the media query
 *    while proving nothing about the listener. If the token moves, the run is
 *    void rather than passing.
 *
 * 2. An INDEPENDENT listener on the real `MediaQueryList`, separate from the
 *    app's own, counting events. This is what stops the explicit-Light leg being
 *    vacuous: "the theme did not follow the device" is satisfied just as well by
 *    a device that never moved. The count going 4 -> 6 across that leg is the
 *    evidence that the stimulus was actually delivered and declined. Assert the
 *    count MOVED; never just assert the theme did not.
 */

const CDP = process.env.THEME_CHECK_CDP ?? 'http://localhost:9222';
const APP = process.env.THEME_CHECK_APP ?? 'http://localhost:5199/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ connection */

async function connect() {
  let list;
  try {
    list = await fetch(`${CDP}/json/list`).then((r) => r.json());
  } catch {
    throw new Error(
      `no CDP endpoint at ${CDP} — start Chrome with --remote-debugging-port (see the usage block)`
    );
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; open a tab in the debugged Chrome');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('could not open the CDP websocket'));
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression);
    return r.result.value;
  };

  return { ws, send, evaluate };
}

/* ---------------------------------------------------------------- harness */

const results = [];
function check(label, cond, detail) {
  results.push({ label, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
}

async function main() {
  const { ws, send, evaluate } = await connect();

  /** The Rendering panel's colour-scheme control, as a method call. */
  const emulate = (scheme) =>
    send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });

  await send('Page.enable');
  await send('Runtime.enable');

  // Open the app with the mode set to `system`.
  await send('Page.navigate', { url: APP });
  await sleep(1500);
  await evaluate(`localStorage.setItem('fpl-theme', 'system')`);
  await send('Page.navigate', { url: APP });
  await sleep(2000);

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('[aria-label="Theme"]')`)) break;
    await sleep(250);
  }
  if (!(await evaluate(`!!document.querySelector('[aria-label="Theme"]')`))) {
    throw new Error(`the theme control never rendered — is the dev server up at ${APP}?`);
  }

  // The forced baseline. See THE BASELINE TRAP above: without it, the first
  // flip on a dark host is a silent no-op and every count below is off by one.
  await emulate('light');
  await sleep(400);

  await evaluate(`window.__loadToken = 'tok-' + Math.random();
    window.__realMqlEvents = 0;
    window.__mql = window.matchMedia('(prefers-color-scheme: dark)');
    window.__mql.addEventListener('change', () => { window.__realMqlEvents++; });
    window.__loadToken`);
  const token = await evaluate(`window.__loadToken`);

  const state = () =>
    evaluate(`(() => {
      const seg = [...document.querySelectorAll('[aria-label="Theme"] button')];
      return {
        token: window.__loadToken,
        realMqlEvents: window.__realMqlEvents,
        matchMediaNow: matchMedia('(prefers-color-scheme: dark)').matches,
        htmlClass: document.documentElement.className,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        systemSuffix: seg.find(b => b.textContent.startsWith('System'))?.textContent,
        pressed: seg.find(b => b.getAttribute('aria-pressed') === 'true')?.textContent,
      };
    })()`);

  /* ------------------------------------------------------------ preflight */

  console.log('\n--- instrument gate -------------------------------------------');

  await emulate('dark');
  await sleep(400);
  const gDark = await state();
  await emulate('light');
  await sleep(400);
  const gLight = await state();

  check(
    'setEmulatedMedia actually moves a real media query',
    gDark.matchMediaNow === true && gLight.matchMediaNow === false,
    `matchMedia under dark=${gDark.matchMediaNow}, under light=${gLight.matchMediaNow}`
  );
  check(
    'a REAL MediaQueryList emits change (independent listener)',
    gLight.realMqlEvents >= 2,
    `independent listener fired ${gLight.realMqlEvents}x across two flips ` +
      `(low here means the baseline did not take — see THE BASELINE TRAP)`
  );

  if (!results.every((r) => r.pass)) {
    console.log('\nINSTRUMENT FAULT — every assertion below would be meaningless. Stopping.');
    ws.close();
    process.exit(2);
  }

  /* --------------------------------------------- 1. System follows, live */

  console.log('\n--- System: the app must follow, with no reload ---------------');

  await emulate('dark');
  await sleep(500);
  const sysDark = await state();
  await emulate('light');
  await sleep(500);
  const sysLight = await state();

  check(
    'mode is System for this leg',
    sysDark.pressed?.startsWith('System') && sysLight.pressed?.startsWith('System'),
    `pressed: ${sysDark.pressed} / ${sysLight.pressed}`
  );
  check(
    'applied theme follows the device',
    sysDark.htmlClass === 'dark' && sysLight.htmlClass === '',
    `class under dark="${sysDark.htmlClass}" (cs=${sysDark.colorScheme}, bg=${sysDark.bodyBg}) | ` +
      `under light="${sysLight.htmlClass}" (cs=${sysLight.colorScheme}, bg=${sysLight.bodyBg})`
  );
  check(
    'the third segment suffix follows',
    sysDark.systemSuffix === 'System · Dark' && sysLight.systemSuffix === 'System · Light',
    `"${sysDark.systemSuffix}" -> "${sysLight.systemSuffix}"`
  );
  check(
    'no reload happened',
    sysDark.token === token && sysLight.token === token,
    `load token stable: ${token}`
  );

  /* ------------------------------------- 2. Explicit Light must not move */

  console.log('\n--- Explicit Light: nothing may move --------------------------');

  await evaluate(`[...document.querySelectorAll('[aria-label="Theme"] button')]
    .find(b => b.textContent === 'Light').click()`);
  await sleep(500);
  const beforeFlip = await state();
  const stored = await evaluate(`localStorage.getItem('fpl-theme')`);

  await emulate('dark');
  await sleep(600);
  const afterDark = await state();
  await emulate('light');
  await sleep(600);
  const afterLight = await state();

  check(
    'an explicit Light is selected and stored',
    beforeFlip.pressed === 'Light' && stored === 'light',
    `pressed=${beforeFlip.pressed}, stored=${stored}`
  );
  check(
    'the applied theme does NOT follow the device',
    afterDark.htmlClass === '' && afterLight.htmlClass === '',
    `class stayed "${afterDark.htmlClass}" while the device went dark ` +
      `(device dark=${afterDark.matchMediaNow}), bg=${afterDark.bodyBg}`
  );
  check(
    'the device really did flip during this leg',
    afterDark.matchMediaNow === true &&
      afterLight.matchMediaNow === false &&
      afterLight.realMqlEvents > beforeFlip.realMqlEvents,
    `events ${beforeFlip.realMqlEvents} -> ${afterLight.realMqlEvents}; ` +
      `this is what stops the assertion above passing on an absence of stimulus`
  );
  check(
    'the suffix still tracks the device under an explicit pick',
    afterDark.systemSuffix === 'System · Dark' && afterLight.systemSuffix === 'System · Light',
    `"${afterDark.systemSuffix}" -> "${afterLight.systemSuffix}" — the subscription is ` +
      `unconditional by design, so this keeps moving`
  );
  check(
    'still no reload',
    afterDark.token === token && afterLight.token === token,
    `load token stable: ${token}`
  );

  console.log('\n===============================================================');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  ws.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\n' + e.message);
  process.exit(2);
});

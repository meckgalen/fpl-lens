/**
 * A controllable `window.matchMedia`, because jsdom has none.
 *
 * Measured rather than assumed: on this repo's jsdom (29.1.1)
 * `typeof window.matchMedia` is `undefined`, and Vitest adds no polyfill — its
 * jsdom environment copies `matchMedia` from the jsdom window only *if it is
 * there*. So this is not a convenience for the theme tests. `App.test.tsx`
 * mounts the whole `<App />` fourteen times and `App` reads the media query in a
 * lazy initialiser, so without this every one of those tests throws
 * `TypeError: window.matchMedia is not a function`.
 *
 * Installed once from `setup.ts` and reset between tests from there too.
 *
 * `matches` is a **getter, not a snapshot**. `App` calls `matchMedia` once and
 * holds the resulting object across a device flip, so a frozen boolean would let
 * the follow-the-device test pass while reading a value that never moved — the
 * test would be green for the wrong reason, which is the failure this project
 * keeps refusing to ship.
 */

type Listener = (event: MediaQueryListEvent) => void;

let prefersDark = false;
const listeners = new Set<Listener>();

/** Flip the device preference and notify every live listener, as a real
 *  `change` event would. Returns nothing: the assertion is on what the app did. */
export function setPrefersDark(value: boolean): void {
  prefersDark = value;
  const event = { matches: value, media: '' } as MediaQueryListEvent;
  for (const listener of [...listeners]) listener(event);
}

/**
 * How many listeners are currently attached.
 *
 * Exported so unsubscription can be asserted **as the property it is** — that no
 * listener remains — rather than through a spy on `removeEventListener`, which
 * would go green if the app removed some other listener, or the right listener
 * from the wrong object.
 */
export function listenerCount(): number {
  return listeners.size;
}

/** Back to the default: device light, nothing subscribed. */
export function resetMatchMedia(): void {
  prefersDark = false;
  listeners.clear();
}

export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return prefersDark;
    },
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'change') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      if (type === 'change') listeners.delete(listener);
    },
    // The pre-standard pair. Nothing in this app calls them, but a stub that
    // omits them is a stub that lies about the interface it is standing in for.
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

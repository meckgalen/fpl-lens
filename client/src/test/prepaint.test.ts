import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readStoredMode, resolveTheme } from '../lib/theme';
import type { ThemeMode } from '../lib/theme';

/**
 * The pre-paint script in `index.html` against the rule in `lib/theme.ts`.
 *
 * They are two implementations of one rule and the duplication is unavoidable —
 * a script that must run before any module loads cannot import from a module.
 * What is avoidable is the duplication drifting silently, which a comment on
 * each side does not prevent: nothing fails when only one of them is edited.
 *
 * **The script is extracted from the shipped `index.html` at run time and never
 * pasted here.** A pasted copy would pin the copy, so the real script could be
 * changed freely with this suite still green — the test would be measuring
 * itself. The mutation that proves the extraction is live is to change the rule
 * *inside `index.html`* and watch this go red.
 */

/**
 * Resolved from the Vitest root, which is `client/` — `test:client` is
 * `cd client && npm test`, and the config lives there. Not from
 * `import.meta.url`: Vitest's transform does not leave that a `file:` URL, so
 * `fileURLToPath` throws on it. Existence is asserted below rather than assumed,
 * because a path that silently misses would empty the script and take every
 * case with it.
 */
const HTML_PATH = resolve(process.cwd(), 'index.html');

/** The `<script>` body from the head, sliced out of the real file. */
function extractPrepaintScript(): string {
  const html = readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\})\)\(\);\s*<\/script>/);
  return match ? match[1] + ')();' : '';
}

const script = extractPrepaintScript();

/** One run of the script under fully controlled conditions. */
function runPrepaint(stored: string | null, prefersDark: boolean): { dark: boolean; threw: boolean } {
  const classes = new Set<string>();
  const sandbox = {
    localStorage: { getItem: (k: string) => (k === 'fpl-theme' ? stored : null) },
    window: { matchMedia: () => ({ matches: prefersDark }) },
    document: {
      documentElement: {
        classList: {
          toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        },
      },
    },
  };

  let threw = false;
  try {
    new Function(
      'localStorage',
      'window',
      'document',
      script
    )(sandbox.localStorage, sandbox.window, sandbox.document);
  } catch {
    threw = true;
  }
  return { dark: classes.has('dark'), threw };
}

describe('the pre-paint script', () => {
  /**
   * Asserted before any case runs, and this is not ceremony.
   *
   * A regex that stops matching — the script is reformatted, the IIFE is
   * rewritten, the tag gains an attribute — would make `script` the empty
   * string. Every case below would then run nothing, apply no class, and the
   * suite would report a row of passes for a file it never read. That is the
   * same vacuous-truth failure item 20 measured one layer up: a check whose
   * premise expires degrades into passing on nothing.
   */
  beforeAll(() => {
    expect(existsSync(HTML_PATH), `no index.html at ${HTML_PATH}`).toBe(true);
    expect(script).not.toBe('');
    expect(script).toContain('fpl-theme');
    expect(script).toContain('prefers-color-scheme: dark');
  });

  /**
   * Eight cases: four stored readings against both device states.
   *
   * `null` is its own branch and its own row rather than a variation on the
   * others — it is the first visit, the one case where the default decides
   * everything and the only one no existing user can produce.
   */
  const stored: (string | null)[] = [null, 'light', 'dark', 'system'];

  for (const raw of stored) {
    for (const prefersDark of [true, false]) {
      it(`agrees with resolveTheme for ${JSON.stringify(raw)} on a ${
        prefersDark ? 'dark' : 'light'
      } device`, () => {
        const expected = resolveTheme(readStoredMode(raw), prefersDark) === 'dark';
        const actual = runPrepaint(raw, prefersDark);
        expect(actual.threw).toBe(false);
        expect(actual.dark).toBe(expected);
      });
    }
  }

  /**
   * The ninth case. An unrecognised stored value must fall back, not throw.
   *
   * Asserted on the class it applies rather than merely on not throwing,
   * because the script has a catch-all: a "did not throw" assertion alone would
   * pass even if the rule inside were broken, since the catch would swallow it
   * and the page would silently get no class. Checking the resulting class is
   * what makes the catch unable to hide a failure.
   */
  it('falls back to the device for an unrecognised stored value', () => {
    for (const raw of ['auto', 'Dark', '', '{"mode":"dark"}']) {
      for (const prefersDark of [true, false]) {
        const actual = runPrepaint(raw, prefersDark);
        expect(actual.threw).toBe(false);
        // Same answer as a first visit: unrecognised reads as `system`.
        expect(actual.dark).toBe(prefersDark);
        expect(actual.dark).toBe(resolveTheme(readStoredMode(raw), prefersDark) === 'dark');
      }
    }
  });

  /**
   * The script writes the class and nothing else. `color-scheme` is carried by
   * `:root.dark` in the stylesheet, so an inline style here would be a third
   * copy of the rule and would outrank the stylesheet forever.
   */
  it('applies only the class, leaving color-scheme to CSS', () => {
    // Note this cannot assert on the string `color-scheme:` — the media query
    // the script READS contains it. What must be absent is any attempt to SET
    // it, which means touching `style` at all.
    expect(script).not.toContain('colorScheme');
    expect(script).not.toMatch(/\.style\b/);
  });

  /** Every mode the app can persist is one the script understands. */
  it('handles every ThemeMode the app can store', () => {
    const modes: ThemeMode[] = ['light', 'dark', 'system'];
    for (const mode of modes) expect(script).toContain(`'${mode}'`);
  });
});

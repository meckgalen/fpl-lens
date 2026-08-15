import { describe, expect, it } from 'vitest';
import { readStoredMode, resolveTheme } from './theme';
import type { ThemeMode } from './theme';

/**
 * The resolution rule, away from React.
 *
 * It is two expressions and would be covered incidentally by `App.theme.test.tsx`,
 * which is not the same as being tested. The property that matters is the one a
 * component test can only reach through a device flip and a re-render: that
 * `prefersDark` is consulted under `'system'` **and nowhere else**. Asserting it
 * here is a direct read of the branch.
 */

describe('readStoredMode', () => {
  it('defaults to system when nothing is stored', () => {
    // The whole of requirement 4's first half. A first visit has no key, and
    // `null` must not read as light — that was the old two-mode behaviour and
    // it is what made the device unreachable.
    expect(readStoredMode(null)).toBe('system');
  });

  it('passes the two old values through, so there is no migration', () => {
    // Every user of the previous toggle has one of these stored. They keep
    // meaning what they meant, which is why nothing has to rewrite the key.
    expect(readStoredMode('light')).toBe('light');
    expect(readStoredMode('dark')).toBe('dark');
  });

  it('reads system as system', () => {
    expect(readStoredMode('system')).toBe('system');
  });

  it('falls back rather than throwing on anything unrecognised', () => {
    // Structural, not a caught exception. The pre-paint copy of this rule runs
    // before anything exists to catch, and a throw there leaves the document
    // with no class at all — a page stuck light with nothing in the console
    // that anyone would think to look at.
    for (const raw of ['', 'Dark', 'auto', 'system ', '{"mode":"dark"}', '0']) {
      expect(readStoredMode(raw)).toBe('system');
    }
  });
});

describe('resolveTheme', () => {
  it('follows the device under system, both ways', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  /**
   * The load-bearing direction, and the one that can only fail one way.
   *
   * An implementation that ignored `mode` and always returned the device's
   * answer agrees with the test above on both rows. It is *this* pair that
   * separates them, so it has to be exercised explicitly rather than trusted to
   * fall out of the happy path.
   */
  it('ignores the device under an explicit mode', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('never returns system', () => {
    // The type says so; this pins that the runtime agrees, because `system` is
    // the one value that must not reach `classList.toggle` or a `color-scheme`.
    const modes: ThemeMode[] = ['light', 'dark', 'system'];
    for (const mode of modes) {
      for (const prefersDark of [true, false]) {
        expect(['light', 'dark']).toContain(resolveTheme(mode, prefersDark));
      }
    }
  });
});

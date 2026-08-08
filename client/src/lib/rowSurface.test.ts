import { describe, expect, it } from 'vitest';
import { ROW_STRIPE, hoverInert, striped } from './rowSurface';

/**
 * The two parity helpers, on their own.
 *
 * They are three lines each and would be covered incidentally by the three table
 * suites, which is not the same as being tested: the property that matters is the one
 * those suites cannot see, that the answer comes from **the data's index** and not
 * from the row's position in the DOM. Every table in this app can render an expansion
 * row as a sibling `<tr>` in the same `<tbody>`, so DOM position and data index come
 * apart the moment anything is open — and a `nth-child` implementation would pass an
 * all-collapsed test in every one of those files.
 */

describe('striped', () => {
  it('alternates from the data index, starting unstriped', () => {
    expect([0, 1, 2, 3, 4].map(striped)).toEqual([
      '',
      ROW_STRIPE,
      '',
      ROW_STRIPE,
      '',
    ]);
  });

  it('sets --row-bg rather than a background, so a pinned cell can read it', () => {
    // The pinned cells paint `var(--row-bg)`. A stripe that set `background` here
    // would tint the row and leave the pinned column holding its own colour, which
    // is the seam this whole indirection exists to remove.
    expect(ROW_STRIPE).toContain('--row-bg');
    expect(ROW_STRIPE).not.toMatch(/(^|\s)bg-/);
  });
});

describe('hoverInert', () => {
  /**
   * The pairing with `striped` is the point. An expansion panel cancels the row
   * hover, and it has to cancel to **its own** surface: cancelling to the default row
   * colour would make hovering an open striped season step it back to plain, which
   * looks exactly like the stripe being lost.
   */
  it('cancels to the same surface the stripe set, index for index', () => {
    for (const i of [0, 1, 2, 3]) {
      const stripe = striped(i);
      const cancel = hoverInert(i);
      expect(cancel.startsWith('hover:')).toBe(true);
      // The surface named after `hover:` is the one the row already has: the
      // stripe's own value when striped, the default when not.
      expect(cancel).toBe(`hover:${stripe || '[--row-bg:hsl(var(--row))]'}`);
    }
  });

  /**
   * **Both branches must exist as whole literal strings in the source.** Tailwind's
   * scanner reads raw file text, so a variant assembled at runtime is a token that
   * appears nowhere, no rule is generated, and the class lands in the DOM doing
   * nothing. This asserts the shape a literal has — a `hover:` prefix directly on an
   * arbitrary property — which is what `hover:${ROW_STRIPE}` would also produce at
   * runtime, so it is not proof on its own. The file it reads from is: `hoverInert`
   * spells both out and this is the reminder of why.
   */
  it('produces a variant fused to its property, not a bare property', () => {
    expect(hoverInert(1)).toBe('hover:[--row-bg:hsl(var(--row-alt))]');
    expect(hoverInert(0)).toBe('hover:[--row-bg:hsl(var(--row))]');
  });
});

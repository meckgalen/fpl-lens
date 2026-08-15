import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { installMatchMedia, resetMatchMedia } from './matchMedia';

/**
 * jsdom implements no `matchMedia` at all, so this has to be installed before
 * any component mounts — `App` reads the media query in a lazy initialiser, and
 * an unstubbed call throws before a single assertion runs. See `matchMedia.ts`
 * for the measurement behind that claim.
 */
installMatchMedia();

/**
 * Unmount between tests, explicitly.
 *
 * React Testing Library registers its own cleanup only when Vitest's `globals`
 * are on. They are not: the tests import `describe`, `it` and `expect` from
 * `vitest` by name, so `tsc --noEmit` type-checks them like any other import
 * rather than trusting an ambient declaration. The cost of that choice is this
 * line, and the cost of forgetting this line is two mounted copies of a
 * component and a `getBy*` that fails on "found multiple elements".
 */
afterEach(cleanup);

/**
 * The theme lands on `<html>`, which `cleanup` does not touch — it unmounts the
 * container and nothing else. A test that resolves dark would otherwise leave
 * `.dark` on the document for every test after it in the file, and the next
 * assertion that the class is *absent* would fail for a reason belonging to a
 * different test. Cleared here rather than in the theme suite because the
 * document is shared by every suite, not just that one.
 */
afterEach(() => {
  document.documentElement.classList.remove('dark');
  resetMatchMedia();
});

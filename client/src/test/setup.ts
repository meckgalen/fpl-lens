import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

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

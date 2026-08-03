import { defineConfig } from 'vitest/config';

/**
 * The client suite: components in jsdom, with the API mocked.
 *
 * Separate from `vite.config.ts` on purpose. That file describes how the app is
 * built and served, and a testing change has no business moving it — the dev
 * proxy to :3001 in particular is the opposite of what happens here, where
 * nothing reaches the network at all.
 *
 * This suite is Vitest; the server suite is `node --import tsx --test` against a
 * real Postgres. Two runners, deliberately: the server one was already there and
 * works, and unifying them would be a tooling change dressed as a testing one.
 * `npm test` at the root runs both.
 */
/**
 * No `@vitejs/plugin-react`. Its two jobs are Fast Refresh, which no test wants,
 * and the JSX transform, which Vite already does for `.tsx` by reading
 * `jsx: "react-jsx"` out of `tsconfig.json`. Including it also produced a page
 * of deprecation warnings on every run, because Vitest 4 carries its own newer
 * Vite than the app builds with — noise on a suite people are meant to read the
 * output of. `render.test.tsx` renders JSX and would fail immediately if this
 * were wrong.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    /**
     * Call history is cleared between tests, declared here rather than as a
     * `beforeEach` in whichever file first needs it.
     *
     * `PlayerDetail.test.tsx` asserts how many times a season was fetched, and
     * `vi.fn()` accumulates across every test in a file. Without this the second
     * test to touch a season fails with a count one too high — and the obvious
     * fix from inside that test is to expect the higher number, which quietly
     * deletes the assertion. Implementations set per test in a `beforeEach`
     * survive; only the recorded calls are cleared.
     */
    clearMocks: true,
  },
});

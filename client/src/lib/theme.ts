/**
 * The theme rule: three modes, one resolution, one place.
 *
 * The app has a `light`/`dark`/`system` choice, and the distinction this module
 * exists to hold is that **the choice and its result are different objects**.
 * `system` is a standing instruction to follow the device; `dark` is a decision.
 * Collapse them — persist what `system` resolved to rather than `system` itself —
 * and the instruction becomes indistinguishable from the decision, so the app
 * stops tracking the device from the next reload onwards with nothing on screen
 * saying it has.
 *
 * Everything here is pure. The media query is a `boolean` parameter rather than
 * a `matchMedia` call, so the rule is testable without a DOM and no component
 * has to compare a string to `'system'` for itself.
 *
 * **This rule is duplicated, deliberately and exactly once**, in the pre-paint
 * inline script in `client/index.html`. That script has to run before any module
 * is loaded and so cannot import from here. `src/test/prepaint.test.ts` extracts
 * it from the shipped HTML and asserts the two agree over every case; change one
 * side and it goes red.
 */

/** What the user chose. This is what is persisted. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** What is actually painted. `system` is never one of these. */
export type AppliedTheme = 'light' | 'dark';

/** The localStorage key. Unchanged from the two-mode toggle: `'light'` and
 *  `'dark'` written by it are still valid readings, so there is no migration. */
export const THEME_KEY = 'fpl-theme';

/** The one media query. Named so the app and its test stub cannot disagree. */
export const THEME_QUERY = '(prefers-color-scheme: dark)';

/** The segments, in the order they render. */
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/**
 * A stored string to a mode, defaulting to `'system'`.
 *
 * The default is what makes a first visit follow the device, and the fallback is
 * structural rather than a `try`/`catch`: anything unrecognised — a value from a
 * future version, a key another tool wrote, a truncated string — reads as
 * `'system'` instead of throwing. That matters most in the pre-paint copy of
 * this rule, which runs before anything could catch and where a throw would
 * leave the page with no class applied at all.
 */
export const readStoredMode = (raw: string | null): ThemeMode =>
  raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';

/**
 * The mode plus the device to the theme to paint.
 *
 * `prefersDark` is **only** consulted under `'system'`. An explicit mode ignores
 * it entirely, which is the half that makes an explicit pick stick while the
 * listener is still attached and the device is still flipping underneath it.
 */
export const resolveTheme = (mode: ThemeMode, prefersDark: boolean): AppliedTheme =>
  mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;

/**
 * What each segment reads.
 *
 * Here rather than in `App.tsx` for the reason `lib/rowSurface.ts` gives: Fast
 * Refresh only handles a module whose exports are all components, and this is
 * not one. It is also the only string work the control does, so keeping it out
 * of the component leaves that component rendering and nothing else.
 *
 * The `system` label carries the device's current answer, so a standing
 * instruction is distinguishable on screen from the two decisions. It names
 * where the device lands whichever segment is selected, because it describes
 * the device rather than the choice.
 */
export const THEME_LABELS: Record<ThemeMode, (prefersDark: boolean) => string> = {
  light: () => 'Light',
  dark: () => 'Dark',
  system: (prefersDark) => `System · ${prefersDark ? 'Dark' : 'Light'}`,
};

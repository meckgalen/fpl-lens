/**
 * Team codes whose club shirt has 404'd, so a club known to have none goes
 * straight to its badge instead of firing a request certain to fail.
 *
 * **What it buys is determinism, not a measured saving.** Nothing has ever been
 * run with this disabled, so no before/after number is claimed. Without it, the
 * number of failed requests depends on whether the browser caches a failure
 * carrying a 150-byte body and no cache headers — which is not a thing to rely
 * on in either direction.
 *
 * Observed on one cold 2016-17 render, 200 rows: **18 failed shirt requests**,
 * one pair per shirtless club, against 85 rows that end up showing a badge.
 * Nine clubs times two variants, and the times-two is data rather than
 * arithmetic — every club in that top 200 has both a goalkeeper and an outfield
 * player.
 *
 * Module-level and never invalidated, deliberately: team codes are permanent
 * and a club's shirt does not start existing mid-session, so the answer cannot
 * go stale within one. It survives season changes for the same reason.
 *
 * **What it cannot do is help the first observation of a club.** Both variants
 * of a club fire before either error returns, so only renders *after* that are
 * saved — scrolling, re-sorting, changing season and coming back.
 * `loading="lazy"` works with it rather than against it, since only in-viewport
 * rows fire on first paint and the set fills while the rest is below the fold.
 *
 * **It lives here rather than in `PlayerShirt.tsx` for a mechanical reason.**
 * React Fast Refresh only handles a module whose exports are all components, so
 * a `resetShirtCache` sitting beside the component turned every edit to that
 * file into a full page reload. Splitting it costs one file and is the better
 * seam anyway: this is module state with a lifetime of its own, not a rendering
 * concern.
 */
const shirtless = new Set<number>();

export function hasNoShirt(teamCode: number): boolean {
  return shirtless.has(teamCode);
}

export function recordMissingShirt(teamCode: number): void {
  shirtless.add(teamCode);
}

/**
 * Test seam. Module state is shared across a test file, so without clearing it
 * between cases the suite silently becomes order-dependent — the exact class of
 * quiet wrong answer the rest of this codebase is built to avoid. Picking
 * distinct team codes per test would hide the coupling rather than remove it.
 */
export function resetShirtCache(): void {
  shirtless.clear();
}

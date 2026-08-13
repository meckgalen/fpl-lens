/**
 * Where the Fixtures page opens, and on which view.
 *
 * **Not a component module**, for the Fast Refresh reason `playerColumns.ts`
 * gives. It is not in `lib/bootstrap.ts` either: that module's doc block
 * explicitly refuses fallback chains and names this page as the caller that
 * decides which round is worth showing. That refusal still stands — what
 * changed in item 18 is that the decision became a named, tested rule that runs
 * **once, to seed the selector**, instead of two expressions re-derived on every
 * render.
 */

import type { GameweekEvent } from '../types/fpl';

/** Which of the two views of a round is showing. */
export type FixturesTab = 'difficulty' | 'results';

export interface FixturesView {
  /** The round to open on, or undefined for a season with no rounds at all. */
  round: number | undefined;
  tab: FixturesTab;
}

/**
 * The round the page opens on, and the view that makes sense for it.
 *
 * **It must not be driven by `events[].finished`.** That field is
 * `bool_and(f.finished)` — true only when *every* fixture in the round is done —
 * so "the latest round with results" would skip a **partly played** round and
 * open on the previous one all Saturday afternoon, every week from GW1. No test
 * built from stored data can catch that: the ten CSV seasons are wholly complete
 * and 2026-27 is wholly empty, so a partly played round exists nowhere in the
 * database. It is covered by a hand-built events array instead.
 *
 * The signal without that weakness is the **deadline against the clock**, which
 * is API identity rule 6's `is_current`. This computes the comparison rather
 * than reading `is_current` off the payload: that flag is derived in SQL against
 * `now()` when the bootstrap was *served*, so it is a snapshot that goes stale
 * in a tab left open across a deadline. Compared here it is right at render time
 * and needs no refetch.
 *
 * Three branches:
 *
 *   1. **Some deadline has passed** → the latest such round, Results. Covers
 *      mid-season whether the round is partly or wholly played.
 *   2. **Every deadline is null** → the last *finished* round, Results. This is
 *      the ten CSV seasons. Using `finished` here is safe and the reason is
 *      structural: this branch is reachable only for a season with no deadlines
 *      at all, where every round is wholly played or wholly not, so the partial
 *      round it mishandles cannot arise.
 *   3. **Deadlines exist and none has passed** → the first round, Difficulty.
 *      This is a pre-season, and 2026-27 is the only season that should reach it.
 *
 * **Branch 2's condition is "every deadline is null", NOT "there are no
 * events".** `listEvents` derives its rows from `fixtures.gw` for every season
 * and only LEFT JOINs the `events` table for the deadline — so each CSV season
 * arrives with a *full* 38-element array whose `deadline_time` is null on every
 * entry. A `length === 0` test never fires, and all ten historical seasons would
 * fall through to branch 3 and open on GW1 / Difficulty. (`bootstrap.ts` says
 * those seasons "have no `events` rows at all", which is true of the *table* and
 * is exactly the sentence that leads to the wrong implementation.)
 *
 * `now` is a parameter rather than a `new Date()` inside, so this is pure and
 * its tests can pin a moment instead of relying on fixed deadlines staying in
 * the past.
 */
export function initialFixturesView(events: GameweekEvent[], now: Date): FixturesView {
  if (events.length === 0) return { round: undefined, tab: 'difficulty' };

  const passed = events.filter(
    (e) => e.deadline_time !== null && new Date(e.deadline_time).getTime() <= now.getTime()
  );
  if (passed.length > 0) {
    // The latest one, by deadline rather than by round number: the two agree on
    // every season stored, and the deadline is the thing being asked about.
    const latest = passed.reduce((a, b) =>
      new Date(a.deadline_time as string) >= new Date(b.deadline_time as string) ? a : b
    );
    return { round: latest.id, tab: 'results' };
  }

  const hasAnyDeadline = events.some((e) => e.deadline_time !== null);
  if (!hasAnyDeadline) {
    const finished = events.filter((e) => e.finished);
    if (finished.length > 0) return { round: finished[finished.length - 1].id, tab: 'results' };
  }

  return { round: events[0].id, tab: 'difficulty' };
}

/**
 * The neighbouring round, or undefined at the ends.
 *
 * **By position in the list, never `round ± 1`.** The rounds are not `1..n`:
 * 2019-20 runs 1-29 then 39-47, and 2022-23 has no round 7. Stepping forward
 * from 29 must land on 39 and from 6 on 8, which arithmetic on the round number
 * cannot do.
 */
export function stepRound(
  events: GameweekEvent[],
  round: number,
  direction: -1 | 1
): number | undefined {
  const i = events.findIndex((e) => e.id === round);
  if (i === -1) return undefined;
  return events[i + direction]?.id;
}

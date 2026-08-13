/**
 * Where the Fixtures page opens, and how it steps between rounds.
 *
 * Two hazards, and both are invisible to a test built from convenient data.
 *
 * **The rounds are not `1..n`.** Nine of the eleven seasons stored are, so a
 * 1..38 loop and a correct derivation agree everywhere except 2019-20 (1-29
 * then 39-47, the Covid restart) and 2022-23 (no round 7). Every stepping test
 * here uses one of those two.
 *
 * **A partly played round exists nowhere in the database.** The ten CSV seasons
 * are wholly complete and 2026-27 is wholly empty, so the case that
 * distinguishes a deadline-driven rule from a `finished`-driven one cannot be
 * built from real data. It is hand-built below, and it is the mutation target:
 * switch the rule back to "the last finished round" and that test — and only
 * that test — goes red.
 */

import { describe, expect, it } from 'vitest';
import { initialFixturesView, stepRound } from './fixtures';
import { anEvent } from '../test/factories';
import type { GameweekEvent } from '../types/fpl';

/** 2019-20: the Covid restart. Rounds 30-38 were emptied and replayed as 39-47. */
const COVID_ROUNDS = [...Array.from({ length: 29 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => i + 39)];
/** 2022-23: round 7 was postponed after the Queen's death and never renumbered. */
const QUEEN_ROUNDS = [...Array.from({ length: 6 }, (_, i) => i + 1), ...Array.from({ length: 31 }, (_, i) => i + 8)];

/** A completed CSV season: no deadlines anywhere, every round finished. */
const completed = (rounds: number[]): GameweekEvent[] =>
  rounds.map((id) => anEvent({ id, name: `Gameweek ${id}`, deadline_time: null, finished: true }));

const NOW = new Date('2026-08-13T12:00:00Z');
const iso = (d: string) => new Date(d).toISOString();

describe('initialFixturesView', () => {
  it('opens a completed season on its last round, on Results', () => {
    // 2019-20's last round is 47, not 38 — and its round COUNT is 38, which is
    // what a count-based derivation would wrongly offer.
    expect(initialFixturesView(completed(COVID_ROUNDS), NOW)).toEqual({ round: 47, tab: 'results' });
    expect(initialFixturesView(completed(QUEEN_ROUNDS), NOW)).toEqual({ round: 38, tab: 'results' });
  });

  it('opens a pre-season on its first round, on Difficulty', () => {
    // 2026-27 today: 38 rounds, deadlines in the future, nothing played.
    const events = Array.from({ length: 38 }, (_, i) =>
      anEvent({ id: i + 1, deadline_time: iso(`2026-08-${21 + (i % 8)}T18:30:00Z`), finished: false })
    );
    expect(initialFixturesView(events, NOW)).toEqual({ round: 1, tab: 'difficulty' });
  });

  it('opens ON a partly played round, not on the one before it', () => {
    /*
     * THE CASE THE DATABASE CANNOT PRODUCE, and the reason the rule reads the
     * deadline rather than `finished`.
     *
     * `events[].finished` is `bool_and(f.finished)` — true only when every
     * fixture in the round is done. Saturday afternoon of any live gameweek is
     * exactly this shape: GW5's deadline has passed, some of its matches are
     * played and some are not, so `finished` is false. A rule that took "the
     * last finished round" would open on GW4 while GW5's results sat there.
     */
    const events = [
      anEvent({ id: 4, deadline_time: iso('2026-09-05T10:00:00Z'), finished: true }),
      anEvent({ id: 5, deadline_time: iso('2026-09-12T10:00:00Z'), finished: false }),
      anEvent({ id: 6, deadline_time: iso('2026-09-19T10:00:00Z'), finished: false }),
    ];
    const saturdayAfternoon = new Date('2026-09-12T15:30:00Z');

    expect(initialFixturesView(events, saturdayAfternoon)).toEqual({ round: 5, tab: 'results' });
  });

  it('does not fall through to the pre-season branch on a season with no deadlines', () => {
    /*
     * The condition is "every deadline is null", NOT "there are no events".
     *
     * `listEvents` derives its rows from `fixtures.gw` for every season and only
     * LEFT JOINs `events` for the deadline, so a CSV season arrives with a FULL
     * 38-element array of null deadlines. Written as `events.length === 0` the
     * branch never fires and all ten historical seasons open on GW1/Difficulty
     * instead of their last round.
     */
    const view = initialFixturesView(completed(QUEEN_ROUNDS), NOW);
    expect(view.round).not.toBe(1);
    expect(view.tab).not.toBe('difficulty');
  });

  it('has no round for a season with no rounds', () => {
    expect(initialFixturesView([], NOW)).toEqual({ round: undefined, tab: 'difficulty' });
  });
});

describe('stepRound', () => {
  it('steps across the Covid gap, not by one', () => {
    const events = completed(COVID_ROUNDS);
    // 29 -> 39. `round + 1` would offer round 30, which 2019-20 never played.
    expect(stepRound(events, 29, 1)).toBe(39);
    expect(stepRound(events, 39, -1)).toBe(29);
  });

  it('steps across the postponed round, not by one', () => {
    const events = completed(QUEEN_ROUNDS);
    // 6 -> 8. Round 7 does not exist in 2022-23.
    expect(stepRound(events, 6, 1)).toBe(8);
    expect(stepRound(events, 8, -1)).toBe(6);
  });

  it('stops at both ends', () => {
    const events = completed(COVID_ROUNDS);
    expect(stepRound(events, 1, -1)).toBeUndefined();
    expect(stepRound(events, 47, 1)).toBeUndefined();
  });

  it('has no answer for a round the season does not have', () => {
    // Leaving 2019-20 on round 47 for a 38-round season is the real case.
    expect(stepRound(completed(QUEEN_ROUNDS), 47, -1)).toBeUndefined();
  });
});

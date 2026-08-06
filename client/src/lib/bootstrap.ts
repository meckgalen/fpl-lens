import { createContext, useContext } from 'react';
import type { BootstrapData, GameweekEvent } from '../types/fpl';

export const BootstrapContext = createContext<BootstrapData | null>(null);

export function useBootstrap(): BootstrapData {
  const data = useContext(BootstrapContext);
  if (!data) throw new Error('useBootstrap must be used inside <BootstrapContext.Provider>');
  return data;
}

/**
 * The current and next gameweek, or **null when there is not one**.
 *
 * Both used to end in a fallback chain — `?? the last finished round`, `?? the
 * last event` — and both were wrong for the same reason: they answered a
 * question the data does not always have an answer to. Over a completed season
 * no event has `is_next` (the ten CSV seasons have no `events` rows at all, so
 * both flags are false by construction — API identity rule 6), and the fallback
 * returned round 38, which the sidebar then rendered as "GW38 / Deadline",
 * claiming a round played in May 2026 was upcoming.
 *
 * That was true of every completed season since Phase 0 and invisible because
 * the app only ever showed one season. Item 8's selector puts ten of them one
 * click away, so the helpers were fixed rather than worked around: hiding the
 * sidebar block while leaving these lying would just move the defect to the
 * next caller.
 *
 * **The condition is "there is no next gameweek", never "the season is
 * complete".** They coincide today and stop coinciding on 21 August 2026:
 * mid-season, between one round finishing and the next deadline passing,
 * 2026-27 has a next gameweek and is not complete. Same distinction as the
 * Dashboard's empty state — a claim about the data, not about the calendar.
 *
 * A caller that wants "a round worth showing" rather than "the round that is
 * next" — the Fixtures page does — derives its own, locally and by that name.
 * See Fixtures.tsx.
 */
export function currentGameweek(b: BootstrapData): GameweekEvent | null {
  return b.events.find((e) => e.is_current) ?? null;
}

export function nextGameweek(b: BootstrapData): GameweekEvent | null {
  return b.events.find((e) => e.is_next) ?? null;
}

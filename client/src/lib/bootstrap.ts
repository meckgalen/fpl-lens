import { createContext, useContext } from 'react';
import type { BootstrapData } from '../types/fpl';

export const BootstrapContext = createContext<BootstrapData | null>(null);

export function useBootstrap(): BootstrapData {
  const data = useContext(BootstrapContext);
  if (!data) throw new Error('useBootstrap must be used inside <BootstrapContext.Provider>');
  return data;
}

export function currentGameweek(b: BootstrapData) {
  return b.events.find((e) => e.is_current) ?? b.events.filter((e) => e.finished).pop() ?? b.events[0];
}

export function nextGameweek(b: BootstrapData) {
  return b.events.find((e) => e.is_next) ?? b.events.find((e) => !e.finished) ?? b.events[b.events.length - 1];
}

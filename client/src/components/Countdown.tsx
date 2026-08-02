import { useEffect, useState, Fragment } from 'react';
import { NO_DEADLINE } from '../types/fpl';

/**
 * A countdown to a deadline, or `TBD` when there is no deadline to count to.
 *
 * The null case is handled here rather than at each call site because there are
 * two of them and they disagreed: both passed `Date.now()` as a fallback, which
 * renders `0d 00h 00m 00s` — a live season whose deadline has just expired,
 * which is the one thing a completed historical season is not. `deadline_time`
 * is null on every event we serve (API identity rule 4: it describes the live
 * game), so that fallback was the normal path, not an edge case.
 */
export function Countdown({ target }: { target: number | null }) {
  const [t, setT] = useState(target === null ? 0 : Math.max(0, target - Date.now()));
  useEffect(() => {
    if (target === null) return;
    setT(Math.max(0, target - Date.now()));
    const id = setInterval(() => setT(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (target === null) {
    return <div className="font-display text-xl font-bold text-foreground">{NO_DEADLINE}</div>;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = Math.floor(t / 86400000);
  const h = Math.floor((t % 86400000) / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const parts: [string | number, string][] = [
    [d, 'd'],
    [pad(h), 'h'],
    [pad(m), 'm'],
    [pad(s), 's'],
  ];
  return (
    <div className="flex items-baseline font-display tabular-nums">
      {parts.map(([n, u]) => (
        <Fragment key={u}>
          <span className="text-xl font-bold text-foreground">{n}</span>
          <span className="text-[9px] uppercase text-muted-foreground mr-2">{u}</span>
        </Fragment>
      ))}
    </div>
  );
}

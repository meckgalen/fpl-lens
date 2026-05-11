import { useEffect, useState, Fragment } from 'react';

export function Countdown({ target }: { target: number }) {
  const [t, setT] = useState(Math.max(0, target - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setT(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(id);
  }, [target]);
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

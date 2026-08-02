import { NO_VALUE } from '../types/fpl';

export function PosBadge({ pos }: { pos: string }) {
  const posStyles: Record<string, string> = {
    GKP: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
    GK: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
    DEF: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
    MID: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    FWD: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em] font-display ${
        posStyles[pos] || posStyles.GK
      }`}
    >
      {pos}
    </span>
  );
}

export function StatusDot({ status }: { status: 'fit' | 'doubt' | 'out' | 'unknown' | string }) {
  const colors: Record<string, string> = {
    fit: 'bg-green-500',
    doubt: 'bg-yellow-500',
    out: 'bg-red-500',
    unknown: 'bg-border',
  };
  // Falls back to unknown, not to fit: an unrecognised code is a question mark,
  // and claiming a player is fit is the more expensive way to be wrong.
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[status] || colors.unknown}`} />;
}

/**
 * Fixture difficulty, 1-5. Null for 2016-17 and 2017-18, which have no
 * fixtures.csv upstream and therefore no ratings — rendered neutral rather than
 * as a made-up 3, which would read as "medium" for a match nobody rated.
 */
export function FDRBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold font-display flex-shrink-0 bg-muted text-muted-foreground">
        {NO_VALUE}
      </span>
    );
  }
  const styles = [
    '',
    'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-400',
    'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-500',
    'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-500',
    'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-400',
    'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400',
  ];
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold font-display flex-shrink-0 ${
        styles[value] || styles[3]
      }`}
    >
      {value}
    </span>
  );
}

export function PlayerAvatar({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 48 54" fill="none">
      <circle cx="24" cy="16" r="11" fill="hsl(var(--border))" />
      <path d="M4 54 Q4 36 24 36 Q44 36 44 54Z" fill="hsl(var(--border))" />
    </svg>
  );
}

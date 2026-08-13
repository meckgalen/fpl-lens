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
 * The difficulty palette, 1-5, indexed by the rating itself.
 *
 * **Complete Tailwind class strings, never assembled from fragments.** Tailwind
 * scans source text for whole class names, so `bg-${colour}-100` produces no CSS
 * at all. Index 0 is a deliberate empty slot so `FDR[1]`..`FDR[5]` line up with
 * the ratings and no `- 1` appears at either call site.
 *
 * Hoisted out of `FDRBadge` in item 18 so the badge and the bar read the SAME
 * map: two copies of a five-colour scale is two things that can drift, and a
 * legend drawn from one while rows are drawn from the other is a legend that
 * lies.
 */
const FDR = [
  '',
  'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-400',
  'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-500',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-500',
  'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-400',
  'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400',
];

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
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold font-display flex-shrink-0 ${
        FDR[value] || FDR[3]
      }`}
    >
      {value}
    </span>
  );
}

/**
 * The same difficulty, as a bar under a team name rather than a chip beside it.
 *
 * **This shape exists because the old one read as a scoreline.** The difficulty
 * row was laid out exactly like the results row one tab away — `flex-1` |
 * centre | `flex-1`, with the centre between two adjacent numbers — so
 * `BOU 1 vs 3 LEI` parsed as a 1-3 defeat rather than as two difficulty
 * ratings. Stacking the rating *under* its own club, full width, means no number
 * ever flanks another number and each rating is visibly attached to one side.
 *
 * The number stays on the bar. Colour alone would put the whole meaning in a
 * channel some readers do not have, and the 1-5 legend would have nothing to
 * key against.
 */
export function FDRBar({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="block w-full h-4 rounded text-[10px] font-bold font-display leading-4 text-center bg-muted text-muted-foreground">
        {NO_VALUE}
      </span>
    );
  }
  return (
    <span
      className={`block w-full h-4 rounded text-[10px] font-bold font-display leading-4 text-center ${
        FDR[value] || FDR[3]
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

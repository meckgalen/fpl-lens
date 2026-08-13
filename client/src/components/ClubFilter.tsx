import { FOCUS_RING, cn } from '../lib/cn';
import type { Team } from '../types/fpl';

/** The sentinel for "no club filter". A string, so it cannot collide with a code. */
export type ClubSelection = number | 'ALL';

/**
 * The club dropdown, shared by the Comparison page and the Players list.
 *
 * Extracted from Comparison.tsx in item 18 rather than written a second time for
 * Players: two copies of a control reading `bootstrap.teams` are two places for
 * the option ordering and the `'ALL'` sentinel to drift apart.
 *
 * **`id` is a prop and not a constant**, which is the only real change the
 * extraction needed. It was the hard-coded literal `comparison-team`, and the
 * `htmlFor`/`id` pair only works while one instance is mounted — a second would
 * point every label at the first control.
 *
 * The value is `Team.id`, which is `fpl_team_code` and permanent across seasons
 * (API identity rule 1), and is what `Player.team` carries. So the caller's
 * predicate is a direct equality and no mapping table is involved.
 */
export function ClubFilter({
  id,
  value,
  onChange,
  teams,
}: {
  id: string;
  value: ClubSelection;
  onChange: (v: ClubSelection) => void;
  teams: Team[];
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Club
      </label>
      <select
        id={id}
        value={value === 'ALL' ? 'ALL' : String(value)}
        onChange={(e) => onChange(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
        className={cn(
          'h-9 rounded-md border border-input bg-card px-2 text-[13px] text-foreground',
          FOCUS_RING
        )}
      >
        <option value="ALL">All clubs</option>
        {/* Copied rather than sorted in place: `bootstrap.teams` is shared state
            and `sort` mutates. By full name, not short name — the short names
            are three letters and sort into an order nobody reads as alphabetical. */}
        {[...teams]
          .sort((x, y) => x.name.localeCompare(y.name))
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </select>
    </div>
  );
}


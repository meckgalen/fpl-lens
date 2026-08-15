import { useEffect, useRef, useState } from 'react';
import { FOCUS_RING } from '../lib/cn';
import { PLAYER_COLUMNS, resolveColumn } from '../lib/playerColumns';
import type { ColumnHistoryRow, SeasonColumnAvailability } from '../types/fpl';

interface Props {
  selected: string[];
  availability: SeasonColumnAvailability;
  /** Null until the matrix lands, and permanently if the fetch failed. */
  history: ColumnHistoryRow[] | null;
  allSeasons: string[];
  onToggle: (key: string) => void;
}

/**
 * The column picker: a checkbox per column, with a reason on every one that
 * cannot be shown.
 *
 * **Unavailable columns are disabled, not hidden**, and that is the whole point
 * of the component rather than a styling choice. Hiding them makes the app look
 * like it has never heard of expected goals when you select 2016-17; disabling
 * them with `from 2022-23` beside the name teaches the shape of the data. The
 * reason is **visible text, never a `title` attribute** — a tooltip is invisible
 * to a reader who does not think to hover, which is exactly the reader it is for.
 *
 * **A tag where one is true, the sentence where it is not.** On 2026-27 every
 * nullable column is disabled at once, and a dozen full sentences saying the
 * same thing is a wall rather than an explanation. So `resolveColumn` returns
 * both forms from the same branch and this renders `tag ?? reason`: the short
 * form where compressing keeps the claim true, and the sentence where it does
 * not — the two permanently-unavailable fields, and the two branches with no
 * season to point at. **Do not give those a tag to make the list uniform.** The
 * point is that the entry says something true, not that every entry is short.
 *
 * Both forms come from `resolveColumn`, which produces a complete sentence
 * without the matrix. So there is no window in which an entry is disabled and
 * unexplained: the matrix only adds the "· recorded …" clause and the tag it
 * shares a derivation with, and nothing already on screen changes meaning when
 * it arrives.
 */
export default function ColumnPicker({
  selected,
  availability,
  history,
  allSeasons,
  onToggle,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Click-away and Escape, both, because a popover that only closes by clicking
  // its own button is a popover that traps a keyboard user in front of it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const shown = selected.length;

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`h-9 px-3 rounded-md border border-input bg-card shadow-sm text-sm text-foreground hover:text-foreground transition-colors ${FOCUS_RING}`}
      >
        Columns
        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{shown}</span>
      </button>

      {open && (
        <div
          // Above the sticky table header, which is `Z_HEADER`/`Z_PINNED_HEADER`
          // — a popover that opens *behind* the thing it overlaps is the bug
          // this z-index exists to avoid.
          className="absolute left-0 top-full mt-1 z-30 w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-border bg-card shadow-lg p-2"
        >
          {/* Names the season, and has to: `from GW16` is a boundary WITHIN the
              selected season, and reads as a claim about some other season
              without it.

              An earlier draft said "a tag says when the stat is recorded;
              anything else says why". It is false — `no matches yet` and
              `partly recorded` are both tags and both whys — so it misdescribed
              two of the five live tags. The split between a tag and a sentence
              is length, not kind, and this says that instead. */}
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
            Greyed-out columns can’t be shown for {availability.season}. Each says why; a few
            need a full sentence.
          </p>

          <ul className="space-y-0.5">
            {PLAYER_COLUMNS.map((col) => {
              const status = resolveColumn(col, availability, history, allSeasons);
              const disabled = !status.available;
              const checked = selected.includes(col.key);

              return (
                <li key={col.key}>
                  {/* A real <label> wrapping a real <input type="checkbox">, so
                      the whole row is a click target, Space toggles it, and the
                      accessible name is the column's long title rather than its
                      two-letter heading. No aria-label anywhere: there is
                      nothing that can drift out of agreement with the text. */}
                  <label
                    className={`flex gap-2.5 px-2 py-1.5 rounded-md ${
                      disabled ? 'opacity-70' : 'cursor-pointer hover:bg-muted/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className={`mt-0.5 accent-primary ${FOCUS_RING}`}
                      checked={checked && !disabled}
                      disabled={disabled}
                      onChange={() => onToggle(col.key)}
                    />
                    <span className="min-w-0">
                      <span className="text-[13px] text-foreground">{col.title}</span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">
                        {col.label}
                      </span>
                      {/* A tag sits beside the label, a sentence gets its own
                          line. Same field either way — `resolveColumn` decides
                          which exists, and this only decides where it goes. */}
                      {disabled &&
                        (status.tag !== undefined ? (
                          <span className="ml-1.5 text-[11px] text-muted-foreground italic">
                            {status.tag}
                          </span>
                        ) : (
                          <span className="block text-[11px] text-muted-foreground mt-0.5">
                            {status.reason}
                          </span>
                        ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

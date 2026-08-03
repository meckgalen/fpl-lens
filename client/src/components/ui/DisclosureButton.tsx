import type { MouseEvent, ReactNode } from 'react';
import { FOCUS_RING, cn } from '../../lib/cn';

interface Props {
  /** Whether the region this controls is open. Drives the chevron and ARIA. */
  expanded: boolean;
  /** The id of the row it opens. See below for why it is only sometimes used. */
  controls: string;
  onToggle: () => void;
  /**
   * The label. **Required, and it must be real text** — see the note on
   * accessible names below.
   */
  children: ReactNode;
  className?: string;
}

/**
 * The one disclosure control, shared by the career table and the Players list.
 *
 * Both used to be a `<tr onClick>`. A `<tr>` is not a control: a mouse could
 * expand a season, a keyboard could not reach the row at all, and nothing in the
 * DOM said the row opened anything — assistive technology got a table of numbers
 * with no indication that there was more. A real `<button>` gets Enter, Space,
 * focus order and the right role for free. `role="button"` on the row would not:
 * Space on a hand-rolled focusable element scrolls the page unless that is
 * suppressed, and the suppression is the sort of thing that gets written once
 * and then omitted at the second call site.
 *
 * **It wraps the chevron *and* the text, never the chevron alone.** An icon-only
 * button has no accessible name — tabbing 200 Players rows would announce
 * "button" 200 times with nothing to tell them apart. Passing the season or the
 * player's name as children makes the visible text the accessible name, so there
 * is no `aria-label` that can drift out of agreement with what is on screen. The
 * chevron is `aria-hidden` for the same reason: "▸ 2024-25" is not a name.
 *
 * **`stopPropagation` lives here rather than at the call sites.** Both tables
 * keep their row `onClick`, because clicking anywhere on the row is how this has
 * always worked for a mouse. Without this the button's click would bubble to the
 * row and toggle a second time, netting back to closed — a click that looks like
 * it did nothing. Putting it in the shared control means no call site can forget
 * it; `CareerTable.test.tsx` and `Players.test.tsx` both count the toggles.
 *
 * **`aria-controls` is emitted only while expanded. `aria-expanded` always is.**
 * The row it points at exists only when open, because the alternative — render
 * every season's panel and hide it — would defeat the lazy per-season fetch the
 * career table is built on. Pointing `aria-controls` at an id that is not in the
 * document is an ARIA violation, and a dangling reference is worse than none: a
 * screen reader that follows it lands nowhere, and validators flag it.
 * `aria-expanded` is well supported and is what actually carries the disclosure
 * semantics. Do not "fix" the conditional back.
 */
export function DisclosureButton({ expanded, controls, onToggle, children, className }: Props) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm text-left',
        FOCUS_RING,
        className
      )}
    >
      <span aria-hidden="true" className="inline-block w-3 text-muted-foreground">
        {expanded ? '▾' : '▸'}
      </span>
      {children}
    </button>
  );
}

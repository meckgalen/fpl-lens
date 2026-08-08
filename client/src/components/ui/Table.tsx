import type { ReactNode } from 'react';
import { FOCUS_RING, cn } from '../../lib/cn';
import { EDGE_HEADER, ROW_BAND } from '../../lib/rowSurface';

/**
 * Every cell paints the colour its ROW is holding, rather than one of its own.
 *
 * This is the whole point of the indirection. A pinned cell has to be opaque or the
 * columns show through it as they slide underneath — which is why the pinned cells
 * used to carry `bg-card` and, on hover, `group-hover:bg-muted`. But an opaque
 * colour of its own cannot follow the row: the rest of the row hovered to
 * `muted/50` over card (≈ rgb 246,244,241) while the pinned cell went to an opaque
 * `muted` (rgb 238,235,231), which put a visible step at the boundary and made the
 * pinned cell look like the only thing highlighted. Holding the row's colour, a
 * pinned cell stripes and hovers in lockstep with the cells beside it and stays
 * opaque doing it.
 *
 * `color:` is a type hint, not decoration — `bg-[var(…)]` is ambiguous between
 * background-color and background-image and Tailwind is entitled to guess the other
 * one. The `transparent` fallback covers a row that sets no `--row-bg` at all.
 */
const CELL_SURFACE = 'bg-[color:var(--row-bg,transparent)]';

/**
 * `border-separate border-spacing-0` rather than Preflight's `border-collapse`.
 *
 * Two reasons, and the first is the one that matters. A **collapsed** border belongs
 * to the table rather than to the cell, so it scrolls out from under a sticky
 * element and leaves the header floating with no edge under it; the separated model
 * keeps every edge on the element that drew it. At zero spacing the two models look
 * identical when there are no borders, so this costs nothing now and means a border
 * added later just works.
 *
 * The second is a consequence rather than a choice, and it is worth stating because
 * it is invisible: **in the separated model a `<tr>` cannot have a border at all.**
 * Row borders are simply not rendered. So switching here is what removed the
 * horizontal row separators and the header underline from every table in the app —
 * `TableRow` and `TableHeader` no longer carry a `border-b` because one there would
 * be silently dead, not because the separators were deleted separately. The stripe
 * does that work now, and the header is defined by its fill and its box-shadow.
 */
export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <table className={cn('w-full caption-bottom text-sm border-separate border-spacing-0', className)}>
      {children}
    </table>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({
  children,
  className = '',
  onClick,
  id,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** For a row a `DisclosureButton` points `aria-controls` at while it is open. */
  id?: string;
}) {
  return (
    <tr
      id={id}
      onClick={onClick}
      // The row holds a colour; the cells paint it. `--row` equals `--card` in both
      // themes, so a row with no stripe and no hover is exactly the colour it was.
      //
      // A stripe passed in via `className` cannot beat the hover by accident: a
      // `hover:` variant carries a pseudo-class, so it is specificity (0,2,0)
      // against the stripe's (0,1,0) and wins regardless of source order.
      className={cn(
        '[--row-bg:hsl(var(--row))] hover:[--row-bg:hsl(var(--row-hover))] transition-colors',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </tr>
  );
}

/**
 * A column heading, and — where the column sorts — the control that sorts it.
 *
 * `onClick` used to sit on the `<th>`. A `<th>` is not focusable, so sorting was
 * mouse-only on both the Players list and every `StatsTable`, including the ones
 * nested inside an expanded career row: a keyboard user could open a season and
 * then not sort the table they had just opened.
 *
 * **The button is the padded box, not an inline label.** The `<th>`'s `h-10 px-3`
 * moves onto it and it takes `w-full h-full`, so the clickable area stays the
 * whole cell. Wrapping the children and leaving the padding on the `<th>` would
 * shrink the target to the text — and 31 of these columns are labelled with two
 * or three characters, so an accessibility fix would have shipped a usability
 * regression nobody asked for.
 *
 * `aria-sort` goes on the `<th>` rather than the button, because it is the
 * column header that is sorted; the button is what sorts it. The ▴/▾ marker the
 * caller passes in is decorative — direction is conveyed by `aria-sort` — so
 * callers mark it `aria-hidden` and it stays out of the accessible name.
 */
export function TableHead({
  children,
  className = '',
  onClick,
  title,
  sortDirection,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Hover text, for the columns whose heading is a three-letter abbreviation. */
  title?: string;
  /** Only meaningful with `onClick`; 'none' for a sortable column that is not sorted. */
  sortDirection?: 'ascending' | 'descending' | 'none';
}) {
  const TYPE =
    'text-left align-middle text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground whitespace-nowrap';

  // The band goes on the cell rather than on `<thead>` via a `[&_tr]:` variant,
  // because the variant would have to be built by interpolating ROW_BAND and
  // Tailwind's scanner only sees literal class strings — the rule would never be
  // generated and the header would silently take a data row's colour.
  // The band, the fill that paints it, and the rule under it. The rule is here
  // rather than at the call sites because `border-separate` dropped `<thead>`'s
  // underline from every table in the app, including the Dashboard's, whose header
  // is not sticky and would otherwise have no edge at all.
  const SURFACE = cn(ROW_BAND, CELL_SURFACE, EDGE_HEADER);

  if (!onClick) {
    return (
      <th title={title} className={cn('h-10 px-3', SURFACE, TYPE, className)}>
        {children}
      </th>
    );
  }

  return (
    <th
      title={title}
      aria-sort={sortDirection}
      // **`h-10` stays on the cell.** Only the horizontal padding moves. The
      // first attempt put `h-10 px-3` on the button and left the cell `p-0`,
      // and the header row collapsed from 40px to 21px on every sortable table:
      // the button carried both `h-10` and `h-full`, `h-full` wins in Tailwind's
      // cascade, and `height: 100%` then resolved against a cell that no longer
      // had a height of its own. The classes all looked right, which is why the
      // test on them passed and only the browser caught it.
      className={cn('h-10 px-0', SURFACE, TYPE, className)}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          // Fills the cell, so the click target is what it was when the handler
          // sat on the <th> — 31 of these columns are labelled with two or three
          // characters, and shrinking the target to the text would trade a
          // keyboard fix for a mouse regression. The cell owns the height, the
          // button owns the padding, and neither states the other's.
          'w-full h-full px-3 [text-align:inherit]',
          // Font, colour, letter-spacing and text-transform arrive by
          // inheritance — Preflight gives buttons `font: inherit` and
          // `color: inherit`, and the rest are inherited CSS properties — so
          // nothing here restates what the cell already says.
          'cursor-pointer select-none hover:text-foreground transition-colors',
          FOCUS_RING
        )}
      >
        {children}
      </button>
    </th>
  );
}

export function TableCell({
  children,
  className = '',
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  /** For a row that spans the table rather than lining up with its columns. */
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn('px-3 py-2.5 align-middle', CELL_SURFACE, className)}>
      {children}
    </td>
  );
}

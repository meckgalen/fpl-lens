import type { ReactNode } from 'react';
import { FOCUS_RING, cn } from '../../lib/cn';

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <table className={cn('w-full caption-bottom text-sm', className)}>{children}</table>;
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead className="[&_tr]:border-b [&_tr]:border-border">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="[&_tr:last-child]:border-0">{children}</tbody>;
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
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
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

  if (!onClick) {
    return (
      <th title={title} className={cn('h-10 px-3', TYPE, className)}>
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
      className={cn('h-10 px-0', TYPE, className)}
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
    <td colSpan={colSpan} className={cn('px-3 py-2.5 align-middle', className)}>
      {children}
    </td>
  );
}

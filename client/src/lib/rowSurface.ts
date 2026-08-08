/**
 * The shared vocabulary for sticky table geometry and row surfaces.
 *
 * Here rather than in `components/ui/Table.tsx` for a mechanical reason: React
 * Fast Refresh only handles a module whose exports are all components, so a single
 * non-component export there turns every subsequent edit to `Table.tsx` into a full
 * page reload. Item 9 shipped exactly that defect with `resetShirtCache` and it took
 * a dev-server log to find, because tests, `tsc` and the browser are all silent
 * about it. Module state and plain constants are not a rendering concern anyway.
 */

/**
 * The z-index ladder. **Three levels, and there is no fourth.**
 *
 * A cell that is sticky on one axis can be overlapped by a cell sticky on the
 * other, so the two axes have to be ordered, and the cell sticky on both has to
 * beat them both. Anything else — a fourth level, or two cells sharing one — means
 * a column sliding over a header or a header sliding under a column, which is the
 * kind of defect that only shows up mid-scroll.
 */
/** A body cell pinned horizontally. Must sit over the columns scrolling past it. */
export const Z_PINNED = 'z-[1]';
/** A header cell pinned vertically. Must sit over the pinned body cells. */
export const Z_HEADER = 'z-[2]';
/** The corner cell, pinned on both axes. Must sit over both of the above. */
export const Z_PINNED_HEADER = 'z-[3]';

/**
 * The two edges, drawn by two different mechanisms **on purpose**.
 *
 * The corner cell — pinned column *and* header row — needs both at once, and if both
 * were `shadow-[…]` utilities they would be two `box-shadow` declarations of equal
 * specificity whose winner depends on the order Tailwind happened to emit them in.
 * That is the `h-10` / `h-full` trap from item 3: every class the test asserts is
 * present, and the browser shows one of them silently losing. Using a border for one
 * and a shadow for the other means they compose instead of competing.
 *
 * The pinned rule can be a border now, which it could not before. Under
 * `border-collapse: collapse` a border belongs to the table and scrolls out from
 * under the cell it was separating, which is why this was a box-shadow. Under
 * `separate` a *cell* border belongs to the cell and travels with it — only `<tr>`
 * borders are dropped. With the global `box-sizing: border-box` it also stays inside
 * a declared width, so it cannot push a pinned column off its offset.
 */
/** Down the right of the last pinned column. Only the last pinned column gets it. */
export const EDGE_PINNED = 'border-r border-border';
/** Under the header row, sticky or not. Lives in `TableHead`, so every table has it. */
export const EDGE_HEADER = 'shadow-[0_1px_0_0_hsl(var(--border))]';

/**
 * The row surfaces. Each sets `--row-bg`, which every cell paints — see the comment
 * beside the tokens in `index.css` for why they are opaque.
 *
 * A row with none of these takes the default `--row` from `TableRow`.
 */
/** Every other data row. Applied by map index, never by `nth-child` — see below. */
export const ROW_STRIPE = '[--row-bg:hsl(var(--row-alt))]';
/** The header row, and a totals/averages row. Not a data row's colour. */
export const ROW_BAND = '[--row-bg:hsl(var(--row-head))]';

/**
 * Whether a row at this index takes the stripe.
 *
 * **By map index, and `nth-child` is wrong here — in all three tables.** Every one
 * of them can render an expansion row as a *sibling* `<tr>` in the same `<tbody>`:
 * `CareerTable` returns `[summary, detail]` per season and React flattens it, and
 * the Players list wraps each row in a Fragment with a conditional `<tr>`. One open
 * row therefore flips the parity of every row below it. `StatsTable` has no
 * expansion but appends an AVG row as the last `<tbody>` child, which parity would
 * stripe half the time.
 *
 * Taking it from the data's own index is immune to all of that, and an expansion
 * row can be given its summary row's value so an open season reads as one block.
 */
export const striped = (index: number): string => (index % 2 === 1 ? ROW_STRIPE : '');

/**
 * Cancels the hover on a row that is not itself a hover target — a career table's
 * expansion panel, where hovering the gameweeks inside should not tint the panel.
 *
 * It has to **name the row's own surface** rather than the default one, or hovering an
 * open *striped* season would step it back to plain. So it takes the same index the
 * stripe does and pairs with it.
 *
 * Both branches are spelled out as whole literal class strings, and that is not
 * verbosity. Tailwind's scanner reads raw file text, so a variant assembled at
 * runtime — `` `hover:${ROW_STRIPE}` `` — is a token that appears nowhere in the
 * source, the rule is never generated, and the result is a class that looks right in
 * the DOM and does nothing. Independent classes concatenate freely; a variant and its
 * base must be literal together.
 */
export const hoverInert = (index: number): string =>
  index % 2 === 1 ? 'hover:[--row-bg:hsl(var(--row-alt))]' : 'hover:[--row-bg:hsl(var(--row))]';

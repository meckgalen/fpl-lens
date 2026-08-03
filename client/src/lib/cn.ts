export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The focus ring, on one line, for every control that gets one.
 *
 * Not a new convention — `Input`, `Switch` and `GameweekFilters` already spell
 * this out inline, and `--ring` is defined in both themes. It is named here
 * because item 3 added three more controls, and a ring that six components each
 * write out by hand is a ring that five of them eventually have.
 *
 * `outline-none` is only safe paired with the ring that replaces it. On its own
 * it makes a control focusable with nothing on screen saying so, which is what
 * the Players search input did until this existed.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

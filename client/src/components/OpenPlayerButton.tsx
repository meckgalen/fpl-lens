import type { Player } from '../types/fpl';
import { FOCUS_RING, cn } from '../lib/cn';

interface Props {
  player: Player;
  /**
   * The same prop the Players list takes, filled by `App.tsx` with
   * `setDetailPlayer`. Passed in rather than reached for, so there is one route
   * into the detail page rather than two that can diverge.
   */
  onOpenDetail: (player: Player) => void;
  className?: string;
}

/**
 * A player's name, as a control that opens their detail page.
 *
 * The Dashboard's three rankings had no click handler at all — not a broken one,
 * none — so the only way into the career view was the Players list. They are
 * three different layouts (one `<Table>`, two `<div>` lists), which is why this
 * is a component rather than three inline buttons: what has to agree across them
 * is the focus ring and the accessible name, and both are easy to write twice
 * and then differently.
 *
 * The name is the button's content, so it is also its accessible name. The team
 * and position sit outside it: they are context for the row, and folding them in
 * would give the button a name assembled from three unrelated facts.
 */
export function OpenPlayerButton({ player, onOpenDetail, className }: Props) {
  return (
    <button
      type="button"
      onClick={() => onOpenDetail(player)}
      className={cn(
        'rounded-sm text-left hover:text-primary hover:underline underline-offset-2 transition-colors',
        FOCUS_RING,
        className
      )}
    >
      {player.web_name}
    </button>
  );
}

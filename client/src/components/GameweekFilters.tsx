interface Props {
  gwRange: [number, number];
  /**
   * The round numbers that exist this season, in order — not a count and not a
   * maximum. 2019-20 runs 1-29 then 39-47 and 2022-23 skips round 7, so a range
   * built from a length is wrong in both.
   */
  rounds: number[];
  homeAway: 'all' | 'home' | 'away';
  onGwRangeChange: (range: [number, number]) => void;
  onHomeAwayChange: (value: 'all' | 'home' | 'away') => void;
}

const selectClass =
  'h-8 px-2 rounded-md border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function GameweekFilters({ gwRange, rounds, homeAway, onGwRangeChange, onHomeAwayChange }: Props) {
  const gwOptions = rounds;

  return (
    /*
     * Pinned to the left edge of whatever is scrolling it, for the same reason
     * the GW and Opp columns are.
     *
     * Since item 12 this bar renders inside an expanded career row, which lives
     * in a `colSpan={34}` cell as wide as a 31-column table — so the career
     * card scrolls horizontally and everything in that cell scrolls with it.
     * Measured before the fix, at `scrollLeft: 700` in a 894px pane: the
     * controls sat at **-419px**, off the left edge, while the pinned Season and
     * GW columns held at the pane's edge. Scrolling right to read BPS took the
     * filters away with it.
     *
     * `w-fit` is load-bearing next to `sticky left-0`: a block-level child of
     * that cell is as wide as the whole table, and a full-width box pinned at
     * `left-0` does not appear to move at all — its left edge is already where
     * it is being pinned to. Shrinking the box to its contents is what makes the
     * pinning visible.
     *
     * The averages note beneath the table still scrolls away. That is
     * pre-existing — it predates this item and applies to every nested table
     * item 10 built — and it is a caption rather than a control, so it is
     * recorded in CLAUDE.md rather than fixed here.
     */
    <div className="sticky left-0 w-fit flex flex-wrap items-center gap-4 mb-4">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        GW from
        <select
          value={gwRange[0]}
          onChange={(e) => onGwRangeChange([Number(e.target.value), gwRange[1]])}
          className={selectClass}
        >
          {gwOptions.map((gw) => (
            <option key={gw} value={gw}>
              {gw}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        to
        <select
          value={gwRange[1]}
          onChange={(e) => onGwRangeChange([gwRange[0], Number(e.target.value)])}
          className={selectClass}
        >
          {gwOptions.map((gw) => (
            <option key={gw} value={gw}>
              {gw}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Venue
        <select
          value={homeAway}
          onChange={(e) => onHomeAwayChange(e.target.value as 'all' | 'home' | 'away')}
          className={selectClass}
        >
          <option value="all">All</option>
          <option value="home">Home</option>
          <option value="away">Away</option>
        </select>
      </label>
    </div>
  );
}

interface Props {
  gwRange: [number, number];
  maxGw: number;
  homeAway: 'all' | 'home' | 'away';
  onGwRangeChange: (range: [number, number]) => void;
  onHomeAwayChange: (value: 'all' | 'home' | 'away') => void;
}

const selectClass =
  'h-8 px-2 rounded-md border border-input bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function GameweekFilters({ gwRange, maxGw, homeAway, onGwRangeChange, onHomeAwayChange }: Props) {
  const gwOptions = Array.from({ length: maxGw }, (_, i) => i + 1);

  return (
    <div className="flex flex-wrap items-center gap-4 mb-4">
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

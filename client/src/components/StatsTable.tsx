import { useState } from 'react';
import type { GameweekHistory, Team } from '../types/fpl';
import { NO_VALUE, fmtNum } from '../types/fpl';
import { Card } from './ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';

interface Props {
  history: GameweekHistory[];
  teams: Team[];
  /**
   * Whether this table owns its horizontal scrolling.
   *
   * True standalone. **False when nested inside the career table**, and it has
   * to be: `position: sticky` resolves against the nearest scrolling ancestor,
   * so a table wrapped in its own `overflow-x-auto` that is never narrow enough
   * to scroll would pin GW to a container that does not move, and the column
   * would slide away with the rest when the outer table scrolls. Sharing the
   * outer scroller also means one scrollbar for the section rather than two
   * nested ones.
   */
  scroll?: boolean;
}

type SortKey = keyof GameweekHistory;

interface Column {
  key: SortKey;
  label: string;
  /** How the cell prints. Every value that can be null goes through fmtNum. */
  render: (gw: GameweekHistory, teamMap: Record<number, string>) => string;
  /** False for the columns an average is meaningless for. */
  averaged: boolean;
}

const num = (v: number) => String(v);

/**
 * Note `Tck` for tackles rather than FPL's `T`, which is already threat here.
 * Two columns of numbers under the same one-letter heading is a table nobody
 * can read; threat keeps the letter because it was here first.
 */
const COLUMNS: Column[] = [
  { key: 'round', label: 'GW', render: (g) => String(g.round), averaged: false },
  {
    key: 'opponent_team',
    label: 'Opp',
    render: (g, teamMap) => teamMap[g.opponent_team] ?? String(g.opponent_team),
    averaged: false,
  },
  { key: 'was_home', label: 'H/A', render: (g) => (g.was_home ? 'H' : 'A'), averaged: false },
  { key: 'total_points', label: 'Pts', render: (g) => num(g.total_points), averaged: true },
  { key: 'minutes', label: 'Min', render: (g) => num(g.minutes), averaged: true },
  { key: 'goals_scored', label: 'G', render: (g) => num(g.goals_scored), averaged: true },
  { key: 'assists', label: 'A', render: (g) => num(g.assists), averaged: true },
  { key: 'clean_sheets', label: 'CS', render: (g) => num(g.clean_sheets), averaged: true },
  { key: 'goals_conceded', label: 'GC', render: (g) => num(g.goals_conceded), averaged: true },
  { key: 'own_goals', label: 'OG', render: (g) => num(g.own_goals), averaged: true },
  { key: 'penalties_saved', label: 'PS', render: (g) => num(g.penalties_saved), averaged: true },
  { key: 'penalties_missed', label: 'PM', render: (g) => num(g.penalties_missed), averaged: true },
  { key: 'yellow_cards', label: 'YC', render: (g) => num(g.yellow_cards), averaged: true },
  { key: 'red_cards', label: 'RC', render: (g) => num(g.red_cards), averaged: true },
  { key: 'saves', label: 'S', render: (g) => num(g.saves), averaged: true },
  { key: 'expected_goals', label: 'xG', render: (g) => fmtNum(g.expected_goals, 2), averaged: true },
  { key: 'expected_assists', label: 'xA', render: (g) => fmtNum(g.expected_assists, 2), averaged: true },
  {
    key: 'expected_goal_involvements',
    label: 'xGI',
    render: (g) => fmtNum(g.expected_goal_involvements, 2),
    averaged: true,
  },
  {
    key: 'expected_goals_conceded',
    label: 'xGC',
    render: (g) => fmtNum(g.expected_goals_conceded, 2),
    averaged: true,
  },
  { key: 'tackles', label: 'Tck', render: (g) => fmtNum(g.tackles, 0), averaged: true },
  {
    key: 'clearances_blocks_interceptions',
    label: 'CBI',
    render: (g) => fmtNum(g.clearances_blocks_interceptions, 0),
    averaged: true,
  },
  { key: 'recoveries', label: 'R', render: (g) => fmtNum(g.recoveries, 0), averaged: true },
  {
    key: 'defensive_contribution',
    label: 'DC',
    render: (g) => fmtNum(g.defensive_contribution, 0),
    averaged: true,
  },
  { key: 'ict_index', label: 'ICT', render: (g) => fmtNum(g.ict_index, 1), averaged: true },
  { key: 'influence', label: 'I', render: (g) => fmtNum(g.influence, 1), averaged: true },
  { key: 'creativity', label: 'C', render: (g) => fmtNum(g.creativity, 1), averaged: true },
  { key: 'threat', label: 'T', render: (g) => fmtNum(g.threat, 1), averaged: true },
  { key: 'bonus', label: 'Bon', render: (g) => num(g.bonus), averaged: true },
  { key: 'bps', label: 'BPS', render: (g) => num(g.bps), averaged: true },
  { key: 'value', label: 'Price', render: (g) => `£${(g.value / 10).toFixed(1)}`, averaged: false },
  { key: 'selected', label: 'Selected', render: (g) => g.selected.toLocaleString(), averaged: false },
];

/**
 * The pinned first column.
 *
 * Thirty-one columns do not fit, so the card scrolls horizontally — and a row
 * of numbers with the round scrolled off the left edge cannot be attributed to
 * a gameweek at all. GW therefore stays put.
 *
 * The background has to be opaque and its own: a transparent sticky cell shows
 * the columns sliding underneath it. `bg-card` and `bg-muted` are both defined
 * per theme, so this follows the light/dark toggle. The hover tint is a shade
 * stronger here than the `bg-muted/50` on the rest of the row, because a
 * translucent hover cannot be layered over an opaque base without compounding;
 * it reads as the pinned column being distinct, which it is.
 *
 * The right-hand rule is a box-shadow rather than a border because Tailwind's
 * reset collapses table borders, and a collapsed border belongs to the table
 * rather than to the cell — so it scrolls away with the columns it was meant to
 * separate.
 */
const STICKY_COL = 'sticky left-0 z-10 bg-card group-hover:bg-muted shadow-[1px_0_0_0_hsl(var(--border))]';

/** The sortable/averageable value of a cell, or null where there is none. */
function numericValue(gw: GameweekHistory, key: SortKey): number | null {
  const v = gw[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' ? v : null;
}

export default function StatsTable({ history, teams, scroll = true }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('round');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.short_name]));

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...history].sort((a, b) => {
    const av = numericValue(a, sortKey);
    const bv = numericValue(b, sortKey);
    // Unmeasured rows sort last in both directions. Treating null as 0 would
    // put a season that predates xG at the bottom of an ascending sort as
    // though it had generated no chances (rule 6).
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  /**
   * The mean over the fixtures shown, not over rounds and not over appearances.
   *
   * Rule 13 makes stating the denominator mandatory, so the row prints it as a
   * count rather than a word: a double gameweek contributes two rows in one
   * round, a blank contributes none, and a fixture the player sat out
   * contributes a row of zeroes. All three make "per gameweek" ambiguous and
   * "per appearance" wrong. The rows are also the filtered ones, so the number
   * moves with the filters, which is another reason to show it.
   *
   * Nulls are skipped rather than summed as zero. Before, a season with no xG
   * averaged 0.00 across 38 fixtures and looked like a measured result; now the
   * denominator is the fixtures that actually carry a value, and a column with
   * none of them shows the placeholder.
   */
  const avg = (key: SortKey): string => {
    const values = history.map((gw) => numericValue(gw, key)).filter((v): v is number => v !== null);
    if (values.length === 0) return NO_VALUE;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return mean.toFixed(1);
  };

  // Built first and wrapped after, rather than through a component chosen at
  // render time: a component defined inside the body is a new type on every
  // render, so React would unmount and remount the table and lose the sort.
  const table = (
    <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col, i) => (
              <TableHead
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`text-right ${sortKey === col.key ? 'text-foreground' : ''} ${
                  i === 0 ? STICKY_COL : ''
                }`}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-0.5 opacity-50 text-[9px]">{sortDir === 'asc' ? '▴' : '▾'}</span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Keyed on the fixture, never on the round. A double gameweek gives
              one player two rows in the same round, and keying on `round`
              collapsed them into a duplicate key that React warns about and
              renders wrong (rule 13). Not an edge case: 2025-26 alone has three
              such rounds — 26 (79 players), 33 (248) and 36 (82). */}
          {sorted.map((gw) => (
            <TableRow key={gw.fixture} className="group">
              {COLUMNS.map((col, i) => (
                <TableCell
                  key={col.key}
                  className={`text-right font-display text-[13px] tabular-nums text-foreground whitespace-nowrap ${
                    i === 0 ? STICKY_COL : ''
                  }`}
                >
                  {col.render(gw, teamMap)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow className="bg-muted/50 font-semibold">
            {COLUMNS.map((col, i) => (
              <TableCell
                key={col.key}
                className={`text-right font-display text-[12px] tabular-nums text-muted-foreground whitespace-nowrap ${
                  // The averages row is already tinted, so its pinned cell takes
                  // the opaque `muted` rather than the card colour.
                  i === 0
                    ? 'sticky left-0 z-10 bg-muted shadow-[1px_0_0_0_hsl(var(--border))]'
                    : ''
                }`}
              >
                {i === 0
                  ? 'AVG'
                  : i === 1
                  ? `over ${history.length} ${history.length === 1 ? 'fixture' : 'fixtures'}`
                  : col.averaged
                  ? avg(col.key)
                  : ''}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
    </Table>
  );

  return scroll ? (
    <Card className="overflow-x-auto">{table}</Card>
  ) : (
    <div className="rounded-lg border border-border bg-card">{table}</div>
  );
}

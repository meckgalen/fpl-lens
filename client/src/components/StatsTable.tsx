import { useState } from 'react';
import type { GameweekHistory, Team } from '../types/fpl';
import { NO_VALUE, fmtNum } from '../types/fpl';
import { Card } from './ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';

interface Props {
  history: GameweekHistory[];
  teams: Team[];
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
  { key: 'expected_goals', label: 'xG', render: (g) => fmtNum(g.expected_goals, 2), averaged: true },
  { key: 'expected_assists', label: 'xA', render: (g) => fmtNum(g.expected_assists, 2), averaged: true },
  {
    key: 'expected_goal_involvements',
    label: 'xGI',
    render: (g) => fmtNum(g.expected_goal_involvements, 2),
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

/** The sortable/averageable value of a cell, or null where there is none. */
function numericValue(gw: GameweekHistory, key: SortKey): number | null {
  const v = gw[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' ? v : null;
}

export default function StatsTable({ history, teams }: Props) {
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

  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`text-right ${sortKey === col.key ? 'text-foreground' : ''}`}
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
            <TableRow key={gw.fixture}>
              {COLUMNS.map((col) => (
                <TableCell
                  key={col.key}
                  className="text-right font-display text-[13px] tabular-nums text-foreground whitespace-nowrap"
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
                className="text-right font-display text-[12px] tabular-nums text-muted-foreground whitespace-nowrap"
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
    </Card>
  );
}

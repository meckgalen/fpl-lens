import { useState } from 'react';
import type { GameweekHistory, Team } from '../types/fpl';
import { Card } from './ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';

interface Props {
  history: GameweekHistory[];
  teams: Team[];
}

type SortKey = keyof GameweekHistory;

const COLUMNS: { key: SortKey; label: string; format?: (v: any) => string }[] = [
  { key: 'round', label: 'GW' },
  { key: 'opponent_team', label: 'Opp' },
  { key: 'was_home', label: 'H/A', format: (v: boolean) => (v ? 'H' : 'A') },
  { key: 'total_points', label: 'Pts' },
  { key: 'minutes', label: 'Min' },
  { key: 'goals_scored', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'clean_sheets', label: 'CS' },
  { key: 'goals_conceded', label: 'GC' },
  { key: 'expected_goals', label: 'xG', format: (v: string) => parseFloat(v).toFixed(2) },
  { key: 'expected_assists', label: 'xA', format: (v: string) => parseFloat(v).toFixed(2) },
  { key: 'expected_goal_involvements', label: 'xGI', format: (v: string) => parseFloat(v).toFixed(2) },
  { key: 'ict_index', label: 'ICT', format: (v: string) => parseFloat(v).toFixed(1) },
  { key: 'influence', label: 'I', format: (v: string) => parseFloat(v).toFixed(1) },
  { key: 'creativity', label: 'C', format: (v: string) => parseFloat(v).toFixed(1) },
  { key: 'threat', label: 'T', format: (v: string) => parseFloat(v).toFixed(1) },
  { key: 'bonus', label: 'Bon' },
  { key: 'bps', label: 'BPS' },
  { key: 'value', label: 'Price', format: (v: number) => `£${(v / 10).toFixed(1)}` },
  { key: 'selected', label: 'Selected', format: (v: number) => v.toLocaleString() },
];

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
    const av = a[sortKey];
    const bv = b[sortKey];
    const numA = typeof av === 'string' ? parseFloat(av) : Number(av);
    const numB = typeof bv === 'string' ? parseFloat(bv) : Number(bv);
    return sortDir === 'asc' ? numA - numB : numB - numA;
  });

  const avg = (key: SortKey) => {
    if (history.length === 0) return '–';
    const sum = history.reduce((acc, gw) => {
      const v = gw[key];
      return acc + (typeof v === 'string' ? parseFloat(v) : Number(v));
    }, 0);
    return (sum / history.length).toFixed(1);
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
          {sorted.map((gw) => (
            <TableRow key={gw.round}>
              {COLUMNS.map((col) => (
                <TableCell
                  key={col.key}
                  className="text-right font-display text-[13px] tabular-nums text-foreground whitespace-nowrap"
                >
                  {col.key === 'opponent_team'
                    ? teamMap[gw.opponent_team] || gw.opponent_team
                    : col.format
                    ? col.format(gw[col.key])
                    : String(gw[col.key])}
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
                  : col.key === 'opponent_team' || col.key === 'was_home'
                  ? ''
                  : avg(col.key)}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

import { Fragment, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { PlayerAvatar, PosBadge, StatusDot } from '../components/PosBadge';
import { POSITION_MAP, fmtNum, statusBucket } from '../types/fpl';
import type { Player } from '../types/fpl';
import { useBootstrap } from '../lib/bootstrap';

/**
 * `form` and `selected_by_percent` were columns here and were sortable. Both
 * have no source in the database and arrive null, so parseFloat gave NaN and
 * the sort left the table in arbitrary order while the header still showed an
 * arrow. They are dropped rather than null-guarded: a stable order on a field
 * with no values is still meaningless, and an always-empty column is noise.
 * They come back with the live bootstrap sync. `ppm` replaces them with a real
 * aggregate.
 */
type SortKey = 'pts' | 'ppm' | 'price' | 'goals' | 'assists';
const POSITIONS = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'] as const;

const numForKey = (p: Player, k: SortKey): number => {
  switch (k) {
    case 'pts':
      return p.total_points;
    case 'ppm':
      return parseFloat(p.points_per_game);
    case 'price':
      return p.now_cost;
    case 'goals':
      return p.goals_scored;
    case 'assists':
      return p.assists;
  }
};

export default function Players({ onOpenDetail }: { onOpenDetail: (player: Player) => void }) {
  const b = useBootstrap();
  const teamMap = useMemo(() => Object.fromEntries(b.teams.map((t) => [t.id, t.short_name])), [b.teams]);

  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>('ALL');
  const [sort, setSort] = useState<SortKey>('pts');
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const cols: { v: SortKey; l: string }[] = [
    { v: 'pts', l: 'Pts' },
    { v: 'ppm', l: 'PPM' },
    { v: 'price', l: 'Price' },
    { v: 'goals', l: 'G' },
    { v: 'assists', l: 'A' },
  ];

  const handleSort = (k: SortKey) => {
    if (sort === k) setSortDir((d) => (d * -1) as -1 | 1);
    else {
      setSort(k);
      setSortDir(-1);
    }
  };

  const list = useMemo(() => {
    const q = search.toLowerCase();
    return b.players
      .filter((p) => {
        if (pos !== 'ALL' && POSITION_MAP[p.element_type] !== pos) return false;
        if (q.length < 1) return true;
        const name = `${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();
        return name.includes(q);
      })
      .sort((a, c) => sortDir * (numForKey(c, sort) - numForKey(a, sort)));
  }, [b.players, search, pos, sort, sortDir]);

  const colWidth = 4 + cols.length;

  const renderCell = (p: Player, v: SortKey) => {
    switch (v) {
      case 'price':
        return `£${(p.now_cost / 10).toFixed(1)}`;
      case 'ppm':
        return fmtNum(p.points_per_game, 1);
      case 'pts':
        return p.total_points;
      case 'goals':
        return p.goals_scored;
      case 'assists':
        return p.assists;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-foreground">Player Statistics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {list.length} players · Click column header to sort · Click row to expand
        </p>
      </div>

      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-input bg-card shadow-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-44"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-0.5 p-1 bg-card border border-border rounded-lg">
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPos(p)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                pos === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-muted-foreground">{list.length} players</span>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4"> </TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Pos</TableHead>
              <TableHead>Status</TableHead>
              {cols.map((c) => (
                <TableHead
                  key={c.v}
                  className={`text-right ${sort === c.v ? 'text-foreground' : ''}`}
                  onClick={() => handleSort(c.v)}
                >
                  {c.l}
                  {sort === c.v && <span className="ml-0.5 opacity-50 text-[9px]">{sortDir < 0 ? '▾' : '▴'}</span>}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.slice(0, 200).map((p) => {
              const bucket = statusBucket(p.status);
              return (
                <Fragment key={p.id}>
                  <TableRow
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  >
                    <TableCell className="p-1.5 pl-4">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-end justify-center overflow-hidden">
                        <PlayerAvatar size={22} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-[13px] text-foreground">{p.web_name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{teamMap[p.team]}</div>
                    </TableCell>
                    <TableCell>
                      <PosBadge pos={POSITION_MAP[p.element_type]} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={bucket} />
                        <span className="text-xs text-muted-foreground capitalize">{bucket}</span>
                      </div>
                    </TableCell>
                    {cols.map((c) => (
                      <TableCell
                        key={c.v}
                        className={`text-right font-display text-[13px] tabular-nums ${
                          sort === c.v ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'
                        }`}
                      >
                        {renderCell(p, c.v)}
                      </TableCell>
                    ))}
                  </TableRow>

                  {expanded === p.id && (
                    <tr>
                      <td colSpan={colWidth} className="p-0">
                        <div className="px-4 py-3 bg-muted/50 flex gap-8 flex-wrap items-center">
                          {[
                            ['Minutes', p.minutes],
                            ['Bonus', p.bonus],
                            ['BPS', p.bps],
                            ['xG', fmtNum(p.expected_goals, 2)],
                            ['xA', fmtNum(p.expected_assists, 2)],
                            ['ICT', fmtNum(p.ict_index, 1)],
                            ['News', p.news || '—'],
                          ].map(([label, value]) => (
                            <div key={String(label)}>
                              <div className="text-[9.5px] text-muted-foreground uppercase tracking-[.07em] mb-1">
                                {label}
                              </div>
                              <div className="font-display font-semibold text-[15px] text-foreground tabular-nums">
                                {value}
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => onOpenDetail(p)}
                            className="ml-auto px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                          >
                            View gameweek detail →
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

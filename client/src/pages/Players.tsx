import { Fragment, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { DisclosureButton } from '../components/ui/DisclosureButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { PlayerAvatar, PosBadge, StatusDot } from '../components/PosBadge';
import { POSITION_MAP, fmtNum, fmtPrice, statusBucket } from '../types/fpl';
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

/** The row a player's toggle points `aria-controls` at while it is open. */
const expandedRowId = (playerCode: number) => `player-summary-${playerCode}`;

const numForKey = (p: Player, k: SortKey): number => {
  switch (k) {
    case 'pts':
      return p.total_points;
    case 'ppm':
      return p.points_per_game;
    case 'price':
      // now_cost is null only for a player with no season row, which cannot
      // reach this list. Sorting them last is still better than NaN, which
      // would strand the whole comparator.
      return p.now_cost ?? 0;
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
      // Ascending, then flipped by sortDir, so -1 is descending and matches the
      // ▾ the header draws for it. It used to be `c - a` here, descending
      // already, which sortDir then inverted: the default view was the
      // lowest-scoring players under a descending arrow. The old default sort
      // key was `form`, which is null, so the comparator returned NaN, sort left
      // the array in the order the API sent it, and the inversion never showed.
      .sort((a, c) => sortDir * (numForKey(a, sort) - numForKey(c, sort)));
  }, [b.players, search, pos, sort, sortDir]);

  const colWidth = 4 + cols.length;

  const renderCell = (p: Player, v: SortKey) => {
    switch (v) {
      case 'price':
        return fmtPrice(p.now_cost);
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
        <h1 className="font-display text-xl font-semibold text-foreground">
          Player Statistics · {b.season}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {list.length} players · Click column header to sort · Click row to expand
        </p>
      </div>

      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        {/* The search input carried a bare `outline-none` and no replacement, so
            focus landed in a text field with nothing on screen saying so — the
            worst of the focus defects, because there is no visible cursor
            anywhere else to fall back on.

            The ring goes on the wrapper, not the input: `Input.tsx` puts the
            border and the ring on the same element, and here the border is on
            this div while the input inside is deliberately borderless. A ring
            around the text alone would sit inside the border it belongs
            outside. `focus-within` rather than `focus-visible` because the
            element being outlined is not the element receiving focus; for a
            text field the two fire together anyway, since browsers match
            `:focus-visible` on text inputs even when they are clicked. */}
        <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
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
                  // -1 is descending here, which is what the ▾ draws for it.
                  sortDirection={
                    sort === c.v ? (sortDir < 0 ? 'descending' : 'ascending') : 'none'
                  }
                >
                  {c.l}
                  {sort === c.v && (
                    <span aria-hidden="true" className="ml-0.5 opacity-50 text-[9px]">
                      {sortDir < 0 ? '▾' : '▴'}
                    </span>
                  )}
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
                      {/* The same disclosure the career table uses, so one
                          gesture works identically in both. The button carries
                          the player's name, which makes that its accessible
                          name — 200 rows of an icon-only button would announce
                          "button" 200 times. The club stays outside it: it is
                          context for the row, not part of the control's name. */}
                      <DisclosureButton
                        expanded={expanded === p.id}
                        controls={expandedRowId(p.id)}
                        onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
                        className="font-medium text-[13px] text-foreground"
                      >
                        {p.web_name}
                      </DisclosureButton>
                      <div className="text-[10px] text-muted-foreground mt-0.5 pl-4">
                        {teamMap[p.team]}
                      </div>
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
                    <tr id={expandedRowId(p.id)}>
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

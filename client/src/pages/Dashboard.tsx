import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { PlayerAvatar, PosBadge } from '../components/PosBadge';
import { Countdown } from '../components/Countdown';
import { POSITION_MAP } from '../types/fpl';
import { currentGameweek, nextGameweek, useBootstrap } from '../lib/bootstrap';

export default function Dashboard() {
  const b = useBootstrap();
  const teamMap = useMemo(() => Object.fromEntries(b.teams.map((t) => [t.id, t.short_name])), [b.teams]);

  const cur = currentGameweek(b);
  const next = nextGameweek(b);
  const deadline = next?.deadline_time ? new Date(next.deadline_time).getTime() : Date.now();

  // Top performers by form (a reasonable stand-in for "GW{N} top scorers"
  // since the bootstrap endpoint doesn't include per-GW points for every player).
  const topGW = useMemo(
    () =>
      [...b.players]
        .sort((a, c) => parseFloat(c.form) - parseFloat(a.form))
        .slice(0, 6),
    [b.players]
  );

  // Captain suggestions and xP leaders both use form as proxy expected-points
  // until the prediction model lands.
  const captains = useMemo(
    () => [...b.players].sort((a, c) => parseFloat(c.form) - parseFloat(a.form)).slice(0, 3),
    [b.players]
  );
  const xpTop = useMemo(
    () => [...b.players].sort((a, c) => parseFloat(c.form) - parseFloat(a.form)).slice(0, 7),
    [b.players]
  );

  const gwAverage = cur ? '–' : '–'; // FPL bootstrap event objects carry avg in `average_entry_score` when surfaced; placeholder for now
  const topScore = '–';

  const deadlineLabel = next?.deadline_time
    ? new Date(next.deadline_time).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'TBD';

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gameweek {cur?.id ?? '–'} · Next deadline{' '}
          <span className="font-medium text-foreground">{deadlineLabel}</span>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mb-3.5">
        <Card>
          <CardContent className="py-4">
            <div className="font-display text-3xl font-bold tabular-nums text-foreground">{gwAverage}</div>
            <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mt-1">
              GW{cur?.id ?? '?'} Average
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="font-display text-3xl font-bold tabular-nums text-foreground">{topScore}</div>
            <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mt-1">Top Score</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Countdown target={deadline} />
            <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mt-1">
              Until GW{next?.id ?? '?'} Deadline
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3.5 mb-3.5">
        <Card>
          <CardHeader>
            <CardTitle>Top Performers (Form)</CardTitle>
            <Badge variant="secondary">Gameweek {cur?.id ?? '?'}</Badge>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 pl-4">#</TableHead>
                <TableHead className="w-10"> </TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead className="text-right pr-4">Form</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topGW.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell className="font-display font-semibold text-border pl-4">{i + 1}</TableCell>
                  <TableCell className="p-1.5 pl-3">
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
                  <TableCell className="text-right font-display font-bold text-[15px] text-foreground pr-4">
                    {p.form}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Captain Suggestions</CardTitle>
            <Badge variant="primary-tint">GW{next?.id ?? '?'}</Badge>
          </CardHeader>
          <CardContent className="pt-3 pb-2">
            {captains.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 py-3 ${i < captains.length - 1 ? 'border-b border-border' : ''}`}
              >
                <span className="font-display font-bold text-[11px] text-border w-4 text-center">#{i + 1}</span>
                <div className="w-9 h-9 rounded-lg bg-muted flex items-end justify-center overflow-hidden flex-shrink-0">
                  <PlayerAvatar size={26} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13px] text-foreground">{p.web_name}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="secondary" className="text-[9px] py-0 px-1.5">
                      {teamMap[p.team]}
                    </Badge>
                    <PosBadge pos={POSITION_MAP[p.element_type]} />
                    <span className="text-[10px] text-muted-foreground">£{(p.now_cost / 10).toFixed(1)}m</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-display font-bold text-xl text-foreground tabular-nums">{p.form}</div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Form</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expected Points Leaders</CardTitle>
          <Badge variant="primary-tint">GW{next?.id ?? '?'}</Badge>
        </CardHeader>
        <CardContent className="pt-3 pb-2">
          {xpTop.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 py-2.5 ${i < xpTop.length - 1 ? 'border-b border-border' : ''}`}
            >
              <span className="font-display font-bold text-[11px] text-border w-4 text-center shrink-0">{i + 1}</span>
              <div className="w-8 h-8 rounded-lg bg-muted flex items-end justify-center overflow-hidden flex-shrink-0">
                <PlayerAvatar size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13px] text-foreground truncate">{p.web_name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <PosBadge pos={POSITION_MAP[p.element_type]} />
                  <span className="text-[10px] text-muted-foreground">
                    {teamMap[p.team]} · £{(p.now_cost / 10).toFixed(1)}m
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-display font-bold text-[15px] text-foreground tabular-nums">{p.form}</div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Form</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

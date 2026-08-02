import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { PlayerAvatar, PosBadge } from '../components/PosBadge';
import { Countdown } from '../components/Countdown';
import { NO_DEADLINE, POSITION_MAP, fmtNum, fmtPrice } from '../types/fpl';
import { currentGameweek, nextGameweek, useBootstrap } from '../lib/bootstrap';

/**
 * Minimum appearances before a per-match average is worth ranking on.
 *
 * Picked from the appearance distribution, not by feel. In 2025-26, of 841
 * players 304 never appeared, 76 made 1-4 appearances and 47 made 5-9. Sorting
 * by raw points-per-game with no floor puts a one-appearance substitute on 7.0
 * above Haaland's 6.8 from 35 matches. Checking the top five at successive
 * floors, the small-sample noise is gone by 5 and the list is then identical at
 * 5, 8, 10 and 12 — so anything in that band costs nothing, and a higher floor
 * buys sample size for free.
 *
 * 10 is a quarter of a 38-game season and leaves a near-constant eligible pool
 * across very different seasons: 393 of the 524 who played in 2016-17, 393 of
 * 515 in 2019-20, 414 of 537 in 2025-26. The UI label states the number, so the
 * ranking is honest about who it leaves out.
 */
const MIN_APPEARANCES = 10;

export default function Dashboard() {
  const b = useBootstrap();
  const teamMap = useMemo(() => Object.fromEntries(b.teams.map((t) => [t.id, t.short_name])), [b.teams]);

  const cur = currentGameweek(b);
  const next = nextGameweek(b);
  const deadline = next?.deadline_time ? new Date(next.deadline_time).getTime() : null;

  // Every ranking below used to sort on `form`, which the database has no
  // source for and which now arrives null: parseFloat(null) is NaN, a NaN
  // comparator leaves the array in whatever order it arrived, and the section
  // went on calling itself a ranking. These three sort on real aggregates.
  //
  // form would be the wrong metric even if it were populated. FPL computes it
  // over the last 30 days, and trailing form only means something when there is
  // a next gameweek to predict. These seasons are over.
  const topPoints = useMemo(
    () => [...b.players].sort((a, c) => c.total_points - a.total_points).slice(0, 6),
    [b.players]
  );

  // `appearances` now comes from the aggregate. It used to be recovered here as
  // total_points / points_per_game, which is off by an appearance either way on
  // the rounding and reads 0 for anyone who appeared and scored nothing.
  const bestPerMatch = useMemo(
    () =>
      b.players
        .filter((p) => p.appearances >= MIN_APPEARANCES)
        .sort((a, c) => c.points_per_game - a.points_per_game)
        .slice(0, 3),
    [b.players]
  );

  const ictTop = useMemo(
    () => [...b.players].sort((a, c) => c.ict_index - a.ict_index).slice(0, 7),
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
    : NO_DEADLINE;

  return (
    <div>
      <div className="mb-6">
        {/* The season is named here, and on every other page header, because
            the database holds ten of them and a payload from the wrong one
            looks exactly like the right one. */}
        <h1 className="font-display text-xl font-semibold text-foreground">Dashboard · {b.season}</h1>
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
            <CardTitle>Top Performers · Total points</CardTitle>
            <Badge variant="secondary">Season</Badge>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 pl-4">#</TableHead>
                <TableHead className="w-10"> </TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead className="text-right pr-4">Pts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPoints.map((p, i) => (
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
                    {p.total_points}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            {/* Not "Captain Suggestions": a captain pick needs fixture difficulty,
                minutes risk, form and ownership, none of which exists here.
                Points per match is a real number, so that is what it says. */}
            <CardTitle>Best points per match</CardTitle>
            <Badge variant="primary-tint">min {MIN_APPEARANCES} apps</Badge>
          </CardHeader>
          <CardContent className="pt-3 pb-2">
            {bestPerMatch.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 py-3 ${i < bestPerMatch.length - 1 ? 'border-b border-border' : ''}`}
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
                    <span className="text-[10px] text-muted-foreground">{fmtPrice(p.now_cost)}m</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-display font-bold text-xl text-foreground tabular-nums">
                    {fmtNum(p.points_per_game, 1)}
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">PPM</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          {/* Was "Expected Points Leaders", ranked on form as a stand-in for a
              prediction model. No such model exists — it is deferred work — and a
              heading that implies one is how a future session concludes it was
              already started. ICT is FPL's own composite and is non-null in all
              ten seasons. */}
          <CardTitle>ICT Index Leaders</CardTitle>
          <Badge variant="primary-tint">Season</Badge>
        </CardHeader>
        <CardContent className="pt-3 pb-2">
          {ictTop.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 py-2.5 ${i < ictTop.length - 1 ? 'border-b border-border' : ''}`}
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
                    {teamMap[p.team]} · {fmtPrice(p.now_cost)}m
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-display font-bold text-[15px] text-foreground tabular-nums">
                  {fmtNum(p.ict_index, 1)}
                </div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">ICT</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

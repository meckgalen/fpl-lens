import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { PosBadge } from '../components/PosBadge';
import { PlayerShirt } from '../components/PlayerShirt';
import { Countdown } from '../components/Countdown';
import { OpenPlayerButton } from '../components/OpenPlayerButton';
import { NO_DEADLINE, NO_VALUE, POSITION_MAP, fmtNum, fmtPrice } from '../types/fpl';
import type { Player } from '../types/fpl';
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

/**
 * What the three rankings say when there is nothing to rank.
 *
 * **The wording is about the data, not the calendar, and that is the whole
 * point of it.** "Rankings start after Gameweek 1" would be a claim about time
 * sitting under a gate that is a claim about data, and the two come apart in a
 * window that is guaranteed to exist: GW1 is played on 21 August, the
 * incremental gameweek sync is a later item, and in between every player has
 * zero appearances while Gameweek 1 is over. Promising something that has
 * already happened is worse than saying nothing.
 *
 * This is the distinction item 1 drew between its two no-rows empty states, in
 * the other direction: there, "once the season is underway" was rejected for a
 * player who was never registered, because it promised something that would
 * never arrive.
 */
function NoMatchesYet({ season }: { season: string }) {
  return (
    <p className="text-center text-sm text-muted-foreground py-8">
      No matches recorded for {season} yet.
    </p>
  );
}

/**
 * The three rankings had no click handler at all — not a broken one, none — so
 * the career view item 1 built was reachable only through the Players list.
 * `onOpenDetail` is the prop that list already takes, filled by `App.tsx` with
 * `setDetailPlayer`: one route into the detail page rather than two that can
 * drift apart.
 */
export default function Dashboard({
  onOpenDetail,
}: {
  onOpenDetail: (player: Player) => void;
}) {
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

  /**
   * Whether any match in this season has been recorded at all.
   *
   * Gated on appearances rather than on the date, because appearances are what
   * all three rankings are computed from: with none, "Top Performers" is six
   * players tied on zero in whatever order the array arrived, "Best points per
   * match" is empty because nobody clears the appearance floor, and "ICT
   * Leaders" is seven more zeroes. Sorting produced those lists; it did not
   * produce a ranking, and the page should not present them as one.
   *
   * True for a season whose fixtures have not started, which is the state
   * 2026-27 is in — and, deliberately, still true after Gameweek 1 is played
   * and before it is ingested. See NoMatchesYet above for why the wording has
   * to match the gate.
   */
  const noMatchesYet = useMemo(() => b.players.every((p) => p.appearances === 0), [b.players]);

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
        {/* Both halves are dropped rather than printed empty when the season
            has no current or next round, which is every completed season:
            "Gameweek – · Next deadline TBD" is two placeholders pretending to
            be a status line. The gate is the derived flag, not any notion of
            the season being over — see lib/bootstrap.ts. */}
        {(cur || next) && (
          <p className="text-sm text-muted-foreground mt-1">
            {cur && <>Gameweek {cur.id}</>}
            {cur && next && ' · '}
            {next && (
              <>
                Next deadline <span className="font-medium text-foreground">{deadlineLabel}</span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3.5 mb-3.5">
        <Card>
          <CardContent className="py-4">
            <div className="font-display text-3xl font-bold tabular-nums text-foreground">{gwAverage}</div>
            <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mt-1">
              {cur ? `GW${cur.id} Average` : 'Gameweek Average'}
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
            {/* No next gameweek means no countdown at all, rather than a
                Countdown handed null — that renders 'TBD', which promises a
                deadline still to be determined. Over a season with no next
                round there is nothing left to determine. */}
            {next ? (
              <Countdown target={deadline} />
            ) : (
              <div className="font-display text-3xl font-bold tabular-nums text-foreground">
                {NO_VALUE}
              </div>
            )}
            <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mt-1">
              {next ? `Until GW${next.id} Deadline` : 'Next Deadline'}
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
          {noMatchesYet ? (
            <NoMatchesYet season={b.season} />
          ) : (
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
                      <PlayerShirt teamCode={p.team} elementType={p.element_type} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <OpenPlayerButton
                      player={p}
                      onOpenDetail={onOpenDetail}
                      className="font-medium text-[13px] text-foreground"
                    />
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
          )}
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
            {noMatchesYet && <NoMatchesYet season={b.season} />}
            {bestPerMatch.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 py-3 ${i < bestPerMatch.length - 1 ? 'border-b border-border' : ''}`}
              >
                <span className="font-display font-bold text-[11px] text-border w-4 text-center">#{i + 1}</span>
                <div className="w-9 h-9 rounded-lg bg-muted flex items-end justify-center overflow-hidden flex-shrink-0">
                  <PlayerShirt teamCode={p.team} elementType={p.element_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <OpenPlayerButton
                    player={p}
                    onOpenDetail={onOpenDetail}
                    className="font-medium text-[13px] text-foreground"
                  />
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
          {noMatchesYet && <NoMatchesYet season={b.season} />}
          {!noMatchesYet && ictTop.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 py-2.5 ${i < ictTop.length - 1 ? 'border-b border-border' : ''}`}
            >
              <span className="font-display font-bold text-[11px] text-border w-4 text-center shrink-0">{i + 1}</span>
              <div className="w-8 h-8 rounded-lg bg-muted flex items-end justify-center overflow-hidden flex-shrink-0">
                <PlayerShirt teamCode={p.team} elementType={p.element_type} />
              </div>
              <div className="flex-1 min-w-0">
                <OpenPlayerButton
                  player={p}
                  onOpenDetail={onOpenDetail}
                  className="font-medium text-[13px] text-foreground truncate max-w-full"
                />
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

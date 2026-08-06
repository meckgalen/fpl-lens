import { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { FDRBadge } from '../components/PosBadge';
import { fetchFixtures } from '../services/api';
import type { Fixture } from '../types/fpl';
import { currentGameweek, nextGameweek, useBootstrap } from '../lib/bootstrap';

const FDR_LABELS: Record<number, string> = { 1: 'Very Easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very Hard' };

function formatDay(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function Fixtures() {
  const b = useBootstrap();
  const teamMap = useMemo(() => Object.fromEntries(b.teams.map((t) => [t.id, t.short_name])), [b.teams]);
  const cur = currentGameweek(b);
  const next = nextGameweek(b);

  const [tab, setTab] = useState<'upcoming' | 'results'>('upcoming');
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The rounds this page shows, which is not the same question as "which round
   * is next".
   *
   * `nextGameweek` answers the second and returns null on every completed
   * season, which is correct and useless here: a season with nothing upcoming
   * still has a last round worth looking at, and this page's whole job is to
   * show one. So the fallbacks that used to live inside the helpers live here
   * instead, under names that say what they are. Behaviour is unchanged on
   * every season; what changed is that a display decision is no longer being
   * made by a function answering something else.
   */
  const upcomingRound =
    next?.id ?? b.events.find((e) => !e.finished)?.id ?? b.events[b.events.length - 1]?.id;
  // The final `?? b.events[0]` is not padding. A season where nothing has been
  // played has no finished round, and without it this is undefined: the effect
  // returns early, the previous tab's fixtures stay mounted, and the heading
  // reads "Gameweek ? results" over them. Caught in the browser on 2026-27,
  // where every fixture is unplayed — stale rows under a wrong label, which is
  // worse than the empty round it was trying to avoid.
  const resultsRound =
    cur?.id ?? b.events.filter((e) => e.finished).pop()?.id ?? b.events[0]?.id;
  const targetGw = tab === 'upcoming' ? upcomingRound : resultsRound;

  useEffect(() => {
    if (!targetGw) return;
    setFixtures(null);
    setError(null);
    // The season is sent, and is in the deps. Both matter and the second is the
    // subtle one: `targetGw` is a NUMBER, and two seasons that both end at
    // round 38 produce the same one — so keying the effect on it alone meant a
    // season change did not refetch, and the page kept rendering the previous
    // season's fixtures under the new season's heading.
    fetchFixtures(targetGw, b.season)
      .then((d) => {
        setFixtures(d.fixtures);
        // Labelled from this response rather than from bootstrap, so the
        // heading describes the rows actually on screen.
        setSeason(d.season);
      })
      .catch((err) => setError(err.message));
  }, [targetGw, b.season]);

  const byDay = useMemo(() => {
    const grouped: Record<string, Fixture[]> = {};
    for (const f of fixtures ?? []) {
      const day = formatDay(f.kickoff_time);
      (grouped[day] ||= []).push(f);
    }
    return grouped;
  }, [fixtures]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-foreground">
          Fixtures · {season ?? b.season}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {tab === 'upcoming'
            ? `Gameweek ${upcomingRound ?? '?'} — difficulty ratings shown per team`
            : `Gameweek ${resultsRound ?? '?'} results`}
        </p>
      </div>

      <div className="flex gap-0.5 p-1 bg-card border border-border rounded-lg mb-4 w-fit">
        {([
          ['upcoming', `GW${upcomingRound ?? '?'} Upcoming`],
          ['results', `GW${resultsRound ?? '?'} Results`],
        ] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden mb-3">
        {error && <div className="px-5 py-4 text-sm text-destructive">{error}</div>}
        {!error && fixtures == null && (
          <div className="px-5 py-4 text-sm text-muted-foreground">Loading fixtures…</div>
        )}
        {!error &&
          fixtures != null &&
          Object.entries(byDay).map(([day, ms]) => (
            <div key={day}>
              <div className="px-5 py-2 bg-muted text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground">
                {day}
              </div>
              {ms.map((m, i) => {
                const h = teamMap[m.team_h] ?? '?';
                const a = teamMap[m.team_a] ?? '?';
                if (tab === 'results') {
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center px-5 py-3 hover:bg-muted/40 transition-colors ${
                        i < ms.length - 1 ? 'border-b border-border' : ''
                      }`}
                    >
                      <span className="flex-1 text-right text-sm font-medium text-foreground">{h}</span>
                      <span className="w-16 text-center font-display font-bold text-sm tabular-nums text-foreground">
                        {m.team_h_score ?? '–'} – {m.team_a_score ?? '–'}
                      </span>
                      <span className="flex-1 text-sm font-medium text-foreground">{a}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={m.id}
                    className={`flex items-center px-5 py-3 hover:bg-muted/40 transition-colors ${
                      i < ms.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <div className="flex-1 flex items-center justify-end gap-2">
                      <span className="text-sm font-medium text-foreground">{h}</span>
                      <FDRBadge value={m.team_h_difficulty} />
                    </div>
                    <span className="w-8 text-center text-xs text-muted-foreground">vs</span>
                    <div className="flex-1 flex items-center gap-2">
                      <FDRBadge value={m.team_a_difficulty} />
                      <span className="text-sm font-medium text-foreground">{a}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </Card>

      {tab === 'upcoming' && (
        <div className="flex items-center gap-4 px-4 py-2.5 bg-card border border-border rounded-lg flex-wrap">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">FDR</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="flex items-center gap-1.5">
              <FDRBadge value={n} />
              <span className="text-xs text-muted-foreground">{FDR_LABELS[n]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

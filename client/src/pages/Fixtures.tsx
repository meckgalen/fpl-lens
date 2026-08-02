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

  const targetGw = tab === 'upcoming' ? next?.id : cur?.id;

  useEffect(() => {
    if (!targetGw) return;
    setFixtures(null);
    setError(null);
    fetchFixtures(targetGw)
      .then((d) => {
        setFixtures(d.fixtures);
        // Labelled from this response rather than from bootstrap, so the
        // heading describes the rows actually on screen.
        setSeason(d.season);
      })
      .catch((err) => setError(err.message));
  }, [targetGw]);

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
            ? `Gameweek ${next?.id ?? '?'} — difficulty ratings shown per team`
            : `Gameweek ${cur?.id ?? '?'} results`}
        </p>
      </div>

      <div className="flex gap-0.5 p-1 bg-card border border-border rounded-lg mb-4 w-fit">
        {([
          ['upcoming', `GW${next?.id ?? '?'} Upcoming`],
          ['results', `GW${cur?.id ?? '?'} Results`],
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

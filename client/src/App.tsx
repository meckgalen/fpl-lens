import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchBootstrap } from './services/api';
import type { BootstrapData, Player } from './types/fpl';
import { BootstrapContext, nextGameweek } from './lib/bootstrap';
import { Switch } from './components/ui/Switch';
import { Countdown } from './components/Countdown';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import Fixtures from './pages/Fixtures';
import PlayerDetail from './pages/PlayerDetail';

type PageId = 'dashboard' | 'players' | 'fixtures';

const NAV: { id: PageId; label: string; icon: ReactNode }[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'players',
    label: 'Players',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    id: 'fixtures',
    label: 'Fixtures',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
];

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('fpl-theme') === 'dark');
  const [page, setPage] = useState<PageId>(() => (localStorage.getItem('fpl-page') as PageId) || 'dashboard');
  const [detailPlayer, setDetailPlayer] = useState<Player | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('fpl-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    localStorage.setItem('fpl-page', page);
  }, [page]);

  useEffect(() => {
    fetchBootstrap()
      .then((d) => setBootstrap(d))
      .catch((err) => setError(err.message));
  }, []);

  const next = bootstrap ? nextGameweek(bootstrap) : null;
  const deadlineLabel = next?.deadline_time
    ? new Date(next.deadline_time).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const deadlineTs = next?.deadline_time ? new Date(next.deadline_time).getTime() : null;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-destructive">Failed to load FPL data: {error}</p>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-muted-foreground">Loading FPL data…</p>
      </div>
    );
  }

  const handleSelectPage = (id: PageId) => {
    setPage(id);
    setDetailPlayer(null);
  };

  return (
    <BootstrapContext.Provider value={bootstrap}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <aside className="w-56 flex-shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border transition-colors duration-300">
          <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sidebar-border">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-display font-bold text-[13px] tracking-tight flex-shrink-0">
              FL
            </div>
            <span className="font-display font-semibold text-[15.5px] text-sidebar-foreground">FPL Lens</span>
          </div>

          <nav className="flex-1 py-3 overflow-y-auto">
            <p className="px-5 pt-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
              Menu
            </p>
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => handleSelectPage(n.id)}
                className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] border-l-2 transition-all text-left ${
                  page === n.id && !detailPlayer
                    ? 'border-l-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'border-l-transparent text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/40'
                }`}
              >
                <span className={page === n.id && !detailPlayer ? 'opacity-100' : 'opacity-60'}>{n.icon}</span>
                {n.label}
              </button>
            ))}

            {next && (
              <>
                <p className="px-5 pt-5 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
                  GW{next.id}
                </p>
                <div className="px-5 pb-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-[.08em] mb-1.5">Deadline</p>
                  <Countdown target={deadlineTs} />
                  {deadlineLabel && <p className="text-[10px] text-muted-foreground mt-1">{deadlineLabel}</p>}
                </div>
              </>
            )}
          </nav>

          <div className="px-5 py-4 border-t border-sidebar-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{dark ? 'Dark' : 'Light'} mode</span>
            <Switch checked={dark} onCheckedChange={setDark} />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-8">
          {detailPlayer ? (
            <PlayerDetail player={detailPlayer} onBack={() => setDetailPlayer(null)} />
          ) : (
            <>
              {page === 'dashboard' && <Dashboard />}
              {page === 'players' && <Players onOpenDetail={setDetailPlayer} />}
              {page === 'fixtures' && <Fixtures />}
            </>
          )}
        </main>
      </div>
    </BootstrapContext.Provider>
  );
}

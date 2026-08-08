import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, fetchBootstrap } from './services/api';
import type { BootstrapData, Player } from './types/fpl';
import { BootstrapContext, nextGameweek } from './lib/bootstrap';
import { FOCUS_RING, cn } from './lib/cn';
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

  /**
   * The season of the request in flight, and **not** the selected season.
   *
   * The selected season is `bootstrap.season` — the one the server actually
   * served. Keeping a second piece of state for "the season the app is showing"
   * would be a second source of truth that can disagree with the payload on
   * screen, which is the whole class of bug API identity rule 7 exists to
   * prevent. This holds only what has been asked for and not yet answered, so a
   * pick shows in the control immediately and then reconciles to what arrived.
   *
   * Seeded from localStorage and deliberately not validated here: the list of
   * valid seasons arrives *on* the bootstrap response, so there is nothing to
   * validate against until the request this seeds has already been made. The
   * server is the validator — see the 400 branch below.
   */
  const [requested, setRequested] = useState<string | null>(() => localStorage.getItem('fpl-season'));
  const [switching, setSwitching] = useState(false);

  /**
   * The open player, held as a **code** rather than as a `Player` object.
   *
   * It used to be the whole object, snapshotted out of whichever bootstrap was
   * live when the row was clicked. That was inert while the app showed one
   * season and became a real defect the moment a selector existed: the header
   * card kept rendering the captured object while its season label came from
   * the live bootstrap, so one season's totals appeared under another season's
   * name. The code is permanent (rule 3), so re-resolving from the current
   * `players` gives a card that always agrees with its own label.
   */
  const [detailCode, setDetailCode] = useState<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('fpl-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    localStorage.setItem('fpl-page', page);
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    setSwitching(true);

    fetchBootstrap(requested ?? undefined)
      .then((d) => {
        if (cancelled) return;
        setBootstrap(d);
        // The SERVED season, never the requested one. They agree on the happy
        // path; where they do not — the parameter was absent and the default
        // applied — the served one is the only true answer, and persisting a
        // request nobody honoured would make the next reload ask for it again.
        localStorage.setItem('fpl-season', d.season);
        setSwitching(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        // An unknown season is recoverable and nothing else is. A stored season
        // this database does not have — a fresh clone, a rebuilt container —
        // must not leave a dead app, so it is dropped and the server asked for
        // its own default. A bare retry would do the same thing to a network
        // blip and silently discard the user's chosen season, which is why this
        // needs the status rather than just the failure.
        //
        // The default is not computed here from `available`: that would put a
        // second copy of `latestSeason()`'s rule in the client, free to drift
        // from the one on the server.
        if (err instanceof ApiError && err.status === 400 && requested !== null) {
          localStorage.removeItem('fpl-season');
          setRequested(null);
          // `switching` stays true: the retry this schedules is the same
          // transition, and clearing it here would flash the UI mid-recovery.
          return;
        }

        setError(err instanceof Error ? err.message : String(err));
        setSwitching(false);
      });

    // Stale responses must not win. Two selector changes in quick succession
    // can land out of order, and StrictMode double-invokes this effect on
    // mount, so the guard is load-bearing rather than defensive.
    return () => {
      cancelled = true;
    };
  }, [requested]);

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

  // Only ever the FIRST load. A season change keeps the previous bootstrap
  // mounted and swaps it atomically when the new payload lands, so the app is
  // never blanked mid-switch: during the transition every page shows the old
  // season's data under the old season's label, which is internally consistent
  // — which is the property that matters.
  if (!bootstrap) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-muted-foreground">Loading FPL data…</p>
      </div>
    );
  }

  const handleSelectPage = (id: PageId) => {
    setPage(id);
    setDetailCode(null);
  };

  // Re-resolved from the CURRENT bootstrap on every render, which is the fix:
  // the card cannot show a season's totals under a different season's label,
  // because there is no captured object to go stale. A player with no
  // player_seasons row for the selected season is simply absent here, and the
  // detail page renders him from his career identity instead.
  const detailPlayer = detailCode == null ? null : bootstrap.players.find((p) => p.id === detailCode) ?? null;
  const openDetail = (p: Player) => setDetailCode(p.id);

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
            {/* A real <select>: keyboard reach, a role and a name for free, and
                the same control GameweekFilters already uses. The visible
                label names it, so there is no aria-label that can drift out of
                agreement with what is on screen.

                Not disabled while switching. Disabling a focused control moves
                focus to <body>, which is exactly the class of regression item 3
                existed to remove; the busy state goes on the region whose
                content is stale instead. */}
            <div className="px-5 pt-3 pb-1.5">
              <label
                htmlFor="season-select"
                className="block pb-1.5 text-[9.5px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70"
              >
                Season
              </label>
              <select
                id="season-select"
                value={requested ?? bootstrap.season}
                onChange={(e) => setRequested(e.target.value)}
                className={cn(
                  'w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5',
                  'text-[13px] text-sidebar-foreground',
                  FOCUS_RING
                )}
              >
                {bootstrap.seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <p className="px-5 pt-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[.12em] text-muted-foreground/70">
              Menu
            </p>
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => handleSelectPage(n.id)}
                className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] border-l-2 transition-all text-left ${
                  page === n.id && detailCode == null
                    ? 'border-l-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'border-l-transparent text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/40'
                }`}
              >
                <span className={page === n.id && detailCode == null ? 'opacity-100' : 'opacity-60'}>{n.icon}</span>
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

        {/*
          The page padding is on the INNER div, not on `<main>`, and that is load-bearing
          rather than tidying.

          `<main>` is the scroll container. A scroll container's padding is inside its
          scrollport, so content scrolls *through* it — and a sticky header resolves
          against the content box, which `p-8` here pushed 32px down. The Players list's
          header stuck at 32px and rows scrolled visibly above it in the strip. Found in
          the browser; nothing in jsdom can see it, since jsdom has no scrollports.

          On an inner element the same 32px is ordinary content that scrolls away, so the
          header sticks flush at 0 and nothing can pass above it. Visually identical at
          rest, which is why this reads as a no-op and is not one.
        */}
        <main
          className={cn('flex-1 overflow-y-auto transition-opacity', switching && 'opacity-60')}
          aria-busy={switching}
        >
          <div className="p-8">
            {detailCode != null ? (
              <PlayerDetail code={detailCode} player={detailPlayer} onBack={() => setDetailCode(null)} />
            ) : (
              <>
                {page === 'dashboard' && <Dashboard onOpenDetail={openDetail} />}
                {page === 'players' && <Players onOpenDetail={openDetail} />}
                {page === 'fixtures' && <Fixtures />}
              </>
            )}
          </div>
        </main>
      </div>
    </BootstrapContext.Provider>
  );
}

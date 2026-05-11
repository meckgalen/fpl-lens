import { useEffect, useState } from 'react';
import PlayerHeader from '../components/PlayerHeader';
import GameweekFilters from '../components/GameweekFilters';
import StatsTable from '../components/StatsTable';
import type { GameweekHistory, Player } from '../types/fpl';
import { fetchPlayerDetail } from '../services/api';
import { useBootstrap } from '../lib/bootstrap';

export default function PlayerDetail({
  player,
  onBack,
}: {
  player: Player;
  onBack: () => void;
}) {
  const b = useBootstrap();
  const team = b.teams.find((t) => t.id === player.team);
  const maxGw = Math.max(b.events.filter((e) => e.finished).length, 1);

  const [history, setHistory] = useState<GameweekHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gwRange, setGwRange] = useState<[number, number]>([1, maxGw || 38]);
  const [homeAway, setHomeAway] = useState<'all' | 'home' | 'away'>('all');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPlayerDetail(player.id)
      .then((d) => setHistory(d.history))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [player.id]);

  const filtered = history.filter((gw) => {
    if (gw.round < gwRange[0] || gw.round > gwRange[1]) return false;
    if (homeAway === 'home' && !gw.was_home) return false;
    if (homeAway === 'away' && gw.was_home) return false;
    return true;
  });

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Back to players
      </button>

      <PlayerHeader player={player} team={team} />

      <GameweekFilters
        gwRange={gwRange}
        maxGw={maxGw || 38}
        homeAway={homeAway}
        onGwRangeChange={setGwRange}
        onHomeAwayChange={setHomeAway}
      />

      {loading && <p className="text-sm text-muted-foreground">Loading player data…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <>
          <StatsTable history={filtered} teams={b.teams} />
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">No data for the selected filters</p>
          )}
        </>
      )}
    </div>
  );
}

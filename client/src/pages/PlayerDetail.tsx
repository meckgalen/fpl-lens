import { useEffect, useMemo, useState } from 'react';
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

  /**
   * The rounds that exist, taken from the events themselves.
   *
   * This used to be `events.filter(e => e.finished).length` — a count used as a
   * maximum, which is only correct when the rounds run 1..n with none missing.
   * Two seasons break that, in opposite directions: 2019-20 has 38 rounds whose
   * highest is 47 (the Covid restart replayed rounds 30-38 as 39-47), so the
   * filter capped nine rounds below the end of the season; 2022-23 has 37
   * rounds whose highest is 38 (no round 7, postponed after the Queen's death),
   * so the filter cut off the final day.
   *
   * Listing the real round numbers fixes both and additionally stops the
   * dropdown offering rounds that never happened.
   */
  const rounds = useMemo(() => b.events.map((e) => e.id), [b.events]);
  const firstRound = rounds[0] ?? 1;
  const lastRound = rounds[rounds.length - 1] ?? 1;

  const [detail, setDetail] = useState<{ season: string; history: GameweekHistory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gwRange, setGwRange] = useState<[number, number]>([firstRound, lastRound]);
  const [homeAway, setHomeAway] = useState<'all' | 'home' | 'away'>('all');

  // The range follows the season rather than freezing at whatever it was
  // initialised with. useState's argument is read once, so without this a
  // season change would leave the filter on the previous season's rounds.
  useEffect(() => {
    setGwRange([firstRound, lastRound]);
  }, [firstRound, lastRound]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPlayerDetail(player.id, b.season)
      .then((d) => setDetail({ season: d.season, history: d.history }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [player.id, b.season]);

  const history = detail?.history ?? [];
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

      {/* The header's totals come from the bootstrap payload and the table below
          comes from the detail response, so each is labelled with its own
          response's season. They agree unless something has gone wrong, and
          that is the point: a season mismatch is otherwise only visible by
          recognising the opponent abbreviations. */}
      <PlayerHeader player={player} team={team} season={b.season} />

      {detail && detail.season !== b.season && (
        <p className="mb-4 text-sm text-destructive">
          These gameweeks are from {detail.season}, but the totals above are from {b.season}.
        </p>
      )}

      <GameweekFilters
        gwRange={gwRange}
        rounds={rounds}
        homeAway={homeAway}
        onGwRangeChange={setGwRange}
        onHomeAwayChange={setHomeAway}
      />

      {loading && <p className="text-sm text-muted-foreground">Loading player data…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <>
          <StatsTable history={filtered} teams={b.teams} />
          {/* Two different empty states. "No data for the selected filters" is
              misleading when the player simply has no rows at all — which is
              what a player who never appeared looks like, and what every player
              looks like during a preseason. */}
          {history.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              {player.web_name} has no recorded gameweeks in {detail?.season ?? b.season}.
            </p>
          ) : (
            filtered.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">
                None of {player.web_name}’s {history.length} matches match the selected filters.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

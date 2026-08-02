import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerHeader from '../components/PlayerHeader';
import GameweekFilters from '../components/GameweekFilters';
import GameweekSection from '../components/GameweekSection';
import CareerTable from '../components/CareerTable';
import type { Player, PlayerCareerSeason, PlayerDetailData } from '../types/fpl';
import { fetchPlayerCareer, fetchPlayerDetail } from '../services/api';
import { useBootstrap } from '../lib/bootstrap';

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3 mt-6">
      <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

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
   *
   * These are the CURRENT season's rounds, which is why they filter only the
   * "This Season" table. An expanded 2019-20 is shown whole.
   */
  const rounds = useMemo(() => b.events.map((e) => e.id), [b.events]);
  const firstRound = rounds[0] ?? 1;
  const lastRound = rounds[rounds.length - 1] ?? 1;

  /**
   * One entry per season fetched, so collapsing and re-expanding costs nothing.
   *
   * Keyed by season and reset when the player changes — a cache that outlived
   * its player would show the previous one's gameweeks under the new one's
   * name, which is the failure mode a cache has to be built not to have.
   */
  const [detailBySeason, setDetailBySeason] = useState<Record<string, PlayerDetailData>>({});
  const [career, setCareer] = useState<PlayerCareerSeason[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * Seasons with a request in flight, in a ref rather than in state.
   *
   * A state guard is read from the render that scheduled the click, so two
   * calls in the same tick both see it empty and both fetch. A ref is written
   * synchronously, which is what "is this already loading" has to be to work at
   * all. Nothing renders from it, so it does not want to be state.
   */
  const inFlight = useRef<Set<string>>(new Set());

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

  const loadSeason = useCallback(
    async (season: string) => {
      if (inFlight.current.has(season)) return;
      inFlight.current.add(season);
      try {
        const d = await fetchPlayerDetail(player.id, season);
        // Keyed on the season the RESPONSE resolved, not the one requested.
        // They agree today; keying on the request is how a cache starts lying
        // the moment they stop agreeing.
        setDetailBySeason((c) => ({ ...c, [d.season]: d }));
      } finally {
        inFlight.current.delete(season);
      }
    },
    [player.id]
  );

  // A new player invalidates everything held for the old one.
  useEffect(() => {
    setDetailBySeason({});
    setCareer(null);
    setExpanded(new Set());
    setLoading(true);
    setError(null);

    Promise.all([fetchPlayerDetail(player.id, b.season), fetchPlayerCareer(player.id)])
      .then(([detail, c]) => {
        setDetailBySeason({ [detail.season]: detail });
        setCareer(c.seasons);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [player.id, b.season]);

  const toggleSeason = (season: string) => {
    const isOpen = expanded.has(season);

    setExpanded((open) => {
      const next = new Set(open);
      // Collapse keeps the cached response, which is the whole point: reopening
      // is free.
      if (isOpen) next.delete(season);
      else next.add(season);
      return next;
    });

    // Outside the updater deliberately. A state updater must be pure — React
    // calls it twice under StrictMode precisely to surface side effects hidden
    // in one, and a fetch in there fired every request twice.
    if (!isOpen && !detailBySeason[season]) void loadSeason(season);
  };

  const current = detailBySeason[b.season];
  const history = current?.history ?? [];
  const filtered = history.filter((gw) => {
    if (gw.round < gwRange[0] || gw.round > gwRange[1]) return false;
    if (homeAway === 'home' && !gw.was_home) return false;
    if (homeAway === 'away' && gw.was_home) return false;
    return true;
  });

  // Whether the career says he was in the game that season at all. Distinct
  // from having no gameweeks in it — see GameweekSection.
  const registeredIn = (season: string) =>
    career === null || career.some((s) => s.season === season);

  const previousSeasons = (career ?? []).filter((s) => s.season !== b.season);

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

      {current && current.season !== b.season && (
        <p className="mb-4 text-sm text-destructive">
          These gameweeks are from {current.season}, but the totals above are from {b.season}.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading player data…</p>}

      {!loading && !error && (
        <>
          <SectionHeading title="This Season" note={b.season} />
          <GameweekFilters
            gwRange={gwRange}
            rounds={rounds}
            homeAway={homeAway}
            onGwRangeChange={setGwRange}
            onHomeAwayChange={setHomeAway}
          />
          <GameweekSection
            history={history}
            filtered={filtered}
            teams={current?.teams ?? b.teams}
            season={current?.season ?? b.season}
            playerName={player.web_name}
            registered={registeredIn(b.season)}
          />

          <SectionHeading
            title="Previous Seasons"
            note={
              previousSeasons.length === 0
                ? undefined
                : `${previousSeasons.length} ${
                    previousSeasons.length === 1 ? 'season' : 'seasons'
                  } — open one for its gameweeks`
            }
          />
          {previousSeasons.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              {b.season} is {player.web_name}’s first season in the game.
            </p>
          ) : (
            <CareerTable
              seasons={previousSeasons}
              expanded={expanded}
              onToggle={toggleSeason}
              renderExpanded={(season) => {
                const d = detailBySeason[season];
                if (!d) {
                  return (
                    <p className="text-center text-sm text-muted-foreground py-4">
                      Loading {season}…
                    </p>
                  );
                }
                return (
                  <GameweekSection
                    history={d.history}
                    teams={d.teams}
                    season={d.season}
                    playerName={player.web_name}
                    // A row only exists in this table because the career has
                    // that season, so registration is not in question here.
                    registered
                    scroll={false}
                  />
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerHeader from '../components/PlayerHeader';
import GameweekFilters from '../components/GameweekFilters';
import GameweekSection from '../components/GameweekSection';
import CareerTable from '../components/CareerTable';
import { FDRBadge } from '../components/PosBadge';
import type { Player, PlayerCareerSeason, PlayerDetailData, PlayerIdentity } from '../types/fpl';
import { fetchPlayerCareer, fetchPlayerDetail } from '../services/api';
import { useBootstrap } from '../lib/bootstrap';

/** How many of the remaining fixtures to show. Enough to plan a transfer on. */
const UPCOMING_SHOWN = 5;

/**
 * What the player has left to play.
 *
 * `PlayerDetailData.fixtures` has been served since step 6 and rendered
 * nowhere, because it was empty for every one of the ten completed seasons —
 * there is nothing left to play in a season that finished in May. 2026-27 is
 * the first season where it comes back non-empty, so this is the first time
 * there is anything to draw.
 *
 * It renders nothing at all when the list is empty, which keeps every
 * historical season's page exactly as it was.
 */
function UpcomingFixtures({
  fixtures,
  teams,
}: {
  fixtures: PlayerDetailData['fixtures'];
  teams: PlayerDetailData['teams'];
}) {
  if (fixtures.length === 0) return null;

  const shortName = (code: number) => teams.find((t) => t.id === code)?.short_name ?? String(code);

  return (
    <div className="flex flex-wrap gap-2">
      {fixtures.slice(0, UPCOMING_SHOWN).map((f) => {
        const opponent = f.is_home ? f.team_a : f.team_h;
        return (
          <div
            key={`${f.event}-${f.team_h}-${f.team_a}`}
            className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5"
          >
            <span className="text-[10px] uppercase tracking-[.07em] text-muted-foreground">
              GW{f.event ?? '?'}
            </span>
            <span className="text-[13px] font-medium text-foreground">
              {shortName(opponent)}
              {/* Lower-case (a) is FPL's own notation for an away fixture. */}
              <span className="text-muted-foreground"> {f.is_home ? '(H)' : '(A)'}</span>
            </span>
            <FDRBadge value={f.difficulty} />
          </div>
        );
      })}
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3 mt-6">
      <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/**
 * "This season has not been fetched yet", which is not the same thing as
 * "there is nothing in it".
 *
 * One component for both call sites. The career table's expanded rows have
 * always drawn this; the "This Season" section needed it once item 8 let the
 * season change under an open page. `GameweekSection` cannot draw it, because
 * all it receives is a `history` array and an empty array and an absent one
 * look identical from there — it would render "Data will appear here once the
 * 2025-26 season is underway" about a season that finished in May.
 */
function SeasonLoading({ season }: { season: string }) {
  return <p className="text-center text-sm text-muted-foreground py-4">Loading {season}…</p>;
}

export default function PlayerDetail({
  code,
  player,
  onBack,
}: {
  /** The permanent player code. Always known, even when `player` is null. */
  code: number;
  /**
   * The player's totals for the selected season, or **null when he has no
   * player-season in it** — which is what selecting 2016-17 while looking at a
   * 2026-27 signing does. Everything on this object is season-scoped, so there
   * is nothing to fall back to and nothing that may be carried over; the page
   * renders him from his career identity instead. See PlayerHeader.
   */
  player: Player | null;
  onBack: () => void;
}) {
  const b = useBootstrap();
  const team = player ? b.teams.find((t) => t.id === player.team) : undefined;

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
  /**
   * Who the player is, with no season attached — name, code, photo.
   *
   * Fetched with the career and kept across a season change, because none of it
   * is a property of a season. It is what names the player when `player` is
   * null, which is the only thing on screen at all in that case.
   */
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
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
  //
  // Keyed on the season and NOT on the two round numbers, which is what it used
  // to be: those are numbers, and the eight ordinary seasons all run 1 to 38, so
  // the effect did not fire on the common case. 2019-20 runs to 47 and 2022-23
  // has no round 7, so a carried-over range is not merely stale but can name
  // rounds the new season never played.
  useEffect(() => {
    setGwRange([firstRound, lastRound]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.season]);

  const loadSeason = useCallback(
    async (season: string) => {
      if (inFlight.current.has(season)) return;
      inFlight.current.add(season);
      try {
        const d = await fetchPlayerDetail(code, season);
        // Keyed on the season the RESPONSE resolved, not the one requested.
        // They agree today; keying on the request is how a cache starts lying
        // the moment they stop agreeing.
        setDetailBySeason((c) => ({ ...c, [d.season]: d }));
      } finally {
        inFlight.current.delete(season);
      }
    },
    [code]
  );

  /**
   * The career, which is season-independent — so this keys on the player alone.
   *
   * It used to be fetched in one `Promise.all` with the season's detail, keyed
   * on both, and a season change therefore threw away a career that had not
   * changed and asked for it again. Splitting it buys two things beyond the
   * saved request: `registeredIn` answers correctly the instant the season
   * swaps instead of returning its loading-true default, and the identity — the
   * only thing that names a player who has no player-season in the newly
   * selected one — survives the change without a reload.
   *
   * This effect owns `loading`, and the detail effect below deliberately does
   * not touch it. `loading` blanks the header and the career table, and neither
   * of those is invalidated by a season change.
   */
  useEffect(() => {
    setDetailBySeason({});
    setCareer(null);
    setIdentity(null);
    setExpanded(new Set());
    setLoading(true);
    setError(null);

    fetchPlayerCareer(code)
      .then((c) => {
        setCareer(c.seasons);
        setIdentity(c.player);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [code]);

  /**
   * The selected season's gameweeks. Adds to the cache rather than replacing
   * it: the cache is keyed by season and the player has not changed, so
   * everything already in it is still true, and reopening a previous season
   * after a season switch stays free.
   *
   * Deliberately NOT routed through `loadSeason`, whose `inFlight` guard is for
   * the click path — two clicks in one tick. Here the guard would deadlock
   * under StrictMode: the second invocation would see the first still in
   * flight, return early, and then the first's write would be cancelled by its
   * own cleanup, so nothing would ever land. The hazard on this path is the
   * opposite one — a response arriving after the page has moved on — so it
   * gets a cancellation flag instead.
   */
  useEffect(() => {
    let cancelled = false;
    fetchPlayerDetail(code, b.season)
      .then((d) => {
        if (!cancelled) setDetailBySeason((c) => ({ ...c, [d.season]: d }));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [code, b.season]);

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
    //
    // The `inFlight` ref would now absorb that second call, so moving this line
    // back inside does not restore the observable bug and no test goes red
    // (measured — see PlayerDetail.test.tsx). It is still wrong: React does not
    // promise to invoke an updater exactly twice, and it can discard a render
    // entirely, leaving a fetch started for a state change that never
    // committed. The ref hides the symptom; this line is the fix.
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

  // The player's name, from the season if he is in it and from his identity
  // otherwise. Both are the same string on every ordinary render; the identity
  // is what remains when there is no player-season at all.
  const name = player?.web_name ?? identity?.web_name ?? '';

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
      {identity && <PlayerHeader player={player} identity={identity} team={team} season={b.season} />}

      {current && current.season !== b.season && (
        <p className="mb-4 text-sm text-destructive">
          These gameweeks are from {current.season}, but the totals above are from {b.season}.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading player data…</p>}

      {!loading && !error && (
        <>
          {current && current.fixtures.length > 0 && (
            <>
              <SectionHeading
                title="Upcoming"
                note={`next ${Math.min(UPCOMING_SHOWN, current.fixtures.length)} of ${
                  current.fixtures.length
                } left to play`}
              />
              <UpcomingFixtures fixtures={current.fixtures} teams={current.teams} />
            </>
          )}

          <SectionHeading title="This Season" note={b.season} />
          <GameweekFilters
            gwRange={gwRange}
            rounds={rounds}
            homeAway={homeAway}
            onGwRangeChange={setGwRange}
            onHomeAwayChange={setHomeAway}
          />
          {/* "Not fetched yet" is not "fetched, and there is nothing in it",
              and GameweekSection cannot tell them apart — it sees a history
              array, and an empty one looks exactly like an absent one. Handing
              it the absent case prints "Data will appear here once the 2025-26
              season is underway" for as long as the request takes, about a
              season that finished in May. The window is created by keeping the
              cache across a season change, which is still the right thing to
              do; this is the other half of it. */}
          {current ? (
            <GameweekSection
              history={history}
              filtered={filtered}
              teams={current.teams}
              season={current.season}
              playerName={name}
              registered={registeredIn(b.season)}
            />
          ) : (
            <SeasonLoading season={b.season} />
          )}

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
              {b.season} is {name}’s first season in the game.
            </p>
          ) : (
            <CareerTable
              seasons={previousSeasons}
              expanded={expanded}
              onToggle={toggleSeason}
              renderExpanded={(season) => {
                const d = detailBySeason[season];
                if (!d) return <SeasonLoading season={season} />;
                return (
                  <GameweekSection
                    history={d.history}
                    teams={d.teams}
                    season={d.season}
                    playerName={name}
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

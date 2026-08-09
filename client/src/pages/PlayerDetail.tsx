import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerHeader from '../components/PlayerHeader';
import GameweekFilters from '../components/GameweekFilters';
import GameweekSection, { NotInGame } from '../components/GameweekSection';
import CareerTable from '../components/CareerTable';
import { FDRBadge } from '../components/PosBadge';
import type {
  GameweekHistory,
  Player,
  PlayerCareerSeason,
  PlayerDetailData,
  PlayerIdentity,
} from '../types/fpl';
import { fetchPlayerCareer, fetchPlayerDetail } from '../services/api';
import { useBootstrap } from '../lib/bootstrap';

/** How many of the remaining fixtures to show. Enough to plan a transfer on. */
const UPCOMING_SHOWN = 5;

type Venue = 'all' | 'home' | 'away';

/** One season's filter state. See `filters` in the component for why null. */
interface SeasonFilter {
  /** null = the whole season, resolved at render against that season's rounds. */
  gwRange: [number, number] | null;
  venue: Venue;
}

/** What an unfiltered season looks like. An absent key means this. */
const NO_FILTER: SeasonFilter = { gwRange: null, venue: 'all' };

/**
 * Apply one season's filters to its rows.
 *
 * The range defaults to the season's own first and last round, so "unset" and
 * "the whole season" are the same thing and neither needs to be stored.
 */
function applyFilters(
  history: GameweekHistory[],
  filter: SeasonFilter,
  rounds: number[]
): GameweekHistory[] {
  const [lo, hi] = filter.gwRange ?? [rounds[0] ?? 1, rounds[rounds.length - 1] ?? 1];
  return history.filter((gw) => {
    if (gw.round < lo || gw.round > hi) return false;
    if (filter.venue === 'home' && !gw.was_home) return false;
    if (filter.venue === 'away' && gw.was_home) return false;
    return true;
  });
}

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
  /**
   * Which rows are the selector's to close, and which are the user's to keep.
   *
   * Refs rather than state because nothing renders from either — they only decide
   * what a season change is allowed to collapse. See the season effect below for
   * why the distinction has to exist at all.
   */
  const lastSelected = useRef<string | null>(null);
  /** Seasons the user has opened or closed by hand. Their state is not ours. */
  const userToggled = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * The filters, **per season**, because every expanded season has its own now.
   *
   * One shared pair used to be enough because one season had filters. It is not
   * enough for eleven: the GW options are season-specific — 2019-20 runs to 47
   * because of the Covid restart, 2022-23 has 37 rounds ending at 38 — so a
   * shared range would carry a round 47 into a season that never played one.
   *
   * **`gwRange: null` means "the whole season", rather than a seeded pair**, and
   * that is the load-bearing part. A season's rounds are not known until its
   * career row is in hand, so seeding would need an effect per season firing when
   * data arrives — which is precisely the effect item 8 had to key on `b.season`
   * rather than on `[firstRound, lastRound]`, because eight of the eleven seasons
   * run 1 to 38 and a numeric dependency does not fire on the common case.
   * Storing "unset" deletes that effect instead of reproducing it eleven times:
   * the default is resolved at render, against the rounds that season actually
   * played.
   *
   * It also deletes the reset that used to run on every season change. Keys make
   * that unnecessary by construction — 2019-20's round 47 cannot reach 2022-23,
   * because it is not stored under 2022-23's key.
   */
  const [filters, setFilters] = useState<Record<string, SeasonFilter>>({});

  const setFilter = useCallback((season: string, patch: Partial<SeasonFilter>) => {
    setFilters((f) => ({ ...f, [season]: { ...(f[season] ?? NO_FILTER), ...patch } }));
  }, []);

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
    // Seeded with the selected season rather than empty: it is the row that was
    // the "This Season" section before item 12, and that section was always open.
    // Recorded as the selector's row, so the next season change may close it,
    // and the previous player's hand-opened rows are forgotten with everything
    // else about him.
    setExpanded(new Set([b.season]));
    lastSelected.current = b.season;
    userToggled.current = new Set();
    // Per player, like everything else here. This was a real gap before item 12
    // and not one the merge introduced: `homeAway` reset on nothing at all, and
    // `gwRange` only on a season change, so opening a second player inherited the
    // first one's filters.
    setFilters({});
    setLoading(true);
    setError(null);

    fetchPlayerCareer(code)
      .then((c) => {
        setCareer(c.seasons);
        setIdentity(c.player);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // `b.season` is READ here and deliberately not a dependency. This effect is
    // "start again on a new player", and it seeds the open row with whatever
    // season is selected at that moment. Adding the dep would refetch the career
    // on every season change — the exact waste item 8 split these two effects to
    // remove, the career being season-independent. Keeping the selected row open
    // ACROSS a season change is the next effect's job, not this one's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  /**
   * Keep the selected season's row open as the selection moves — and close the
   * one the selector opened last time, which is the part that took measuring.
   *
   * **A purely additive version was tried first and is wrong.** It opened the new
   * season and closed nothing, on the reasoning that a user who expanded a season
   * to compare against should keep it. That reasoning is right and the rule built
   * on it is not, because it does not distinguish rows the user opened from rows
   * that opened themselves. Measured in the browser on Haaland, whose career is
   * five seasons, changing season four times:
   *
   *     start        1 open   pane 1,986px   5 of 5 season totals in view
   *     -> 2023-24   2 open   pane 3,708px   4
   *     -> 2024-25   3 open   pane 5,429px   3
   *     -> 2025-26   4 open   pane 7,151px   2
   *     -> 2026-27   5 open   pane ~7,300px  — every season expanded
   *
   * Against a 920px scrollport. Four ordinary interactions and the totals are no
   * longer in line with each other, which is the entire point of merging them
   * into one table.
   *
   * So the row the *selector* opened is the selector's to close, and every row the
   * *user* opened is theirs to keep. `autoOpened` is which season this effect last
   * opened; `toggleSeason` clears it the moment the user touches that row, because
   * from then on its state is a choice rather than a side effect.
   *
   * Idempotent, so StrictMode's double invocation and this firing alongside the
   * mount effect are both harmless: the second pass finds `autoOpened` already
   * equal to `b.season` and does nothing.
   */
  useEffect(() => {
    // Every ref is read HERE and none inside the updater, and that is not a
    // style choice. An updater does not run when it is scheduled — it runs during
    // the next render — so a ref read inside it sees whatever the ref holds by
    // then, which is after the assignment below. The first attempt did exactly
    // that and closed nothing at all, because the updater always found the
    // "previous" season already equal to the new one. The same purity rule the
    // `loadSeason` comment below states, arriving from the read side.
    const previous = lastSelected.current;
    const keepPrevious =
      previous === null || previous === b.season || userToggled.current.has(previous);
    lastSelected.current = b.season;

    setExpanded((open) => {
      const next = new Set(open);
      if (!keepPrevious) next.delete(previous);
      next.add(b.season);
      return next;
    });
  }, [b.season]);

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

    // The user now has an opinion about this row, so a later season change must
    // not collapse it on the grounds that the selector opened it. Recorded
    // whichever way the toggle went: opening it makes it theirs, and so does
    // closing it.
    userToggled.current.add(season);

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

  const seasons = career ?? [];
  /** The career row for a season, which is where its `rounds` live. */
  const careerBySeason = useMemo(
    () => new Map(seasons.map((s) => [s.season, s])),
    [seasons]
  );

  // Whether the career says he was in the game that season at all. Distinct
  // from having no gameweeks in it — see GameweekSection.
  //
  // Its only caller now is the page-level notice below. Inside the table the
  // question cannot arise: a row exists there precisely because the career has
  // that season.
  const registeredIn = (season: string) =>
    career === null || career.some((s) => s.season === season);

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

          {/* The one absence with no row to sit in. A season the player has no
              player_seasons row for produces no career row either, so the table
              below simply does not contain it and there is nowhere in it to say
              why. It goes here instead, under the header card that has already
              degraded to a name and a photograph for the same reason. */}
          {!registeredIn(b.season) && <NotInGame playerName={name} season={b.season} />}

          {/* One table, one header, and the selected season is a row in it.
              There is no "This Season" section any more and no "Previous
              Seasons" heading: the first was wrong whenever the selector was not
              on the season being played, and the second was wrong on any season
              with later ones above it — on Haaland at 2022-23 it filed four
              later seasons under "previous". Removing the sections removes both
              claims rather than rewording them. */}
          {seasons.length > 0 && (
            <CareerTable
              seasons={seasons}
              selected={b.season}
              expanded={expanded}
              onToggle={toggleSeason}
              renderExpanded={(season) => {
                // "Not fetched yet" is not "fetched, and there is nothing in
                // it", and GameweekSection cannot tell them apart — it sees a
                // history array, and an empty one looks exactly like an absent
                // one. Handing it the absent case prints "Data will appear here
                // once the 2025-26 season is underway" for as long as the
                // request takes, about a season that finished in May.
                const d = detailBySeason[season];
                if (!d) return <SeasonLoading season={season} />;

                // The season's own rounds, off its career row. Not derived from
                // this player's rows: a gap there could mean the season skipped
                // the round OR that he was not in the squad, and the two are
                // indistinguishable once they are in one dropdown.
                const rounds = careerBySeason.get(season)?.rounds ?? [];
                const filter = filters[season] ?? NO_FILTER;

                return (
                  <>
                    {/* Gated on there being ROWS, not on there being rounds.
                        `rounds` comes from the season's fixtures, so 2026-27 has
                        all 38 of them and no match played — and an earlier draft
                        of this gate drew a full GW range above "Data will appear
                        here once the 2026-27 season is underway", which is three
                        controls that can only filter nothing. Found in the
                        browser. The season having rounds and the player having
                        rows in them are different questions, which is the same
                        distinction the empty states themselves turn on. */}
                    {d.history.length > 0 && rounds.length > 0 && (
                      <GameweekFilters
                        gwRange={
                          filter.gwRange ?? [rounds[0], rounds[rounds.length - 1]]
                        }
                        rounds={rounds}
                        homeAway={filter.venue}
                        onGwRangeChange={(gwRange) => setFilter(season, { gwRange })}
                        onHomeAwayChange={(venue) => setFilter(season, { venue })}
                      />
                    )}
                    <GameweekSection
                      history={d.history}
                      filtered={applyFilters(d.history, filter, rounds)}
                      teams={d.teams}
                      season={d.season}
                      playerName={name}
                      // A row only exists in this table because the career has
                      // that season, so registration is not in question here.
                      registered
                    />
                  </>
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

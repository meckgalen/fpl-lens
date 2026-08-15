import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { PlayerShirt } from '../components/PlayerShirt';
import { ComparisonRadar } from '../components/ComparisonRadar';
import { ComparisonTable } from '../components/ComparisonTable';
import { ClubFilter, type ClubSelection } from '../components/ClubFilter';
import { fetchColumnHistory, fetchComparison, fetchComparisonThresholds } from '../services/api';
import type {
  AxisThreshold,
  ColumnHistoryRow,
  ComparisonPosition,
  ComparisonThresholdsData,
  Player,
  SeasonColumnAvailability,
} from '../types/fpl';
import { columnByKey, resolveColumn } from '../lib/playerColumns';
import { useBootstrap } from '../lib/bootstrap';
import { FOCUS_RING, cn } from '../lib/cn';
import {
  COMPARISON_POSITIONS,
  DEFAULT_POSITION,
  ELEMENT_TYPE_OF,
  MAX_TRACES,
  TRACE_COLORS,
  TRACE_LIMIT_REASON,
  hasTrace,
  mergeComparison,
  traceKey,
  type ComparisonView,
  type SeasonResult,
  type Trace,
} from '../lib/comparison';

/**
 * How many candidates are rendered at once.
 *
 * The picker used to offer **8** and stop, with nothing on screen saying so —
 * pick DEF on 2023-24 and the other 270 defenders were unreachable however you
 * searched. It now lists everyone matching the filters in a scrolling pane, and
 * renders them a chunk at a time for the reason the Players list does: item 18
 * measured 200 rows mounting in ~215ms against ~792ms for 865, and this list
 * re-renders on **every keystroke** in the search box.
 */
const CANDIDATE_CHUNK = 60;

/** One array, so "no thresholds yet" is a stable reference. */
const NO_AXES: AxisThreshold[] = [];

/**
 * What the band's presence or absence says, in one place.
 *
 * The two withheld cases are worded from the tag rather than from the traces,
 * so the sentence and the rule cannot disagree about which case fired. The
 * third absence — the server's own cohort floor — is read off `cohortSize`,
 * which is the number that explains it.
 *
 * Not exported: a non-component export would take this file out of React Fast
 * Refresh's hands and turn every subsequent edit to it into a full reload.
 */
function bandCaption(view: ComparisonView, position: ComparisonPosition, season: string): string {
  const cohort = `${view.cohortSize} ${position}s past 1,200 minutes in ${season}`;
  if (view.bandWithheld?.reason === 'spans-seasons') {
    return `No band · the traces span ${view.bandWithheld.seasons} seasons, each with its own median`;
  }
  if (view.bandWithheld?.reason === 'other-season') {
    return `No band · every trace is from ${view.bandWithheld.season}, and the band would be ${season}’s`;
  }
  return view.band === null ? `No band · ${cohort}` : `Band · median of ${cohort}`;
}

/**
 * Why an axis is not a spoke, in the picker's own words.
 *
 * `resolveColumn` is the shipped reason function, and this reuses it rather than
 * restating it: an axis key IS a `PLAYER_COLUMNS` key, which is exactly why the
 * two surfaces can share one rule. An axis whose column resolves as available is
 * one the *other* season on the chart could not answer, which the availability
 * data for THIS season cannot explain — so that case names the intersection
 * instead of guessing.
 */
function axisReason(
  axis: string,
  availability: SeasonColumnAvailability,
  history: ColumnHistoryRow[] | null,
  seasons: string[]
): string {
  const col = columnByKey(axis);
  if (col === undefined) return `Not recorded in ${availability.season}.`;
  const status = resolveColumn(col, availability, history, seasons);
  return status.available
    ? 'Not recorded in every season on the chart.'
    : status.reason;
}

/**
 * The player comparison chart: the controls, the two fetches, and the state the
 * radar is drawn from.
 *
 * **The geometry is not here.** This page decides which seasons are asked for,
 * what a trace is and what the band describes; `lib/comparison.ts` folds the
 * answers into one `ComparisonView`, and `ComparisonRadar` draws it without
 * re-deciding any of it. In particular the band's absence arrives already
 * decided and already worded.
 *
 * Two fetches, and they are different kinds of thing:
 *
 *   - **the thresholds**, season-independent and memoized at module scope in
 *     `services/api.ts` — the frozen floors and ceilings, which are the axis
 *     configuration. Nothing can be drawn before they land, which is the
 *     accepted cost of serving them rather than compiling them in.
 *   - **the comparison data**, one request per season in play. Values are raw
 *     and are scaled against the thresholds here, so the frozen ceilings are
 *     applied in exactly one place.
 */
export default function Comparison() {
  const b = useBootstrap();

  const [position, setPosition] = useState<ComparisonPosition>(DEFAULT_POSITION);
  const [traces, setTraces] = useState<Trace[]>([]);

  const [thresholds, setThresholds] = useState<ComparisonThresholdsData | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  /**
   * One entry per season with a request in flight or answered. Keyed by season
   * because that is what a request is scoped to — a trace's season and the
   * selected season are the same kind of key, and two traces on one season share
   * one request rather than making two.
   */
  const [results, setResults] = useState<Map<string, SeasonResult>>(new Map());

  const [search, setSearch] = useState('');
  const [team, setTeam] = useState<ClubSelection>('ALL');

  /**
   * The column matrix, for the reason an absent axis carries.
   *
   * Module-scope memoized in `services/api.ts`, so on a session that has opened
   * the Players list this costs nothing. Off the critical path and nothing
   * blocks on it: `resolveColumn` returns a complete sentence from the bootstrap
   * alone, and the matrix only appends the clause naming where the axis IS
   * recorded — which is the clause that matters most here, on a page whose whole
   * point is other seasons.
   */
  const [history, setHistory] = useState<ColumnHistoryRow[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchColumnHistory()
      .then((d) => {
        if (live) setHistory(d.columns);
      })
      .catch(() => {
        // Degrades to the bootstrap-only sentence, which is already true.
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    fetchComparisonThresholds()
      .then((d) => {
        if (live) setThresholds(d);
      })
      .catch((err: unknown) => {
        // Surfaced rather than swallowed, unlike the column matrix's. There is
        // nothing to degrade to here: with no floors and ceilings the page has
        // no axes, so a silent failure would be an empty page with no reason on
        // it. The memo is cleared on rejection, so leaving and returning retries.
        if (live) setThresholdError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  /**
   * What to ask for: one request per season in play, carrying that season's
   * codes.
   *
   * The selected season is always in it — it owns the band and the canonical
   * axis list, and is what the page shows before anyone has been picked — plus
   * every season a trace is pinned to. Ordinarily those are the same season and
   * this is one request; a second arises the moment a trace outlives a season
   * change, which is the whole point of a trace carrying its season.
   *
   * Memoized because the effect below fires requests off its identity. `traces`
   * is state, so its identity changes only when it actually changes, and this
   * array's does the same.
   */
  const plan = useMemo(
    () =>
      [...new Set([b.season, ...traces.map((t) => t.season)])].sort().map((season) => ({
        season,
        codes: traces.filter((t) => t.season === season).map((t) => t.code),
      })),
    [b.season, traces]
  );

  useEffect(() => {
    let live = true;

    // Every season in play goes back to loading, including one whose rows have
    // not changed. Holding the previous response while a new one is in flight
    // was the alternative and is worse here than App.tsx's equivalent: a trace
    // added a moment ago is not in the stale response, and the merge would
    // report it as "not in this season" — a wrong sentence rather than a
    // waiting one.
    setResults(new Map(plan.map((p) => [p.season, { state: 'loading' as const }])));

    for (const { season, codes } of plan) {
      fetchComparison(season, position, codes)
        .then((data) => {
          if (!live) return;
          // Merged into whatever else has landed rather than replacing it: the
          // seasons answer independently and out of order, and a later response
          // must not discard an earlier one. `live` is what keeps a stale
          // request — a position change, a trace removed — out entirely.
          setResults((prev) => new Map(prev).set(season, { state: 'ok', data }));
        })
        .catch((err: unknown) => {
          if (!live) return;
          // Per season, so one refusal does not blank the page. The reachable
          // one is a player who changed position between seasons: the server
          // rejects rather than drawing him on the wrong axis set, and the
          // message it sends says which position he actually was.
          const message = err instanceof Error ? err.message : String(err);
          setResults((prev) => new Map(prev).set(season, { state: 'error', message }));
        });
    }

    return () => {
      live = false;
    };
  }, [plan, position]);

  /**
   * A position change clears the traces, and that is the server's rule rather
   * than a tidy-up.
   *
   * `/api/comparison` refuses a player who is not the position asked for — a
   * comparison draws one position's axis set, and a spoke drawn on the wrong one
   * is a silent mis-render. Keeping the traces would turn every position change
   * into a 400 the user did not ask for.
   */
  const changePosition = (p: ComparisonPosition) => {
    setPosition(p);
    setTraces([]);
  };

  // A module constant rather than a fresh `[]`, so the memo below has a stable
  // dependency while the thresholds are still in flight.
  const forPosition: AxisThreshold[] = thresholds?.thresholds[position] ?? NO_AXES;
  const selectedResult = results.get(b.season);
  const view = useMemo(
    () => mergeComparison(forPosition, b.season, traces, results),
    [forPosition, b.season, traces, results]
  );

  const teamMap = useMemo(
    () => Object.fromEntries(b.teams.map((t) => [t.id, t.short_name])),
    [b.teams]
  );

  /**
   * Who can be added: this season's players of the chosen position, narrowed by
   * club and by name.
   *
   * From `bootstrap.players`, which is the selected season's roster — so a
   * candidate always exists in the season the trace will be pinned to, and the
   * server's 404 and 400 are both unreachable through this control.
   */
  const candidates: Player[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return b.players
      .filter((p) => p.element_type === ELEMENT_TYPE_OF[position])
      .filter((p) => team === 'ALL' || p.team === team)
      .filter((p) => {
        if (q.length === 0) return true;
        return `${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q);
      })
      .filter((p) => !hasTrace(traces, { code: p.id, season: b.season }))
      .sort((x, y) => y.total_points - x.total_points);
  }, [b.players, position, team, search, traces, b.season]);

  /**
   * How many candidates are on screen. Same instrument as the Players list, and
   * reset on every change to the candidate set — which here includes each
   * keystroke, so typing always starts from the top of the new matches.
   */
  const [shown, setShown] = useState(CANDIDATE_CHUNK);
  useEffect(() => {
    setShown(CANDIDATE_CHUNK);
  }, [candidates]);

  const moreRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (el === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + CANDIDATE_CHUNK);
      },
      // The pane is the scroll container, so it is the root: against the
      // viewport a list scrolled inside a fixed-height box never intersects.
      { root: el.closest('ul'), rootMargin: '300px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, candidates]);

  const full = traces.length >= MAX_TRACES;

  const addTrace = (p: Player) => {
    if (full) return;
    setTraces((prev) => [...prev, { code: p.id, season: b.season, web_name: p.web_name }]);
    setSearch('');
  };

  const removeTrace = (t: Trace) =>
    setTraces((prev) => prev.filter((x) => traceKey(x) !== traceKey(t)));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-foreground">
          Comparison · {b.season}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {/* No claim about the band here. It is drawn in four different
              situations and withheld in three of them, and `bandCaption` is
              derived from the tag that decided it — a second sentence up here
              could only ever restate that or contradict it, and it did. */}
          Every axis is fixed across seasons, so two players from different years are
          drawn on the same scale.
        </p>
      </div>

      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <div className="flex gap-0.5 p-1 bg-card border border-border rounded-lg">
          {COMPARISON_POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => changePosition(p)}
              aria-pressed={position === p}
              /* 44px below `lg`, and this one is sized by CONSEQUENCE rather
                 than by the 26px it measured. `changePosition` clears every
                 trace — the server refuses a player drawn on another position's
                 axes — so a mis-tap here destroys up to four traces the reader
                 assembled by searching. The identical-looking pills on the
                 Players list only re-filter a table and are left alone. */
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                'max-lg:min-h-11 max-lg:px-4',
                FOCUS_RING,
                position === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {/* The search ring goes on the wrapper, not the input: the border is
            here and the input inside is borderless, so a ring around the text
            alone would sit inside the border it belongs outside. Players.tsx's
            reasoning, and the same shape. */}
        <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-44"
            placeholder={`Add a player…`}
            aria-label={`Search ${position} players in ${b.season}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ClubFilter id="comparison-team" value={team} onChange={setTeam} teams={b.teams} />

        <span className="ml-auto text-xs text-muted-foreground">
          {traces.length} of {MAX_TRACES}
        </span>
      </div>

      {/* The candidates. A plain list rather than a combobox: it renders the
          numbers the choice is actually made on, which a datalist cannot. */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            Add a {position} from {b.season}
            {/* The match count, which the panel never had. Eight rows with no
                total looked like the whole answer rather than a slice of it. */}
            <span className="ml-2 font-normal text-[12px] text-muted-foreground tabular-nums">
              {candidates.length} {candidates.length === 1 ? 'match' : 'matches'}
            </span>
          </CardTitle>
          {full && (
            <span className="text-[11px] text-muted-foreground">
              {TRACE_LIMIT_REASON}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-2">
          {candidates.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No {position} matches that search in {b.season}.
            </p>
          ) : (
            /* A fixed-height scroller: the pane keeps its size whether it holds
               four defenders or 374, so the chart below it does not jump every
               time the search changes. */
            <ul className="flex flex-col max-h-[22rem] overflow-y-auto">
              {candidates.slice(0, shown).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={full}
                    onClick={() => addTrace(p)}
                    /* The one control on this page whose accessible name is not
                       simply its content, and deliberately. The row is a name, a
                       club and a points total, which concatenates into
                       "GabrielARS209 pts" — three unrelated facts announced as
                       one. The label names the action and the player, and cannot
                       drift far from the row because it contains the row's own
                       name. `OpenPlayerButton`'s convention, at the point where
                       following it literally makes things worse. */
                    aria-label={`Add ${p.web_name}`}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left transition-colors',
                      FOCUS_RING,
                      full ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/60'
                    )}
                  >
                    <span className="w-8 h-8 rounded-lg bg-muted flex items-end justify-center overflow-hidden flex-shrink-0">
                      <PlayerShirt teamCode={p.team} elementType={p.element_type} />
                    </span>
                    <span className="text-[13px] font-medium text-foreground">{p.web_name}</span>
                    <span className="text-[11px] text-muted-foreground">{teamMap[p.team]}</span>
                    <span className="ml-auto font-display text-[13px] tabular-nums text-muted-foreground">
                      {p.total_points} pts
                    </span>
                  </button>
                </li>
              ))}
              {shown < candidates.length && (
                <li
                  ref={moreRef}
                  className="px-3 py-2 text-[11px] text-muted-foreground"
                >
                  Showing {shown} of {candidates.length} · scroll for more
                </li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The chosen traces. Each names its own season, because a trace is a
          (player, season) pair and two of them can differ — API identity rule 7
          applied to a control rather than to a payload. */}
      {traces.length > 0 && (
        <ul className="flex gap-2 flex-wrap mb-4">
          {traces.map((t, slot) => {
            const resolved = view?.traces.find((r) => traceKey(r.trace) === traceKey(t));
            return (
              <li key={traceKey(t)}>
                <span className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-full border border-border bg-card text-[13px]">
                  {/* The legend. The chip's colour is the promise that the
                      outline of that colour is this player, so it is read off
                      the same list by the same index the chart uses. */}
                  <span
                    aria-hidden="true"
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: TRACE_COLORS[slot % TRACE_COLORS.length] }}
                  />
                  <span className="font-medium text-foreground">{t.web_name}</span>
                  <span className="text-[11px] text-muted-foreground">{t.season}</span>
                  {resolved?.problem && (
                    <span className="text-[11px] text-destructive">{resolved.problem}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeTrace(t)}
                    aria-label={`Remove ${t.web_name} ${t.season}`}
                    /* The most destructive control on the page, and it measured
                       the smallest: 15.97x20 at 380 before the shell change,
                       20x20 after. It deletes a trace outright, and rebuilding
                       one means searching the picker again.

                       Sized up rather than given an expanded hit area with a
                       pseudo-element: the chips sit in a `gap-2` wrap, so a
                       12px invisible halo on each would overlap the neighbouring
                       chip and trade a small target for a wrong one. */
                    className={cn(
                      'w-5 h-5 max-lg:w-11 max-lg:h-11 rounded-full',
                      'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                      FOCUS_RING
                    )}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Axes</CardTitle>
          {view && (
            <span className="text-[11px] text-muted-foreground">{bandCaption(view, position, b.season)}</span>
          )}
        </CardHeader>
        <CardContent>
          {thresholdError !== null ? (
            <p className="text-sm text-destructive">
              Could not load the axis scales: {thresholdError}
            </p>
          ) : thresholds === null ? (
            // The accepted cost of serving the thresholds rather than compiling
            // them in, and the reason this loading state is not optional: until
            // this lands there is no axis configuration, so there is nothing to
            // draw a chart of and nothing to draw one on.
            <p className="text-sm text-muted-foreground">Loading axis scales…</p>
          ) : selectedResult?.state === 'error' ? (
            // The selected season owns the band and the canonical axis list, so
            // its failure is the page's, not one trace's. A trace season that
            // fails says so on its own chip instead and leaves the rest drawn.
            <p className="text-sm text-destructive">
              Could not load {b.season}: {selectedResult.message}
            </p>
          ) : view === null ? (
            <p className="text-sm text-muted-foreground">Loading {b.season}…</p>
          ) : !b.columns.measured ? (
            /*
             * The pre-season state, and it is the DEFAULT season's — 2026-27 is
             * what the app resolves to until the first round is ingested, so this
             * is the first thing most visitors see for the next four months.
             * Drawing the chart here produced an empty target with every trace
             * collapsed to a dot in the bullseye: honest, since every value is 0
             * and 0 minutes is below the Min floor, and indistinguishable from a
             * broken chart. The Dashboard got its three empty states in item 4 for
             * the same reason; this is the fourth.
             *
             * The axes are still named, because what the page WILL show is the
             * useful thing to say, and the scales are frozen and already known.
             */
            <div className="py-6 text-center">
              <p className="text-sm text-foreground">
                No matches recorded for {b.season} yet, so no values and no cohort.
              </p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {position}s will be drawn on {forPosition.length} axes:{' '}
                {forPosition.map((a) => a.label).join(' · ')}.
              </p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                The scales are fixed across seasons, so pick an earlier one to compare on the
                same rings.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col xl:flex-row xl:items-start gap-6">
                {/* The chart keeps its own scroller: it is a fixed 580px so its
                    captions stay at 11px, so a narrow viewport scrolls it rather
                    than shrinking the text to 7px. Every wide table in this app
                    already works this way. */}
                <div className="overflow-x-auto max-w-full">
                  <ComparisonRadar view={view} />
                </div>
                <div className="flex-1 min-w-0 xl:pt-2">
                  <ComparisonTable view={view} />
                </div>
              </div>

              {view.absent.length > 0 && (
                /*
                 * Item 13's rule, applied to a surface that was dropping axes
                 * silently. The reason comes from `resolveColumn` — the picker's
                 * own function over the same availability data — because every
                 * axis key is a `PLAYER_COLUMNS` key, and a second reason rule
                 * would be a second thing to keep true.
                 */
                <ul className="mt-4 border-t border-border pt-3 space-y-1">
                  {view.absent.map((axis) => (
                    <li key={axis.axis} className="text-[11px] text-muted-foreground">
                      <span className="text-foreground">{axis.label}</span> is not a spoke
                      {' · '}
                      {axisReason(axis.axis, b.columns, history, b.seasons)}
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-3 text-[11px] text-muted-foreground">
                Ten rings, each a tenth of that axis&rsquo;s own range, the same on every season
                — which is what makes two years comparable. ▲ is a value past the outer
                ring and ▼ one below the floor; both are drawn at the edge, with their true
                number beside them.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { PlayerShirt } from '../components/PlayerShirt';
import { ComparisonRadar } from '../components/ComparisonRadar';
import { fetchComparison, fetchComparisonThresholds } from '../services/api';
import type {
  AxisThreshold,
  ComparisonPosition,
  ComparisonThresholdsData,
  Player,
} from '../types/fpl';
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

/** How many search results the picker offers before asking for a narrower query. */
const MAX_CANDIDATES = 8;

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
  const [team, setTeam] = useState<number | 'ALL'>('ALL');

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
      .sort((x, y) => y.total_points - x.total_points)
      .slice(0, MAX_CANDIDATES);
  }, [b.players, position, team, search, traces, b.season]);

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
          Every axis is fixed across seasons, so two players from different years are
          drawn on the same scale. The band is {b.season}&rsquo;s typical {position}.
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
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
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

        <div>
          <label htmlFor="comparison-team" className="sr-only">
            Club
          </label>
          <select
            id="comparison-team"
            value={team === 'ALL' ? 'ALL' : String(team)}
            onChange={(e) => setTeam(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-[13px] text-foreground',
              FOCUS_RING
            )}
          >
            <option value="ALL">All clubs</option>
            {[...b.teams]
              .sort((x, y) => x.name.localeCompare(y.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          {traces.length} of {MAX_TRACES}
        </span>
      </div>

      {/* The candidates. A plain list rather than a combobox: it renders the
          numbers the choice is actually made on, which a datalist cannot. */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Add a {position} from {b.season}</CardTitle>
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
            <ul className="flex flex-col">
              {candidates.map((p) => (
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
                    className={cn(
                      'w-5 h-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
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
          ) : (
            <>
              <ComparisonRadar view={view} />
              {view.axes.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground text-center">
                  Ten rings, each a tenth of that axis&rsquo;s own range. A scale is drawn from{' '}
                  {`${Math.min(...view.axes.map((a) => a.derivedFrom.seasons.length))}–${Math.max(
                    ...view.axes.map((a) => a.derivedFrom.seasons.length)
                  )} seasons`}
                  , per axis, and is the same on every season — which is what makes two years
                  comparable. A ▲ is a value past the outer ring, with its true number beside it.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

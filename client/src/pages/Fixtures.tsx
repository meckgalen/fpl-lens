import { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { FDRBadge, FDRBar } from '../components/PosBadge';
import { fetchFixtures } from '../services/api';
import type { Fixture } from '../types/fpl';
import { useBootstrap } from '../lib/bootstrap';
import { FOCUS_RING, cn } from '../lib/cn';
import { initialFixturesView, stepRound, type FixturesTab } from '../lib/fixtures';
import { noMatchesRecorded, roundNotPlayed } from '../lib/emptyStates';

const FDR_LABELS: Record<number, string> = { 1: 'Very Easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very Hard' };

/**
 * A match row's own width, centred inside the full-width card.
 *
 * **Measured rather than chosen.** Left to fill the card, a difficulty bar
 * rendered **956px** wide on a 2327px viewport and its rating sat **478px** from
 * the club it belongs to — the number and its name so far apart that stacking
 * them stopped meaning anything. Capped, each half is ~300px and the rating sits
 * under its own club.
 *
 * Applied to the results row too: the two tabs are two views of ONE round now,
 * and letting them disagree about geometry would make them look unrelated. The
 * day headings stay full width — they are bands across the card, not rows.
 */
const ROW = 'flex items-center max-w-3xl mx-auto';

/**
 * The day heading. Local zone and locale, and `formatTime` below must match:
 * the two render on the same row, and a mismatch only shows on a late kickoff
 * that falls on a different date in one zone than the other.
 */
function formatDay(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The kickoff clock time, which nothing on this page showed before item 18 —
 * `formatDay` takes the date and drops it.
 *
 * The wire value is ISO with a trailing `Z` (`KICKOFF_UTC` in the fixtures
 * repository), so `new Date` parses it as UTC. No `timeZone` option here or in
 * `formatDay`, so both render in the reader's own zone.
 */
function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function Fixtures() {
  const b = useBootstrap();
  const teamMap = useMemo(() => Object.fromEntries(b.teams.map((t) => [t.id, t.short_name])), [b.teams]);

  /**
   * One selected round, and two views of it.
   *
   * Before item 18 the two tabs derived a round each and fetched separately, so
   * switching tab silently changed the week. A per-tab cursor cannot survive a
   * round selector, and a shared one makes the tabs what they always should have
   * been: presentation modes over one round. Retrospective difficulty on a
   * played round is a feature — FDR against the actual result is only comparable
   * when both views sit on the same round.
   *
   * `initialFixturesView` runs **once per season**, to seed this. It is not
   * re-derived on every render.
   */
  const [view, setView] = useState(() => initialFixturesView(b.events, new Date()));
  const [seededFor, setSeededFor] = useState(b.season);

  /**
   * Re-seed during render, not in an effect.
   *
   * React's documented pattern for adjusting state when a prop changes, and here
   * it removes a real race rather than tidying one. With the round in state and
   * the re-seed in an effect, a season change lands in two steps — the new
   * season with the OLD round for one render — and the fetch below would ask for
   * round 47 of a 38-round season. Setting both in the render body means the
   * re-render happens before children render or effects fire, so the stale pair
   * never reaches the fetch.
   */
  if (seededFor !== b.season) {
    setSeededFor(b.season);
    // **The round re-seeds; the view does not.** Which round to show is a fact
    // about the season and has to be recomputed — round 47 does not exist in a
    // 38-round season. Difficulty-vs-Results is a choice about the page, so
    // carrying it across is carrying the reader's intent, the same argument the
    // Players list makes for its search and sort. The rule's tab is therefore
    // the *opening* tab only, which is what it is for.
    setView((v) => ({ ...initialFixturesView(b.events, new Date()), tab: v.tab }));
  }

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const round = view.round;
  /**
   * Belt and braces beside the render-phase re-seed above: the request depends
   * on the round existing in THIS season, so that is what is checked. Cheap, and
   * it holds for any future path that sets a round.
   */
  const roundIsReal = round !== undefined && b.events.some((e) => e.id === round);

  useEffect(() => {
    if (round === undefined || !roundIsReal) return;
    setFixtures(null);
    setError(null);
    // The season is sent and is in the deps. Two seasons that both end at round
    // 38 produce the same number, so keying on the round alone meant a season
    // change did not refetch and the page kept the previous season's fixtures
    // under the new season's heading.
    fetchFixtures(round, b.season)
      .then((d) => {
        setFixtures(d.fixtures);
        // Labelled from this response, so the heading describes the rows on
        // screen rather than what the shell happens to be set to.
        setSeason(d.season);
      })
      .catch((err) => setError(err.message));
  }, [round, roundIsReal, b.season]);

  const byDay = useMemo(() => {
    const grouped: Record<string, Fixture[]> = {};
    for (const f of fixtures ?? []) {
      const day = formatDay(f.kickoff_time);
      (grouped[day] ||= []).push(f);
    }
    return grouped;
  }, [fixtures]);

  /**
   * Whether this round has anything to show as a result.
   *
   * Per **fixture**, not the round's own `finished` flag: that is `bool_and`, so
   * it reads false on a partly played round that does have results worth showing.
   */
  const anySettled = (fixtures ?? []).some((f) => f.finished);

  const setTab = (tab: FixturesTab) => setView((v) => ({ ...v, tab }));
  const goto = (r: number | undefined) => {
    if (r !== undefined) setView((v) => ({ ...v, round: r }));
  };

  const prev = round === undefined ? undefined : stepRound(b.events, round, -1);
  const next = round === undefined ? undefined : stepRound(b.events, round, 1);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-foreground">
          Fixtures · {season ?? b.season}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {round === undefined
            ? 'No rounds recorded for this season.'
            : view.tab === 'difficulty'
              ? `Gameweek ${round} — difficulty ratings shown per team`
              : `Gameweek ${round} results`}
        </p>
      </div>

      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        {/*
          The round selector, built from `bootstrap.events`.

          **Every option comes from the events list, never from a 1..38 loop.**
          2019-20 runs 1-29 then 39-47 and 2022-23 has no round 7, so a counter
          would offer nine rounds that do not exist and hide nine that do. The
          arrows step by POSITION for the same reason — `round + 1` from 29 is a
          round 2019-20 never played.
        */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goto(prev)}
            disabled={prev === undefined}
            aria-label="Previous gameweek"
            className={cn(
              'h-9 w-9 rounded-md border border-input bg-card text-foreground disabled:opacity-40',
              FOCUS_RING
            )}
          >
            ‹
          </button>
          <label htmlFor="fixtures-round" className="sr-only">
            Gameweek
          </label>
          <select
            id="fixtures-round"
            value={round ?? ''}
            onChange={(e) => goto(Number(e.target.value))}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-[13px] text-foreground',
              FOCUS_RING
            )}
          >
            {b.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => goto(next)}
            disabled={next === undefined}
            aria-label="Next gameweek"
            className={cn(
              'h-9 w-9 rounded-md border border-input bg-card text-foreground disabled:opacity-40',
              FOCUS_RING
            )}
          >
            ›
          </button>
        </div>

        {/* Two views of the one selected round — not two rounds. */}
        <div className="flex gap-0.5 p-1 bg-card border border-border rounded-lg w-fit">
          {([
            ['difficulty', 'Difficulty'],
            ['results', 'Results'],
          ] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              aria-pressed={view.tab === v}
              className={cn(
                'px-4 py-1.5 rounded-md text-xs font-medium transition-colors',
                FOCUS_RING,
                view.tab === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden mb-3">
        {error && <div className="px-5 py-4 text-sm text-destructive">{error}</div>}
        {!error && fixtures == null && (
          <div className="px-5 py-4 text-sm text-muted-foreground">Loading fixtures…</div>
        )}

        {/*
          A round with no fixtures at all. Before item 18 this rendered an empty
          bordered box with no explanation.
        */}
        {!error && fixtures != null && fixtures.length === 0 && (
          <div className="px-5 py-4 text-sm text-muted-foreground">
            No fixtures in Gameweek {round}.
          </div>
        )}

        {/*
          Results asked for on a round nobody has played. The season-level
          sentence when the whole season is unmeasured — the picker's own words,
          from the one place they live — and the round-level one otherwise,
          because "no matches recorded for 2025-26" would be false.
        */}
        {!error && fixtures != null && fixtures.length > 0 && view.tab === 'results' && !anySettled && (
          <div className="px-5 py-4 text-sm text-muted-foreground">
            {b.columns.measured && round !== undefined
              ? roundNotPlayed(season ?? b.season, round)
              : noMatchesRecorded(season ?? b.season)}
          </div>
        )}

        {!error &&
          fixtures != null &&
          (view.tab === 'difficulty' || anySettled) &&
          Object.entries(byDay).map(([day, ms]) => (
            <div key={day}>
              <div className="px-5 py-2 bg-muted text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground">
                {day}
              </div>
              {ms.map((m, i) => {
                const h = teamMap[m.team_h] ?? '?';
                const a = teamMap[m.team_a] ?? '?';
                const divider = i < ms.length - 1 ? 'border-b border-border' : '';

                if (view.tab === 'results') {
                  return (
                    <div key={m.id} className={`px-5 py-3 hover:bg-muted/40 transition-colors ${divider}`}>
                      <div className={ROW}>
                        <span className="flex-1 text-right text-sm font-medium text-foreground">{h}</span>
                        <span className="w-16 text-center font-display font-bold text-sm tabular-nums text-foreground">
                          {m.team_h_score ?? '–'} – {m.team_a_score ?? '–'}
                        </span>
                        <span className="flex-1 text-sm font-medium text-foreground">{a}</span>
                      </div>
                    </div>
                  );
                }

                /*
                  The restack. Each side is a vertical stack — club name over its
                  own difficulty bar — with the kickoff time between them.

                  The old row was `{h} [1] vs [3] {a}`, structurally identical to
                  the results row above it, so two difficulty ratings either side
                  of a centre read as a scoreline. Nothing here puts a number
                  beside another number.
                */
                return (
                  <div key={m.id} className={`px-5 py-3 hover:bg-muted/40 transition-colors ${divider}`}>
                    <div className={`${ROW} gap-3`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground text-right mb-1">{h}</div>
                        <FDRBar value={m.team_h_difficulty} />
                      </div>
                      <span className="w-14 shrink-0 text-center text-[11px] text-muted-foreground tabular-nums">
                        {formatTime(m.kickoff_time) ?? 'vs'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground mb-1">{a}</div>
                        <FDRBar value={m.team_a_difficulty} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </Card>

      {view.tab === 'difficulty' && (
        <div className="flex items-center gap-4 px-4 py-2.5 bg-card border border-border rounded-lg flex-wrap">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">FDR</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="flex items-center gap-1.5">
              {/* The badge, not the bar: the legend is a key to the colours, and
                  a full-width bar in a legend row would be a different shape
                  from the thing it explains. Same `FDR` map either way. */}
              <FDRBadge value={n} />
              <span className="text-xs text-muted-foreground">{FDR_LABELS[n]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

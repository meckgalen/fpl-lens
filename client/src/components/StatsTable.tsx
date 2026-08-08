import { useState } from 'react';
import type { GameweekHistory, Team } from '../types/fpl';
import { NO_VALUE, fmtNum } from '../types/fpl';
import {
  EDGE_PINNED,
  ROW_BAND,
  Z_HEADER,
  Z_PINNED,
  Z_PINNED_HEADER,
  striped,
} from '../lib/rowSurface';
import { columnAverage, fmtAverage } from '../lib/averages';
import type { ColumnAverage, Normalization } from '../lib/averages';

/**
 * How the averages divide. A named constant rather than an inline literal because
 * it is the seam the deferred per-90 toggle turns into a piece of state — see
 * `lib/averages.ts`. This item ships one value and no toggle.
 */
const NORMALIZATION: Normalization = 'per-appearance';
import { Card } from './ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';

interface Props {
  history: GameweekHistory[];
  teams: Team[];
  /**
   * Whether this table owns its horizontal scrolling.
   *
   * True standalone. **False when nested inside the career table**, and it has
   * to be: `position: sticky` resolves against the nearest scrolling ancestor,
   * so a table wrapped in its own `overflow-x-auto` that is never narrow enough
   * to scroll would pin GW to a container that does not move, and the column
   * would slide away with the rest when the outer table scrolls. Sharing the
   * outer scroller also means one scrollbar for the section rather than two
   * nested ones.
   */
  scroll?: boolean;
}

type SortKey = keyof GameweekHistory;

interface Column {
  key: SortKey;
  label: string;
  /** How the cell prints. Every value that can be null goes through fmtNum. */
  render: (gw: GameweekHistory, teamMap: Record<number, string>) => string;
  /** False for the columns an average is meaningless for. */
  averaged: boolean;
}

const num = (v: number) => String(v);

/**
 * Note `Tck` for tackles rather than FPL's `T`, which is already threat here.
 * Two columns of numbers under the same one-letter heading is a table nobody
 * can read; threat keeps the letter because it was here first.
 */
const COLUMNS: Column[] = [
  { key: 'round', label: 'GW', render: (g) => String(g.round), averaged: false },
  {
    key: 'opponent_team',
    label: 'Opp',
    render: (g, teamMap) => teamMap[g.opponent_team] ?? String(g.opponent_team),
    averaged: false,
  },
  { key: 'was_home', label: 'H/A', render: (g) => (g.was_home ? 'H' : 'A'), averaged: false },
  { key: 'total_points', label: 'Pts', render: (g) => num(g.total_points), averaged: true },
  { key: 'minutes', label: 'Min', render: (g) => num(g.minutes), averaged: true },
  { key: 'goals_scored', label: 'G', render: (g) => num(g.goals_scored), averaged: true },
  { key: 'assists', label: 'A', render: (g) => num(g.assists), averaged: true },
  { key: 'clean_sheets', label: 'CS', render: (g) => num(g.clean_sheets), averaged: true },
  { key: 'goals_conceded', label: 'GC', render: (g) => num(g.goals_conceded), averaged: true },
  { key: 'own_goals', label: 'OG', render: (g) => num(g.own_goals), averaged: true },
  { key: 'penalties_saved', label: 'PS', render: (g) => num(g.penalties_saved), averaged: true },
  { key: 'penalties_missed', label: 'PM', render: (g) => num(g.penalties_missed), averaged: true },
  { key: 'yellow_cards', label: 'YC', render: (g) => num(g.yellow_cards), averaged: true },
  { key: 'red_cards', label: 'RC', render: (g) => num(g.red_cards), averaged: true },
  { key: 'saves', label: 'S', render: (g) => num(g.saves), averaged: true },
  { key: 'expected_goals', label: 'xG', render: (g) => fmtNum(g.expected_goals, 2), averaged: true },
  { key: 'expected_assists', label: 'xA', render: (g) => fmtNum(g.expected_assists, 2), averaged: true },
  {
    key: 'expected_goal_involvements',
    label: 'xGI',
    render: (g) => fmtNum(g.expected_goal_involvements, 2),
    averaged: true,
  },
  {
    key: 'expected_goals_conceded',
    label: 'xGC',
    render: (g) => fmtNum(g.expected_goals_conceded, 2),
    averaged: true,
  },
  { key: 'tackles', label: 'Tck', render: (g) => fmtNum(g.tackles, 0), averaged: true },
  {
    key: 'clearances_blocks_interceptions',
    label: 'CBI',
    render: (g) => fmtNum(g.clearances_blocks_interceptions, 0),
    averaged: true,
  },
  { key: 'recoveries', label: 'R', render: (g) => fmtNum(g.recoveries, 0), averaged: true },
  {
    key: 'defensive_contribution',
    label: 'DC',
    render: (g) => fmtNum(g.defensive_contribution, 0),
    averaged: true,
  },
  { key: 'ict_index', label: 'ICT', render: (g) => fmtNum(g.ict_index, 1), averaged: true },
  { key: 'influence', label: 'I', render: (g) => fmtNum(g.influence, 1), averaged: true },
  { key: 'creativity', label: 'C', render: (g) => fmtNum(g.creativity, 1), averaged: true },
  { key: 'threat', label: 'T', render: (g) => fmtNum(g.threat, 1), averaged: true },
  { key: 'bonus', label: 'Bon', render: (g) => num(g.bonus), averaged: true },
  { key: 'bps', label: 'BPS', render: (g) => num(g.bps), averaged: true },
  { key: 'value', label: 'Price', render: (g) => `£${(g.value / 10).toFixed(1)}`, averaged: false },
  { key: 'selected', label: 'Selected', render: (g) => g.selected.toLocaleString(), averaged: false },
];

/**
 * The two pinned columns, and the widths that make the pair line up.
 *
 * Thirty-one columns do not fit, so the card scrolls horizontally — and a row of
 * numbers with the round scrolled off the left edge cannot be attributed to a
 * gameweek at all, nor to an opponent. GW and Opp therefore both stay put.
 *
 * **A second pinned column needs a concrete offset equal to the first column's
 * width, so the first column's width has to be real.** Under `table-layout: auto` a
 * declared width is a strong hint and no more: a cell whose content is wider wins.
 * Measured intrinsic widths are GW **51.3px** (the `GW▴` header text at 26.5px and
 * two digits at 27.3px, plus 24px of `px-3`) and Opp **~52px** (three-letter
 * opponent codes). Both clear 3.5rem/56px with about 5px of headroom, and `w-14`
 * equals `left-14`, so the invariant reads off the classes.
 *
 * The brief specified 3rem/3.5rem. 3rem is **48px, below GW's 51.3px** — GW would
 * have rendered wider than declared and Opp's `left: 3rem` would have overlapped it
 * by about 3px. Not adopted.
 *
 * Opp measured **119.6px** before this item, which is why the pair would have cost
 * 171px. The cause was not the opponent codes: it was the averages row's
 * `over 38 fixtures` sitting in this column at 95.6px of `whitespace-nowrap` text.
 * That note is a line beneath the table now — see AveragesNote. A footnote must not
 * dictate a pinned column's width.
 *
 * Failure mode if the headroom is ever eaten (a display font that fails to load and
 * falls back wider): a visible seam or overlap between the two pinned columns when
 * scrolled right. **Loud rather than silent**, which is why 5px is accepted here;
 * `table-layout: fixed` would make it a guarantee at the cost of declaring all 31
 * widths.
 *
 * No background and no hover colour of their own any more. The cells paint
 * `--row-bg`, which the row holds, so they stripe and hover with the rest of the row
 * instead of stepping away from it — see the comment in `ui/Table.tsx`.
 *
 * Geometry only, **no z-index**: the level is added at each call site, because the
 * same column is `Z_PINNED` in the body and `Z_PINNED_HEADER` in the header, and two
 * `z-*` utilities on one cell are two declarations of equal specificity whose winner
 * depends on Tailwind's emission order.
 */
const PIN_W = 'w-14 min-w-[3.5rem]';
const PINNED_GW = `sticky left-0 ${PIN_W}`;
const PINNED_OPP = `sticky left-14 ${PIN_W} ${EDGE_PINNED}`;

/**
 * The header, sticky on the vertical axis.
 *
 * `position: sticky` on the individual `<th>`, never on `<thead>` or `<tr>`. It also
 * only does anything if the nearest scroll container is **bounded**: a wrapper with
 * `overflow-x: auto` has its `overflow-y` computed to `auto` by the spec, which makes
 * it a vertical scroll container of unbounded height, and a sticky header inside one
 * never sticks — no error, no warning. Both of this table's scrollports are bounded
 * for that reason; see the render at the bottom of this file.
 */
const STICKY_HEAD = `sticky top-0 ${Z_HEADER}`;
/** For the two corner cells, which are pinned on both axes at once. */
const STICKY_HEAD_PINNED = `sticky top-0 ${Z_PINNED_HEADER}`;

/**
 * What the averages rest on, as a line beneath the table.
 *
 * Rule 13 makes stating the denominator mandatory — a double gameweek is two rows in
 * one round, a blank is none, and a fixture the player sat out is a row of zeroes, so
 * "per gameweek" is ambiguous on its own. It used to be printed inside the averages
 * row's Opp cell, which is where a 95.6px footnote ended up setting a pinned column's
 * width. It says the same thing from outside the table, where it dictates nothing.
 *
 * **One sentence with one substitution**, never two separately worded ones:
 *
 *     Averages over 37 appearances in 38 fixtures      (min === max)
 *     Averages over 12–16 appearances in 38 fixtures   (2022-23, and only there)
 *
 * The earlier draft read "over 37 of 38 fixtures played", which does not scan: the
 * trailing participle lets a fast reader take 38 as the played count, which is the
 * one number it is not. Putting the count next to its own noun fixes that, uses the
 * word the career table's APPS column and FPL both use, and leaves 38 unambiguously
 * the total.
 *
 * The range is honest at the low end rather than approximate: each average really is
 * computed over between 12 and 16 **appearances**, because 2022-23 measures the
 * expected family only from round 16 (item 7). So the range describes the averages,
 * not the player.
 *
 * **It renders what it is handed and computes nothing** — including the decision of
 * whether to appear at all, which stays with the caller. That is what keeps it free
 * of the empty-range case: `Math.min()` of no values is `Infinity`, and defending
 * against that here would put the caller's knowledge in the wrong place.
 */
export function AveragesNote({
  min,
  max,
  fixtures,
  breakdown,
}: {
  /** The smallest denominator any rendered average used. */
  min: number;
  /** The largest. Equal to `min` in every season but 2022-23. */
  max: number;
  /** Rows shown — the availability signal the old denominator used to carry. */
  fixtures: number;
  /** Per-column detail for the title, where the two differ. */
  breakdown?: string;
}) {
  const appearances = min === max ? String(min) : `${min}–${max}`;
  return (
    <p className="mt-2 text-[11px] text-muted-foreground" title={breakdown}>
      Averages over {appearances} {min === 1 && max === 1 ? 'appearance' : 'appearances'} in{' '}
      {fixtures} {fixtures === 1 ? 'fixture' : 'fixtures'}
    </p>
  );
}

/** The sortable/averageable value of a cell, or null where there is none. */
function numericValue(gw: GameweekHistory, key: SortKey): number | null {
  const v = gw[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' ? v : null;
}

export default function StatsTable({ history, teams, scroll = true }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('round');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.short_name]));

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...history].sort((a, b) => {
    const av = numericValue(a, sortKey);
    const bv = numericValue(b, sortKey);
    // Unmeasured rows sort last in both directions. Treating null as 0 would
    // put a season that predates xG at the bottom of an ascending sort as
    // though it had generated no chances (rule 6).
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  /**
   * The mean over the fixtures the player actually **played**, per column.
   *
   * It used to divide by every row shown, which put two averages of the same
   * quantity on one screen disagreeing with each other: Tarkowski's 2025-26 read
   * AVG Pts 4.5 (170/38) under a career row saying PPG 4.6 (170/37), neither
   * labelled as differing from the other. `points_per_game` has divided by
   * appearances since Phase 0, so this makes the gameweek table agree with the
   * convention the career table already documents.
   *
   * Nulls are still skipped, and the two filters compose — see `columnAverage`. A
   * column with nothing contributing shows the placeholder rather than 0.00.
   *
   * The denominators come back with the values because they do not agree: 2022-23
   * measures the expected family only from round 16, so one row can carry three of
   * them. The footnote is built from them below.
   */
  const averages = new Map<SortKey, ColumnAverage>(
    COLUMNS.filter((col) => col.averaged).map((col) => [
      col.key,
      columnAverage(history, (gw) => numericValue(gw, col.key), NORMALIZATION),
    ])
  );

  const avg = (key: SortKey): string => {
    const a = averages.get(key);
    return a === undefined || a.value === null ? NO_VALUE : fmtAverage(a.value);
  };

  /**
   * The footnote's numbers, and the three cases the caller owns.
   *
   * **Only columns that render a number contribute a denominator.** A column whose
   * denominator is 0 shows `—`, and letting it into the range would drag the low end
   * to 0 on every season with a rule-6 column — which is all ten — and make them all
   * look divergent when only 2022-23 is.
   *
   * That leaves the set empty exactly when nothing rendered, which is a real case
   * rather than a hypothetical: a player with no appearances among the rows shown,
   * either because he never played or because the filters selected a window he
   * missed. `Math.min()` of an empty array is `Infinity`, so this is handled here
   * rather than in the note — the sentence would otherwise read "Averages over
   * Infinity appearances in 38 fixtures", and it would read that on the largest
   * population this item changes.
   *
   * Zero is the true floor there rather than a guard value: with no appearances
   * there are no averages, and the appearance count really is 0.
   */
  const rendered = [...averages.values()].filter((a) => a.denominator > 0);
  const denominators = rendered.map((a) => a.denominator);
  const minDenominator = denominators.length === 0 ? 0 : Math.min(...denominators);
  const maxDenominator = denominators.length === 0 ? 0 : Math.max(...denominators);

  /** Per-column detail for the note's title, only where the columns disagree. */
  const breakdown =
    minDenominator === maxDenominator
      ? undefined
      : COLUMNS.filter((col) => col.averaged && (averages.get(col.key)?.denominator ?? 0) > 0)
          .map((col) => `${col.label}: ${averages.get(col.key)!.denominator}`)
          .join(' · ');

  // Built first and wrapped after, rather than through a component chosen at
  // render time: a component defined inside the body is a new type on every
  // render, so React would unmount and remount the table and lose the sort.
  const table = (
    <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col, i) => (
              <TableHead
                key={col.key}
                onClick={() => handleSort(col.key)}
                // Direction is announced by aria-sort, so the arrow below is
                // decorative and hidden. Every column here sorts, so the ones
                // that are not the current key say so rather than say nothing.
                sortDirection={
                  sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className={`text-right ${sortKey === col.key ? 'text-foreground' : ''} ${
                  i <= 1 ? STICKY_HEAD_PINNED : STICKY_HEAD
                } ${i === 0 ? PINNED_GW : ''} ${i === 1 ? PINNED_OPP : ''}`.trim()}
              >
                {col.label}
                {sortKey === col.key && (
                  <span aria-hidden="true" className="ml-0.5 opacity-50 text-[9px]">
                    {sortDir === 'asc' ? '▴' : '▾'}
                  </span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Keyed on the fixture, never on the round. A double gameweek gives
              one player two rows in the same round, and keying on `round`
              collapsed them into a duplicate key that React warns about and
              renders wrong (rule 13). Not an edge case: 2025-26 alone has three
              such rounds — 26 (79 players), 33 (248) and 36 (82). */}
          {sorted.map((gw, i) => (
            // The stripe comes from the map index, not `nth-child`: the AVG row is
            // the last `<tbody>` child, so parity would tint it half the time
            // depending on how many fixtures the filters left. See rowSurface.
            <TableRow key={gw.fixture} className={striped(i)}>
              {COLUMNS.map((col, c) => (
                <TableCell
                  key={col.key}
                  className={`text-right font-display text-[13px] tabular-nums text-foreground whitespace-nowrap ${
                    c === 0 ? `${PINNED_GW} ${Z_PINNED}` : ''
                  } ${c === 1 ? `${PINNED_OPP} ${Z_PINNED}` : ''}`}
                >
                  {col.render(gw, teamMap)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {/* The averages row takes the band surface for the same reason the header
              does: it is not one of the data rows, so it cannot take a data row's
              colour, and it has to be opaque because its first two cells are pinned.
              `bg-muted/50` was translucent, which is exactly why its pinned cell
              needed a second, differently-coloured literal of its own. */}
          <TableRow className={`${ROW_BAND} font-semibold`}>
            {COLUMNS.map((col, i) => (
              <TableCell
                key={col.key}
                className={`text-right font-display text-[12px] tabular-nums text-muted-foreground whitespace-nowrap ${
                  i === 0 ? `${PINNED_GW} ${Z_PINNED}` : ''
                } ${i === 1 ? `${PINNED_OPP} ${Z_PINNED}` : ''}`}
              >
                {/* The denominator used to live in the Opp cell, where 95.6px of
                    nowrap text set that column's width at 119.6px and made the
                    pinned pair cost 171px. It is a line under the table now. */}
                {i === 0 ? 'AVG' : col.averaged ? avg(col.key) : ''}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
    </Table>
  );

  /**
   * The wrappers, and why the standalone one is bounded.
   *
   * `overflow-x-auto` alone does not work. Per the overflow spec, `overflow-x: auto`
   * with `overflow-y: visible` computes `overflow-y` to **auto** — so the wrapper is a
   * vertical scroll container whose height is its content height, meaning it never
   * scrolls vertically and a sticky header inside it silently never sticks. Measured
   * before this item: `clientHeight === scrollHeight === 1635`, `max-height: none`.
   *
   * Bounding it is what makes the header work, and it makes this table its own scroll
   * pane. `overscroll-behavior` is deliberately left at its default so the wheel
   * chains onto the page once the pane bottoms out; `contain` would trap it.
   *
   * The nested case is unchanged, because that wrapper is not a scroll container at
   * all — `scroll={false}` shares the career table's scroller, which is bounded for
   * this same reason, and that is what its sticky header resolves against.
   *
   * The note sits OUTSIDE the wrapper deliberately. Inside it, it would scroll
   * horizontally away with the columns — a footnote about the whole table that you
   * have to scroll back to read.
   *
   * **No note at all when no rows are shown.** There is no denominator to state, and
   * `GameweekSection` already prints "None of X's N matches match the selected
   * filters." directly beneath — which says the useful thing. Before this item it
   * read "Averages over 0 fixtures", which was noise.
   */
  return (
    <>
      {scroll ? (
        <Card className="overflow-auto max-h-[70vh]">{table}</Card>
      ) : (
        <div className="rounded-lg border border-border bg-card">{table}</div>
      )}
      {history.length > 0 && (
        <AveragesNote
          min={minDenominator}
          max={maxDenominator}
          fixtures={history.length}
          breakdown={breakdown}
        />
      )}
    </>
  );
}

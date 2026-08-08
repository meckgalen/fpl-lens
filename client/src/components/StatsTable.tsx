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
 * The averages row's denominator, as a line beneath the table.
 *
 * Rule 13 makes stating the denominator mandatory — a double gameweek is two rows in
 * one round, a blank is none, and a fixture the player sat out is a row of zeroes, so
 * "per gameweek" is ambiguous and "per appearance" is wrong. It used to be printed
 * inside the averages row's Opp cell, which is where a 95.6px footnote ended up
 * setting a pinned column's width. It says the same thing from outside the table,
 * where it dictates nothing.
 *
 * **It takes the number as a prop and renders only what it is handed.** It does not
 * count rows and does not compose the figure from a season length. The denominator is
 * being revisited as its own item and may become per-column rather than one number
 * for the table; taking it as an input means that lands at the one call site instead
 * of in here. Nothing about the *value* changed in this item — it is still the
 * filtered row count, which is what the cell printed before.
 */
export function AveragesNote({ denominator }: { denominator: number }) {
  return (
    <p className="mt-2 text-[11px] text-muted-foreground">
      Averages over {denominator} {denominator === 1 ? 'fixture' : 'fixtures'}
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
   * The mean over the fixtures shown, not over rounds and not over appearances.
   *
   * Rule 13 makes stating the denominator mandatory, so the row prints it as a
   * count rather than a word: a double gameweek contributes two rows in one
   * round, a blank contributes none, and a fixture the player sat out
   * contributes a row of zeroes. All three make "per gameweek" ambiguous and
   * "per appearance" wrong. The rows are also the filtered ones, so the number
   * moves with the filters, which is another reason to show it.
   *
   * Nulls are skipped rather than summed as zero. Before, a season with no xG
   * averaged 0.00 across 38 fixtures and looked like a measured result; now the
   * denominator is the fixtures that actually carry a value, and a column with
   * none of them shows the placeholder.
   */
  const avg = (key: SortKey): string => {
    const values = history.map((gw) => numericValue(gw, key)).filter((v): v is number => v !== null);
    if (values.length === 0) return NO_VALUE;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return mean.toFixed(1);
  };

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
   */
  return (
    <>
      {scroll ? (
        <Card className="overflow-auto max-h-[70vh]">{table}</Card>
      ) : (
        <div className="rounded-lg border border-border bg-card">{table}</div>
      )}
      <AveragesNote denominator={history.length} />
    </>
  );
}

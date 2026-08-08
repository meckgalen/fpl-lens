import type { ReactNode } from 'react';
import type { PlayerCareerSeason } from '../types/fpl';
import { NO_VALUE, POSITION_MAP, fmtNum } from '../types/fpl';
import { EDGE_PINNED, Z_PINNED, hoverInert, striped } from '../lib/rowSurface';
import { Card } from './ui/Card';
import { DisclosureButton } from './ui/DisclosureButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { fmtPpg } from '../lib/averages';

interface Props {
  seasons: PlayerCareerSeason[];
  /** Which season's rows are open. Expanding does not close the others. */
  expanded: Set<string>;
  onToggle: (season: string) => void;
  /** The gameweeks for an expanded season, rendered inside the spanning row. */
  renderExpanded: (season: string) => ReactNode;
}

interface Column {
  label: string;
  /** Spelled out in the header's title where the label is an abbreviation. */
  title?: string;
  render: (s: PlayerCareerSeason) => string;
}

/**
 * Everything but the pinned Season cell, which carries the expand control and
 * is rendered separately.
 *
 * `Tck` rather than FPL's `T`, matching StatsTable: threat already has the
 * letter. Every nullable stat goes through fmtNum, so a season that never
 * measured one shows `—` where the FPL site shows `0.00`. That difference is
 * deliberate and is the reason the column set is worth having: 0 says he
 * generated no chances, `—` says nobody was counting.
 */
const COLUMNS: Column[] = [
  {
    label: 'Club',
    // Rule 17. The snapshot is taken when the season ends, so a January move is
    // backdated across the whole row. The gameweeks underneath are where the
    // club he actually played each match for lives.
    title: 'Club at the end of the season — a mid-season transfer shows the new one',
    render: (s) => s.team_short_name,
  },
  { label: 'Pos', render: (s) => POSITION_MAP[s.element_type] ?? NO_VALUE },
  {
    label: 'Price',
    title: 'Start of season → end of season',
    render: (s) =>
      s.start_cost === null && s.end_cost === null
        ? NO_VALUE
        : `${fmtPriceCell(s.start_cost)}→${fmtPriceCell(s.end_cost)}`,
  },
  {
    label: 'Mch',
    title: 'Fixtures he was in the squad for, played or not',
    render: (s) => String(s.matches),
  },
  {
    label: 'Apps',
    title: 'Matches with minutes on the pitch — not rounds, a double gameweek is two',
    render: (s) => String(s.appearances),
  },
  { label: 'Starts', title: 'Not collected before 2022-23', render: (s) => fmtNum(s.starts, 0) },
  { label: 'Pts', render: (s) => String(s.total_points) },
  { label: 'PPG', title: 'Points per appearance, not per round', render: (s) => fmtPpg(s.points_per_game) },
  { label: 'Min', render: (s) => String(s.minutes) },
  { label: 'G', render: (s) => String(s.goals_scored) },
  { label: 'A', render: (s) => String(s.assists) },
  { label: 'CS', render: (s) => String(s.clean_sheets) },
  { label: 'GC', render: (s) => String(s.goals_conceded) },
  { label: 'OG', render: (s) => String(s.own_goals) },
  { label: 'PS', title: 'Penalties saved', render: (s) => String(s.penalties_saved) },
  { label: 'PM', title: 'Penalties missed', render: (s) => String(s.penalties_missed) },
  { label: 'YC', render: (s) => String(s.yellow_cards) },
  { label: 'RC', render: (s) => String(s.red_cards) },
  { label: 'S', title: 'Saves', render: (s) => String(s.saves) },
  { label: 'xG', title: 'Not collected before 2022-23', render: (s) => fmtNum(s.expected_goals, 2) },
  { label: 'xA', title: 'Not collected before 2022-23', render: (s) => fmtNum(s.expected_assists, 2) },
  {
    label: 'xGI',
    title: 'Not collected before 2022-23',
    render: (s) => fmtNum(s.expected_goal_involvements, 2),
  },
  {
    label: 'xGC',
    title: 'Expected goals conceded — not collected before 2022-23',
    render: (s) => fmtNum(s.expected_goals_conceded, 2),
  },
  {
    label: 'Tck',
    title: 'Tackles — collected 2016-17 to 2018-19 and again from 2025-26',
    render: (s) => fmtNum(s.tackles, 0),
  },
  {
    label: 'CBI',
    title: 'Clearances, blocks, interceptions — collected 2016-17 to 2018-19 and again from 2025-26',
    render: (s) => fmtNum(s.clearances_blocks_interceptions, 0),
  },
  {
    label: 'R',
    title: 'Recoveries — collected 2016-17 to 2018-19 and again from 2025-26',
    render: (s) => fmtNum(s.recoveries, 0),
  },
  {
    label: 'DC',
    title: 'Defensive contribution — introduced in 2025-26',
    render: (s) => fmtNum(s.defensive_contribution, 0),
  },
  { label: 'ICT', render: (s) => fmtNum(s.ict_index, 1) },
  { label: 'I', title: 'Influence', render: (s) => fmtNum(s.influence, 1) },
  { label: 'C', title: 'Creativity', render: (s) => fmtNum(s.creativity, 1) },
  { label: 'T', title: 'Threat', render: (s) => fmtNum(s.threat, 1) },
  { label: 'Bon', title: 'Bonus', render: (s) => String(s.bonus) },
  { label: 'BPS', render: (s) => String(s.bps) },
];

/** One end of the price range. Kept local: the pair renders as one cell. */
function fmtPriceCell(cost: number | null): string {
  return cost === null ? NO_VALUE : `£${(cost / 10).toFixed(1)}`;
}

/**
 * The pinned Season column, which is also the expand control.
 *
 * The table is wider than any screen, and each row is its own toggle — so
 * without this, scrolling right to compare DC or BPS puts the control that
 * opens the row off the left edge, and the number you are reading and the
 * button you need are never visible at once.
 *
 * No background of its own any more. The cell paints `--row-bg`, which the row
 * holds, so it stripes and hovers in step with the rest of the row instead of
 * stepping away from it — see the comment in `ui/Table.tsx`. Still opaque, which is
 * the requirement a sticky cell actually has.
 *
 * **This table gets no sticky header**, deliberately. Ten rows never need one, and
 * leaving it off keeps the z-index ladder at the three levels `rowSurface` defines
 * rather than adding a fourth for a header that would have to sit above the
 * gameweek tables' headers nested inside it.
 */
const STICKY_COL = `sticky left-0 ${Z_PINNED} ${EDGE_PINNED}`;

/** The row a season's toggle points `aria-controls` at while it is open. */
const detailRowId = (season: string) => `career-gameweeks-${season}`;

export default function CareerTable({ seasons, expanded, onToggle, renderExpanded }: Props) {
  return (
    /*
     * A bounded pane, and the bound is what makes the nested gameweek tables' sticky
     * headers work at all.
     *
     * `overflow-x-auto` on its own does not. Per the overflow spec, `overflow-x: auto`
     * with `overflow-y: visible` computes `overflow-y` to **auto**, so this was
     * already a vertical scroll container — just an unbounded one, which never scrolls
     * and which a sticky header therefore resolves against and does nothing.
     *
     * The nested tables cannot be given a scroller of their own instead: each one
     * lives inside a `colSpan={34}` cell that is as wide as this whole table, so its
     * wrapper is never narrow enough to scroll horizontally. This card is their
     * scrollport on both axes, so this is where the bound has to be.
     *
     * It earns its keep beyond the sticky header. Ten expandable seasons at 38 rows
     * each is a 400-row page; a pane keeps the season list reachable while you read
     * one season. And it costs nothing collapsed — the table is ~200px tall with four
     * rows closed, so no scrollbar exists until something is open.
     *
     * `overscroll-behavior` stays at its default: the wheel should chain onto the page
     * once the pane bottoms out. `contain` would make the trapping worse, not better.
     */
    <Card className="overflow-auto max-h-[75vh]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={`${STICKY_COL} text-left`}>Season</TableHead>
            {COLUMNS.map((col) => (
              <TableHead key={col.label} className="text-right" title={col.title}>
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {seasons.map((s, i) => {
            const isOpen = expanded.has(s.season);
            // From the map index, not `nth-child`. An open season inserts a sibling
            // <tr> into this same <tbody>, so parity would alternate between summary
            // rows and expansion rows and flip everything below the open one.
            const stripe = striped(i);
            return [
              <TableRow key={s.season} className={stripe} onClick={() => onToggle(s.season)}>
                <TableCell
                  className={`${STICKY_COL} font-display text-[13px] font-semibold text-foreground whitespace-nowrap`}
                >
                  {/* The row keeps its own onClick, so a mouse can still open a
                      season by clicking anywhere along it. This is the control
                      a keyboard and a screen reader get, and it carries the
                      season as its text so its accessible name is "2024-25"
                      rather than "button". DisclosureButton stops the click
                      propagating, or the row handler would toggle it back. */}
                  <DisclosureButton
                    expanded={isOpen}
                    controls={detailRowId(s.season)}
                    onToggle={() => onToggle(s.season)}
                  >
                    {s.season}
                  </DisclosureButton>
                </TableCell>
                {COLUMNS.map((col) => (
                  <TableCell
                    key={col.label}
                    className="text-right font-display text-[13px] tabular-nums text-foreground whitespace-nowrap"
                  >
                    {col.render(s)}
                  </TableCell>
                ))}
              </TableRow>,
              // The expanded gameweeks, in a row spanning the whole table. Its
              // key is distinct from the summary row's so React never has to
              // choose between two rows claiming the same season.
              isOpen && (
                <TableRow
                  key={`${s.season}-detail`}
                  id={detailRowId(s.season)}
                  // Takes its summary row's stripe so an open season reads as one
                  // block, and cancels the hover — hovering the gameweeks inside it
                  // should not tint the panel they sit in. `hoverInert` takes the same
                  // index so the cancel names this row's own surface; cancelling to
                  // the default colour would step an open striped season back to plain.
                  className={`${stripe} ${hoverInert(i)}`}
                >
                  <TableCell colSpan={COLUMNS.length + 1} className="p-0">
                    <div className="px-3 py-3 bg-muted/30">{renderExpanded(s.season)}</div>
                  </TableCell>
                </TableRow>
              ),
            ];
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

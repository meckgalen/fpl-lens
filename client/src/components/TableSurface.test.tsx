/**
 * The row-surface refactor, the z-index ladder, and the pinned column geometry.
 *
 * **Read the limit of this file before reading its assertions.** Every claim here is
 * at the class level, and jsdom does not lay out: it has no scroll containers, no
 * sticky resolution, no stacking contexts and no widths. So nothing in this file is
 * evidence that a header sticks, that a pinned pair lines up, or that a stripe runs
 * unbroken through a pinned cell. Those rest entirely on the browser pass.
 *
 * What it can pin is narrower and still worth having: that the cells stopped carrying
 * their own opaque colours, that the ladder has three distinct levels assigned to the
 * right cells, that a width and the offset derived from it are the same number, and —
 * the one with real teeth — that the stripe follows the **data index** rather than DOM
 * parity, asserted in the state where the two disagree.
 *
 * The item-3 record is the precedent for the disclaimer. Every class its test
 * asserted was present while the header row was silently collapsed to half height in
 * the browser, because `h-full` beat `h-10` in a cascade jsdom never evaluates.
 */

import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatsTable, { AveragesNote } from './StatsTable';
import CareerTable from './CareerTable';
import { ROW_STRIPE, Z_HEADER, Z_PINNED, Z_PINNED_HEADER } from '../lib/rowSurface';
import type { FootnoteModel } from '../lib/averages';
import { aCareerSeason, aGameweek, aTeam } from '../test/factories';

const TEAMS = [aTeam(), aTeam({ id: 43, short_name: 'MCI' })];

/** Four rounds, so there are two striped rows and two unstriped ones. */
const HISTORY = [1, 2, 3, 4].map((n) => aGameweek({ fixture: n, round: n }));

/** The `<tr>`s holding fixture data — the AVG row is a `<tbody>` child too. */
const dataRows = (table: HTMLElement) =>
  [...table.querySelectorAll('tbody tr')].filter(
    (tr) => !(tr.textContent ?? '').startsWith('AVG')
  );

const avgRow = (table: HTMLElement) =>
  [...table.querySelectorAll('tbody tr')].find((tr) =>
    (tr.textContent ?? '').startsWith('AVG')
  ) as HTMLElement;

describe('the cells paint the row’s colour, not their own', () => {
  /**
   * The defect this replaced, stated so the assertion is legible. A pinned cell has
   * to be opaque or the columns show through it, so it carried `bg-card` and hovered
   * to an opaque `bg-muted` — while the rest of the row hovered to `bg-muted/50` over
   * card. Measured in the browser: rgb(238,235,231) against rgb(246,244,241), a hard
   * vertical step at the pinned boundary that read as only the pinned cell being
   * highlighted.
   */
  it('gives no cell a background colour of its own', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const table = screen.getByRole('table');

    for (const cell of table.querySelectorAll('th, td')) {
      expect(cell.className).toMatch(/bg-\[color:var\(--row-bg/);
      // The literals that used to be here, and the `group-hover:` variant that
      // paired with them. Any of them coming back reintroduces the step.
      expect(cell.className).not.toMatch(/\bbg-card\b/);
      expect(cell.className).not.toMatch(/\bbg-muted\b/);
      expect(cell.className).not.toMatch(/group-hover:/);
    }
  });

  it('sets --row-bg on the row, and hovers it there too', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const row = dataRows(screen.getByRole('table'))[0];

    expect(row.className).toContain('[--row-bg:hsl(var(--row))]');
    expect(row.className).toContain('hover:[--row-bg:hsl(var(--row-hover))]');
  });

  it('gives the averages row the band surface rather than a data row’s colour', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);

    // It is not a data row, so it cannot take one's colour — and it has to be
    // opaque, because its first two cells are pinned. `bg-muted/50` was translucent,
    // which is why its pinned cell needed a second differently-coloured literal.
    expect(avgRow(screen.getByRole('table')).className).toContain('[--row-bg:hsl(var(--row-head))]');
    expect(avgRow(screen.getByRole('table')).className).not.toContain(ROW_STRIPE);
  });
});

describe('the z-index ladder', () => {
  /**
   * Three levels, and the assertion is that they are three *different* ones assigned
   * to the right cells. A pinned body cell must sit over the columns scrolling past
   * it; a header cell must sit over the pinned body cells; the corner, pinned on both
   * axes, must sit over both. Collapsing any two lets a column slide over a header or
   * a header under a column, which only shows up mid-scroll.
   */
  it('is three distinct levels', () => {
    expect(new Set([Z_PINNED, Z_HEADER, Z_PINNED_HEADER]).size).toBe(3);
  });

  it('puts the corner cells above the header, and the header above the pinned body', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const table = screen.getByRole('table');
    const heads = [...table.querySelectorAll('thead th')];

    // GW and Opp are pinned on both axes; every other header cell on one.
    expect(heads[0].className).toContain(Z_PINNED_HEADER);
    expect(heads[1].className).toContain(Z_PINNED_HEADER);
    expect(heads[2].className).toContain(Z_HEADER);
    expect(heads[2].className).not.toContain(Z_PINNED_HEADER);

    const cells = [...dataRows(table)[0].querySelectorAll('td')];
    expect(cells[0].className).toContain(Z_PINNED);
    expect(cells[1].className).toContain(Z_PINNED);
    expect(cells[2].className).not.toMatch(/\bz-\[/);
  });

  /**
   * One `z-*` per cell. Two would be two declarations of equal specificity whose
   * winner depends on the order Tailwind happened to emit them, which is the class of
   * bug item 3 shipped with `h-10` against `h-full` — every asserted class present,
   * one of them silently losing in a cascade jsdom never runs.
   */
  it('never puts two z-index utilities on one cell', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);

    for (const cell of screen.getByRole('table').querySelectorAll('th, td')) {
      expect(cell.className.match(/\bz-\[\d+\]/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });
});

describe('the pinned pair', () => {
  /**
   * The invariant a second pinned column needs: its `left` offset equals the first
   * column's width. The brief specified `width: 3rem` for GW with Opp at `left: 3rem`,
   * and 3rem is 48px against GW's **measured 51.3px** intrinsic width — under
   * `table-layout: auto` GW would have rendered wider than declared and Opp would have
   * overlapped it by ~3px. 3.5rem clears it with about 5px to spare.
   *
   * Asserting the two tokens are the same number is the whole test. jsdom cannot tell
   * whether they line up on screen; it can tell whether the code still claims they do.
   */
  it('offsets Opp by exactly GW’s width', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const heads = [...screen.getByRole('table').querySelectorAll('thead th')];

    expect(heads[0].className).toContain('left-0');
    expect(heads[0].className).toContain('w-14');
    // 14 in both, and `left-14` is `w-14`'s 3.5rem. If one moves the other must.
    expect(heads[1].className).toContain('left-14');
    expect(heads[1].className).toContain('w-14');
  });

  it('gives the pinned block a floor as well as a width', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const gw = screen.getByRole('table').querySelector('thead th') as HTMLElement;

    // `w-14` alone is a hint an over-wide cell wins against; `min-w` is what stops the
    // column collapsing narrower than the offset Opp is pinned at.
    expect(gw.className).toContain('min-w-[3.5rem]');
  });

  it('rules off the last pinned column and not the first', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const heads = [...screen.getByRole('table').querySelectorAll('thead th')];

    // A border rather than a box-shadow, because the corner cell needs the header's
    // bottom shadow at the same time and two box-shadows would race. The rule belongs
    // to the boundary between the pinned block and the scrolling columns, so only Opp
    // draws it — GW drawing one too would put a line down the middle of the pair.
    expect(heads[1].className).toContain('border-r');
    expect(heads[0].className).not.toContain('border-r');
  });

  /**
   * The reason Opp could be pinned narrow at all. It measured **119.6px** before this
   * item, and not because of the opponent codes: the averages row printed
   * `over 38 fixtures` in this column, 95.6px of `whitespace-nowrap` text setting the
   * width of a pinned column from a footnote.
   */
  it('keeps the averages row’s Opp cell empty', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const cells = [...avgRow(screen.getByRole('table')).querySelectorAll('td')];

    expect(cells[0]).toHaveTextContent('AVG');
    expect(cells[1]).toHaveTextContent('');
    expect(cells[1].textContent).not.toMatch(/fixture/);
  });
});

describe('the averages footnote', () => {
  const exact = (value: number): FootnoteModel => ({
    main: { kind: 'exact', value },
    divergent: null,
  });

  /**
   * **It renders what it is handed.** Item 10 built this seam, item 11 widened it
   * from one denominator to a range, and item 12 replaced the range with a model
   * — and through all three the note has computed nothing. Values chosen to match
   * no count in any table, to separate "displayed the input" from "recounted the
   * rows and got the same answer".
   */
  it('renders the numbers it is given, not ones it recounted', () => {
    render(<AveragesNote model={exact(17)} fixtures={23} />);
    expect(screen.getByText('Averages over 17 appearances in 23 fixtures.')).toBeInTheDocument();
  });

  it('renders one line when the denominators agree', () => {
    render(<AveragesNote model={exact(9)} fixtures={12} />);
    expect(screen.getByText('Averages over 9 appearances in 12 fixtures.')).toBeInTheDocument();
    expect(screen.queryByText(/over 9,/)).not.toBeInTheDocument();
  });

  /**
   * The two-line form, which is the whole point of item 12's change to this note.
   * Item 11's "Averages over 23–35 appearances in 38 fixtures" was true and told a
   * reader nothing: it spanned two groups without naming either.
   */
  it('names the divergent group on a second line', () => {
    render(
      <AveragesNote
        model={{
          main: { kind: 'exact', value: 35 },
          divergent: { label: 'Expected stats', appearances: 23, from: 16 },
        }}
        fixtures={38}
      />
    );

    expect(screen.getByText('Averages over 35 appearances in 38 fixtures.')).toBeInTheDocument();
    expect(
      screen.getByText('Expected stats over 23, not measured before GW16.')
    ).toBeInTheDocument();
  });

  /**
   * The clause is dropped where the gap is not a prefix — `buildFootnote` decides
   * that and signals it with `from: null`. The rest of the sentence is still true,
   * so it is kept rather than the whole line being suppressed.
   */
  it('drops the "before GWn" clause when it is handed no threshold', () => {
    render(
      <AveragesNote
        model={{
          main: { kind: 'exact', value: 35 },
          divergent: { label: 'xGI', appearances: 22, from: null },
        }}
        fixtures={38}
      />
    );

    expect(screen.getByText('xGI over 22.')).toBeInTheDocument();
    expect(screen.queryByText(/not measured before/)).not.toBeInTheDocument();
  });

  /** The fallback for three or more distinct denominators. Nothing produces it today. */
  it('states a range when it is given one', () => {
    render(<AveragesNote model={{ main: { kind: 'range', min: 12, max: 16 }, divergent: null }} fixtures={38} />);
    expect(screen.getByText('Averages over 12–16 appearances in 38 fixtures.')).toBeInTheDocument();
  });

  it('pluralises both counts from the input', () => {
    render(<AveragesNote model={exact(1)} fixtures={1} />);
    expect(screen.getByText('Averages over 1 appearance in 1 fixture.')).toBeInTheDocument();
  });

  /** Every row played, so the denominator is the row count and one line suffices. */
  it('is handed the appearance count by StatsTable', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    expect(
      screen.getByText(`Averages over ${HISTORY.length} appearances in ${HISTORY.length} fixtures.`)
    ).toBeInTheDocument();
  });

  /**
   * Outside the table, or it scrolls sideways away from the columns it describes.
   *
   * **This used to also assert `closest('[class*="overflow-auto"]')` is null, and
   * that assertion was deleted rather than kept.** Item 12 removed `StatsTable`'s
   * bounded-`Card` branch — every caller now renders inside an expanded career
   * row, whose scroller is the career `Card`. With no `overflow-auto` anywhere in
   * *this* render, `closest` returns null wherever the note sits, so the check
   * would have survived the change while pinning nothing at all.
   *
   * The claim it was written for is still real; it just moved. Its home is the
   * nested render below, where the scrollport actually exists.
   */
  it('sits outside the table', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    expect(screen.getByText(/Averages over/).closest('table')).toBeNull();
  });

  it('is not inside the career pane’s scroller when nested', async () => {
    // The real arrangement: a StatsTable inside an expanded career row, whose
    // scrollport is the career Card. Only here is there an overflow-auto ancestor
    // for the note to be wrongly placed inside of, so only here does asking
    // whether it is mean anything.
    const user = userEvent.setup();

    function Harness() {
      const [expanded, setExpanded] = useState<Set<string>>(new Set());
      return (
        <CareerTable
          seasons={[aCareerSeason({ season: '2024-25' })]}
          expanded={expanded}
          onToggle={(season) => setExpanded(new Set([season]))}
          renderExpanded={() => <StatsTable history={HISTORY} teams={TEAMS} />}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '2024-25' }));

    const note = screen.getByText(/Averages over/);
    const [career, gameweeks] = screen.getAllByRole('table');

    // It IS inside the career table and its scroller, unavoidably — the whole
    // expanded row is a cell of that table, and that is pre-existing. The claim
    // is narrower and is the one the note's placement was chosen for: it is not
    // inside the table it describes, so the columns cannot scroll out from under
    // it and take the sentence about them with it.
    expect(gameweeks.contains(note)).toBe(false);
    expect(career.contains(note)).toBe(true);
    expect(note.closest('[class*="overflow-auto"]')).not.toBeNull();
  });
});

describe('striping follows the data index, not DOM parity', () => {
  it('stripes alternate fixture rows in StatsTable', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const rows = dataRows(screen.getByRole('table'));

    expect(rows.map((r) => r.className.includes(ROW_STRIPE))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  /**
   * **The load-bearing one.** `CareerTable` returns `[summary, detail]` per season and
   * React flattens it, so an open season inserts a sibling `<tr>` into the same
   * `<tbody>` — and every summary row below it shifts by one DOM position. A
   * `nth-child(even)` implementation is green while everything is collapsed and wrong
   * the moment anything is open, which is the state this asserts in.
   *
   * Seasons 0 and 2 must stay unstriped and 1 and 3 striped with the first one open,
   * even though rows 1, 2 and 3 are now at DOM positions 2, 3 and 4.
   */
  it('keeps career stripes with a season expanded and the DOM parity shifted', async () => {
    const user = userEvent.setup();
    const seasons = ['2024-25', '2023-24', '2022-23', '2021-22'].map((season) =>
      aCareerSeason({ season })
    );

    function Harness() {
      const [expanded, setExpanded] = useState<Set<string>>(new Set());
      return (
        <CareerTable
          seasons={seasons}
          expanded={expanded}
          onToggle={(season) =>
            setExpanded((open) => {
              const next = new Set(open);
              if (next.has(season)) next.delete(season);
              else next.add(season);
              return next;
            })
          }
          renderExpanded={() => <p>gameweeks</p>}
        />
      );
    }

    render(<Harness />);
    const table = screen.getByRole('table');
    const summaryFor = (season: string) =>
      within(table).getByRole('button', { name: season }).closest('tr') as HTMLElement;

    await user.click(within(table).getByRole('button', { name: '2024-25' }));

    // The sibling row really is there, so the parity really has shifted.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(summaryFor('2023-24').previousElementSibling).toHaveTextContent('gameweeks');

    expect(summaryFor('2024-25').className).not.toContain(ROW_STRIPE);
    expect(summaryFor('2023-24').className).toContain(ROW_STRIPE);
    expect(summaryFor('2022-23').className).not.toContain(ROW_STRIPE);
    expect(summaryFor('2021-22').className).toContain(ROW_STRIPE);
  });

  /**
   * An open season's panel takes its summary row's surface, so the two read as one
   * block — and cancels the hover to **that** surface rather than to the default one.
   * Cancelling to the default would step an open striped season back to plain on
   * hover, which looks like the stripe being lost.
   */
  it('gives an expansion panel its summary row’s surface and an inert hover', async () => {
    const user = userEvent.setup();
    const seasons = ['2024-25', '2023-24'].map((season) => aCareerSeason({ season }));

    function Harness() {
      const [expanded, setExpanded] = useState<Set<string>>(new Set());
      return (
        <CareerTable
          seasons={seasons}
          expanded={expanded}
          onToggle={(season) => setExpanded(new Set([season]))}
          renderExpanded={() => <p>gameweeks</p>}
        />
      );
    }

    render(<Harness />);
    const table = screen.getByRole('table');

    // The striped one, index 1.
    await user.click(within(table).getByRole('button', { name: '2023-24' }));
    const panel = screen.getByText('gameweeks').closest('tr') as HTMLElement;

    expect(panel.className).toContain(ROW_STRIPE);
    expect(panel.className).toContain('hover:[--row-bg:hsl(var(--row-alt))]');
  });
});

describe('the borderless model', () => {
  /**
   * `border-separate` is not cosmetic here. Under `collapse` a border belongs to the
   * table rather than the cell, so it scrolls out from under a sticky element and
   * leaves the header floating with no edge. It is also what removed the row
   * separators app-wide, as a consequence rather than a second edit: in the separated
   * model a `<tr>` cannot have a border at all, so one there would be silently dead.
   */
  it('separates borders at zero spacing and keeps none on the rows', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);
    const table = screen.getByRole('table');

    expect(table.className).toContain('border-separate');
    expect(table.className).toContain('border-spacing-0');

    for (const row of table.querySelectorAll('tr')) {
      expect(row.className).not.toMatch(/\bborder-b\b/);
    }
  });

  it('draws the header’s edge with a shadow, which travels with the cell', () => {
    render(<StatsTable history={HISTORY} teams={TEAMS} />);

    for (const th of screen.getByRole('table').querySelectorAll('thead th')) {
      expect(th.className).toContain('shadow-[0_1px_0_0_hsl(var(--border))]');
    }
  });
});

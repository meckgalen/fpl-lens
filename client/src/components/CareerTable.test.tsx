/**
 * The career row's disclosure: reachable, operable, and announced.
 *
 * Until item 3 the row was a `<tr onClick>`. A mouse could expand a season; a
 * keyboard could not reach it at all, and nothing in the DOM said the row opened
 * anything — so a screen reader got a table of numbers with no indication there
 * was more underneath. None of that shows up in a rendering test, which is why
 * it survived two items.
 *
 * `user-event` rather than `fireEvent` throughout, as item 2 recorded: firing a
 * synthetic click at a button proves nothing about whether Enter and Space reach
 * it. `user.tab()` here is the actual claim — that the control is in the tab
 * order at all.
 *
 * The single-toggle test is the one that guards the arrangement rather than the
 * feature. The row keeps its `onClick` so a mouse can still open a season by
 * clicking anywhere along it, which means the button's click would bubble into
 * it and toggle straight back. Netting to closed looks exactly like a click that
 * did nothing, so nothing catches it unless something counts.
 */

import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CareerTable from './CareerTable';
import { aCareerSeason } from '../test/factories';

const SEASONS = [aCareerSeason({ season: '2024-25' }), aCareerSeason({ season: '2020-21' })];

/**
 * A controlled harness, because `CareerTable` does not own `expanded` —
 * `PlayerDetail` does, and it is that split the button has to work across.
 */
function Harness({ onToggle }: { onToggle?: (season: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  return (
    <CareerTable
      seasons={SEASONS}
      expanded={expanded}
      onToggle={(season) => {
        onToggle?.(season);
        setExpanded((open) => {
          const next = new Set(open);
          if (next.has(season)) next.delete(season);
          else next.add(season);
          return next;
        });
      }}
      renderExpanded={(season) => <p>gameweeks for {season}</p>}
    />
  );
}

const toggleFor = (season: string) => screen.getByRole('button', { name: season });

describe('CareerTable: the season toggle is a real control', () => {
  it('is in the tab order and names itself with its season', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The accessible name is the season, which is only true because the button
    // wraps the text rather than the chevron alone. An icon-only button would
    // name every row "button" and this query would find two of them.
    const first = toggleFor('2024-25');

    await user.tab();
    expect(first).toHaveFocus();

    await user.tab();
    expect(toggleFor('2020-21')).toHaveFocus();
  });

  it('expands and collapses on Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = toggleFor('2024-25');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.tab();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('gameweeks for 2024-25')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('gameweeks for 2024-25')).not.toBeInTheDocument();
  });

  it('expands and collapses on Space', async () => {
    // Separate from Enter deliberately. A `<button>` gets both; a `<tr>` with
    // `role="button"` and a keydown handler typically gets Enter and scrolls the
    // page on Space, so testing only Enter would not tell the two apart.
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = toggleFor('2024-25');

    await user.tab();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps focus on the toggle after expanding', async () => {
    // The row is re-rendered with a sibling inserted after it. If the button
    // remounted rather than updated, focus would fall back to <body> and a
    // keyboard user would be dropped at the top of the document.
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    await user.keyboard('{Enter}');
    expect(toggleFor('2024-25')).toHaveFocus();
  });
});

describe('CareerTable: aria-controls points somewhere real, or nowhere', () => {
  it('omits aria-controls while collapsed and resolves it while expanded', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = toggleFor('2024-25');

    // The row it would name does not exist yet, and a reference to an id that
    // is not in the document is worse than no reference: a screen reader
    // following it lands nowhere.
    expect(toggle).not.toHaveAttribute('aria-controls');

    await user.tab();
    await user.keyboard('{Enter}');

    const id = toggle.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    // Resolved through the document rather than compared against the string
    // that produced it, so a renamed row or a typo fails here instead of
    // passing against itself.
    expect(document.getElementById(id!)).not.toBeNull();
    expect(document.getElementById(id!)).toContainElement(
      screen.getByText('gameweeks for 2024-25')
    );
  });
});

describe('CareerTable: the row handler and the button do not both fire', () => {
  it('toggles exactly once per mouse click on the toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);

    await user.click(toggleFor('2024-25'));

    // Two would be the button plus the row it bubbled into, which nets back to
    // collapsed — indistinguishable on screen from a click that did nothing.
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('2024-25');
    expect(toggleFor('2024-25')).toHaveAttribute('aria-expanded', 'true');
  });

  it('still opens the season when the row is clicked away from the toggle', async () => {
    // The mouse affordance the row handler exists for. Dropping it would be the
    // other way to fix the double toggle, and this is what that would cost.
    const user = userEvent.setup();
    render(<Harness />);

    const row = toggleFor('2020-21').closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row!).getByText('ARS'));

    expect(toggleFor('2020-21')).toHaveAttribute('aria-expanded', 'true');
  });
});

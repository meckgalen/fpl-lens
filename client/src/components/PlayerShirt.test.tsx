/**
 * The club shirt, its two fallbacks, and the cache that stops the second one
 * costing a request per row.
 *
 * **URLs are asserted in full rather than pattern-matched**, for the reason
 * `PlayerHeader.test.tsx` gives about the photograph: the transformation is not
 * the identity, and every part of it — host, directory, `shirt_` prefix,
 * goalkeeper suffix, size — is a separate thing that can be wrong. All of them
 * were probed against the live host over all 35 team codes this database holds
 * before any of this was written.
 *
 * **Queried by `src`, not by role.** The images are decorative and carry
 * `alt=""`, which keeps them out of the accessibility tree, so `getByRole('img')`
 * cannot see them. That is the intended behaviour and the last test pins it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { PlayerShirt } from './PlayerShirt';
import { resetShirtCache } from '../lib/shirtCache';

const ARSENAL = 3;
/** Middlesbrough: in 2016-17, gone since, and has no shirt asset. */
const BORO = 25;
const GKP = 1;
const MID = 3;

const img = (c: HTMLElement) => c.querySelector('img');
const src = (c: HTMLElement) => img(c)?.getAttribute('src');

// Module-level state is shared across the file, so without this the suite
// becomes order-dependent — the exact class of quiet wrong answer this project
// refuses. Not worked around by giving each test its own team code, which would
// hide the coupling rather than remove it.
beforeEach(resetShirtCache);

describe('PlayerShirt', () => {
  it('builds the outfield shirt URL from the permanent team code', () => {
    const { container } = render(<PlayerShirt teamCode={ARSENAL} elementType={MID} />);

    expect(src(container)).toBe(
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-66.png'
    );
  });

  it('builds the goalkeeper variant for element_type 1', () => {
    const { container } = render(<PlayerShirt teamCode={ARSENAL} elementType={GKP} />);

    expect(src(container)).toBe(
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3_1-66.png'
    );
  });

  it('asks for the larger shirt at the header card size', () => {
    const { container } = render(<PlayerShirt teamCode={ARSENAL} elementType={MID} size={110} />);

    expect(src(container)).toBe(
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-110.png'
    );
  });

  it('falls back to the club badge when the shirt does not exist', () => {
    // Nine of twenty clubs on 2016-17, so this is a whole season rather than an
    // edge case.
    const { container } = render(<PlayerShirt teamCode={BORO} elementType={MID} />);

    fireEvent.error(img(container)!);

    expect(src(container)).toBe('https://resources.premierleague.com/premierleague/badges/50/t25.png');
  });

  it('asks for the larger badge at the header card size', () => {
    const { container } = render(<PlayerShirt teamCode={BORO} elementType={MID} size={110} />);

    fireEvent.error(img(container)!);

    expect(src(container)).toBe('https://resources.premierleague.com/premierleague/badges/100/t25.png');
  });

  it('falls back to the grey placeholder when the badge fails too', () => {
    const { container } = render(<PlayerShirt teamCode={BORO} elementType={MID} />);

    fireEvent.error(img(container)!);
    fireEvent.error(img(container)!);

    expect(img(container)).toBeNull();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders the new club after the props change, not the previous one’s fallback', () => {
    // The header card reuses one instance across players, so a failure state
    // that never resets would make one club's missing shirt suppress the next
    // club's real one.
    const { container, rerender } = render(<PlayerShirt teamCode={BORO} elementType={MID} />);
    fireEvent.error(img(container)!);
    expect(src(container)).toContain('/badges/');

    rerender(<PlayerShirt teamCode={ARSENAL} elementType={MID} />);

    expect(src(container)).toBe(
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-66.png'
    );
  });

  it('skips the shirt request for a club already known to have none', () => {
    // The point of the module-level cache is determinism, not a measured
    // saving: nothing has been run with it disabled, and without it the number
    // of failed requests depends on whether the browser caches a failure with a
    // 150-byte body and no cache headers. Observed on one cold 2016-17 render:
    // 18 failed shirt requests, one pair per shirtless club, against 85 rows
    // that end up showing a badge.
    const first = render(<PlayerShirt teamCode={BORO} elementType={MID} />);
    fireEvent.error(img(first.container)!);
    first.unmount();

    const { container } = render(<PlayerShirt teamCode={BORO} elementType={GKP} />);

    expect(src(container)).toBe('https://resources.premierleague.com/premierleague/badges/50/t25.png');
  });

  it('still requests the shirt for a club that has not failed', () => {
    // The converse, so the set cannot pass as a blunt "never request a shirt".
    const first = render(<PlayerShirt teamCode={BORO} elementType={MID} />);
    fireEvent.error(img(first.container)!);
    first.unmount();

    const { container } = render(<PlayerShirt teamCode={ARSENAL} elementType={MID} />);

    expect(src(container)).toBe(
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-66.png'
    );
  });

  it('is decorative: the shirt and the badge are both absent from the a11y tree', () => {
    // The row already names the player and the club in text beside it, so an
    // alt naming either would be announced twice.
    const { container } = render(<PlayerShirt teamCode={BORO} elementType={MID} />);
    expect(img(container)).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    fireEvent.error(img(container)!);

    expect(img(container)).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('defers loading, for the 200 rows the Players list renders', () => {
    const { container } = render(<PlayerShirt teamCode={ARSENAL} elementType={MID} />);

    expect(img(container)).toHaveAttribute('loading', 'lazy');
  });
});

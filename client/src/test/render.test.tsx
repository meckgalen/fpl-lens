/**
 * A test for the harness rather than for the app.
 *
 * `renderInApp` wraps in StrictMode, and the `PlayerDetail` suite depends on
 * that entirely: its point is that React double-invokes render functions and
 * state updaters, which happens only under StrictMode and only in a development
 * build of React. If either were missing, those tests would still pass — they
 * would just have stopped meaning anything. There is nothing on screen to say
 * so, hence this file.
 *
 * The `rerender` half matters for the same reason and is easier to get wrong.
 * RTL's `rerender` re-applies the `wrapper` option but does **not** re-apply
 * wrapping done by hand to the element, so a helper written the obvious way
 * loses StrictMode on the second render only — which is exactly the render the
 * cache-reset test depends on.
 */

import { describe, expect, it } from 'vitest';
import { useBootstrap } from '../lib/bootstrap';
import { renderInApp } from './render';
import { aBootstrap } from './factories';

/** Counts its own renders, and reads the context so a missing provider throws. */
function Probe({ label, onRender }: { label: string; onRender: () => void }) {
  const b = useBootstrap();
  onRender();
  return (
    <p>
      {label} {b.season}
    </p>
  );
}

describe('renderInApp', () => {
  it('double-invokes the render function, on the first render and on a rerender', () => {
    let renders = 0;
    const count = () => {
      renders += 1;
    };

    const { rerender, getByText } = renderInApp(<Probe label="first" onRender={count} />);

    // One would be React without StrictMode, or a production build of it.
    // Everything the PlayerDetail suite claims to catch needs this to be two.
    expect(renders).toBe(2);
    getByText('first 2025-26');

    rerender(<Probe label="second" onRender={count} />);

    // Two more, not one: the wrapper is re-applied, so the second render is
    // still inside StrictMode.
    expect(renders).toBe(4);
    getByText('second 2025-26');
  });

  it('provides the bootstrap context, including after a rerender', () => {
    // useBootstrap throws without a provider, so reaching the assertion at all
    // is the assertion. The season is read from the passed bootstrap rather
    // than the default, so a wrapper that dropped the value and fell back to
    // some other source would not satisfy it.
    const noop = () => {};
    const { rerender, getByText } = renderInApp(
      <Probe label="first" onRender={noop} />,
      aBootstrap({ season: '2019-20' })
    );
    getByText('first 2019-20');

    rerender(<Probe label="second" onRender={noop} />);
    getByText('second 2019-20');
  });
});

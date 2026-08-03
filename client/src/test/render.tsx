import { StrictMode } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { BootstrapContext } from '../lib/bootstrap';
import type { BootstrapData } from '../types/fpl';
import { aBootstrap } from './factories';

/**
 * Render a component the way the app renders it: inside StrictMode, inside the
 * bootstrap provider.
 *
 * **StrictMode is not optional here.** `main.tsx` mounts the app inside it, so a
 * suite that leaves it out is testing a React that does not ship — and the one
 * client bug this project has actually had (a fetch inside a `setExpanded`
 * updater, firing twice) is visible only under it.
 *
 * **The wrapping goes through RTL's `wrapper` option**, not applied by hand to
 * the element passed in. RTL's `rerender` re-applies `wrapper` automatically; a
 * hand-wrapped element is re-rendered raw, which would silently drop both
 * StrictMode and the provider on the second render. Half of that is
 * self-checking — losing the provider throws inside `useBootstrap` — and half is
 * not: losing StrictMode is a green test that pins nothing. `render.test.tsx`
 * is the check that it survives.
 */
export function renderInApp(
  ui: ReactElement,
  bootstrap: BootstrapData = aBootstrap()
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <BootstrapContext.Provider value={bootstrap}>{children}</BootstrapContext.Provider>
      </StrictMode>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

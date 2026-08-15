/**
 * The three-mode theme, at shell level.
 *
 * Separate from `App.test.tsx` on the `comparison.axes.test.ts` precedent: that
 * file is 496 lines and all five of its describes are about the season selector
 * and the bootstrap payload, which share no setup with this.
 *
 * What is only testable here rather than in `lib/theme.test.ts`: that the chosen
 * mode is what reaches localStorage, that the device subscription is live, and
 * that it is torn down. The resolution rule itself is pure and is tested there.
 */

import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { fetchBootstrap } from './services/api';
import { aBootstrap, aPlayer, aTeam } from './test/factories';
import { listenerCount, setPrefersDark } from './test/matchMedia';
import { THEME_KEY } from './lib/theme';

vi.mock('./services/api', async () => {
  const actual = await vi.importActual<typeof import('./services/api')>('./services/api');
  return {
    ApiError: actual.ApiError,
    fetchBootstrap: vi.fn(),
    fetchPlayerDetail: vi.fn(),
    fetchPlayerCareer: vi.fn(),
    fetchFixtures: vi.fn(),
    fetchColumnHistory: vi.fn(() => new Promise<never>(() => {})),
    resetColumnHistory: vi.fn(),
    fetchComparisonThresholds: vi.fn(() => new Promise<never>(() => {})),
    fetchComparison: vi.fn(() => new Promise<never>(() => {})),
    resetComparisonThresholds: vi.fn(),
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchBootstrap).mockImplementation(async () =>
    aBootstrap({ season: '2026-27', seasons: ['2026-27'], players: [aPlayer()], teams: [aTeam()] })
  );
});

function renderApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

/**
 * Mount and wait for the sidebar, which is where the control lives.
 *
 * `App` renders a bare "Loading FPL data…" until the bootstrap resolves, so
 * every query for a segment has to come after that. The theme itself does not
 * wait — the class is applied from an effect on mount, which is why the
 * class-only assertions can and do run against `renderApp` directly.
 */
async function renderLoaded() {
  const result = renderApp();
  await screen.findByLabelText('Season');
  return result;
}

const isDark = () => document.documentElement.classList.contains('dark');
const segment = (name: string | RegExp) => screen.getByRole('button', { name });

/** Flip the OS setting, as the media query's `change` event would. */
function flipDevice(prefersDark: boolean) {
  act(() => setPrefersDark(prefersDark));
}

describe('the first visit, with nothing stored', () => {
  it('follows a dark device', async () => {
    setPrefersDark(true);
    await renderLoaded();
    expect(isDark()).toBe(true);
    expect(segment(/^System/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows a light device', async () => {
    setPrefersDark(false);
    await renderLoaded();
    expect(isDark()).toBe(false);
    expect(segment(/^System/)).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Nothing is written until something is chosen.
   *
   * If mounting persisted the resolved default, "nothing stored" would be
   * unreachable after the first load: every returning visitor would carry an
   * explicit record of a choice they never made, and the app would stop
   * tracking their device without anything on screen saying so.
   */
  it('stores nothing at all', async () => {
    setPrefersDark(true);
    await renderLoaded();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});

describe('the two values the old toggle wrote', () => {
  // Requirement 4: they stay valid, so there is no migration to get wrong.
  it('honours a stored dark on a light device', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    setPrefersDark(false);
    await renderLoaded();
    expect(isDark()).toBe(true);
    expect(segment('Dark')).toHaveAttribute('aria-pressed', 'true');
  });

  it('honours a stored light on a dark device', async () => {
    localStorage.setItem(THEME_KEY, 'light');
    setPrefersDark(true);
    await renderLoaded();
    expect(isDark()).toBe(false);
    expect(segment('Light')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('what gets persisted', () => {
  /**
   * The whole of requirement 1, and the seeding matters.
   *
   * Starting from nothing stored would make this vacuous: the mode would
   * already be `system`, so the click would be a no-op and the assertion would
   * read a value no click produced. Seeding an explicit `light` means the click
   * is a real transition into `system`.
   *
   * Mutation target: persist `resolveTheme(...)` instead of the mode and this
   * is the test that goes red. Storing the resolved value looks harmless — the
   * page paints identically — and it silently ends the feature, because
   * `dark` and `system` become indistinguishable on the next load.
   */
  it('stores system itself, not the theme system resolved to', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_KEY, 'light');
    setPrefersDark(true);
    await renderLoaded();

    await user.click(segment(/^System/));

    expect(localStorage.getItem(THEME_KEY)).toBe('system');
    // The applied theme is dark, which is exactly the value a collapsing
    // implementation would have written. Asserting both is what separates them.
    expect(isDark()).toBe(true);
  });

  it('stores an explicit pick as itself', async () => {
    const user = userEvent.setup();
    setPrefersDark(true);
    await renderLoaded();

    await user.click(segment('Light'));

    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(isDark()).toBe(false);
  });
});

describe('tracking the device', () => {
  it('follows a live OS change while on system', async () => {
    setPrefersDark(false);
    await renderLoaded();
    expect(isDark()).toBe(false);

    flipDevice(true);

    expect(isDark()).toBe(true);
  });

  /**
   * The other direction, and the one that can only fail one way.
   *
   * This is only a real test because the subscription stays attached under an
   * explicit mode. Detach it and `prefersDark` never moves, so the assertion
   * holds because nothing happened rather than because anything ignored it —
   * and it would then pass against a `resolveTheme` that always reads the
   * device, which is the exact mutation it exists to catch.
   */
  it('does not follow an OS change once a theme is picked explicitly', async () => {
    const user = userEvent.setup();
    setPrefersDark(false);
    await renderLoaded();

    await user.click(segment('Light'));
    flipDevice(true);

    expect(isDark()).toBe(false);
    expect(segment('Light')).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * The hint on the system segment describes the DEVICE, not the choice, so it
   * keeps moving under an explicit pick. That is what makes it useful: it says
   * where system would land if you chose it.
   */
  it('names where the device currently lands, whatever is selected', async () => {
    const user = userEvent.setup();
    setPrefersDark(false);
    await renderLoaded();
    expect(segment('System · Light')).toBeInTheDocument();

    await user.click(segment('Dark'));
    flipDevice(true);

    expect(segment('System · Dark')).toBeInTheDocument();
  });

  /**
   * Unsubscription asserted as the property — no listener remains — rather than
   * through a spy on `removeEventListener`, which would go green for a listener
   * removed from the wrong object.
   */
  it('drops its listener on unmount', async () => {
    const { unmount } = await renderLoaded();
    expect(listenerCount()).toBeGreaterThan(0);

    unmount();

    expect(listenerCount()).toBe(0);
  });
});

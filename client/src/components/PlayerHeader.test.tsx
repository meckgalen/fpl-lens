/**
 * The header card's photograph, and the fallback that is not optional.
 *
 * `photo` has been on the wire since step 6 and nothing rendered it. Item 4
 * draws it, hot-linked from premierleague.com the way FPL's own site does.
 *
 * The URL is asserted here in full rather than pattern-matched, because the
 * transformation is not the identity — `{code}.jpg` on the wire, a PNG at a
 * size suffix on the host, with a `p` in front of the code — and every part of
 * it has changed at some point in the Premier League's history. It was checked
 * against the live host before this was written, not recalled.
 *
 * The fallback has its own test because the case is not rare: five of the six
 * newest 2026-27 player codes had no photograph when this was built, and those
 * are precisely the players people look up in August.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlayerHeader from './PlayerHeader';
import { aPlayer, aTeam } from '../test/factories';

const PHOTO_URL = 'https://resources.premierleague.com/premierleague/photos/players/250x250/p223340.png';

const renderHeader = (photo: string | null) =>
  render(<PlayerHeader player={aPlayer({ photo: photo as string })} team={aTeam()} season="2026-27" />);

describe('PlayerHeader photo', () => {
  it('builds the asset URL from the code on the wire', () => {
    renderHeader('223340.jpg');
    expect(screen.getByRole('img', { name: 'Saka' })).toHaveAttribute('src', PHOTO_URL);
  });

  it('falls back to the placeholder when the image fails to load', () => {
    // A new signing with no photograph yet, which is the common case in August
    // and renders as a broken image without this.
    renderHeader('223340.jpg');
    const img = screen.getByRole('img', { name: 'Saka' });

    fireEvent.error(img);

    expect(screen.queryByRole('img', { name: 'Saka' })).not.toBeInTheDocument();
  });

  it('does not attempt a request when there is no photo field', () => {
    renderHeader(null);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

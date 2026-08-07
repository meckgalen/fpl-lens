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
 *
 * Item 9 changed the size the card asks for and what it falls back to. The size
 * directory is the CSS size and the file is 2x, so `250x250` was 500x500 and
 * 346 KB for a 56-pixel box; `110x140` is 220x280 and 111 KB, still 2x for a
 * retina display. The URL assertion below going red on that change is the test
 * doing its job.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlayerHeader from './PlayerHeader';
import { resetShirtCache } from '../lib/shirtCache';
import { aPlayer, aTeam, anIdentity } from '../test/factories';

const PHOTO_URL = 'https://resources.premierleague.com/premierleague/photos/players/110x140/p223340.png';
const SHIRT_URL = 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-110.png';

beforeEach(resetShirtCache);

const renderHeader = (photo: string | null) =>
  render(
    <PlayerHeader
      player={aPlayer({ photo: photo as string })}
      identity={anIdentity({ photo: photo as string })}
      team={aTeam()}
      season="2026-27"
    />
  );

/** The season the player has no `player_seasons` row for: no club, so no shirt. */
const renderPartialHeader = (photo: string | null) =>
  render(
    <PlayerHeader
      player={null}
      identity={anIdentity({ photo: photo as string })}
      team={aTeam()}
      season="2016-17"
    />
  );

describe('PlayerHeader photo', () => {
  it('builds the asset URL from the code on the wire', () => {
    renderHeader('223340.jpg');
    expect(screen.getByRole('img', { name: 'Saka' })).toHaveAttribute('src', PHOTO_URL);
  });

  it('falls back to the club shirt when the image fails to load', () => {
    // A new signing with no photograph yet, which is the common case in August
    // and renders as a broken image without this.
    const { container } = renderHeader('223340.jpg');
    const img = screen.getByRole('img', { name: 'Saka' });

    fireEvent.error(img);

    expect(screen.queryByRole('img', { name: 'Saka' })).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', SHIRT_URL);
  });

  it('does not attempt a photo request when there is no photo field', () => {
    // `queryByRole('img')` still means "the photograph" after item 9: the shirt
    // behind it carries alt="" and so is not in the accessibility tree.
    renderHeader(null);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to the grey placeholder, never a shirt, for a season the player was not in', () => {
    // There is no club for a season with no player-season row, and the only one
    // available is the previously selected season's. Rendering that is the
    // stale-snapshot bug the partial header exists to avoid, as an image.
    const { container } = renderPartialHeader('223340.jpg');
    const photo = screen.getByRole('img', { name: 'Saka' });

    fireEvent.error(photo);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

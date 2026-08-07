import { useState } from 'react';
import { PlayerAvatar } from './PosBadge';
import { hasNoShirt, recordMissingShirt } from '../lib/shirtCache';

/**
 * A player's club shirt, hot-linked from FPL the way its own site does, with a
 * two-step fallback behind it. Nothing is stored or proxied — that would be an
 * asset pipeline, which is a separate piece of work from showing one image.
 *
 * **Shirts rather than photographs, because a shirt is keyed on a club.** A
 * 564-row Players list pulls a few dozen distinct images and the browser caches
 * each after its first request; photographs would be 564 separate assets, most
 * scrolled past unseen. That is why FPL's own list uses shirts too.
 *
 * Both URL patterns were probed against the live host rather than written from
 * memory, over all 35 team codes this database holds:
 *
 *   shirt    https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_{code}[_1]-{66|110}.png
 *   badge    https://resources.premierleague.com/premierleague/badges/{50|100}/t{code}.png
 *
 * Both are keyed on `fpl_team_code`, which is what `Player.team` and `Team.id`
 * already are (API identity rule 3), so every season resolves with no lookup
 * table. `_1` is the goalkeeper variant — confirmed by rendering the images, not
 * assumed: `shirt_3-110.png` is Arsenal's red outfield shirt and
 * `shirt_3_1-110.png` a white long-sleeved keeper shirt. `_2`/`_3` 404, so there
 * is one variant and not a kit series. Only `-66`, `-110` and `-220` exist.
 *
 * **The badge step is required, not decoration, and the reason is a whole
 * season rather than an edge case.** A shirt exists for *exactly* the twenty
 * clubs in the current season and for no others — set equality when all 35
 * stored codes were probed, with the fifteen misses being every club not in
 * 2026-27, West Ham included. So 2016-17 has eleven clubs with a shirt and nine
 * without, and the selector puts that season one click away. The badge covers
 * all 35 codes, including clubs relegated a decade ago, and was likewise
 * verified by rendering: `t25` really is Middlesbrough and `t88` really is Hull.
 * A badge keyed on some other id space would have shown the wrong club quietly,
 * which is the failure this project keeps refusing to ship.
 *
 * The grey placeholder stays as the last resort. It is close to unreachable now
 * that the badge covers every stored code, but "close to" is not "never" — a
 * newly promoted club can exist in the data before either asset is published.
 *
 * **Known and not fixable: the shirt is the CURRENT kit, never the season's.**
 * The asset set being the current twenty clubs means 2016-17 renders Arsenal's
 * 2026-27 shirt. Right club, wrong year, by construction — the path carries a
 * team code and a size and nothing else, and the older kits are gone from the
 * host. See Known Issues in CLAUDE.md.
 */

const SHIRT_BASE = 'https://fantasy.premierleague.com/dist/img/shirts/standard';
const BADGE_BASE = 'https://resources.premierleague.com/premierleague/badges';

/** The three that exist; these two are the ones the app renders at. */
export type ShirtSize = 66 | 110;

/**
 * Shirt width to badge width. Both are sized for a 2x display of the box they
 * sit in: 66 for the 32-36px list rows, 110 for the header card's 56px.
 */
const BADGE_SIZE: Record<ShirtSize, number> = { 66: 50, 110: 100 };

/** The grey placeholder's size, matching what each site rendered before. */
const AVATAR_SIZE: Record<ShirtSize, number> = { 66: 22, 110: 40 };

/**
 * `element_type` 1 is a goalkeeper. Written as an explicit comparison rather
 * than by reusing the value, because the shirt suffix being `_1` and the
 * position code being `1` are two unrelated numbering schemes that happen to
 * agree — reusing one for the other would break silently if either moved.
 */
const GOALKEEPER = 1;

/**
 * The set of clubs known to have no shirt lives in `lib/shirtCache.ts`, with
 * the reasoning for it. It is consulted *before* the first render rather than
 * only after a failure, and it **does not replace the per-instance reset
 * below** — the two answer different questions. The cache answers "does this
 * club have a shirt at all", which is a fact about the league. The instance
 * state answers "which club is this instance currently showing", which is a
 * fact about one row.
 */

type Stage = 'shirt' | 'badge' | 'placeholder';

interface Props {
  /** Permanent `fpl_team_code` — `Player.team` or `Team.id`, never a season id. */
  teamCode: number;
  /** FPL `element_type`; only whether it is 1 matters here. */
  elementType: number;
  size?: ShirtSize;
}

export function PlayerShirt({ teamCode, elementType, size = 66 }: Props) {
  const [stage, setStage] = useState<Stage>('shirt');

  // Which club/position the current `stage` was decided for. Tracked as an
  // identity rather than a bare boolean so the fallback resets when the props
  // change: a stale "this failed" would make one club's missing shirt suppress
  // the next club's real one. The header card reuses this component across
  // players without a key, so that is a live path, not a hypothetical.
  const identity = `${teamCode}:${elementType}`;
  const [decidedFor, setDecidedFor] = useState(identity);

  let current = stage;
  if (decidedFor !== identity) {
    setDecidedFor(identity);
    setStage('shirt');
    current = 'shirt';
  }

  // The club is already known to have no shirt, so skip straight to its badge
  // rather than firing a request that is certain to 404.
  if (current === 'shirt' && hasNoShirt(teamCode)) current = 'badge';

  if (current === 'placeholder') return <PlayerAvatar size={AVATAR_SIZE[size]} />;

  // The shirt is 66x87 — taller than it is wide — and the containers it sits in
  // are square, so it has to fit by height. Not `object-cover`, which would
  // crop the sleeves off.
  const className = 'h-full w-auto object-contain';

  // Decorative in every position it renders: the row names the player and the
  // club in text beside it, so an alt naming either would be announced twice.
  // Same reasoning as the disclosure chevron. An empty alt also keeps it out of
  // the accessibility tree, which is why the tests query it by src.
  const alt = '';

  if (current === 'badge') {
    return (
      <img
        src={`${BADGE_BASE}/${BADGE_SIZE[size]}/t${teamCode}.png`}
        alt={alt}
        loading="lazy"
        className={className}
        onError={() => setStage('placeholder')}
      />
    );
  }

  const keeper = elementType === GOALKEEPER ? '_1' : '';
  return (
    <img
      src={`${SHIRT_BASE}/shirt_${teamCode}${keeper}-${size}.png`}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        recordMissingShirt(teamCode);
        setStage('badge');
      }}
    />
  );
}

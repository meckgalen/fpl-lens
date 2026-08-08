import { useState, type ReactNode } from 'react';
import type { Player, PlayerIdentity, Team } from '../types/fpl';
import { POSITION_MAP, fmtNum, fmtOr, fmtPrice, statusOf } from '../types/fpl';
import { Card, CardContent } from './ui/Card';
import { PlayerAvatar, PosBadge } from './PosBadge';
import { PlayerShirt } from './PlayerShirt';
import { fmtPpg } from '../lib/averages';

/**
 * The player's photograph, hot-linked from premierleague.com the way FPL's own
 * site does. Nothing is stored or proxied — that would be an asset pipeline,
 * which is a separate piece of work from showing one image.
 *
 * The URL was checked against the live host rather than written from memory,
 * because the transformation is not the identity and the path has moved before.
 * `player.photo` is FPL's `{code}.jpg`; the served asset is a PNG at a size
 * suffix:
 *
 *   photo '223340.jpg'
 *   -> https://resources.premierleague.com/premierleague/photos/players/250x250/p223340.png
 *
 * Measured at the time of writing: that URL returns 200 image/png for Saka,
 * while the `premierleague25`- and `premierleague26`-prefixed variants some
 * seasons used return 403 and 502.
 *
 * **The size directory is the CSS size, not the pixel size — the file served is
 * 2x.** `250x250` is really 500x500 and 346 KB, for a box rendered at 56px.
 * `110x140` is 220x280 and 111 KB, still comfortably 2x for a retina display,
 * and is what this asks for. Measured in the browser, cache-busted, the two
 * sizes **interleaved** so both saw the same network: 404 ms against 170 ms,
 * medians of nine. Interleaving matters — absolute numbers taken minutes apart
 * drifted by 60% during the session that measured this.
 *
 * **The fallback is required, not decoration.** A newly published roster has
 * players with no photograph for weeks — five of the six newest 2026-27 codes
 * returned 403 when this was written — and they are exactly the players people
 * look up in August. Without `onError` a large share of the new squad would
 * render as a broken image.
 *
 * What it falls back *to* is the caller's decision, because the two callers
 * differ on it — see `PartialHeader`.
 */
function PlayerPhoto({
  photo,
  name,
  fallback,
}: {
  photo: string | null | undefined;
  name: string;
  fallback: ReactNode;
}) {
  const code = photo?.replace(/\.[a-z]+$/i, '');
  const src = code ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png` : null;

  // Which src failed, rather than a bare "it failed". The detail page reuses
  // this component across players without a key, so a boolean would never reset
  // and one player's missing photograph would suppress the next player's real
  // one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <div className="w-14 h-14 rounded-lg bg-muted flex items-end justify-center overflow-hidden flex-shrink-0">
      {src && failedSrc !== src ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover object-top"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        fallback
      )}
    </div>
  );
}

interface Props {
  /**
   * The player's totals for this season, or null when he has none — see the
   * partial header below.
   */
  player: Player | null;
  /** Who he is, with no season attached. Always known. */
  identity: PlayerIdentity;
  team: Team | undefined;
  /** The season these totals cover — see PlayerDetail for why it is passed. */
  season: string;
}

/**
 * **The partial header, which is a decision rather than an oversight.**
 *
 * Selecting a season the player was not in the game for leaves no `Player` for
 * him: no club, no position, no price, no totals, because there is no
 * player-season row for any of them to come from. The only place those values
 * could come from is the season that was selected a moment ago — and rendering
 * last season's club under this season's heading is exactly the stale-snapshot
 * bug item 8 exists to fix, reintroduced in the one case where re-lookup cannot
 * fix it.
 *
 * So they are not rendered at all. Not as `0`, and not as the no-value marker
 * either: `—` means "we looked and there was nothing to measure" (rule 6), and
 * here nobody looked, because there was nothing to look at.
 *
 * Name and photo survive because both derive from `fpl_code`, which is
 * permanent across seasons.
 *
 * **Which is also why the photograph falls back to the grey placeholder here
 * and not to a club shirt.** A shirt needs a club, this player has none for
 * this season, and the only club available is the one the previously selected
 * season put on screen a moment ago. Rendering that would be the stale-snapshot
 * bug described above, reintroduced as an image in the one case where
 * re-lookup cannot fix it.
 */
function PartialHeader({ identity, season }: { identity: PlayerIdentity; season: string }) {
  return (
    <Card className="mb-4">
      <CardContent>
        <div className="flex items-center gap-3">
          <PlayerPhoto
            photo={identity.photo}
            name={identity.web_name}
            fallback={<PlayerAvatar size={40} />}
          />
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              {identity.first_name} {identity.second_name}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground">{season}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlayerHeader({ player, identity, team, season }: Props) {
  if (!player) return <PartialHeader identity={identity} season={season} />;

  const status = statusOf(player.status);

  // Form and Ownership have no source in the database and arrive null; xG, xA
  // and Starts are null for every season before 2022-23. All of them render the
  // "no value" placeholder rather than an empty tile, 'null%' or 'NaN'.
  //
  // Apps and Starts sit next to each other deliberately: a player can appear
  // more often than he starts, and on a double gameweek he can appear twice in
  // one round, so neither number is the count of rounds (rule 13).
  const stats: { label: string; value: string | number }[] = [
    { label: 'Total Pts', value: player.total_points },
    { label: 'PPG', value: fmtPpg(player.points_per_game) },
    { label: 'Form', value: fmtOr(player.form) },
    { label: 'Price', value: fmtPrice(player.now_cost) },
    { label: 'Ownership', value: fmtOr(player.selected_by_percent, '%') },
    { label: 'Minutes', value: player.minutes },
    { label: 'Apps', value: player.appearances },
    { label: 'Starts', value: fmtNum(player.starts, 0) },
    { label: 'Goals', value: player.goals_scored },
    { label: 'Assists', value: player.assists },
    { label: 'xG', value: fmtNum(player.expected_goals, 2) },
    { label: 'xA', value: fmtNum(player.expected_assists, 2) },
    { label: 'ICT', value: fmtNum(player.ict_index, 1) },
    { label: 'Bonus', value: player.bonus },
  ];

  return (
    <Card className="mb-4">
      <CardContent>
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <PlayerPhoto
              photo={player.photo}
              name={player.web_name}
              fallback={<PlayerShirt teamCode={player.team} elementType={player.element_type} size={110} />}
            />
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              {player.first_name} {player.second_name}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground">{season}</span>
              <span>·</span>
              <span>{team?.name || 'Unknown'}</span>
              <span>·</span>
              <PosBadge pos={POSITION_MAP[player.element_type]} />
              <span>·</span>
              <span style={{ color: status.color }}>{status.label}</span>
              {player.news && (
                <>
                  <span>·</span>
                  <span className="italic">{player.news}</span>
                </>
              )}
            </div>
          </div>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md bg-muted/60 px-2 py-2.5 text-center">
              <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mb-1">{s.label}</div>
              <div className="font-display text-base font-semibold text-foreground tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

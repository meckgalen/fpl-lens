import type { GameweekHistory, Team } from '../types/fpl';
import StatsTable from './StatsTable';

interface Props {
  /** Every match row for this player-season, before filtering. */
  history: GameweekHistory[];
  /**
   * The rows to show. Omit where there are no filters.
   *
   * Since item 12 every expanded season has its own filters, so in the app this
   * is always supplied; the default is what keeps the component usable on its
   * own, which is how most of its tests render it.
   */
  filtered?: GameweekHistory[];
  /** The clubs of THIS season, so an opponent from 2016-17 can still be named. */
  teams: Team[];
  /** The season this is, for the wording. Rows are labelled by their own. */
  season: string;
  /** Whose season it is, for the wording. */
  playerName: string;
  /**
   * Whether the player was in the game that season at all — whether a
   * `player_seasons` row exists, which the career response answers. False and
   * "no rows yet" look identical and are not the same thing.
   *
   * **In the app this is now always true**, because every season on screen is a
   * career row and a career row exists only where a `player_seasons` row does.
   * The false case moved out to `NotInGame` below, which `PlayerDetail` renders
   * at page level — there being no row to put it in. The prop stays because the
   * distinction is still real and this component is still where the wording of
   * all four absences lives.
   */
  registered: boolean;
}

const message = 'text-center text-sm text-muted-foreground py-6';

/**
 * "He was not in the game that season" — the one absence with no row to sit in.
 *
 * Its own component because it has two callers that cannot share a rendering.
 * Inside this component it is the `!registered` branch. At page level it is what
 * `PlayerDetail` draws when the *selected* season is one the player has no
 * `player_seasons` row for: the career table then has no row for that season at
 * all, so there is nowhere in the table to say so, and the header card beside it
 * has already degraded to a name and a photograph for the same reason.
 *
 * Extracted rather than duplicated: the sentence is asserted in two suites, and
 * a second copy of it is a second thing to keep in step with them.
 */
export function NotInGame({ playerName, season }: { playerName: string; season: string }) {
  return (
    <p className={message}>
      {playerName} was not in the game in {season}.
    </p>
  );
}

/**
 * A season's gameweeks, and the four different ways it can come back empty.
 *
 * They all render as an absence and they mean different things, so the wording
 * is the only thing distinguishing them and it lives in one place:
 *
 *   1. **Not in the game.** No squad place that season — Cresswell has nine
 *      seasons and 2025-26 is not one of them. Nothing will ever appear here,
 *      so saying "once the season is underway" would be false. See `NotInGame`:
 *      in the app this arrives from the page rather than from here, because a
 *      season with no `player_seasons` row has no career row to expand.
 *   2. **Registered, no rows.** The season has not started, or has not reached
 *      him yet. This one really does fill in with time. Every 2026-27 player is
 *      in this state today, and stays in it until the incremental gameweek sync
 *      is run — playing the matches does not end it, ingesting them does.
 *   3. **Rows that are all zero.** In the squad every week, never played:
 *      Onana's 2025-26 is thirty-eight of them. The table renders, because
 *      thirty-eight zeroes is the answer — with a line saying so, since a
 *      wall of zeroes otherwise looks like a loading failure.
 *   4. **Filtered out.** Rows exist and the filters excluded them. **Reachable
 *      on every season since item 12**, which put a GW range and a venue filter
 *      above every expanded season's table rather than above one of them.
 *
 * The first two are the same shape and differ only in whether time will fix
 * them, which is why `registered` has to be passed in: the history alone
 * cannot tell them apart.
 */
export default function GameweekSection({
  history,
  filtered,
  teams,
  season,
  playerName,
  registered,
}: Props) {
  if (!registered) {
    return <NotInGame playerName={playerName} season={season} />;
  }

  if (history.length === 0) {
    return <p className={message}>Data will appear here once the {season} season is underway.</p>;
  }

  const rows = filtered ?? history;
  const neverPlayed = history.every((gw) => gw.minutes === 0);

  return (
    <>
      {/* Two arrays with two jobs. `rows` is what the table shows and what every
          number in it describes; `history` is the whole player-season, and the
          footnote needs it to say where a partly measured column starts —
          which is a fact about the season, not about the filter. */}
      <StatsTable history={rows} seasonHistory={history} teams={teams} />
      {/* Independent, not exclusive: a player who never played can also have
          his rows filtered out, and then both facts are worth stating. */}
      {neverPlayed && (
        <p className={message}>
          In the {season} squad for {history.length}{' '}
          {history.length === 1 ? 'fixture' : 'fixtures'}, and played none of them.
        </p>
      )}
      {rows.length === 0 && (
        <p className={message}>
          None of {playerName}’s {history.length} matches match the selected filters.
        </p>
      )}
    </>
  );
}

import type { GameweekHistory, Team } from '../types/fpl';
import StatsTable from './StatsTable';

interface Props {
  /** Every match row for this player-season, before filtering. */
  history: GameweekHistory[];
  /**
   * The rows to show. Omit where there are no filters — an expanded previous
   * season has none, because the round selector is built from the current
   * season's events and 2019-20 runs to round 47.
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
   */
  registered: boolean;
  /**
   * False when this sits inside the career table, so the gameweeks scroll with
   * it rather than in a second scroller of their own. See StatsTable.
   */
  scroll?: boolean;
}

const message = 'text-center text-sm text-muted-foreground py-6';

/**
 * A season's gameweeks, and the four different ways it can come back empty.
 *
 * They all render as an absence and they mean different things, so the wording
 * is the only thing distinguishing them and it lives in one place:
 *
 *   1. **Not in the game.** No squad place that season — Cresswell has nine
 *      seasons and 2025-26 is not one of them. Nothing will ever appear here,
 *      so saying "once the season is underway" would be false.
 *   2. **Registered, no rows.** The season has not started, or has not reached
 *      him yet. This one really does fill in with time. Unreachable across the
 *      ten completed seasons in the database and correct the day a live one is
 *      ingested, which is the only reason it is written now.
 *   3. **Rows that are all zero.** In the squad every week, never played:
 *      Onana's 2025-26 is thirty-eight of them. The table renders, because
 *      thirty-eight zeroes is the answer — with a line saying so, since a
 *      wall of zeroes otherwise looks like a loading failure.
 *   4. **Filtered out.** Rows exist and the filters excluded them. Only "This
 *      Season" has filters, so this cannot fire under an expanded row.
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
  scroll = true,
}: Props) {
  if (!registered) {
    return (
      <p className={message}>
        {playerName} was not in the game in {season}.
      </p>
    );
  }

  if (history.length === 0) {
    return <p className={message}>Data will appear here once the {season} season is underway.</p>;
  }

  const rows = filtered ?? history;
  const neverPlayed = history.every((gw) => gw.minutes === 0);

  return (
    <>
      <StatsTable history={rows} teams={teams} scroll={scroll} />
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

/**
 * Team names that no `teams.csv` can supply.
 *
 * Rule 15: `teams.csv` is only published from 2019-20 onward. Clubs that were
 * relegated before then and have not been promoted since therefore have a
 * permanent `team_code` appearing in `players_raw.csv` for 2016-17..2018-19,
 * but no row anywhere that carries their name. These six are seeded by hand.
 *
 * Sunderland is deliberately NOT here: they were promoted for 2025-26, so
 * `teams.csv` supplies their name and the ingest picks it up automatically.
 *
 * How the mapping was established, since a wrong name here is a silent error
 * that no constraint would catch: the season-scoped team id is assigned
 * alphabetically by club name in 2016-17..2018-19, which is verifiable for
 * those seasons because the other 14-19 clubs per season DO have known names.
 * Reading off the alphabetical position of each gap gives the club, and every
 * code was then cross-checked in a second season:
 *
 *   Stoke 110 and Swansea 80  -> same code in both 2016-17 and 2017-18
 *   Huddersfield 38           -> same code in both 2017-18 and 2018-19
 *   Middlesbrough 25, Hull 88 -> 2016-17 only (relegated after one season)
 *   Cardiff 97                -> 2018-19 only
 *
 * Note the alphabetical property holds for these three seasons but NOT in
 * later ones (2025-26 orders Burnley before Bournemouth), so do not reuse it
 * as a general rule. It is only load-bearing for the six codes below.
 *
 * `ingest-dimensions.ts` asserts that every entry here is actually used. An
 * unused seed means upstream has since published a real `teams.csv` row, and
 * that row should win instead of this file.
 */

export interface SeedTeam {
  name: string;
  short_name: string;
}

/** Keyed by permanent FPL `team_code`. Names follow FPL's own convention. */
export const SEED_TEAMS: Record<number, SeedTeam> = {
  25: { name: 'Middlesbrough', short_name: 'MID' },
  38: { name: 'Huddersfield', short_name: 'HUD' },
  80: { name: 'Swansea', short_name: 'SWA' },
  88: { name: 'Hull', short_name: 'HUL' },
  97: { name: 'Cardiff', short_name: 'CAR' },
  110: { name: 'Stoke', short_name: 'STK' },
};

/**
 * The metric columns the Players list can show, and the sort over them.
 *
 * One table rather than three parallel switches. Before item 13 the page held a
 * five-member `SortKey` union used three times over — the header list, a
 * `numForKey` switch and a `renderCell` switch — which is survivable at five
 * and is not at twenty: adding a column meant three edits, and forgetting one
 * of them produces a column that renders and cannot be sorted, or sorts and
 * renders blank. Modelled on `StatsTable`'s `COLUMNS` for the same reason.
 *
 * **Not a component module.** It lives here rather than in `Players.tsx` so
 * that page stays all-components: React Fast Refresh only handles a module
 * whose exports are all components, and one non-component export turns every
 * subsequent edit to the file into a full page reload. That is item 9's lesson
 * and `lib/shirtCache.ts`'s precedent.
 */

import { fmtNum, fmtPrice } from '../types/fpl';
import type {
  ColumnAvailability,
  ColumnHistoryRow,
  Player,
  SeasonColumnAvailability,
} from '../types/fpl';
import { fmtPpg, fmtQuotient } from './averages';
import { noMatchesRecorded } from './emptyStates';

export interface PlayerColumn {
  /** Stable across versions: it is what persistence stores. */
  key: string;
  /** The column heading. Short — thirteen of these share a viewport. */
  label: string;
  /** The long name, for the picker. The heading alone does not teach. */
  title: string;
  /**
   * The expansion of the abbreviation, for the Players list's header hover.
   *
   * **Four name fields, and the only way to keep them straight is by which
   * surface reads which**, so that is what the names say:
   *
   * | field | who reads it | shape |
   * | --- | --- | --- |
   * | `label` | the table heading, the radar spoke | `DCH/St` |
   * | `title` | the picker, as visible text | a noun phrase |
   * | `gloss` | the Players header `title=` hover | one short sentence |
   * | `description` | the radar spoke's hover, and nothing else | a definition |
   *
   * `gloss` and `description` are two fields because the two hovers do
   * different jobs. A Players header sits inside a table that already names
   * the season and the player, so expanding the abbreviation is the whole job.
   * A radar spoke has no header row and no picker beside it, so its tooltip has
   * to *teach* — which is why `axisDefinition` deliberately does not fall back
   * to anything shorter. Collapsing the two would force one string to do both
   * and lose whichever end it was not written for; `comparison.axes.test.ts`
   * exists to stop exactly that.
   *
   * Optional, falling back to `title` — which is a reasonable degraded state
   * here in a way it is not on a radar spoke.
   */
  gloss?: string;
  /**
   * The definition, for the radar spoke's hover. **Read by `axisDefinition` and
   * by nothing else.**
   *
   * **Present on exactly the eleven comparison axes**, and that invariant is
   * pinned in both directions by `comparison.axes.test.ts`: every axis has one,
   * and no non-axis column does. The converse half is what stops the field
   * regrowing on a column nothing reads it for, where it would sit beside a
   * `gloss` saying the same thing and be free to drift from it.
   *
   * A radar spoke captioned `DCH/St` has no picker and no header row beside it
   * to give it context, so an unexplained abbreviation is all the reader gets.
   * That is why this exists at all, and why it is the long one.
   */
  description?: string;
  /**
   * Whether the underlying column can be NULL in some season (rule 6). Only a
   * nullable column can ever be unavailable, so this is what the season-level
   * empty state disables and what the availability matrix is consulted for.
   *
   * The `Price` and value columns are `false` despite dividing by a nullable
   * cost: `listPlayerTotals` COALESCEs `now_cost` to `end_cost`, and
   * `start_cost` is complete on all eleven seasons.
   */
  nullable: boolean;
  /**
   * The database columns this column's value is derived from, for a column that
   * has **no matrix cell of its own**. Availability is the most restrictive
   * state across them; ties break by declaration order, so the most informative
   * dependency goes first.
   *
   * Defaults to `[key]`, which is what every column before item 14 was: a
   * nullable column named for the database column it renders. So a
   * single-dependency column takes an identical path through `resolveColumn`
   * and this is one rule rather than a second branch.
   *
   * Item 14's two entries are the first that need it — `defcon_hits` is derived
   * from `defensive_contribution`, and `defcon_hits_per_start` from that AND
   * `starts`. Both dependencies are already in the bootstrap's five, so no
   * server-side change was required to answer for them. `Pts/£` fits the same
   * concept retroactively as a derived column whose inputs happen to be
   * non-nullable, which is why it needs no entry here.
   */
  dependsOn?: string[];
  /**
   * A permanent reason this column can never be shown, whatever the season.
   *
   * Distinct from a season-dependent absence: these two have no source in the
   * database at all, so no matrix cell describes them and no season makes them
   * available. Present as disabled entries rather than omitted, because "we do
   * not store this" is information a user is entitled to — the alternative is a
   * column that silently does not exist and looks like an oversight.
   */
  unavailable?: string;
  /**
   * The sort value, or null where there is nothing to sort on. Null is not 0:
   * `numForKey` used to fold `now_cost ?? 0` and the comparator below sorts
   * nulls last instead, which keeps an unmeasured column out of the top of a
   * descending sort rather than pinning it to the bottom of an ascending one.
   */
  value: (p: Player) => number | null;
  render: (p: Player) => string;
}

/**
 * Points per million, at two different prices, answering two different
 * questions — which is the only reason both exist.
 *
 * `now_cost` is the price today (or the closing price on a completed season,
 * via the repository's COALESCE), so `Pts/£` is what a buyer would pay now.
 * `start_cost` is what the season opened at and is never revised, so `Pts/£s`
 * is what owning the player from day one actually returned. On a player whose
 * price moved they are different numbers, and a column that silently used
 * `now_cost` for both would look right on every row.
 *
 * **Both go through `fmtPpg`, never `fmtNum`.** `fmtPpg` wraps `roundHalfEven`;
 * `fmtNum` ends in `toFixed`, which is not an implementation of any rounding
 * convention but whatever the binary representation gives. Item 11 measured the
 * two disagreeing on 111 of 226 tied player-seasons — and agreeing on 6 more by
 * accident. Two divisions rounded two ways is the exact bug item 11 removed.
 */
const perMillion = (points: number, cost: number | null): number | null =>
  cost === null || cost === 0 ? null : points / (cost / 10);

/** `fmtNum` for the nullable ones, so an absent value renders `—` and not `0`. */
const int = (v: number | null) => fmtNum(v, 0);

/**
 * **`_per_start` means two unrelated things in this file, and that was accepted
 * rather than missed.** The two helpers either side of this note are where it is
 * visible:
 *
 *   - `pts_per_start` divides by the season's **opening price** — `perMillion`
 *     above, against `start_cost`. "Start" is the start of the *season*.
 *   - `hauls_per_start` and `floors_per_start` divide by **games started** —
 *     `perStart` below, against the `starts` column. "Start" is an appearance in
 *     the XI.
 *
 * **Do not rename either.** All three are persisted selection keys: the Players
 * list stores the user's chosen columns by key in `localStorage`, and
 * `loadSelectedColumns` drops keys no definition matches — so a rename silently
 * discards that column from every existing selection, with nothing to detect it.
 *
 * Item 21 is where this became worth writing down rather than tolerating in
 * silence. It put `/St` into user-facing labels for the first time (`Pts10+/St`,
 * `Pts4+/St`, alongside `DCH/St`), so on screen the suffix now reliably means
 * "per game started" — while in the source `pts_per_start` goes on meaning
 * something else entirely. A reader who notices the inconsistency and "fixes" it
 * is the failure this note exists to prevent.
 */

/**
 * A count divided by starts, or null where the question has no answer.
 *
 * **The one place the client divides by `starts`**, shared by `DCH/St`,
 * `Pts10+/St` and `Pts4+/St`. Item 19 wrote a second copy of these guards for its two ratios
 * before collapsing them into this: two implementations of one null rule is
 * where one gets fixed and the other does not. **The gated/ungated difference
 * between those columns lives entirely in the numerator passed in**, never in
 * the guards, so sharing them is exact rather than approximate.
 *
 * **All three null tests are required, and `numerator === null` is the one that
 * is easy to drop.** `null / 5` is `0` in JavaScript, not `NaN`, so omitting it
 * renders a confident `0.00` for a count that was never measured — rule 6
 * defeated by a coercion, in a cell indistinguishable from a real zero.
 *
 * Each is probably unreachable today, because the availability layer withholds
 * these columns on every season where the numerator can be null. That is not a
 * reason to leave them out: the server's guards exist precisely so the value
 * *can* be null, this is the only place the client divides by it, and a column
 * whose correctness rests on a different module's filter is one refactor from
 * being wrong.
 *
 * **A zero denominator returns null rather than 0.00**, so "he made no starts"
 * and "he cleared none of his starts" stay distinguishable. 367 of 2025-26's
 * 841 players have no starts at all, so this is the common case rather than the
 * edge one.
 */
const perStart = (numerator: number | null, starts: number | null): number | null =>
  numerator === null || starts === null || starts === 0 ? null : numerator / starts;

/** Ungated numerator: a hit won off the bench counts, so this can exceed 1. */
const hitsPerStart = (p: Player): number | null => perStart(p.defcon_hits, p.starts);

/**
 * Gated numerators — only fixtures the player STARTED — so unlike `hitsPerStart`
 * above these cannot exceed 1.00. That bound is stated in both glosses and is
 * therefore a promise on screen; it is pinned across all eleven seasons in
 * `hauls.test.ts`.
 */
const haulsPerStart = (p: Player): number | null => perStart(p.hauls_started, p.starts);
const floorsPerStart = (p: Player): number | null => perStart(p.floors_started, p.starts);

/**
 * Every column the payload can answer, in the order they render.
 *
 * `DEFAULT_KEYS` below picks the thirteen that show without being asked; the
 * rest are in the picker. A column is here because the bootstrap already
 * carries it, not because it was judged interesting — the picker having no
 * arbitrary ceiling is cheaper than curating one.
 */
export const PLAYER_COLUMNS: PlayerColumn[] = [
  {
    key: 'pts',
    label: 'Pts',
    title: 'Total points',
    gloss: 'Total points.',
    description:
      'Every point the player scored across the season — appearances, goals, assists, clean sheets, bonus and deductions, as FPL awarded them.',
    nullable: false,
    value: (p) => p.total_points,
    render: (p) => String(p.total_points),
  },
  {
    key: 'price',
    label: 'Price',
    title: 'Price',
    gloss: 'Price.',
    nullable: false,
    value: (p) => p.now_cost,
    render: (p) => fmtPrice(p.now_cost),
  },
  {
    key: 'minutes',
    label: 'Min',
    title: 'Minutes played',
    gloss: 'Minutes played.',
    description:
      'Total minutes on the pitch across the season. The denominator behind most rate stats, and the quickest read on whether a player actually starts.',
    nullable: false,
    value: (p) => p.minutes,
    render: (p) => String(p.minutes),
  },
  {
    key: 'goals',
    label: 'G',
    title: 'Goals scored',
    gloss: 'Goals scored.',
    description:
      'Goals scored across the season, as FPL recorded them.',
    nullable: false,
    value: (p) => p.goals_scored,
    render: (p) => String(p.goals_scored),
  },
  {
    key: 'assists',
    label: 'A',
    title: 'Assists',
    gloss: 'Assists.',
    description:
      'Assists across the season, on FPL’s own definition — which is not always the same as the match broadcaster’s.',
    nullable: false,
    value: (p) => p.assists,
    render: (p) => String(p.assists),
  },
  {
    key: 'clean_sheets',
    label: 'CS',
    title: 'Clean sheets',
    gloss: 'Clean sheets.',
    description:
      'Matches where the player was on the pitch for at least 60 minutes and his side conceded nothing. Scores points for goalkeepers and defenders, and one point for midfielders.',
    nullable: false,
    value: (p) => p.clean_sheets,
    render: (p) => String(p.clean_sheets),
  },
  {
    key: 'pts_per_now',
    label: 'Pts/£',
    title: 'Points per £m, at the current price',
    // One clause beyond the expansion, and it is load-bearing: the picker also
    // offers Pts/£s, the same ratio at the season's opening price, so a gloss
    // that said only "points per £m" would describe both columns equally.
    gloss: 'Points per £m, at the current price.',
    description:
      'Total points divided by the player’s current price in £m — what a buyer would pay today. The sibling Pts/£s divides by the price the season opened at instead, so the two answer different questions on any player whose price moved.',
    nullable: false,
    value: (p) => perMillion(p.total_points, p.now_cost),
    render: (p) => fmtPpg(perMillion(p.total_points, p.now_cost)),
  },
  {
    // Points per MATCH. Not points per million — `PPM` has meant this on this
    // page and on the Dashboard since step 7, and reusing the abbreviation for
    // FPL's own "value" sense would silently change what an existing column
    // means. The two value columns above are spelled out instead.
    key: 'ppm',
    label: 'PPM',
    title: 'Points per match appeared in',
    // The denominator is the clause that has to survive the trim. "Points per
    // match" alone reads as points per ROUND, which is a different number on
    // any player with a blank gameweek or an unused-substitute appearance.
    gloss: 'Points per match appeared in, not per round.',
    description:
      'Points per match appeared in — not points per million. Total points divided by the matches the player played at least a minute of, so blank gameweeks and unused-substitute rounds are not in the denominator. The two value columns spell out the per-million sense instead.',
    nullable: false,
    value: (p) => p.points_per_game,
    render: (p) => fmtPpg(p.points_per_game),
  },
  {
    // How a total was arrived at, which the total itself cannot say. Two
    // players on 120 points are not the same asset: one returns 6 most weeks,
    // the other blanks repeatedly and then scores 15.
    //
    // **Labelled `Pts10+` rather than `Hauls` since item 21.** "Haul" has no
    // agreed threshold in FPL — 10, 12, or just "a big week" depending who is
    // talking — so the name hid the one choice the reader needs to see. `Min10+`
    // was rejected: `Min` is minutes played and sits in the same header row.
    // **The KEY stays `hauls`**, because it is a persisted selection key; see
    // `loadSelectedColumns`.
    //
    // **nullable: false, and that is what keeps it offered on 2026-27.** It
    // counts over total_points, which is NOT NULL in every season, so there is
    // no unmeasured state — a roster that has played nothing has hauled zero
    // times in the same sense that it has scored zero goals, and Goals renders
    // 0 there for the same reason (rule 6).
    key: 'hauls',
    label: 'Pts10+',
    title: 'Matches of 10 or more points',
    // Two clauses past the expansion, both of which change the number: the
    // threshold is a convention rather than an FPL statistic, and the unit is
    // the FIXTURE, so rule 13's double gameweek contributes two.
    gloss: 'Fixtures scoring 10 or more points. Counted per fixture, so a double gameweek can contribute two.',
    nullable: false,
    value: (p) => p.hauls,
    render: (p) => int(p.hauls),
  },
  {
    // Inclusive of hauls, not a 4-to-9 band, so Pts4+ >= Pts10+ on every row.
    // Renamed from `Floors` in item 21 for a second reason on top of the missing
    // threshold: "floor" normally describes a player's BASELINE, so a column of
    // counts under that heading reads as a level rather than a tally.
    key: 'floors',
    label: 'Pts4+',
    title: 'Matches of 4 or more points',
    gloss: 'Fixtures scoring 4 or more points, including the 10+ hauls. Counted per fixture, so a double gameweek can contribute two.',
    nullable: false,
    value: (p) => p.floors,
    render: (p) => int(p.floors),
  },
  {
    key: 'expected_goals',
    label: 'xG',
    title: 'Expected goals',
    gloss: 'Expected goals.',
    nullable: true,
    value: (p) => p.expected_goals,
    render: (p) => fmtNum(p.expected_goals, 2),
  },
  {
    key: 'expected_goal_involvements',
    label: 'xGI',
    title: 'Expected goal involvements',
    gloss: 'Expected goal involvements.',
    description:
      'Expected goals plus expected assists — the chances created and taken, weighted by how likely each was to be scored. Recorded from 2022-23 only.',
    nullable: true,
    value: (p) => p.expected_goal_involvements,
    render: (p) => fmtNum(p.expected_goal_involvements, 2),
  },
  {
    key: 'defensive_contribution',
    label: 'DC',
    title: 'Defensive contribution',
    gloss: 'Defensive contribution.',
    nullable: true,
    value: (p) => p.defensive_contribution,
    render: (p) => int(p.defensive_contribution),
  },

  // ---- available, not default ----

  {
    key: 'bonus',
    label: 'Bon',
    title: 'Bonus points',
    gloss: 'Bonus points.',
    description:
      'Bonus points, the 3-2-1 awarded after each match to the top performers by FPL’s Bonus Points System. Already included in total points.',
    nullable: false,
    value: (p) => p.bonus,
    render: (p) => String(p.bonus),
  },
  {
    key: 'pts_per_start',
    label: 'Pts/£s',
    title: 'Points per £m, at the price the season opened at',
    gloss: 'Points per £m, at the price the season opened at.',
    nullable: false,
    value: (p) => perMillion(p.total_points, p.start_cost),
    render: (p) => fmtPpg(perMillion(p.total_points, p.start_cost)),
  },
  {
    key: 'expected_assists',
    label: 'xA',
    title: 'Expected assists',
    gloss: 'Expected assists.',
    nullable: true,
    value: (p) => p.expected_assists,
    render: (p) => fmtNum(p.expected_assists, 2),
  },
  {
    key: 'starts',
    label: 'Starts',
    title: 'Matches started',
    gloss: 'Matches started.',
    nullable: true,
    value: (p) => p.starts,
    render: (p) => int(p.starts),
  },
  {
    // How many gameweeks cleared the defensive contribution threshold.
    //
    // **The number a DC total cannot give you.** Gabriel's 2025-26 is 277 over
    // 30 starts — 9.2 a start against a defender's 10 — and that average cannot
    // distinguish a player who hits most weeks from one who almost never does.
    // He hits 11 times in 38.
    //
    // Derived server-side and merely rendered here; nothing on the client
    // compares a number to a threshold. Its matrix cell is
    // `defensive_contribution`'s, via `dependsOn`.
    key: 'defcon_hits',
    label: 'DCH',
    title: 'Defensive contribution hits',
    gloss: 'Defensive contribution hits.',
    nullable: true,
    dependsOn: ['defensive_contribution'],
    value: (p) => p.defcon_hits,
    render: (p) => int(p.defcon_hits),
  },
  {
    // Hits per START, and named for it rather than called a rate or a
    // percentage, because **it can exceed 1**: a substitute who racks up twelve
    // recoveries in half an hour has cleared the threshold without starting, so
    // the numerator counts all games and the denominator counts starts. Rare —
    // 8 such hits in all of 2025-26, and no player's total actually exceeds his
    // starts — but above 1 reads as "hits more often than he starts", which is
    // informative. Not clamped, the denominator not switched to appearances,
    // and the numerator not restricted to started games: the count column above
    // and this one must share one numerator.
    //
    // Availability takes the more restrictive of its two inputs.
    // `defensive_contribution` is declared first so a season that records
    // neither reports DC's sentence, which names 2025-26, rather than `starts`'
    // which would name 2022-23 and describe the wrong column.
    key: 'defcon_hits_per_start',
    label: 'DCH/St',
    title: 'Defensive contribution hits per start',
    // The denominator and the definition of a hit both have to survive: the
    // expansion alone leaves "hit" undefined, and "per start" is what
    // distinguishes it from a per-game rate.
    gloss:
      'Defensive contribution hits per start — per game STARTED, not per game played. A hit is a match clearing the positional threshold.',
    description:
      'Defensive contribution hits divided by starts. A hit is a match clearing the positional threshold (DEF 10 CBIT; MID and FWD 12 CBIRT; goalkeepers have no threshold and so no hits). A value above 1 is meaningful rather than an error: hits won off the bench count in the numerator, while only starts count in the denominator.',
    nullable: true,
    dependsOn: ['defensive_contribution', 'starts'],
    value: (p) => hitsPerStart(p),
    render: (p) => fmtQuotient(hitsPerStart(p), 2),
  },
  {
    // The numerator counts only STARTED fixtures, so this is bounded at 1.00 —
    // the opposite of DCH/St above, whose numerator is ungated and which can
    // exceed 1. The two look like the same fragment and are not; the server
    // computes them from separate expressions for exactly this reason.
    //
    // dependsOn is ['starts'] alone: the count itself derives from a NOT NULL
    // column, so starts is the only input that can be unmeasured. That gets
    // 2022-23's "Only recorded from GW16" and 2026-27's "No matches recorded"
    // for free.
    key: 'hauls_per_start',
    label: 'Pts10+/St',
    title: 'Matches of 10 or more points, per start',
    // The title changed with the label rather than staying "Hauls per start":
    // the picker renders the two side by side, so the old title would have put
    // the word back on screen beside the label that replaced it.
    gloss:
      'Matches of 10 or more points, per start — only started fixtures count, in the numerator as well as the denominator.',
    nullable: true,
    dependsOn: ['starts'],
    value: (p) => haulsPerStart(p),
    render: (p) => fmtQuotient(haulsPerStart(p), 2),
  },
  {
    key: 'floors_per_start',
    label: 'Pts4+/St',
    title: 'Matches of 4 or more points, per start',
    gloss:
      'Matches of 4 or more points, per start — only started fixtures count, in the numerator as well as the denominator.',
    nullable: true,
    dependsOn: ['starts'],
    value: (p) => floorsPerStart(p),
    render: (p) => fmtQuotient(floorsPerStart(p), 2),
  },
  {
    key: 'saves',
    label: 'S',
    title: 'Saves',
    gloss: 'Saves.',
    description:
      'Shots saved by a goalkeeper across the season. Every third save scores a point.',
    nullable: false,
    value: (p) => p.saves,
    render: (p) => String(p.saves),
  },
  {
    key: 'bps',
    label: 'BPS',
    title: 'Bonus points system score',
    gloss: 'Bonus points system score.',
    nullable: false,
    value: (p) => p.bps,
    render: (p) => String(p.bps),
  },
  {
    key: 'ict_index',
    label: 'ICT',
    title: 'ICT index',
    gloss: 'ICT index.',
    nullable: false,
    value: (p) => p.ict_index,
    render: (p) => fmtNum(p.ict_index, 1),
  },
  {
    key: 'influence',
    label: 'I',
    title: 'Influence',
    gloss: 'Influence.',
    nullable: false,
    value: (p) => p.influence,
    render: (p) => fmtNum(p.influence, 1),
  },
  {
    key: 'creativity',
    label: 'C',
    title: 'Creativity',
    gloss: 'Creativity.',
    nullable: false,
    value: (p) => p.creativity,
    render: (p) => fmtNum(p.creativity, 1),
  },
  {
    key: 'threat',
    label: 'T',
    title: 'Threat',
    gloss: 'Threat.',
    nullable: false,
    value: (p) => p.threat,
    render: (p) => fmtNum(p.threat, 1),
  },

  // ---- offered, permanently disabled, each saying why ----

  {
    key: 'status',
    label: 'Status',
    title: 'Availability status',
    gloss: 'Availability status.',
    nullable: false,
    // A live-game field with no source, so it read "Unknown" on every row of
    // every season while it was a column. It is worth an entry rather than a
    // deletion because it becomes real the moment the live field sync lands.
    unavailable: 'Live-game field, not stored for a completed season.',
    value: () => null,
    render: () => fmtNum(null, 0),
  },
  {
    key: 'selected_by_percent',
    label: 'Own%',
    title: 'Teams selected by %',
    gloss: 'Percentage of teams selecting this player.',
    nullable: false,
    // The one reason string that is a fact about OUR pipeline rather than about
    // FPL's data, and it is worded to say so. The raw manager count does exist,
    // per gameweek, in all ten seasons — what is missing is the total-managers
    // denominator, which rides on the live bootstrap and is stored nowhere. So
    // the percentage is computable for a live season and lost only for the
    // historical ones. "Does not exist" would be the wrong sentence.
    unavailable: 'Ownership percentage is not stored. FPL publishes it live only.',
    value: () => null,
    render: () => fmtNum(null, 0),
  },
];

/**
 * The thirteen that render without being asked for.
 *
 * **This list is the render ORDER**, not just a set: `Players.tsx` maps
 * `selected`, so the order a key sits at here is the order its column appears
 * in. It matches `PLAYER_COLUMNS`' own leading order, which is why the two are
 * worth keeping in step.
 *
 * **Thirteen before item 21's swap and thirteen after**, deliberately: item 13
 * measured the thirteen-column table at 1440px with 290px of headroom, and that
 * measurement is only still valid at the same count. `bonus` and
 * `pts_per_start` left, `hauls` and `floors` arrived — both removed columns are
 * still in the picker, one click away.
 */
export const DEFAULT_KEYS = [
  'pts',
  'price',
  'minutes',
  'goals',
  'assists',
  'clean_sheets',
  'pts_per_now',
  'ppm',
  'hauls',
  'floors',
  'expected_goals',
  'expected_goal_involvements',
  'defensive_contribution',
];

export const DEFAULT_SORT_KEY = 'pts';

export const columnByKey = (key: string): PlayerColumn | undefined =>
  PLAYER_COLUMNS.find((c) => c.key === key);

/**
 * Ascending, nulls last in both directions, so `sortDir` flips the numbers and
 * leaves the absent values where they are.
 *
 * **Insurance, and documented as such.** Under the availability predicate a
 * rendered column has no NULL cells, so today nothing reaches the null branches
 * from a season the picker would offer. That holds until the gameweek sync
 * writes 2026-27's first match rows, at which point a registered player with no
 * match row yet has a NULL aggregate in a season that reads as fully measured —
 * so the policy is here from the start rather than added in September.
 */
export const compareBy =
  (col: PlayerColumn, dir: -1 | 1) =>
  (a: Player, c: Player): number => {
    const x = col.value(a);
    const y = col.value(c);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return dir * (x - y);
  };

/**
 * Whether a column can be shown for the selected season, and if not, why.
 *
 * The reason is a **complete sentence from the bootstrap alone**. The matrix
 * only ever appends a trailing clause saying where the column *is* recorded, so
 * there is no window in which a disabled entry carries a wrong claim or no claim
 * — it gains a pointer when the matrix lands and nothing changes meaning.
 */
export type ColumnStatus =
  | { available: true }
  | {
      available: false;
      /** The full sentence. What `Comparison.tsx` renders beside a dropped axis. */
      reason: string;
      /**
       * The same fact, compressed for the column picker — where a dozen entries
       * are disabled at once and a dozen sentences drown the list.
       *
       * **An addition to the same return value, produced in the same branch as
       * the sentence**, never a second function over the same inputs. Item 13's
       * rule is that one reason has one derivation; a tag derived separately is
       * that rule broken in the quietest possible way, since the two would
       * disagree only in the cases nobody looks at.
       *
       * **Absent where compressing would make the claim false or empty**, and
       * the picker falls back to `reason` there. Three branches decline it: the
       * two permanently-unavailable fields, whose sentences are not
       * interchangeable with each other; the column the server never spoke for,
       * where a tag would restate the greying without adding the distinction it
       * exists to draw; and a `none` with no season to point at.
       */
      tag?: string;
    };

/**
 * Human phrasing for the set of seasons a column is recorded in — **the phrase
 * alone, with no leading verb**.
 *
 * Returns `from 2022-23`, or `2016-17 to 2018-19, and 2025-26`. The caller
 * supplies the verb: the sentence writes `· recorded ${where}.` and the picker's
 * tag uses the phrase as it stands. **That is what makes the tag and the
 * sentence one derivation** rather than the sentence being built first and the
 * tag sliced back off it with a `replace(/^recorded /, '')`.
 *
 * "Recorded" means the matrix state is not `none` — a `partial` season has the
 * column, just not for all of it, and pointing a reader at it is still right.
 *
 * Two shapes, because two shapes actually occur. Most columns arrived once and
 * stayed, which reads as "from 2022-23". The defensive trio did not: it was
 * collected 2016-17 to 2018-19, dropped for six seasons and collected again in
 * 2025-26, and "from 2016-17" would be a plain lie about the six in between.
 * **That second shape is what stops the tag being uniformly short** — it
 * compresses to a range list and no further, because `from 2025-26` would be
 * false. Truthful and long beats short and wrong.
 */
export function describeRecordedIn(
  recorded: string[],
  allSeasons: string[],
  /**
   * The newest season that records anything at all — the anchor for "reaches the
   * present", and NOT simply the newest season.
   *
   * The difference is the unplayed season. 2026-27 has no match rows, so every
   * column is absent there, so no run ever reaches the newest season and every
   * column falls to the range form: xG read **"recorded 2022-23 to 2025-26"**,
   * which is literally true and implies the column was discontinued. It has not
   * been — that season simply has not been played. Found in the browser; the
   * unit fixtures all stopped at a season with data.
   */
  latestWithData: string
): string | null {
  if (recorded.length === 0) return null;

  // Ascending, so "runs" are chronological. `allSeasons` arrives newest-first.
  const asc = [...allSeasons].sort();
  const present = new Set(recorded);

  const runs: string[][] = [];
  for (const season of asc) {
    if (!present.has(season)) continue;
    const last = runs[runs.length - 1];
    const prevIndex = asc.indexOf(season) - 1;
    const contiguous = last !== undefined && prevIndex >= 0 && last.includes(asc[prevIndex]);
    if (contiguous) last.push(season);
    else runs.push([season]);
  }

  const lastRun = runs[runs.length - 1];

  // One unbroken run reaching as far as the data goes: the column arrived and
  // stayed, which is "from X" rather than a closed range.
  if (runs.length === 1 && lastRun[lastRun.length - 1] === latestWithData) {
    return `from ${lastRun[0]}`;
  }

  const phrases = runs.map((r) => (r.length === 1 ? r[0] : `${r[0]} to ${r[r.length - 1]}`));
  return phrases.length === 1
    ? phrases[0]
    : `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

/**
 * The one place a column's availability is decided.
 *
 * Order matters and is not arbitrary:
 *
 *   1. **A permanent `unavailable`** beats everything — no season makes a field
 *      with no source available.
 *   2. **A season with no matches** is one fact about the season, so it is said
 *      once, in the season's own words, rather than nine times per column.
 *      Wording borrowed from the Dashboard deliberately: the same situation
 *      should not have two sentences in one app.
 *   3. **A non-nullable column is always available** where the season has rows.
 *      It is NOT NULL in the schema, so no matrix cell can withhold it.
 *   4. Otherwise the season's own `columns` block decides.
 *
 * `history` is optional throughout: every branch produces a true sentence
 * without it.
 */
export function resolveColumn(
  col: PlayerColumn,
  availability: SeasonColumnAvailability,
  history: ColumnHistoryRow[] | null,
  allSeasons: string[]
): ColumnStatus {
  // No tag. The two fields here are not season-dependent, so there is no "when"
  // for a tag to carry — and their sentences are not interchangeable with each
  // other: `Own%`'s says the gap is in OUR pipeline (the raw manager count is
  // stored; the denominator is not), where `Status`' says the field describes a
  // live game. A shared `not stored` would collapse that distinction, which is
  // the one those two sentences were written to draw.
  if (col.unavailable) return { available: false, reason: col.unavailable };

  const season = availability.season;

  if (!availability.measured) {
    // Non-nullable columns are still all-zero rather than absent here, but the
    // season has no matches, so every stat column is equally uninformative and
    // the honest thing is one sentence about the season.
    if (!col.nullable) return { available: true };
    // The sentence stays `noMatchesRecorded`'s — the Dashboard, Comparison and
    // Fixtures pages render that same string, and this is not the place to fork
    // it. Only the picker's compressed form is new.
    return { available: false, reason: noMatchesRecorded(season), tag: 'no matches yet' };
  }

  if (!col.nullable) return { available: true };

  /**
   * The dependency that decides it — the most restrictive, ties by declaration
   * order.
   *
   * A column with no `dependsOn` is a column named for the one database column
   * it renders, which is every nullable column before item 14. So this reduces
   * to the single-cell lookup it used to be rather than adding a branch beside
   * it, and a derived column is the general case rather than the exception.
   *
   * Severity ranks `undefined` above `none` above `partial`: an absent cell
   * means the server never spoke for the column, which is a stronger reason to
   * withhold than a measured "no player has a value". Neither of item 14's two
   * columns can reach that today — both dependencies are in the bootstrap's
   * five — but the ordering has to be stated rather than left to `find`.
   */
  const severity = (c: ColumnAvailability | undefined): number =>
    c === undefined ? 3 : c.state === 'none' ? 2 : c.state === 'partial' ? 1 : 0;

  const deps = col.dependsOn ?? [col.key];
  let depKey = deps[0];
  let cell = availability.columns.find((c) => c.key === depKey);
  for (const key of deps.slice(1)) {
    const candidate = availability.columns.find((c) => c.key === key);
    // Strictly greater, so a tie keeps the earlier declaration — which is why
    // `defensive_contribution` is declared first on both of item 14's columns:
    // on 2016-17 both dependencies are `none`, and DC's sentence names 2025-26
    // where `starts`' would name 2022-23 and describe the wrong column.
    if (severity(candidate) > severity(cell)) {
      cell = candidate;
      depKey = key;
    }
  }

  // A nullable column the bootstrap does not speak for. It cannot be rendered,
  // because the payload carries no value for it — but "the server did not
  // measure this" is not the same claim as "no player has a value", so the
  // sentence says only what is known.
  // No tag: `not available` would restate the greying without carrying the
  // distinction this branch exists to draw.
  if (cell === undefined) return { available: false, reason: `Not available for ${season}.` };

  if (cell.state === 'full') return { available: true };

  if (cell.state === 'partial') {
    // A season total over a partly measured column has no honest value — this
    // is rule 6 one layer up, and the reason names the boundary rather than
    // merely refusing.
    //
    // The tag drops the season because the picker's own heading names it, and
    // an entry is only ever greyed for the season on screen. `from GW16` is
    // therefore true as read, and it is a boundary WITHIN this season rather
    // than a different season — which is what keeps it distinct from the
    // `from 2022-23` tag below.
    const from = cell.measured_from;
    return from === null
      ? { available: false, reason: `Only recorded for part of ${season}.`, tag: 'partly recorded' }
      : {
          available: false,
          reason: `Only recorded from GW${from} in ${season}.`,
          tag: `from GW${from}`,
        };
  }

  // `none`. The base sentence is a claim about OUR ROWS, never about the world:
  // "not measured" would be a statement about whether anybody took the
  // measurement, which is not something this app can know. The distinction is
  // not pedantic — after GW1 of a live season is ingested, a column the upstream
  // has not populated yet reads `none`, and 2022-23 is the precedent that this
  // really happens: the expected family was absent through round 15 and then
  // appeared. "Not recorded in 2026-27" stays true either way.
  const base = `Not recorded in ${season}`;
  // No tag: with no matrix there is no season to point at, and the tag would be
  // the greying restated.
  if (history === null) return { available: false, reason: `${base}.` };

  // `depKey`, not `col.key`. For a derived column the matrix has no row of its
  // own, and the seasons worth pointing at are the ones that record the
  // dependency this branch was chosen for.
  const recorded = history
    .filter((r) => r.key === depKey && r.state !== 'none')
    .map((r) => r.season);

  // The newest season recording ANY column, which is how far our data reaches.
  // Derived from the matrix rather than taken as "the newest season", because
  // the newest season is the unplayed one — see describeRecordedIn.
  const withData = history.filter((r) => r.state !== 'none').map((r) => r.season);
  const latestWithData = withData.length > 0 ? withData.sort()[withData.length - 1] : season;

  const where = describeRecordedIn(recorded, allSeasons, latestWithData);

  // The clause that makes a mid-season lag legible the moment any season has the
  // column. With no season recording it there is nothing to point at, and the
  // sentence is complete without one — and there is nothing to tag either.
  //
  // The verb lives here rather than in `describeRecordedIn`, so the sentence and
  // the tag are one derivation with the sentence adding a word, not two
  // derivations that agree today.
  if (where === null) return { available: false, reason: `${base}.` };
  return { available: false, reason: `${base} · recorded ${where}.`, tag: where };
}

const STORAGE_KEY = 'fpl-players-columns';

/**
 * The stored selection, filtered against the columns this build knows about.
 *
 * **The FULL selection is stored, never the visible subset**, and that is the
 * single rule persistence runs on. Render is `stored.filter(available)`, so a
 * column unavailable on the selected season stays selected and comes back when
 * the user returns to a season that has it. Storing only what was rendered would
 * silently forget the choice the first time someone looked at 2016-17.
 *
 * Unknown keys are dropped at read — a column renamed or removed in a later
 * version leaves a key in localStorage that no definition matches, and there is
 * no server to validate against here. That is the one thing this borrows from
 * the season key's round trip; it deliberately does not borrow the rest, since
 * there is nothing to ask.
 */
export function loadSelectedColumns(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_KEYS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_KEYS;
    const known = parsed.filter((k): k is string => typeof k === 'string' && columnByKey(k) !== undefined);
    // An empty stored array is a real choice (every column turned off) and is
    // kept; a corrupt or fully unknown one is not, and falls back.
    return parsed.length > 0 && known.length === 0 ? DEFAULT_KEYS : known;
  } catch {
    // Malformed JSON, or storage unavailable. The defaults are always valid.
    return DEFAULT_KEYS;
  }
}

export function saveSelectedColumns(keys: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage full or blocked. The app works, the choice just does not persist.
  }
}

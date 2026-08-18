/**
 * The frozen axis thresholds for the player comparison chart.
 *
 * The chart draws raw values against fixed per-axis floors and ceilings.
 * **Freezing them is what makes two seasons comparable to each other**: an axis
 * rescaled per season would put every season's best player on the outer ring
 * and say nothing about whether 2016-17's best is 2025-26's best. So the
 * numbers are constants, derived once, in item 16 step 1, over the ten complete
 * seasons.
 *
 * **They live on the server and cross the wire.** The alternative — a module in
 * `client/src/lib/` — would have forced `verify:thresholds` to import across
 * packages to read them, which `server/tsconfig.json` records as the point at
 * which the right fix becomes a shared package. Here the check imports them
 * inside the server program with full type checking, no third `exclude` entry
 * arrives, and item 13's rule is untouched. The consequence the client pays is
 * in `GET /api/comparison-thresholds`: no axis configuration exists until the
 * response lands, so the comparison page needs a loading state rather than
 * rendering axes from a compiled-in constant. That is the accepted cost.
 *
 * The deciding argument was not the import count, though. **Re-derivation is a
 * server-only change** — see the rule below, under which two of these axes are
 * expected to move. A constant compiled into the client moves only when the
 * client is rebuilt and every cached bundle has expired; a constant served from
 * here moves when the server restarts.
 *
 * Derivation, cohort sizes and the full distribution tables:
 * `docs/items/item-16-comparison-thresholds.md`. `npm run verify:thresholds`
 * checks these values against the database.
 */

/**
 * The re-derivation rule.
 *
 * **A threshold derived from fewer than five seasons is re-derived when a
 * season is added. Five or more is frozen, and re-derived only deliberately.**
 *
 * Today that makes exactly two axes re-derivable: `defcon_hits_per_start`, which
 * has one season, and `expected_goal_involvements`, which has three. Both are
 * new columns rather than new stats — see the availability notes on each below.
 *
 * **A re-derived threshold records the old value beside the new one and the
 * season that triggered it** (`supersedes`, unused today because nothing has
 * been re-derived yet). Re-deriving an axis breaks cross-season comparability
 * on it — a player measured against the old ceiling and one measured against
 * the new are not on the same chart — which is the single thing frozen
 * thresholds exist to protect. So the change has to be visible in the data
 * rather than inferable from a git log.
 *
 * **A change to `DEFCON_THRESHOLDS` invalidates every `defcon_hits_per_start`
 * threshold outright, not at the next season boundary.** That module already
 * says a second value makes it a per-season lookup; when that happens, the hit
 * counts these thresholds were derived from stop meaning what they meant, and
 * five seasons of accumulation does not repair it.
 *
 * Five is a defensible line rather than a derived one: it is the point at which
 * the per-season spread of a statistic stops being one season wide.
 */
export const RE_DERIVE_BELOW_SEASONS = 5;

/**
 * An axis key is a `PLAYER_COLUMNS` key, deliberately.
 *
 * All eleven axes already exist as columns the Players list can offer, so
 * reusing the keys means the two surfaces name the same stat identically and
 * there is no second vocabulary to keep in step. The `label` below is separate
 * because a radar axis and a table header have different width budgets — `Sv`
 * here against the picker's `S` is the one place they differ today.
 */
export type ComparisonAxisKey =
  | 'pts'
  | 'clean_sheets'
  | 'goals'
  | 'minutes'
  | 'ppm'
  | 'defcon_hits_per_start'
  | 'assists'
  | 'pts_per_now'
  | 'expected_goal_involvements'
  | 'bonus'
  | 'saves';

export type ComparisonPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

/**
 * Where a threshold came from, as data rather than as a comment above it.
 *
 * This is what makes the re-derivation rule enforceable instead of
 * aspirational: `verify:thresholds` re-derives over exactly these seasons, so
 * the check stays green as seasons are added rather than going red for the
 * frozen value doing its job. A comment could not be read by the check, and a
 * rule nothing enforces is a rule that has already drifted.
 */
export interface AxisDerivation {
  /** The seasons the cohort was drawn from, oldest first. */
  seasons: string[];
  /** How many player-seasons met the 1,200-minute gate over those seasons. */
  cohort: number;
}

export interface AxisThreshold {
  axis: ComparisonAxisKey;
  /** The chart's axis caption. */
  label: string;
  floor: number;
  ceiling: number;
  derivedFrom: AxisDerivation;
  /**
   * Set when this axis has been re-derived: what it used to be, and the season
   * whose arrival triggered it. Absent on a threshold still carrying its
   * original value, which is all of them today.
   */
  supersedes?: { floor: number; ceiling: number; triggeredBy: string };
}

/** The ten complete seasons. 2026-27 has no match rows and no cohort. */
const ALL_TEN = [
  '2016-17', '2017-18', '2018-19', '2019-20', '2020-21',
  '2021-22', '2022-23', '2023-24', '2024-25', '2025-26',
];

/**
 * xGI's derivation set is three seasons, not ten and not four.
 *
 * The column is 2022-23 onward, but 2022-23 measures it only from GW16, so
 * `measuredSum` blanks exactly the players who played through rounds 1-15 — the
 * regulars — and keeps a real total for the January arrivals. Pooling that
 * season would sample the fringe and call it the population. Item 13 already
 * treats 2022-23 as unavailable for this column at aggregate level; this is the
 * same call for the same reason.
 */
const XGI_SEASONS = ['2023-24', '2024-25', '2025-26'];

/**
 * DC is 2025-26 only. One season, and the reason the rule above exists.
 *
 * **`defcon_hits_per_start` was re-derived in item 24 and its ceilings did not
 * move.** The axis changed definition — its numerator is now gated on
 * `starts = 1`, so every value fell — which invalidates a frozen threshold the
 * same way a `DEFCON_THRESHOLDS` change would. It was re-derived over this same
 * season and cohort, and both ceilings landed on the rung they were already on:
 * DEF p99 0.705628 → 0.699820 and MID unchanged to six decimals, against rungs
 * of 0.80 and 0.60.
 *
 * **So `supersedes` is deliberately unset on both**, because nothing was
 * superseded; setting it would record a change that did not happen, and
 * `thresholds.test.ts`'s assertion that no axis carries one stays green.
 *
 * That leaves this comment and `docs/items/item-24-dch-per-start-gated.md` as
 * the only record that the re-derivation happened at all — there is no data
 * field for "re-derived, unchanged", and inventing one for a single case would
 * be a shape pretending to information. If the axis is redefined again, redo
 * the derivation rather than assuming this outcome repeats: it held because the
 * affected players sat away from the percentile, not because gating is
 * harmless.
 */
const DCH_SEASONS = ['2025-26'];

/**
 * The eleven axes in canonical order, with the caption each renders under.
 *
 * **Every position's set is built by filtering this list**, below, rather than
 * by being written out separately. That is what makes "a pruned set preserves
 * the relative order" structurally true instead of four hand-maintained arrays
 * that agree today.
 */
const AXIS_POOL: { axis: ComparisonAxisKey; label: string }[] = [
  { axis: 'pts', label: 'Pts' },
  { axis: 'clean_sheets', label: 'CS' },
  { axis: 'goals', label: 'G' },
  { axis: 'minutes', label: 'Min' },
  { axis: 'ppm', label: 'PPM' },
  { axis: 'defcon_hits_per_start', label: 'DCH/St' },
  { axis: 'assists', label: 'A' },
  { axis: 'pts_per_now', label: 'Pts/£' },
  { axis: 'expected_goal_involvements', label: 'xGI' },
  { axis: 'bonus', label: 'Bon' },
  { axis: 'saves', label: 'Sv' },
];

/**
 * Floors and ceilings, per position, keyed by axis.
 *
 * **An axis absent from a position's map does not exist for that position.**
 * Goalkeepers have no goals axis; forwards have neither clean sheets nor
 * `defcon_hits_per_start`. The second is a measurement rather than a
 * convention: 25 of the 28 forwards in the 2025-26 cohort recorded exactly
 * 0.00, with p25 and p75 both 0.00, so the axis would have nine forwards in ten
 * sitting on the floor. It is dropped rather than left unset — an unset ceiling
 * is a number nobody chose, and this is an axis nobody should draw.
 *
 * **Ceilings are p99 rounded up to a friendly number; floors are 0.** Two
 * exceptions, both because the 1,200-minute cohort gate puts the floor
 * somewhere other than zero: `minutes` floors at the gate itself, and `ppm`
 * floors at the cohort's p01.
 *
 * **`minutes` ceilings at 3,420 on every position**, which is the one ceiling
 * not produced by rounding p99 up. 38 matches x 90 minutes is the maximum the
 * competition can produce, and it is the observed max on GK, DEF and MID; the
 * friendly rung above p99 is 4,000, which would leave a sixth of the axis
 * permanently unreachable.
 *
 * **A floor rounds DOWN where a ceiling rounds up**, which matters on two
 * values. GK ppm p01 is 2.278596 and MID's is 1.487931; rounding those to
 * nearest gives 2.28 and 1.49, both *above* the quantile they name, so the
 * floor would clip marginally more than the 1% it claims to. Rounding is
 * directional, and the safe direction for a floor is the opposite of a
 * ceiling's.
 */
const BOUNDS: Record<ComparisonPosition, Partial<Record<ComparisonAxisKey, [number, number]>>> = {
  GK: {
    pts: [0, 200],
    clean_sheets: [0, 20],
    minutes: [1200, 3420],
    ppm: [2.27, 5],
    pts_per_now: [0, 40],
    bonus: [0, 25],
    saves: [0, 200],
  },
  DEF: {
    pts: [0, 200],
    clean_sheets: [0, 20],
    goals: [0, 5],
    minutes: [1200, 3420],
    ppm: [1.14, 6],
    defcon_hits_per_start: [0, 0.8],
    assists: [0, 10],
    pts_per_now: [0, 40],
    expected_goal_involvements: [0, 10],
    bonus: [0, 25],
  },
  MID: {
    pts: [0, 250],
    clean_sheets: [0, 20],
    goals: [0, 20],
    minutes: [1200, 3420],
    ppm: [1.48, 8],
    defcon_hits_per_start: [0, 0.6],
    assists: [0, 15],
    pts_per_now: [0, 30],
    expected_goal_involvements: [0, 30],
    bonus: [0, 30],
  },
  FWD: {
    pts: [0, 250],
    goals: [0, 30],
    minutes: [1200, 3420],
    ppm: [1.73, 8],
    assists: [0, 15],
    pts_per_now: [0, 30],
    expected_goal_involvements: [0, 30],
    bonus: [0, 50],
  },
};

/**
 * The cohort each position's axes were derived over.
 *
 * Three numbers per position, because three availability regimes exist: most
 * axes have all ten seasons, xGI has three and DCH/St has one. They are the
 * count of player-seasons clearing 1,200 minutes over the seasons named, not
 * the count of rows carrying a value — every cohort member has a value for
 * every axis its position draws, which was checked in step 1 rather than
 * assumed.
 */
const COHORT: Record<ComparisonPosition, { all: number; xgi: number; dch: number }> = {
  GK: { all: 223, xgi: 0, dch: 0 },
  DEF: { all: 1064, xgi: 311, dch: 109 },
  MID: { all: 1231, xgi: 377, dch: 126 },
  FWD: { all: 309, xgi: 85, dch: 0 },
};

function derivationFor(position: ComparisonPosition, axis: ComparisonAxisKey): AxisDerivation {
  const cohort = COHORT[position];
  if (axis === 'expected_goal_involvements') return { seasons: XGI_SEASONS, cohort: cohort.xgi };
  if (axis === 'defcon_hits_per_start') return { seasons: DCH_SEASONS, cohort: cohort.dch };
  return { seasons: ALL_TEN, cohort: cohort.all };
}

const POSITIONS: ComparisonPosition[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * The axis set each position draws, in canonical order.
 *
 * GK draws 7, DEF and MID draw the same 10, FWD draws 8.
 */
export const COMPARISON_THRESHOLDS: Record<ComparisonPosition, AxisThreshold[]> = Object.fromEntries(
  POSITIONS.map((position) => [
    position,
    AXIS_POOL.filter(({ axis }) => BOUNDS[position][axis] !== undefined).map(({ axis, label }) => {
      const [floor, ceiling] = BOUNDS[position][axis]!;
      return { axis, label, floor, ceiling, derivedFrom: derivationFor(position, axis) };
    }),
  ])
) as Record<ComparisonPosition, AxisThreshold[]>;

/** True where the re-derivation rule applies — fewer than five seasons behind it. */
export function isReDerivable(threshold: AxisThreshold): boolean {
  return threshold.derivedFrom.seasons.length < RE_DERIVE_BELOW_SEASONS;
}

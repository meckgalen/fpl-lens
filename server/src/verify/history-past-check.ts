/**
 * The `history_past` cross-check, run over every reachable player in all ten
 * CSV-backfilled seasons.
 *
 * Run: npm run verify:history-past   (add --refresh to bypass the cache)
 *
 * **Read-only.** It opens the pool, runs one aggregate query and prints. It
 * writes nothing to the database and nothing to the repository except a cache
 * of the API responses under `data/raw/`, which is gitignored.
 *
 * ## What it compares, and why that is worth anything
 *
 * `player_gameweeks` was loaded from the vaastav CSVs. FPL's own
 * `element-summary/{id}/history_past` carries whole-season totals for the same
 * player-seasons and is a completely different pipeline — it is the only
 * prior-season data the official API exposes, and the reason the CSV backfill
 * exists at all. Summing our per-match rows per player-season and diffing
 * against those totals is therefore a check whose derivation is not shared with
 * the thing it checks.
 *
 * Item 5 ran it over 60 players in two seasons and found two things: a
 * `defensive_contribution` gap in 2024-25 (44 of 60), and one player, Maguire,
 * disagreeing on the ICT family in 2024-25 with the cause "not established".
 * This is the run that establishes it.
 *
 * ## The buckets, which are the hypothesis
 *
 * A manual comparison of three players across all their seasons found xGC, xA
 * and xGI drifting in 2022-23 alongside the ICT family, while BPS did not drift
 * anywhere. That is a predicted pattern rather than a coincidence:
 *
 * - **Non-scoring derived** stats — the ICT family and the expected family —
 *   award no points. FPL can recompute them from a resupplied Opta feed at any
 *   time and nothing settled changes.
 * - **Scoring** stats cannot be revised. Bonus points are awarded from BPS, and
 *   changing any of them retroactively would alter finished FPL scores, leagues
 *   and seasons.
 *
 * So the hypothesis is: **drift is confined to the non-scoring bucket, in every
 * season.** A single disagreement in the scoring bucket falsifies it, and the
 * run prints every one of them in full rather than counting them.
 *
 * The defensive quartet is neither: we hold it for 2016-17..2018-19 and 2025-26
 * and NULL for the six between (rule 6), and FPL retro-computed
 * `defensive_contribution` for 2024-25 without publishing its components. It is
 * a known gap in what we hold, so it is measured and reported on its own rather
 * than counted as drift.
 *
 * ## Direction
 *
 * Every drift found by hand had ours LOWER than FPL's. Revision that is simply
 * a later, better data pull should go both ways, so a consistent direction is
 * the strongest available clue about the cause. Every disagreement is therefore
 * reported with its sign and its percentage, not just its count.
 *
 * ## Rule 6, and what is not a disagreement
 *
 * `history_past` reports 0 for a stat that season never measured — `starts`
 * before 2022-23, the expected family before 2022-23, the defensive quartet in
 * the six seasons it is missing. We store NULL there. Ours-NULL against
 * theirs-0 is the two sources agreeing that nobody measured it, and is counted
 * as such. Ours-NULL against theirs-NONZERO is a real gap in what we hold, and
 * that is the 2024-25 defensive_contribution finding.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from '../db/pool.js';
import { getBootstrap } from '../services/fplApi.js';
import { numOrNull } from '../repositories/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
// server/src/verify -> server/src -> server -> repo root
const repoRoot = join(here, '..', '..', '..');
const CACHE_PATH = join(repoRoot, 'data', 'raw', 'history-past-cache.json');

const FPL_BASE = 'https://fantasy.premierleague.com/api';
/** Same figure the gameweek sync uses: 564 requests, politely. */
const CONCURRENCY = 5;

/** The ten seasons the CSV backfill owns. 2026-27 has no match rows to sum. */
const CSV_SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
  '2024-25',
  '2025-26',
] as const;

// ------------------------------------------------------------- the buckets

/**
 * Awards no points, so FPL is free to recompute it. The hypothesis says every
 * drift lives here.
 */
const NON_SCORING_DERIVED = [
  'influence',
  'creativity',
  'threat',
  'ict_index',
  'expected_goals',
  'expected_assists',
  'expected_goal_involvements',
  'expected_goals_conceded',
] as const;

/**
 * Feeds the score. BPS awards bonus points; the rest are the score itself.
 * Revising any of these would alter settled results, so FPL cannot.
 */
const SCORING_FROZEN = [
  'total_points',
  'minutes',
  'goals_scored',
  'assists',
  'clean_sheets',
  'goals_conceded',
  'own_goals',
  'penalties_saved',
  'penalties_missed',
  'yellow_cards',
  'red_cards',
  'saves',
  'bonus',
  'bps',
  'starts',
] as const;

/** The known gap. Reported on its own, never folded into the drift count. */
const DEFENSIVE = [
  'tackles',
  'recoveries',
  'clearances_blocks_interceptions',
  'defensive_contribution',
] as const;

type Column = (typeof NON_SCORING_DERIVED | typeof SCORING_FROZEN | typeof DEFENSIVE)[number];

const BUCKETS = [
  { name: 'non-scoring derived', columns: NON_SCORING_DERIVED },
  { name: 'scoring and frozen', columns: SCORING_FROZEN },
  { name: 'defensive quartet', columns: DEFENSIVE },
] as const;

const ALL_COMPARED: readonly Column[] = [
  ...NON_SCORING_DERIVED,
  ...SCORING_FROZEN,
  ...DEFENSIVE,
];

/**
 * Fields in `history_past` that are not stats to compare: identity, and the two
 * price columns, which live on `player_seasons` rather than on any match row.
 */
const NOT_A_STAT = new Set(['season_name', 'element_code', 'start_cost', 'end_cost']);

/**
 * Half a unit in the last place FPL publishes, per decimal column.
 *
 * Our totals are sums of per-match values that the CSV already rounded, so a
 * total can differ from FPL's by accumulated rounding without either side being
 * wrong. Anything inside `matches x halfUlp` is reported as within rounding and
 * kept out of the drift count; everything beyond it is drift. Both counts are
 * printed, so nothing is hidden by the choice.
 */
const HALF_ULP: Partial<Record<Column, number>> = {
  influence: 0.05,
  creativity: 0.05,
  threat: 0.05,
  ict_index: 0.05,
  expected_goals: 0.005,
  expected_assists: 0.005,
  expected_goal_involvements: 0.005,
  expected_goals_conceded: 0.005,
};

// ------------------------------------------------------------------ types

/** One `history_past` entry, indexed because we compare every stat it carries. */
type PastRow = Record<string, string | number>;

interface Cache {
  fetchedAt: string;
  /** element code -> its history_past rows. */
  past: Record<string, PastRow[]>;
}

/** One player-season as we hold it. Null means the season never measured it. */
interface OurTotals {
  code: number;
  season: string;
  matches: number;
  stats: Partial<Record<Column, number | null>>;
}

interface Disagreement {
  code: number;
  season: string;
  column: Column;
  ours: number;
  theirs: number;
  diff: number;
  /** Never null: a `theirs` of 0 is a reverse gap, not a disagreement. */
  pct: number;
  beyondRounding: boolean;
}

/** Ours NULL where FPL reports a real number: a hole, not a drift. */
interface Gap {
  code: number;
  season: string;
  column: Column;
  theirs: number;
}

/**
 * The same thing pointing the other way: we hold a measured total and
 * `history_past` reports 0.
 *
 * Kept out of the drift count because it is not a disagreement about a value,
 * it is one side not carrying the column at all. It is what the pre-2019 Opta
 * feed looks like from FPL's side.
 */
interface ReverseGap {
  code: number;
  season: string;
  column: Column;
  ours: number;
}

// ------------------------------------------------------------------ fetch

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/**
 * Every player the API will still talk about: the current bootstrap's roster.
 *
 * That is exactly what "reachable" means, and it is the check's one structural
 * bias. `history_past` is served off an element, and an element exists only for
 * a player in this season's game, so a player who has left the Premier League
 * is unreachable however many seasons of ours he appears in. The coverage
 * table below reports the split per season rather than leaving it implied.
 */
async function fetchAllPast(refresh: boolean): Promise<Cache> {
  if (!refresh && existsSync(CACHE_PATH)) {
    const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Cache;
    console.log(
      `Using cached history_past for ${Object.keys(cached.past).length} players ` +
        `(fetched ${cached.fetchedAt}). Pass --refresh to re-fetch.`
    );
    return cached;
  }

  const bootstrap = await getBootstrap();
  const elements = bootstrap.elements.map((e) => ({ id: e.id, code: e.code }));
  console.log(`Fetching history_past for ${elements.length} elements at concurrency ${CONCURRENCY}...`);

  const past: Record<string, PastRow[]> = {};
  const queue = [...elements];
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const el = queue.pop();
      if (el === undefined) return;
      const summary = await fetchJson<{ history_past: PastRow[] }>(
        `${FPL_BASE}/element-summary/${el.id}/`
      );
      past[String(el.code)] = summary.history_past;
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${elements.length}`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const cache: Cache = { fetchedAt: new Date().toISOString(), past };
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
  console.log(`Fetched ${Object.keys(past).length} players; cached at ${CACHE_PATH}`);
  return cache;
}

// --------------------------------------------------------------- our side

/**
 * Our totals, summed the way the career query sums them: a bare `sum()`, which
 * yields NULL when every row is NULL and so preserves rule 6 through the
 * aggregate. Reproducing the app's own arithmetic is the point — a check that
 * summed differently would be checking something we do not serve.
 */
async function fetchOurTotals(): Promise<Map<string, OurTotals>> {
  const sums = ALL_COMPARED.map((c) => `sum(pg.${c}) as ${c}`).join(',\n         ');
  const { rows } = await pool.query<Record<string, string | number | null>>(
    `select p.fpl_code as code,
            pg.season,
            count(*) as matches,
            ${sums}
       from player_gameweeks pg
       join players p on p.id = pg.player_id
      where pg.season = any($1)
      group by p.fpl_code, pg.season`,
    [CSV_SEASONS]
  );

  const out = new Map<string, OurTotals>();
  for (const row of rows) {
    const code = Number(row.code);
    const season = String(row.season);
    const stats: Partial<Record<Column, number | null>> = {};
    for (const column of ALL_COMPARED) {
      stats[column] = numOrNull(row[column] as string | number | null, column);
    }
    out.set(`${code}|${season}`, {
      code,
      season,
      matches: Number(row.matches),
      stats,
    });
  }
  return out;
}

/**
 * Every fixture with a hole, and every player-season that appeared in one.
 *
 * The second half is what turns "the source has holes" into an attribution: a
 * player who never took the field in a holed fixture cannot have lost anything
 * to it, so if the drift were caused by something else, it would show up on
 * those players too.
 */
async function fetchBlankFixtures(): Promise<{
  blanks: Map<string, BlankFixture>;
  /** `code|season` -> the fixture ids that player appeared in. */
  appearances: Map<string, number[]>;
  startsAnomalies: StartsAnomaly[];
}> {
  const zeroFlags = HOLE_DETECTABLE.map((c) => `sum(${c}) = 0 as ${c}`).join(',\n           ');
  const { rows } = await pool.query<Record<string, unknown>>(
    `select season, min(gw) as gw, fixture_id, sum(starts) as starts_total,
            ${zeroFlags}
       from player_gameweeks
      group by season, fixture_id
     having sum(minutes) > 0`
  );

  const blanks = new Map<string, BlankFixture>();
  const startsAnomalies: StartsAnomaly[] = [];
  for (const row of rows) {
    const startsTotal = row.starts_total === null ? null : Number(row.starts_total);
    if (startsTotal !== null && startsTotal !== 0 && startsTotal !== 22) {
      startsAnomalies.push({
        season: String(row.season),
        gw: row.gw === null ? null : Number(row.gw),
        fixtureId: Number(row.fixture_id),
        starts: startsTotal,
      });
    }
    const columns = new Set<Column>();
    for (const column of HOLE_DETECTABLE) {
      if (row[column] === true) columns.add(column);
    }
    if (columns.size === 0) continue;
    const fixtureId = Number(row.fixture_id);
    blanks.set(`${row.season}|${fixtureId}`, {
      season: String(row.season),
      gw: row.gw === null ? null : Number(row.gw),
      fixtureId,
      columns,
    });
  }

  const appearances = new Map<string, number[]>();
  const { rows: appRows } = await pool.query<{ code: string; season: string; fixture_id: number }>(
    `select p.fpl_code as code, pg.season, pg.fixture_id
       from player_gameweeks pg
       join players p on p.id = pg.player_id
      where pg.minutes > 0`
  );
  for (const row of appRows) {
    const key = `${Number(row.code)}|${row.season}`;
    const list = appearances.get(key);
    if (list) list.push(Number(row.fixture_id));
    else appearances.set(key, [Number(row.fixture_id)]);
  }

  return { blanks, appearances, startsAnomalies };
}

/**
 * The same hole one row down: a full appearance registering zero influence,
 * zero creativity AND zero threat.
 *
 * The fixture-level detector only fires when a whole match is blank, and it
 * leaves a residue in seasons where the source lost individual rows instead.
 * Each of the three is zero often enough on its own to mean nothing — influence
 * alone is zero on 2-4% of hour-long appearances in every season — but all
 * three at once, for an hour on the pitch, is not.
 *
 * **This one is a strong signal rather than a certainty, and the report prints
 * the baseline that says how strong.** Clean seasons carry 2 to 6 such rows out
 * of about 7,900; the dirty ones carry tens or hundreds. So a handful of the
 * rows it flags may be genuine nothing-happened appearances, and a season whose
 * count is in single figures should be read as noise.
 */
async function fetchHoledRows(): Promise<{
  /** `code|season` -> how many such rows that player-season has. */
  byPlayer: Map<string, number>;
  /** season -> [rows, players]. */
  bySeason: Map<string, { rows: number; players: number }>;
}> {
  const { rows } = await pool.query<{ code: string; season: string; n: string }>(
    `select p.fpl_code as code, pg.season, count(*) as n
       from player_gameweeks pg
       join players p on p.id = pg.player_id
      where pg.minutes >= 60
        and pg.influence = 0 and pg.creativity = 0 and pg.threat = 0
      group by p.fpl_code, pg.season`
  );
  const byPlayer = new Map<string, number>();
  const bySeason = new Map<string, { rows: number; players: number }>();
  for (const row of rows) {
    byPlayer.set(`${Number(row.code)}|${row.season}`, Number(row.n));
    const s = bySeason.get(row.season) ?? { rows: 0, players: 0 };
    s.rows += Number(row.n);
    s.players += 1;
    bySeason.set(row.season, s);
  }
  return { byPlayer, bySeason };
}

type Attribution = 'blank fixture' | 'blank row' | 'unexplained';

/**
 * Where a drift could have come from, most specific first.
 *
 * "Blank fixture" is the strong one: 22 players took the field and the column
 * totals zero. "Blank row" is the row-level version, which only applies to the
 * ICT family because that is what it detects. Anything else is unexplained, and
 * that number is the honest residue this whole run exists to shrink.
 */
function attribute(
  d: Disagreement,
  blanks: Map<string, BlankFixture>,
  appearances: Map<string, number[]>,
  holedRows: Map<string, number>
): Attribution {
  const played = appearances.get(`${d.code}|${d.season}`) ?? [];
  for (const fixtureId of played) {
    const blank = blanks.get(`${d.season}|${fixtureId}`);
    if (blank?.columns.has(d.column)) return 'blank fixture';
  }
  const ictFamily: readonly string[] = ['influence', 'creativity', 'threat', 'ict_index'];
  if (ictFamily.includes(d.column) && (holedRows.get(`${d.code}|${d.season}`) ?? 0) > 0) {
    return 'blank row';
  }
  return 'unexplained';
}

// -------------------------------------------------------------- compare

/** `2018/19` on the wire, `2018-19` everywhere in this codebase (rule 8). */
function normaliseSeason(name: string): string {
  const [start, endShort] = name.split('/');
  return `${start}-${endShort}`;
}

function theirValue(row: PastRow, column: Column): number {
  const raw = row[column];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`history_past.${column}: expected a number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * A fixture where one column is zero on every row while the match was
 * unmistakably played.
 *
 * This is the shape a hole in the source takes. The vaastav scraper writes a
 * round's file once, and where a column was not being collected yet — or the
 * scrape ran before FPL published it — every row carries `0` rather than an
 * empty cell. Zero asserts a measurement nobody took, which is rule 6 violated
 * at source, and it is invisible to every check we have: the row is present,
 * the count is right, `count(col)` equals `count(*)`, and the total is simply
 * short.
 *
 * Detected from our own stored rows rather than from the CSVs, so it describes
 * what the database actually holds.
 *
 * **Only nine columns are checked, and the reason is the competition rather
 * than the data.** `starts` totals exactly 22 on any played fixture, eleven a
 * side, by the laws of the game. The ICT family scores almost every action, so
 * a match totals hundreds. The expected family accrues to all 22 players from
 * the first shot faced — `expected_goals_conceded` especially, which every
 * player on the pitch shares in. A played fixture totalling exactly zero in any
 * of those is not a football result.
 *
 * Every other column can legitimately be zero across a whole match: a 0-0 with
 * no cards, no own goals and no saved penalties is an ordinary Tuesday. **So a
 * hole in one of those is undetectable this way**, and that limit is stated
 * rather than hidden — the attribution below can only ever be as wide as this
 * list.
 */
const HOLE_DETECTABLE: readonly Column[] = [...NON_SCORING_DERIVED, 'starts'];

interface BlankFixture {
  season: string;
  gw: number | null;
  fixtureId: number;
  columns: Set<Column>;
}

/**
 * Fixtures where `starts` is neither 0 nor 22.
 *
 * The same law of the game read the other way: where the column is populated at
 * all it must total exactly 22, so anything else is a row missing from the
 * fixture rather than a hole in a column. Nothing else in this codebase checks
 * it, and it costs one more aggregate over a query already being run.
 */
interface StartsAnomaly {
  season: string;
  gw: number | null;
  fixtureId: number;
  starts: number;
}

interface Comparison {
  disagreements: Disagreement[];
  gaps: Gap[];
  reverseGaps: ReverseGap[];
  /** Ours NULL and theirs 0: the two sources agreeing nobody measured it. */
  agreedAbsent: number;
  /** Player-seasons compared, per season. */
  pairs: Map<string, number>;
  /** In our database, not reachable through any current element. */
  unreachable: Map<string, number>;
  /** Reachable, FPL reports minutes, and we hold no rows at all. */
  missingFromUs: { code: number; season: string; minutes: number }[];
}

function compare(cache: Cache, ours: Map<string, OurTotals>): Comparison {
  const disagreements: Disagreement[] = [];
  const gaps: Gap[] = [];
  const reverseGaps: ReverseGap[] = [];
  const pairs = new Map<string, number>();
  const unreachable = new Map<string, number>();
  const missingFromUs: Comparison['missingFromUs'] = [];
  let agreedAbsent = 0;

  const seen = new Set<string>();

  for (const [codeStr, rows] of Object.entries(cache.past)) {
    const code = Number(codeStr);
    for (const row of rows) {
      const season = normaliseSeason(String(row.season_name));
      if (!(CSV_SEASONS as readonly string[]).includes(season)) continue;

      assertColumnsCovered(row);

      const key = `${code}|${season}`;
      const mine = ours.get(key);
      if (!mine) {
        const minutes = theirValue(row, 'minutes');
        if (minutes > 0) missingFromUs.push({ code, season, minutes });
        continue;
      }
      seen.add(key);
      pairs.set(season, (pairs.get(season) ?? 0) + 1);

      for (const column of ALL_COMPARED) {
        const theirs = theirValue(row, column);
        const mineValue = mine.stats[column];

        if (mineValue === null || mineValue === undefined) {
          if (theirs === 0) agreedAbsent++;
          else gaps.push({ code, season, column, theirs });
          continue;
        }

        const diff = mineValue - theirs;
        if (diff === 0) continue;

        // The rounding envelope applies before any classification: a total of
        // 0.009 against a reported 0 is two sources agreeing, not one of them
        // missing a column.
        const envelope = (HALF_ULP[column] ?? 0) * mine.matches;
        if (theirs === 0) {
          if (Math.abs(diff) > envelope) {
            reverseGaps.push({ code, season, column, ours: mineValue });
          }
          continue;
        }

        disagreements.push({
          code,
          season,
          column,
          ours: mineValue,
          theirs,
          diff,
          pct: (diff / Math.abs(theirs)) * 100,
          beyondRounding: Math.abs(diff) > envelope,
        });
      }
    }
  }

  for (const [key, mine] of ours) {
    if (!seen.has(key)) {
      unreachable.set(mine.season, (unreachable.get(mine.season) ?? 0) + 1);
    }
  }

  return { disagreements, gaps, reverseGaps, agreedAbsent, pairs, unreachable, missingFromUs };
}

/**
 * The bucket list must account for every stat `history_past` carries.
 *
 * If FPL adds a column, the run stops here rather than quietly comparing 27 of
 * 28 and reporting a clean season. Derived from the payload, not from our
 * schema, so it is the upstream that has to stay still.
 */
let columnsChecked = false;
function assertColumnsCovered(row: PastRow): void {
  if (columnsChecked) return;
  const theirStats = Object.keys(row).filter((k) => !NOT_A_STAT.has(k));
  const mine = new Set<string>(ALL_COMPARED);
  const missing = theirStats.filter((k) => !mine.has(k));
  const extra = [...mine].filter((k) => !theirStats.includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `history_past columns do not match the buckets. ` +
        `In the payload and unbucketed: [${missing}]. Bucketed and absent: [${extra}].`
    );
  }
  columnsChecked = true;
}

// --------------------------------------------------------------- report

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function fmt(n: number, dp = 2): string {
  return Number.isFinite(n) ? n.toFixed(dp) : '—';
}

function bucketOf(column: Column): string {
  for (const b of BUCKETS) {
    if ((b.columns as readonly string[]).includes(column)) return b.name;
  }
  return 'unknown';
}

function report(
  c: Comparison,
  ours: Map<string, OurTotals>,
  blanks: Map<string, BlankFixture>,
  appearances: Map<string, number[]>,
  startsAnomalies: StartsAnomaly[],
  holedRows: { byPlayer: Map<string, number>; bySeason: Map<string, { rows: number; players: number }> }
): boolean {
  const drift = c.disagreements.filter((d) => d.beyondRounding);
  const withinRounding = c.disagreements.length - drift.length;
  const attributed = new Map<Disagreement, Attribution>(
    drift.map((d) => [d, attribute(d, blanks, appearances, holedRows.byPlayer)])
  );
  const isExplained = (d: Disagreement): boolean => attributed.get(d) !== 'unexplained';

  console.log('\n=== Coverage =======================================================');
  console.log('season    ours  reachable  unreachable   %reach');
  for (const season of CSV_SEASONS) {
    const total = [...ours.values()].filter((o) => o.season === season).length;
    const reach = c.pairs.get(season) ?? 0;
    const un = c.unreachable.get(season) ?? 0;
    console.log(
      `${season}  ${String(total).padStart(4)}  ${String(reach).padStart(9)}  ` +
        `${String(un).padStart(11)}  ${fmt((reach / total) * 100, 1).padStart(6)}%`
    );
  }
  if (c.missingFromUs.length) {
    console.log(
      `\n!! ${c.missingFromUs.length} player-seasons where FPL reports minutes and we hold no rows:`
    );
    for (const m of c.missingFromUs.slice(0, 20)) {
      console.log(`   code ${m.code} ${m.season}: ${m.minutes} minutes`);
    }
  } else {
    console.log('\nNo reachable player-season with FPL minutes is missing from our rows.');
  }

  console.log('\n=== Disagreements by bucket and season ==============================');
  console.log(
    'A cell is one (player, season, column). "drift" is a disagreement beyond the'
  );
  console.log('rounding envelope; "rnd" is one inside it. low/high is ours vs FPL.\n');
  console.log('season    bucket                 cells    drift   rnd    low   high');
  for (const season of CSV_SEASONS) {
    for (const b of BUCKETS) {
      const cells = (c.pairs.get(season) ?? 0) * b.columns.length;
      const inBucket = drift.filter(
        (d) => d.season === season && (b.columns as readonly string[]).includes(d.column)
      );
      const rnd = c.disagreements.filter(
        (d) =>
          !d.beyondRounding &&
          d.season === season &&
          (b.columns as readonly string[]).includes(d.column)
      ).length;
      const low = inBucket.filter((d) => d.diff < 0).length;
      const high = inBucket.filter((d) => d.diff > 0).length;
      console.log(
        `${season}  ${b.name.padEnd(20)}  ${String(cells).padStart(6)}  ` +
          `${String(inBucket.length).padStart(6)}  ${String(rnd).padStart(4)}  ` +
          `${String(low).padStart(5)}  ${String(high).padStart(5)}`
      );
    }
  }

  console.log('\n=== Non-scoring derived: direction and size =========================');
  console.log('season    column                          n     low    high   min%   med%   max%');
  for (const season of CSV_SEASONS) {
    for (const column of NON_SCORING_DERIVED) {
      const ds = drift.filter((d) => d.season === season && d.column === column);
      if (ds.length === 0) continue;
      const pcts = ds.map((d) => d.pct).sort((a, b) => a - b);
      console.log(
        `${season}  ${column.padEnd(28)}  ${String(ds.length).padStart(4)}  ` +
          `${String(ds.filter((d) => d.diff < 0).length).padStart(5)}  ` +
          `${String(ds.filter((d) => d.diff > 0).length).padStart(5)}  ` +
          `${fmt(percentile(pcts, 0), 1).padStart(6)} ${fmt(percentile(pcts, 50), 1).padStart(6)} ` +
          `${fmt(percentile(pcts, 100), 1).padStart(6)}`
      );
    }
  }

  console.log('\n=== Defensive quartet: what we do not hold ==========================');
  console.log('Ours NULL where FPL reports a non-zero total. Rule 6 says NULL means');
  console.log('"not measured"; these are the cells where FPL measured it anyway.\n');
  console.log('season    column                          gaps    max   median');
  for (const season of CSV_SEASONS) {
    for (const column of DEFENSIVE) {
      const gs = c.gaps.filter((g) => g.season === season && g.column === column);
      if (gs.length === 0) continue;
      const vals = gs.map((g) => g.theirs).sort((a, b) => a - b);
      console.log(
        `${season}  ${column.padEnd(28)}  ${String(gs.length).padStart(4)}  ` +
          `${String(vals[vals.length - 1]).padStart(6)}  ${String(percentile(vals, 50)).padStart(6)}`
      );
    }
  }
  const otherGaps = c.gaps.filter((g) => !(DEFENSIVE as readonly string[]).includes(g.column));
  if (otherGaps.length) {
    console.log(`\n!! ${otherGaps.length} gaps OUTSIDE the defensive quartet:`);
    for (const g of otherGaps.slice(0, 30)) {
      console.log(`   code ${g.code} ${g.season} ${g.column}: FPL ${g.theirs}, ours NULL`);
    }
  } else {
    console.log('\nNo gap outside the defensive quartet.');
  }

  console.log('\n=== The gap pointing the other way =================================');
  console.log('We hold a measured total and history_past reports 0 — one side not');
  console.log('carrying the column at all, rather than the two disagreeing on it.\n');
  console.log('season    column                          cells  players     max');
  for (const season of CSV_SEASONS) {
    for (const column of ALL_COMPARED) {
      const rs = c.reverseGaps.filter((g) => g.season === season && g.column === column);
      if (rs.length === 0) continue;
      console.log(
        `${season}  ${column.padEnd(28)}  ${String(rs.length).padStart(5)}  ` +
          `${String(new Set(rs.map((r) => r.code)).size).padStart(7)}  ` +
          `${String(Math.max(...rs.map((r) => r.ours))).padStart(6)}`
      );
    }
  }

  console.log('\n=== Holes in the source ============================================');
  console.log('Fixtures where a column is 0 on every row of a match that was played.');
  console.log('Detected from our stored rows; see BlankFixture for why this is a hole');
  console.log('and not a result.\n');
  console.log('season    gw   fixtures  columns');
  const holeGroups = new Map<string, { gw: number | null; season: string; n: number }>();
  for (const b of blanks.values()) {
    const key = `${b.season}|${b.gw}|${[...b.columns].sort().join(',')}`;
    const g = holeGroups.get(key);
    if (g) g.n++;
    else holeGroups.set(key, { gw: b.gw, season: b.season, n: 1 });
  }
  for (const [key, g] of [...holeGroups].sort()) {
    const columns = key.split('|')[2].split(',');
    console.log(
      `${g.season}  ${String(g.gw).padStart(2)}   ${String(g.n).padStart(8)}  ${columns.join(', ')}`
    );
  }

  if (startsAnomalies.length === 0) {
    console.log(
      '\nEvery played fixture totals 0 or exactly 22 starts — eleven a side, or the hole.'
    );
  } else {
    console.log(`\n!! ${startsAnomalies.length} played fixtures whose starts total is neither 0 nor 22:`);
    for (const a of startsAnomalies.slice(0, 20)) {
      console.log(`   ${a.season} gw ${a.gw} fixture ${a.fixtureId}: ${a.starts}`);
    }
  }

  console.log('\n=== Blank rows: the same hole one row down ==========================');
  console.log('Appearances of 60 minutes or more registering zero influence, zero');
  console.log('creativity AND zero threat. Read the count against the clean seasons:');
  console.log('single figures is the baseline, not a finding.\n');
  console.log('season     rows  players');
  for (const season of CSV_SEASONS) {
    const s = holedRows.bySeason.get(season) ?? { rows: 0, players: 0 };
    console.log(`${season}  ${String(s.rows).padStart(7)}  ${String(s.players).padStart(7)}`);
  }

  console.log('\n=== Attribution ====================================================');
  console.log('Where each drift could have come from, most specific first. A blank');
  console.log('fixture is proof the source lost that column for that match; a blank');
  console.log('row is the same signal per appearance, and is strong rather than');
  console.log('certain — see fetchHoledRows.\n');
  console.log('season    bucket                 drift  fixture     row  unexplained');
  for (const season of CSV_SEASONS) {
    for (const b of BUCKETS) {
      const ds = drift.filter(
        (d) => d.season === season && (b.columns as readonly string[]).includes(d.column)
      );
      if (ds.length === 0) continue;
      const byFixture = ds.filter((d) => attributed.get(d) === 'blank fixture').length;
      const byRow = ds.filter((d) => attributed.get(d) === 'blank row').length;
      console.log(
        `${season}  ${b.name.padEnd(20)}  ${String(ds.length).padStart(6)}  ` +
          `${String(byFixture).padStart(7)}  ${String(byRow).padStart(6)}  ` +
          `${String(ds.length - byFixture - byRow).padStart(11)}`
      );
    }
  }
  const unexplained = drift.filter((d) => !isExplained(d));
  console.log(
    `\nUnexplained: ${unexplained.length} of ${drift.length}. ` +
      `Direction: ${unexplained.filter((d) => d.diff < 0).length} low, ` +
      `${unexplained.filter((d) => d.diff > 0).length} high.`
  );
  const bySeason = new Map<string, Disagreement[]>();
  for (const d of unexplained) bySeason.set(d.season, [...(bySeason.get(d.season) ?? []), d]);
  for (const [season, ds] of [...bySeason].sort()) {
    const players = new Set(ds.map((d) => d.code));
    const pcts = ds.map((d) => Math.abs(d.pct)).sort((a, b) => a - b);
    console.log(
      `  ${season}: ${ds.length} cells over ${players.size} players ` +
        `(${[...new Set(ds.map((d) => d.column))].join(', ')}), ` +
        `|pct| median ${fmt(percentile(pcts, 50), 1)}%, max ${fmt(percentile(pcts, 100), 1)}%`
    );
  }

  console.log('\n=== The hypothesis =================================================');
  const scoringDrift = drift.filter((d) =>
    (SCORING_FROZEN as readonly string[]).includes(d.column)
  );
  console.log(
    `Cells compared: ${(
      [...c.pairs.values()].reduce((a, b) => a + b, 0) * ALL_COMPARED.length
    ).toLocaleString()}. ` +
      `Agreed absent (rule 6): ${c.agreedAbsent.toLocaleString()}. ` +
      `Gaps: ${c.gaps.length.toLocaleString()}.`
  );
  console.log(
    `Disagreements: ${c.disagreements.length.toLocaleString()} — ` +
      `${drift.length.toLocaleString()} drift, ${withinRounding.toLocaleString()} within rounding.`
  );
  console.log(
    `Direction of drift: ${drift.filter((d) => d.diff < 0).length.toLocaleString()} low, ` +
      `${drift.filter((d) => d.diff > 0).length.toLocaleString()} high.`
  );

  if (scoringDrift.length === 0) {
    console.log('\nCONFIRMED: every drift is in the non-scoring derived bucket.');
    return true;
  }
  const scoringUnexplained = scoringDrift.filter((d) => !isExplained(d));
  console.log(
    `\nFALSIFIED: ${scoringDrift.length} disagreements in the scoring bucket, ` +
      `${scoringUnexplained.length} of them not attributable to a hole in the source. ` +
      `Every one, in full:`
  );
  const byColumn = new Map<string, Disagreement[]>();
  for (const d of scoringDrift) {
    byColumn.set(d.column, [...(byColumn.get(d.column) ?? []), d]);
  }
  for (const [column, ds] of byColumn) {
    console.log(`\n  ${column} (${bucketOf(column as Column)}), ${ds.length}:`);
    for (const d of ds.slice(0, 12)) {
      console.log(
        `    code ${d.code} ${d.season}: ours ${d.ours}, FPL ${d.theirs} (${
          d.diff > 0 ? '+' : ''
        }${d.diff})${isExplained(d) ? ' [hole]' : ' [UNEXPLAINED]'}`
      );
    }
    if (ds.length > 12) console.log(`    ... and ${ds.length - 12} more`);
  }
  return false;
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const cache = await fetchAllPast(refresh);
  const ours = await fetchOurTotals();
  console.log(`Our side: ${ours.size.toLocaleString()} player-seasons across ${CSV_SEASONS.length} seasons.`);
  const comparison = compare(cache, ours);
  const { blanks, appearances, startsAnomalies } = await fetchBlankFixtures();
  const holedRows = await fetchHoledRows();
  const confirmed = report(comparison, ours, blanks, appearances, startsAnomalies, holedRows);
  await closePool();
  process.exitCode = confirmed ? 0 : 1;
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

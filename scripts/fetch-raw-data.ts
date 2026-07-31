/**
 * Phase 0, step 1: fetch historical FPL CSVs.
 *
 * Downloads the three per-season files from the vaastav/Fantasy-Premier-League
 * mirror into data/raw/{season}/, for 2016-17 through 2025-26.
 *
 *   players_raw.csv      -> data/raw/{season}/players_raw.csv
 *   teams.csv            -> data/raw/{season}/teams.csv
 *   gws/merged_gw.csv    -> data/raw/{season}/gws/merged_gw.csv
 *
 * Behaviour required by CLAUDE.md:
 *   - Skip files already present on disk (no re-download).
 *   - Log 404s and keep going; a missing file must not fail the run. Early
 *     seasons legitimately have no teams.csv.
 *
 * Run: npx tsx scripts/fetch-raw-data.ts
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_BASE =
  'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';

const SEASONS = [
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
];

// Files relative to a season directory, both remotely and on disk.
const FILES = ['players_raw.csv', 'teams.csv', 'gws/merged_gw.csv'];

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ROOT = join(PROJECT_ROOT, 'data', 'raw');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type Outcome = 'downloaded' | 'skipped' | 'missing' | 'error';

async function fetchOne(season: string, relPath: string): Promise<Outcome> {
  const url = `${REPO_BASE}/${season}/${relPath}`;
  const dest = join(RAW_ROOT, season, relPath);
  const label = `${season}/${relPath}`;

  if (await exists(dest)) {
    console.log(`  skip     ${label} (already on disk)`);
    return 'skipped';
  }

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.log(`  ERROR    ${label} (${(err as Error).message})`);
    return 'error';
  }

  if (res.status === 404) {
    console.log(`  404      ${label} (not published for this season)`);
    return 'missing';
  }
  if (!res.ok) {
    console.log(`  ERROR    ${label} (HTTP ${res.status})`);
    return 'error';
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`  ok       ${label} (${buf.length.toLocaleString()} bytes)`);
  return 'downloaded';
}

async function main() {
  const tally: Record<Outcome, number> = {
    downloaded: 0,
    skipped: 0,
    missing: 0,
    error: 0,
  };

  for (const season of SEASONS) {
    console.log(`\n${season}`);
    for (const relPath of FILES) {
      tally[await fetchOne(season, relPath)]++;
    }
  }

  console.log(
    `\nDone. downloaded=${tally.downloaded} skipped=${tally.skipped} ` +
      `missing(404)=${tally.missing} error=${tally.error}`,
  );

  // A 404 is expected and non-fatal; a genuine transport/HTTP error is worth
  // a non-zero exit so it is not silently ignored in CI.
  if (tally.error > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The one link between the shell wrapper and this codebase.
 *
 * `scripts/refresh-prod.sh` raises a sticky marker when FPL serves a settled
 * round with a column unpublished, and the only channel it has for detecting
 * that is grepping the run log — the sync prints the hole block and **exits 0**,
 * because the run succeeded and the rows landed. So the shell holds a copy of a
 * string this module prints.
 *
 * A copy is what drifts, and it drifts in the direction where the signal is
 * silently lost: reword the block and the grep stops matching, the marker stops
 * being raised, and nothing fails. Item 23's rule applies — extract the string
 * from the **shipped** artefact rather than pasting it into the test — so this
 * reads the script off disk.
 *
 * Gated on a non-empty read, for the reason item 20 gives: a check whose premise
 * has expired degrades into passing on nothing. A moved or renamed script must
 * fail here rather than quietly assert against an empty string.
 *
 * Run: npm test   (needs neither the database nor any ingest)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HOLE_SENTINEL } from './ingest-live-gameweeks.js';

const SCRIPT_PATH = fileURLToPath(new URL('../../../scripts/refresh-prod.sh', import.meta.url));

/**
 * Comment lines stripped. The ordering assertions below search for command
 * fragments, and the wrapper's header explains at length what it does and does
 * not run — so searching the raw text finds the prose describing a step rather
 * than the step. Caught by this suite going red against a correct script.
 */
function commands(script: string): string {
  return script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('scripts/refresh-prod.sh', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const code = commands(script);

  it('is readable and non-trivial, so the assertions below cannot pass on nothing', () => {
    assert.ok(
      script.length > 1000,
      `${SCRIPT_PATH} read as ${script.length} characters; the wrapper has moved or been emptied`
    );
    assert.ok(
      code.includes('docker compose'),
      'stripping comments left no docker invocation; the ordering assertions would pass on nothing'
    );
  });

  it('greps for the exact sentinel this module prints', () => {
    assert.ok(HOLE_SENTINEL.length > 0);
    assert.ok(
      script.includes(HOLE_SENTINEL),
      `the wrapper no longer contains HOLE_SENTINEL (${JSON.stringify(HOLE_SENTINEL)}), so a ` +
        `hole would be ingested, logged, and never signalled. Update both sides together.`
    );
  });

  it('runs the two ingests in the order the roster dependency requires', () => {
    const season = code.indexOf('ingest-live-season.ts');
    const gameweeks = code.indexOf('ingest-live-gameweeks.ts');
    assert.ok(season > 0 && gameweeks > 0, 'both ingests must appear in the wrapper');
    assert.ok(
      season < gameweeks,
      'ingest-live-season.ts must be invoked before ingest-live-gameweeks.ts: player_seasons ' +
        'is written by the former alone, and the latter rolls back without it'
    );
  });

  it('builds before it runs, because `docker compose run` reuses a stale image', () => {
    const build = code.indexOf('compose build ingest');
    const firstRun = code.indexOf('compose run --rm');
    assert.ok(build > 0, 'the wrapper must build the ingest image');
    assert.ok(
      build < firstRun,
      'the build must precede the first `compose run`, or the run executes whatever image ' +
        'already exists — the defect observed in production on 3 September 2026'
    );
  });
});

/**
 * Fails when CLAUDE.md grows past the budget. Run by `npm run docs:size`, which
 * `npm test` runs alongside the two test suites.
 *
 * The point is that the wall is hit by a red test rather than by a session that
 * has already spent its context. CLAUDE.md is read in full at the start of every
 * session against a 150,000-character read limit; past that, part of the file
 * silently stops being read, with nothing saying which part. It has happened
 * twice — 195k before item 13 split the item records out, 147k before item 15
 * split them again — and both times the overflow was discovered by reasoning
 * from a stale claim rather than by anything failing.
 *
 * The threshold is 120,000, not 150,000. The margin is deliberate: an item's
 * record now lands in docs/items/ rather than here, but the stub, the Current
 * State edits and any new rule still land here, and they have to fit at the END
 * of a session when the appetite for restructuring is lowest. Raising the
 * threshold to make this pass spends exactly the margin that stops the overflow
 * being silent. Trim instead — the working agreement says what moves where.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Budgets are per file, in characters. Add a file here to put it under the check. */
const BUDGETS: ReadonlyArray<{ file: string; max: number }> = [
  { file: 'CLAUDE.md', max: 120_000 },
];

let failed = false;

for (const { file, max } of BUDGETS) {
  const chars = readFileSync(join(repoRoot, file), 'utf8').length;
  const pct = Math.round((chars / max) * 100);
  const headroom = max - chars;

  if (chars > max) {
    failed = true;
    console.error(
      `FAIL ${file}: ${chars.toLocaleString()} characters, ` +
        `${(-headroom).toLocaleString()} over the ${max.toLocaleString()} budget (${pct}%).`,
    );
    console.error(
      '     Trim rather than raising the budget. Item records belong in',
    );
    console.error(
      '     docs/items/, the test-suite map in docs/testing.md, and a resolved',
    );
    console.error(
      '     Known Issue in the item file that resolved it. See the working agreement.',
    );
  } else {
    console.log(
      `ok   ${file}: ${chars.toLocaleString()} characters, ` +
        `${headroom.toLocaleString()} to spare against ${max.toLocaleString()} (${pct}%).`,
    );
  }
}

process.exit(failed ? 1 : 0);

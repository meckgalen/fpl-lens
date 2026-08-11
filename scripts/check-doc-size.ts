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
 * WHICH UNIT THE BUDGET IS IN, because the two available answers differ and
 * nobody should have to rediscover this. The budget is counted in **characters**:
 * `readFileSync(...).length` returns UTF-16 code units, which is one per
 * character for everything in this file. `wc -c` returns **bytes** and reads
 * about 1,500 higher — the gap is multi-byte UTF-8 punctuation (em dashes, `×`,
 * `→`, `…`) and accented names (Fernández, Ødegaard, Højbjerg, Guéhi). So the two
 * disagree by roughly 1.3%, and a check written against the wrong one is wrong in
 * the permissive direction.
 *
 * Characters is the right unit for a context budget, which is why it is the one
 * used here. **If Claude Code's read limit turns out to be measured in bytes,
 * the byte figure is the one that governs** and this script should switch to
 * `Buffer.byteLength(text, 'utf8')` rather than having its threshold lowered to
 * compensate — a threshold that encodes a unit conversion is a threshold nobody
 * can reason about later.
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

/**
 * Split text into blocks at headings matching `marker` (e.g. /^## /), returning
 * each block's title and character count, largest first.
 *
 * Reported on every run, and deliberately WITHOUT a threshold of its own. The
 * total is the only thing that can fail. The reason for printing this at all:
 * the total goes red once, at the end, after the damage — a section creeping
 * from 25k to 28k is the thing you want to see while it is happening, and it is
 * invisible in a single number. Both times this file hit a wall it did so by one
 * section quietly absorbing measurements nobody was watching accumulate.
 */
function sections(text: string, marker: RegExp): Array<{ title: string; chars: number }> {
  const lines = text.split('\n');
  const out: Array<{ title: string; chars: number }> = [];
  let title: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (title !== null) out.push({ title, chars: buf.join('\n').length });
  };

  for (const line of lines) {
    if (marker.test(line)) {
      flush();
      title = line.replace(marker, '').trim();
      buf = [line];
    } else if (title !== null) {
      buf.push(line);
    }
  }
  flush();

  return out.sort((a, b) => b.chars - a.chars);
}

/** Truncate a heading so the report stays in one column. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let failed = false;

for (const { file, max } of BUDGETS) {
  const text = readFileSync(join(repoRoot, file), 'utf8');
  const chars = text.length;
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

  // Where the weight sits. Informational: nothing below can fail the run.
  const top = sections(text, /^## /).slice(0, 5);
  if (top.length > 0) {
    console.log(`     largest sections:`);
    for (const s of top) {
      const share = Math.round((s.chars / chars) * 100);
      console.log(
        `       ${String(s.chars).padStart(6)}  ${String(share).padStart(2)}%  ${clip(s.title, 52)}`,
      );
    }
  }

  // The two numbered rule lists are where a single rule can quietly become an
  // essay, which no per-section figure shows.
  for (const [label, heading] of [
    ['Data Layer Rules', '## Data Layer Rules'],
    ['API Identity Rules', '## API Identity Rules'],
  ] as const) {
    const start = text.indexOf(heading);
    if (start === -1) continue;
    const next = text.indexOf('\n## ', start + heading.length);
    const body = text.slice(start, next === -1 ? undefined : next);
    const [biggest] = sections(body, /^\d+\. /);
    if (biggest) {
      console.log(
        `     largest ${label.padEnd(18)} rule ${String(biggest.chars).padStart(5)}  ` +
          `${clip(biggest.title, 46)}`,
      );
    }
  }
}

process.exit(failed ? 1 : 0);

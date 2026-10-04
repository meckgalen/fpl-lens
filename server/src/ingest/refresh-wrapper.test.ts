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
 * Since the interactive-hang finding it is also the only place the wrapper is
 * *run*. The suite used to be entirely static and so passed a script that hung
 * on every hand-run, which is the reason the second describe block exists: the
 * defect was in how the wrapper hands stdin to its children, and no assertion
 * about the text of a command can observe a process that never returns.
 *
 * Run: npm test   (needs neither the database nor any ingest; needs bash,
 * flock, timeout and find, which the wrapper needs anyway)
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
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

  it('closes stdin on the compose function, so both call sites inherit it', () => {
    const definition = code.split('\n').find((line) => /^\s*compose\(\)/.test(line));
    assert.ok(definition, 'the wrapper no longer defines a `compose` function');
    assert.match(
      definition,
      /<\s*\/dev\/null/,
      'the `compose` function must redirect stdin from /dev/null. Without it a `docker compose ' +
        'run` inherits the terminal that invoked the script, completes its work and then never ' +
        'returns — and the step timeout writes a failure marker for a step that succeeded. It ' +
        'belongs on the function rather than a call site so that no future call can be added ' +
        'without it'
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

/**
 * Stands in for `docker compose`. It models exactly ONE property of the real
 * thing: a child that does not return while the stdin it inherited stays open.
 *
 * The real hang is Compose's own stream cleanup, and this reproduces neither
 * that mechanism nor Compose's behaviour — reading stdin to EOF is simply the
 * cheapest process with the same observable shape. That is legitimate here
 * because the thing under test is the *wrapper's* redirection, not Compose:
 * the stub is the environment, not the code being checked. It cannot tell us
 * that Compose hangs — the VPS established that — only whether the wrapper
 * hands its children a stdin that would let it.
 *
 * `exec`, not a plain `cat`, so that the process blocked on the read is the
 * direct child of `timeout`. A bash parent defers SIGTERM until its foreground
 * command finishes, so without the exec the wrapper's own step timeout could
 * not end the hang and the mutation run would never terminate.
 *
 * Item 27 extends it in two ways, both of which leave that property intact.
 * `run` exits 1 when FAKE_RUN_FAIL is set, before reading stdin, which is how a
 * failed ingest is staged. `exec` is the raw capture's read-only database
 * query: it prints FAKE_DB_TABLE, or exits 1 when FAKE_DB_FAIL is set. Its
 * banner goes to stderr, because the wrapper reads the query's stdout as data.
 */
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "fake docker $*" >&2
sub=
for a in "$@"; do
  case "$a" in run|exec|build) sub=$a; break ;; esac
done
if [ "$sub" = exec ]; then
  [ -n "\${FAKE_DB_FAIL:-}" ] && exit 1
  printf '%s\\n' "\${FAKE_DB_TABLE:-}"
  exit 0
fi
if [ "$sub" = run ] && [ -n "\${FAKE_RUN_FAIL:-}" ]; then
  exit 1
fi
exec cat > /dev/null
`;

/**
 * Stands in for `curl`, so the suite never reaches FPL or football-data.co.uk
 * and never depends on whether this machine can (the dev machine cannot reach
 * the latter at all). It honours the two things the wrapper relies on: `-o` and
 * the `-w` format, printed as `status redirects bytes url type`. The body is
 * chosen by URL from FAKE_PAYLOADS, with optional `.status` and `.type`
 * siblings. FAKE_CURL_FAIL makes it fail like a dropped connection.
 */
const FAKE_CURL = `#!/usr/bin/env bash
[ -n "\${FAKE_CURL_FAIL:-}" ] && { echo "curl: (6) Could not resolve host" >&2; exit 6; }
out= url=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -w|--max-redirs|--max-time|--retry) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  *bootstrap-static*) name=bootstrap ;;
  *fixtures.csv*) name=fixtures ;;
  *) echo "fake curl: unexpected url $url" >&2; exit 3 ;;
esac
body=$FAKE_PAYLOADS/$name
cp "$body" "$out"
status=200; [ -f "$body.status" ] && status=$(cat "$body.status")
type=application/octet-stream; [ -f "$body.type" ] && type=$(cat "$body.type")
printf '%s 0 %s %s %s' "$status" "$(wc -c < "$body" | tr -d ' ')" "$url" "$type"
`;

const BOOTSTRAP_BODY = JSON.stringify({ elements: [{ id: 1, status: 'a' }, { id: 2, status: 'i' }], events: [] });

/** The real header (2026-10-04, as served to the VPS), plus one PL row and one other. */
const FIXTURES_BODY =
  '﻿Div,Date,Time,HomeTeam,AwayTeam,Referee,B365H,B365D,B365A,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5\r\n' +
  'E0,18/10/2026,15:00,Arsenal,Chelsea,,2.1,3.4,3.5,2.05,3.38,3.45,1.8,2.0\r\n' +
  'E2,18/10/2026,15:00,Barnsley,Reading,,2.4,3.3,2.9,2.38,3.25,2.85,1.95,1.85\r\n';

/** What the dev machine's network serves at the `.csv` URL: HTTP 200, HTML. Real bytes. */
const BLOCK_PAGE = readFileSync(
  fileURLToPath(new URL('./testdata/football-data-block-page.html', import.meta.url))
);

const DB_TABLE = '2026-27|1|610|10\n2026-27|2|626|10';

interface WrapperRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
}

interface Tree {
  dir: string;
  archive: string;
  logs: string;
  payloads: string;
}

/**
 * A copy of the shipped wrapper in a temporary tree, with the stubs on PATH.
 * The script derives its root, and so its log directory and lock file, from its
 * own location: run in place, the test would write logs into the repository and
 * take the lock a real refresh uses. The copy is byte-for-byte the shipped
 * file, so it is still shipped bytes being executed. The archive root is inside
 * the tree, never the default under $HOME.
 */
function makeTree(): Tree {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-wrapper-'));
  for (const sub of ['scripts', 'bin', 'payloads']) mkdirSync(join(dir, sub));
  copyFileSync(SCRIPT_PATH, join(dir, 'scripts', 'refresh-prod.sh'));
  writeFileSync(join(dir, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 });
  writeFileSync(join(dir, 'bin', 'curl'), FAKE_CURL, { mode: 0o755 });
  const payloads = join(dir, 'payloads');
  writeFileSync(join(payloads, 'bootstrap'), BOOTSTRAP_BODY);
  writeFileSync(join(payloads, 'bootstrap.type'), 'application/json');
  writeFileSync(join(payloads, 'fixtures'), FIXTURES_BODY);
  writeFileSync(join(payloads, 'fixtures.type'), 'text/csv');
  return { dir, archive: join(dir, 'archive'), logs: join(dir, 'logs'), payloads };
}

/**
 * Runs the wrapper with a stdin pipe that is never written to and never closed —
 * a non-interactive stand-in for the terminal a hand-run gives it, and the
 * condition cron does NOT provide.
 */
function runWrapper(
  tree: Tree,
  env: Record<string, string> = {},
  stepTimeout = '20s',
  killAfterMs = 60_000
): Promise<WrapperRun> {
  return new Promise<WrapperRun>((resolve) => {
    const child = spawn('bash', [join(tree.dir, 'scripts', 'refresh-prod.sh')], {
      env: {
        ...process.env,
        PATH: `${join(tree.dir, 'bin')}:${process.env.PATH ?? ''}`,
        STEP_TIMEOUT: stepTimeout,
        CAPTURE_ROOT: tree.archive,
        FAKE_PAYLOADS: tree.payloads,
        FAKE_DB_TABLE: DB_TABLE,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so the backstop below can kill anything the
      // wrapper left behind rather than only the wrapper itself.
      detached: true,
    });

    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

    const backstop = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, killAfterMs);

    child.on('close', (code, signal) => {
      clearTimeout(backstop);
      resolve({ code, signal, output, timedOut });
    });
  });
}

function captures(tree: Tree): string[] {
  if (!existsSync(tree.archive)) return [];
  return readdirSync(tree.archive).filter((n) => /^\d{8}T\d{6}Z$/.test(n)).sort();
}

function manifest(tree: Tree, name: string): Map<string, string> {
  const lines = readFileSync(join(tree.archive, name, 'MANIFEST'), 'utf8').split('\n');
  const map = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at > 0 && !map.has(line.slice(0, at))) map.set(line.slice(0, at), line.slice(at + 1));
  }
  return map;
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const marker = (tree: Tree, name: string) => join(tree.logs, name);

describe('scripts/refresh-prod.sh, run', () => {
  it('terminates and succeeds when its stdin stays open', async () => {
    const tree = makeTree();
    try {
      const run = await runWrapper(tree);

      assert.ok(
        run.output.includes('fake docker'),
        'the stub was never invoked, so this asserts nothing about how the wrapper runs ' +
          `Compose. Output:\n${run.output}`
      );
      assert.equal(
        run.timedOut,
        false,
        'the wrapper never returned. Every step did its work and the process stayed alive — the ' +
          'interactive hang, back. Check that `compose()` still redirects stdin from /dev/null: ' +
          `stdout and stderr redirection alone leaves stdin as the caller's.\n${run.output}`
      );
      assert.equal(run.code, 0, `the wrapper exited ${run.code}/${run.signal}:\n${run.output}`);
      assert.ok(
        run.output.includes('--- done'),
        `the wrapper exited 0 without reaching its last line:\n${run.output}`
      );
    } finally {
      rmSync(tree.dir, { recursive: true, force: true });
    }
  });
});

/**
 * Item 27. Every case runs the shipped wrapper end to end with the stubs above;
 * none of them asserts on the script's text, because the defects these exist to
 * catch — an exit code changed by the capture, a capture skipped on failure —
 * are properties of a run, not of a line.
 */
describe('scripts/refresh-prod.sh, raw capture', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = makeTree();
  });
  afterEach(() => {
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it('(a) archives both payloads, gzipped and hashed, beside the database state', async () => {
    const run = await runWrapper(tree);
    assert.equal(run.code, 0, run.output);

    const [name, ...rest] = captures(tree);
    assert.ok(name, `no capture directory was archived:\n${run.output}`);
    assert.equal(rest.length, 0);
    const m = manifest(tree, name);
    assert.equal(m.get('db_state'), 'refreshed');
    assert.equal(m.get('season'), '2026-27');
    assert.equal(m.get('max_round_held'), '2');
    assert.equal(m.get('rows_held'), '1236');
    assert.equal(m.get('fixtures.csv.e0_rows'), '1');
    assert.equal(m.get('bootstrap-static.json.elements'), '2');
    assert.equal(m.get('fixtures.csv.num_redirects'), '0');

    const bootstrap = gunzipSync(readFileSync(join(tree.archive, name, 'bootstrap-static.json.gz')));
    const fixtures = gunzipSync(readFileSync(join(tree.archive, name, 'fixtures.csv.gz')));
    assert.equal(bootstrap.toString(), BOOTSTRAP_BODY, 'the archived bootstrap is not the bytes served');
    assert.equal(fixtures.toString(), FIXTURES_BODY, 'the archived CSV is not the bytes served, BOM included');
    assert.equal(m.get('bootstrap-static.json.sha256'), sha256(BOOTSTRAP_BODY));
    assert.equal(m.get('fixtures.csv.sha256'), sha256(FIXTURES_BODY));

    assert.equal(existsSync(marker(tree, 'last-capture-failure')), false, run.output);
    assert.equal(existsSync(marker(tree, 'last-failure')), false, run.output);
  });

  it('(b) rejects the real block page served as HTTP 200, and keeps the bootstrap', async () => {
    writeFileSync(join(tree.payloads, 'fixtures'), BLOCK_PAGE);
    writeFileSync(join(tree.payloads, 'fixtures.type'), 'text/html; charset=utf-8');
    const run = await runWrapper(tree);
    assert.equal(run.code, 0, run.output);

    const [name] = captures(tree);
    assert.ok(name, `the bootstrap should still have been archived:\n${run.output}`);
    assert.ok(existsSync(join(tree.archive, name, 'bootstrap-static.json.gz')));
    assert.equal(
      existsSync(join(tree.archive, name, 'fixtures.csv.gz')),
      false,
      'an HTML block page was archived as the odds file — the outcome this validation exists to prevent'
    );
    assert.equal(manifest(tree, name).get('fixtures.csv.kept'), 'no');
    // The reason, not only the rejection. Against a page starting with `<` the
    // header check alone would also reject it, so the `<` check earns its place
    // by the diagnosis — "this is a web page" is what the reader of the marker
    // needs at 08:00 — and this assertion is what pins it. Measured: without it,
    // removing the `<` check left this suite green.
    const text = readFileSync(marker(tree, 'last-capture-failure'), 'utf8');
    assert.match(text, /fixtures\.csv: rejected, markup, not CSV/);
    assert.equal(existsSync(marker(tree, 'last-failure')), false, 'a capture problem marked the ingest as failed');
  });

  it('(b2) rejects a plain-text error body and a bootstrap without elements', async () => {
    // Neither starts with `<`, so only the content checks proper can catch them.
    // The bootstrap shape is FPL's own while the game is updating.
    writeFileSync(join(tree.payloads, 'fixtures'), 'Service temporarily unavailable, try later\r\n');
    writeFileSync(join(tree.payloads, 'bootstrap'), JSON.stringify({ detail: 'The game is being updated.' }));
    const run = await runWrapper(tree);
    assert.equal(run.code, 0, run.output);

    assert.deepEqual(captures(tree), [], 'an error body was archived as data');
    const text = readFileSync(marker(tree, 'last-capture-failure'), 'utf8');
    assert.match(text, /fixtures\.csv: rejected, header lacks Div/);
    assert.match(text, /bootstrap-static\.json: rejected, no non-empty elements array/);
  });

  it('(c) keeps the payloads when the database cannot be read, marked unknown', async () => {
    const run = await runWrapper(tree, { FAKE_DB_FAIL: '1' });
    assert.equal(run.code, 0, run.output);

    const [name] = captures(tree);
    assert.ok(name, `an unreadable database discarded irreplaceable payloads:\n${run.output}`);
    const m = manifest(tree, name);
    assert.equal(m.get('max_round_held'), 'unknown');
    assert.equal(m.get('bootstrap-static.json.kept'), 'yes');
    assert.equal(m.get('fixtures.csv.kept'), 'yes');
    assert.match(readFileSync(marker(tree, 'last-capture-failure'), 'utf8'), /database state unreadable/);
  });

  it('(d) a second run adds a capture and leaves the first byte-identical', async () => {
    assert.equal((await runWrapper(tree)).code, 0);
    const [first] = captures(tree);
    const before = readdirSync(join(tree.archive, first)).map((f) =>
      sha256(readFileSync(join(tree.archive, first, f)))
    );
    // Directory names are stamped to the second.
    await new Promise((r) => setTimeout(r, 1100));
    writeFileSync(join(tree.payloads, 'bootstrap'), JSON.stringify({ elements: [{ id: 9 }] }));
    assert.equal((await runWrapper(tree)).code, 0);

    const all = captures(tree);
    assert.equal(all.length, 2, `expected two captures, found ${all.join(', ')}`);
    assert.equal(all[0], first);
    const after = readdirSync(join(tree.archive, first)).map((f) =>
      sha256(readFileSync(join(tree.archive, first, f)))
    );
    assert.deepEqual(after, before, 'the first capture changed when the second was taken');
  });

  it('(e) a failing capture never fails the refresh', async () => {
    const run = await runWrapper(tree, { FAKE_CURL_FAIL: '1' });

    assert.equal(run.code, 0, `a capture failure changed the refresh's exit code:\n${run.output}`);
    assert.equal(
      existsSync(marker(tree, 'last-failure')),
      false,
      'a capture failure set the INGEST failure marker'
    );
    assert.ok(
      existsSync(marker(tree, 'last-capture-failure')),
      `the capture failed and raised no marker of its own:\n${run.output}`
    );
    assert.deepEqual(captures(tree), [], 'nothing fetched, so nothing should be archived');
  });

  it('(f) a failed refresh still captures, flagged, with the state the database holds', async () => {
    const run = await runWrapper(tree, { FAKE_RUN_FAIL: '1' });

    assert.equal(run.code, 1, `the refresh's own exit code was not preserved:\n${run.output}`);
    assert.ok(existsSync(marker(tree, 'last-failure')), 'the ingest failure marker was not set');
    const [name] = captures(tree);
    assert.ok(name, `a failed refresh skipped the capture, losing the day:\n${run.output}`);
    const m = manifest(tree, name);
    assert.equal(m.get('db_state'), 'refresh-failed');
    assert.equal(m.get('failed_step'), 'ingest:live (season structure)');
    assert.equal(m.get('max_round_held'), '2', 'the database was still readable and should have been read');
    assert.equal(m.get('bootstrap-static.json.kept'), 'yes');
  });

  it('(g) reports a stale staging directory and does not delete it', async () => {
    const stale = join(tree.archive, '.staging-20260101T030000Z');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'bootstrap-static.json'), 'half a capture');

    const run = await runWrapper(tree);
    assert.equal(run.code, 0, run.output);

    assert.equal(
      readFileSync(join(stale, 'bootstrap-static.json'), 'utf8'),
      'half a capture',
      'a stale staging directory was deleted; it may be the only copy of that day'
    );
    const text = readFileSync(marker(tree, 'last-capture-failure'), 'utf8');
    assert.ok(text.includes(stale), `the marker does not name the stale directory:\n${text}`);
    assert.equal(captures(tree).length, 1, 'the stale directory should not block today\'s capture');
  });
});

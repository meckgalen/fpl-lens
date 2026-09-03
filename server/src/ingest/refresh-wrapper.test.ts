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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 */
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "fake docker $*"
exec cat > /dev/null
`;

interface WrapperRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
}

/**
 * Runs the shipped wrapper with a stdin pipe that is never written to and never
 * closed — a non-interactive stand-in for the terminal a hand-run gives it, and
 * the condition cron does NOT provide.
 *
 * The script is copied to a temporary tree rather than run in place because it
 * derives its root, and therefore its log directory and lock file, from its own
 * location: run in place, the test would write logs into the repository and
 * take the lock a real refresh uses. The copy is byte-for-byte the shipped
 * file, so it is still shipped bytes being executed.
 */
function runWrapperWithOpenStdin(stepTimeout: string, killAfterMs: number): Promise<WrapperRun> {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-wrapper-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(SCRIPT_PATH, join(dir, 'scripts', 'refresh-prod.sh'));
  writeFileSync(join(dir, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 });

  return new Promise<WrapperRun>((resolve) => {
    const child = spawn('bash', [join(dir, 'scripts', 'refresh-prod.sh')], {
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
        STEP_TIMEOUT: stepTimeout,
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
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, signal, output, timedOut });
    });
  });
}

describe('scripts/refresh-prod.sh, run', () => {
  it('terminates and succeeds when its stdin stays open', async () => {
    const run = await runWrapperWithOpenStdin('20s', 60_000);

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
  });
});

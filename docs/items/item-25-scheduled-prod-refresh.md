# Item 25 — The scheduled production refresh

FPL Lens went to production, and the in-season refresh was run by hand for GW1 and GW2
on 3 September 2026. This item automates it and records what running it by hand taught.

The deliverable is one shell script — the first in this repo — plus a crontab line and
the corrections to three documents that had been describing a world where production
data arrived by `pg_restore` and the gameweek sync had never been run.

---

## The three learnings

### 1. The ordering, and a comment that dissolved one dependency and kept the other's sentence

`ingest-live-season.ts` must run before `ingest-live-gameweeks.ts`. Run them the other
way round during a transfer window and the sync rolls back on

```
2026-27: element 651 has no player_seasons row
```

for any player registered since the last run.

The comment above `syncSeasonGameweeks` said the opposite, and it is worth being precise
about how it got there, because the mistake is a good one:

> Refreshing here is what removes the ordering dependency instead of documenting it.

Item 5 wrote that, and it was **true of the dependency item 5 was thinking about**. Every
2026-27 fixture was `finished: false` from item 4's pre-season load, so a sync reading the
stored flags without refreshing them first would have written zero rows after GW1 —
correctly, and for a reason nothing on screen explained. Item 5 dissolved that by having
the sync call `syncFixtures()` itself. What it did not do, and never claimed to do, was
touch the **roster** dependency: `player_seasons` has exactly one writer.

So there were two ordering dependencies, one was removed, and **the sentence announcing
the removal did not say which**. `docker-compose.prod.yml` had it right in its own
comment; the code comment and `CLAUDE.md`'s Getting Started both had it wrong. A reader
comparing the two would have concluded the compose file was stale.

The guards were always there and always correct — `loadSyncMaps` for a season with no
roster at all, `buildGameweekRows` per element for everything else, both inside the
transaction. Only the prose was wrong. The per-element message has been extended to name
the remedy, which the whole-season one already did:

```
2026-27: element 651 has no player_seasons row. Run 'npm run ingest:live' first — it is
the only writer of the roster, so a player registered since its last run has nothing here
to attach a match to.
```

### 2. `docker compose run` reuses a stale image

`docker compose run` does **not** rebuild when source changes. On 3 September a stale
image silently ran old code through a full pull-and-retry cycle: the source on disk was
correct, the container was not, and nothing in the output said so.

This is the defect the wrapper exists to prevent, and it is verified by reproducing it —
see *Build-first*, below.

### 3. Production and local ingest independently

Both databases ingest from the FPL API. Neither is a copy of the other, and in-season
production is usually ahead: it now refreshes daily while a local database moves only when
somebody runs an ingest. The `pg_dump`/`pg_restore` that seeded production's first
gameweek was a one-off. Using it as the refresh mechanism reverts production, silently,
because a restored database looks exactly like a correct one.

`README.md` asserted the opposite — *"Production data arrives by `pg_restore`, not by
ingestion"* — which was true when written, before the `ingest` service existed.

---

## The wrapper

`scripts/refresh-prod.sh`. Build, then the two ingests in order, fail fast, log, and
raise a marker for the two things nobody would otherwise see.

**What it deliberately does not do** is most of its design, and each entry is a thing
somebody will reasonably want to add:

| Not done | Why |
| --- | --- |
| `git pull` | A cron job that pulls is a cron job that deploys unreviewed code at 03:00. The build picks up code a *human* already pulled. |
| `pg_dump` / `pg_restore` | Learning 3, as a prohibition in the file that is otherwise the natural home for a "sync from local" convenience. |
| `up`, `down`, `restart`, `--build` | The wrapper never bounces a healthy site. |
| Reconcile container state (`--no-deps`) | See below — this one was discovered rather than designed. |
| Any step that behaves differently on an empty run | The no-change path is the same path. Both ingests are upserts that delete no row. |

**`--no-deps` was not in the plan.** The plan reasoned that `depends_on:
condition: service_healthy` would at worst *start* Postgres if it were down, and called
that non-destructive. The first real run showed something stronger:

```
 Container fpl-lens-db-prod  Recreate
 Container fpl-lens-db-prod  Recreated
 Container fpl-lens-db-prod  Starting
```

Compose reconciled the running container against the compose file and **recreated the
database container**. It converged — the second run printed `Running` and did not repeat
it — so it is a one-time event per compose-file change, not a daily one. That is correct
behaviour for `up`. It is a surprise restart of the production database at 03:00 with
nobody watching, and the first cron run after any future edit to `docker-compose.prod.yml`
would trigger it.

So both runs pass `--no-deps`, and a database that is down becomes a loud failure with a
marker rather than something an unattended job quietly fixes by restarting things. That is
what the marker is for.

**The two markers.** `logs/last-failure` on any non-zero exit, removed by the next
success. `logs/last-hole` when FPL served a settled round with a column unpublished.

The hole marker discharges a requirement `docs/roadmap.md` pre-registered before this item
existed: *"When scheduling lands, that block has to become a signal rather than a log line.
Nobody reads the output of a cron job, and a hole that self-heals only if somebody notices
does not self-heal."* The block prints and **exits 0** — the run succeeded, the rows
landed — so grepping the log is the only channel available.

That grep holds a copy of a string the TypeScript prints, and a copy drifts in the
direction where the signal is silently lost: reword the block, the grep stops matching, the
marker stops being raised, and nothing fails. So the string is exported as `HOLE_SENTINEL`
and a test reads the **shipped** script off disk — item 23's rule — gated on a non-empty
read so a moved script fails rather than asserting against nothing.

**Log retention is a flat 30 days, with no sparse archive.** The only stated use for an old
log is establishing how long after a round's last fixture the `finished` flag flips, and
that needs *consecutive recent* runs; a monthly sample answers nothing. These logs are
diagnostic, not backups — `~/backups` retention is a separate open question and not this
item's.

---

## The schedule

```
CRON_TZ=UTC
0 3 * * * /home/kemal/fpl-lens/scripts/refresh-prod.sh >> /home/kemal/fpl-lens/logs/cron.log 2>&1
```

Under the deploy user's crontab, not root. `CRON_TZ` because cron uses system local time
and the schedule is stated in UTC.

**Once daily, and a midday run would buy nothing.** One round of evidence: GW2's fixtures
played 28-31 August 2026 still read `finished: false` with `finished_provisional: true`
days afterwards, and all of them flipped once the round completed. Rounds settle when FPL
processes them, which so far means overnight. The app does not track live data by design.

**That evidence also answers a question `CLAUDE.md` recorded as unanswerable.** The schema
notes said which flag flips first *"cannot be established from any season available
today"* — both are `True` on all 380 rows of completed 2025-26 and `false` on all 380 of
unplayed 2026-27, so only a match in progress distinguishes them — and prescribed an
observation on 22 August that nobody made. GW2 supplied it from the other direction:
`finished_provisional` leads and `finished` waits for round processing, which is the
opposite of what the names suggest.

**One round is a hypothesis and the schedule is built to tolerate it being wrong.** Nothing
in the code depends on the ordering: the sync gates on the conjunction, true only once both
have fired — the later of the two under either ordering — so it was right before the
observation and is unchanged by it. And `ingest-live-gameweeks` covers **every** settled
round in one invocation, so a missed or mistimed run self-heals on the next. The cost of
being wrong about 03:00 is latency, never a gap.

**The limit of what daily logs can measure, stated rather than overclaimed.** A daily
cadence bounds the flip to within 24 hours. That is enough to distinguish "overnight" from
"days later" and not enough to time it. If a tighter number is wanted that is a deliberate,
temporary change to the cron line.

---

## Verification

Everything below was run locally against the prod compose stack (`fpl-lens-db-prod`, a
different database from the VPS). The VPS half — a hand-run end to end, then the first
scheduled run — is the operator's.

### The four wrapper invariants, each mutation-checked

The suite is `server/src/ingest/refresh-wrapper.test.ts`, and it needs neither the database
nor any ingest. Baseline 4 pass / 0 fail. Each mutation was applied to a **copy-restored**
file, never `git checkout` (item 14's rule):

| Mutation | Result |
| --- | --- |
| Reword `HOLE_SENTINEL` in the `.ts` | 3 pass / **1 fail** |
| Delete the build step from the wrapper | 3 pass / **1 fail** |
| Swap the two ingests into the wrong order | 3 pass / **1 fail** |
| Delete the wrapper's `HOLE_SENTINEL=` line | 3 pass / **1 fail** |

Restored: 4 pass / 0 fail.

**The suite found a fault in itself first.** The ordering assertions originally searched the
raw script text and went red against a *correct* script, because the wrapper's header
explains at length what it does and does not run — so `indexOf('compose run')` matched the
prose describing a step rather than the step. It now strips comment lines first, and asserts
that stripping left a `docker compose` invocation behind, so the ordering checks cannot pass
on nothing.

### Build-first, by reproducing the production defect

The plan's first version of this check was wrong and was corrected before building: touching
a source file and watching the layer rebuild only proves the build step *runs*, and
`docker compose build` rebuilds that layer once the context changes regardless. It would
have gone green against a build step that did nothing. The failure being guarded against is
the **absence** of the step.

So: change a string `ingest-live-season.ts` prints, then run with and without the build.

| Run | Output line |
| --- | --- |
| Wrapper **without** step 1 | `Committed in 2.4s. All assertions passed.` |
| Wrapper **with** step 1 | `Committed in 2.2s. All assertions passed. PROBE-2026-09-03-STALE-IMAGE` |

The first is the 3 September defect reproduced exactly: the probe is in the source on disk
and absent from the output, because a stale image ran old code. Probe removed and a clean
image rebuilt afterwards; `git status` confirmed no trace.

### A bug the failure path caught

The first failure-path run printed:

```
Warning: unknown mime-type for "build" -- using "application/octet-stream"
Error: no "compose" mailcap rules found for type "application/octet-stream"
```

`timeout` is an external binary and **cannot invoke a shell function**, so
`timeout "$STEP_TIMEOUT" compose build ingest` execed whatever `compose` was on `PATH` —
on this machine the mailcap MIME utility. The wrapper was running the wrong program
entirely, and only the failure-path run read the command's output closely enough to notice:
the successful runs would have looked identical to a passing build. `timeout` now lives
*inside* the `compose` function.

That is the argument for exercising the failure path rather than assuming it: the check
aimed at the marker found a defect in the happy path.

### The rest

| Check | Result |
| --- | --- |
| `bash -n` | clean (shellcheck not installed on this machine) |
| `tsc --noEmit` on the server | clean |
| Failure path | exit 1, `logs/last-failure` written naming the step, trap's lines present in the run log — so closing the descriptors and waiting on `tee` is doing its job |
| Marker cleared on success | `logs/last-failure` absent after the next green run |
| Full run, cold | 29s end to end; `Changed: players, player_seasons, events, fixtures`; 1236 rows across GW1 (610) and GW2 (626) |
| Second consecutive run | `No change: every table this ingest writes is byte-identical` and `No new rows: 1236 already stored for 2026-27` — the no-change path, exit 0 |
| `--no-deps` in place | no `Container fpl-lens-db-prod` lines at all; only the two `--rm` one-shot containers |
| Concurrent run | second invocation printed `a refresh is already in progress; this run does nothing`, exit **0**, and wrote no log file |
| `npm run docs:size` | 108,008 → **109,387** of 120,000 (net +1,379; two of the six edits delete expired text) |

`npm test` was **not** run. The server suite has 11 pre-existing failures unrelated to this
item: database-backed suites written when 2026-27 held zero `player_gameweeks` rows, a
premise the GW1 ingest falsified. `CLAUDE.md` predicted exactly that — *"turns
`SEASONS_WITH_GAMEWEEKS` red on purpose: that is how the eleventh season announces
itself"* — and it is being handled separately.

---

## What this item did not do

- **Fix the 11 failing server tests.** Out of scope by instruction.
- **Fix the 13 stale player names.** `players` is written `ON CONFLICT DO NOTHING`, so a
  rename never propagates — Savinho is Sávio in FPL and Savinho here. Recorded, not fixed.
- **The `event/{gw}/live` cross-check.** Its window is now open every round rather than
  once, but it is its own session. Still in `docs/roadmap.md`.

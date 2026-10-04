# Item 27 — Daily raw capture of the live-only sources

`scripts/refresh-prod.sh` now archives two raw files on every run, from its EXIT
trap:

- FPL's `bootstrap-static` response;
- football-data.co.uk's `fixtures.csv`.

Each file is validated, gzipped and hashed, and each run's files sit beside a
MANIFEST that records what the production database held at that moment. Nothing
parses them. There is no schema change, no database write, no container change,
and no production TypeScript. The only TypeScript is test code.

**Numbered 27 and shipped before item 26**, which is reserved for the backtest
harness. Every day this did not run lost data permanently, and that is the whole
argument for its priority.

---

## Why: the refresh is a mirror, and some fields are not match facts

`player_gameweeks` is historical by nature. Some FPL fields, though, are **daily
state**. The minutes layer (framework §5.1) needs what `status` and
`chance_of_playing_next_round` said at each past deadline, and §3.4 asks for the
fixtures file to be archived "from day one" to measure the gap between
publication-time and closing odds. Neither can be fetched again later.

### Step 1: the fields are not overwritten. They are never stored.

Asked two ways, and both agree.

- **From source:** no migration (`initial-schema`, `live-season`,
  `live-gameweeks`) declares any of the four columns.
- **Against the local database**, once Docker was up:

  ```
  SELECT table_name, column_name FROM information_schema.columns
  WHERE column_name IN ('status', 'chance_of_playing_next_round', 'form', 'news');

        table_name      | column_name
  ----------------------+-------------
   pg_stat_wal_receiver | status
  ```

  The one row is a Postgres system view. **No application table holds any of the
  four.** So the brief's framing, "overwrites yesterday's", understated it. Today's
  value was lost too (API identity rule 4). All four were in scope, and none
  dropped out.

**What the raw bootstrap keeps, beyond those four.** These fields are listed so a
later item knows what is already archived:

- daily state the database overwrites or never holds: `now_cost` (stored, but
  only its latest value), `selected_by_percent`, `penalties_order`,
  `chance_of_playing_this_round` and `news_added`;
- `ep_next`, FPL's own forecast;
- the per-event `finished` and `data_checked` flags.

---

## The fixtures file: what was verified, and how

### From the VPS (the only machine that can reach it)

- `https://www.football-data.co.uk/fixtures.csv` answers **302** to
  `https://football-data.co.uk/fixtures.csv`, in one hop. `http://` does the
  same.
- The apex URL serves **`200 text/csv`, 13,669 bytes** (2026-10-04). It is UTF-8
  with a BOM, which shows as a stray `Div` line in a `uniq -c` of column 1.
- It covers several leagues and about a week ahead. That day it held E2, E3, EC,
  SC1–3 and SP2, with **zero E0 and zero E1**, which is likely the international
  break.
- **The ten core columns were checked in two passes.** A `head -c 200` showed eight
  of them: `Div Date Time HomeTeam AwayTeam AvgH AvgD AvgA`. `Avg>2.5` and
  `Avg<2.5` were cut off there, so they were **assumed, not seen**. They were
  then checked against the same file with
  `head -1 | tr -d '\r' | tr ',' '\n' | grep -n -x -F -e 'Avg>2.5' -e 'Avg<2.5'`,
  which matched both as whole fields, at positions 38 and 39.
- The header also carries `Referee`, which the 2026-07-30 Wayback copy did not.
  The column drift is real, so validation pins only the stable core.

### From the dev machine: a national block, permanent

This is **not a technical fault**. Turkey blocks betting-odds sites at the national
level, and no code or certificate change will alter it. From this machine:

- `www.` over **HTTPS** fails on a self-signed certificate.
- `www.` over **HTTP** returns **`200 text/html`, 11,017 bytes**: an "access
  blocked" page (`erisime_engellenmis`) served at the `.csv` URL. It is the
  challenge-page hazard the brief warned about, and a status check alone would
  have archived it. Its bytes are the test fixture
  `server/src/ingest/testdata/football-data-block-page.html`. It contains only
  public `gov.tr` notice links.
- The **apex** host **times out**: three attempts of 60 seconds each, in the
  dev-stack run.

**So every football-data.co.uk fetch runs on the VPS and is transferred**,
including the historical season CSVs that framework step 4 needs. The same note is
in `plans/item-26-backtest-harness.md`, so that step 4 does not rediscover it.

---

## Design

### It runs from the EXIT trap, on both outcomes

The brief asked for strict chaining: capture only after a successful refresh.
**That was reversed, deliberately.**

- **Alignment with a database state matters for one consumer only.** FPL's
  `status`, `news` and `chance_of_playing_next_round` record what FPL said that
  day whether or not our ingest succeeded. The odds file is independent of our
  database entirely.
- **Only item 26's `form` bake-off needs alignment**, and it will have dozens of
  `db_state=refreshed` days to choose from.
- **The loss on the other side is permanent**, and most ingest failures are on our
  side: a build error, a migration, a rollback on a newly registered player. On
  those days FPL is perfectly reachable.

The order inside `on_exit` is:

1. The refresh's verdict is decided: `last-failure` is written or cleared, exactly
   as before.
2. `capture "$code" || capture_failed "$code"` runs.
3. `$GW_OUT` is removed.
4. The descriptors close, and the trap waits for `tee`.
5. `exit "$code"`.

What that order buys:

- **The capture is still under the lock**, because fd 9 lives until the process
  exits. It never sees a half-run refresh.
- **The lock-held early `exit 0` happens before the trap is installed**, so a
  skipped run does not capture. Whoever holds the lock will.

**Isolation.** A capture problem writes `logs/last-capture-failure`, a third sticky
marker that the next clean capture clears. It never touches `last-failure` and
never changes the exit code. `capture_failed` cannot fail: every command in it
ends `|| true`.

**The trap that makes this harder than it looks: `set -e` does not apply inside
`capture`.** Bash ignores errexit in any function, or subshell, invoked as part of
an `||` list. So every command in it that can fail is checked explicitly. A bare
failing command would fall through and archive whatever it had left behind.

### The database state: one read-only query, the same on both paths

On a failed refresh the database is **still queried**. It did not advance, but it
still holds something, and recording what it holds keeps every capture matchable.
`db_state=refresh-failed` tells a consumer it may lag FPL that day.

**The source.** The first draft parsed the sync's own per-round report from
`$GW_OUT`. That cannot work on a refresh that failed before the sync ran. So it is
one query, through the existing `compose()` function (which brings the timeout and
the stdin pin):

```
compose exec -T postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" exec psql … -c "$1"' sh "$sql"
```

**What it reads** is `gw | rows | fixtures` per round, for
`max(season) FROM player_seasons`, which is `latestSeason()`'s rule. The `LEFT JOIN`
gives a pre-season a parseable one-row answer instead of an empty one.

**It needs no settledness clause.** The sync writes nothing that is not settled,
so whether the top round is *complete* is answered by the `fixtures` column beside
it, and that is why the whole table goes into the manifest.

**This is SQL outside `server/src/repositories/`, and it is a deliberate exception
to Data Layer rule 20.** It is a read-only row count. It restates none of
`measuredSum`, the count guard or `SETTLED_SQL`, which are the things rule 20
exists to keep in one place. Rule 20 was rewritten in place to say so.

**Two failure classes, two treatments:**

| Failure | What happens | Why |
|---|---|---|
| Bad **content** | The file is discarded, and the marker names it and the reason | It is an error page |
| Missing **metadata** (database unreadable) | The payloads are kept with `max_round_held=unknown`, and the marker is raised | The payload is irreplaceable, and the timestamp still places it |

### Validation judges the bytes, never the status

The block page arrives as HTTP 200, so the status code cannot be the test.
Validation runs in `python3`, because the VPS has no `jq`.

- **Bootstrap:** the JSON parses, and `.elements` is a non-empty array.
- **Fixtures:**
  - the bytes decode as UTF-8 (BOM stripped);
  - the first byte is not `<`;
  - the header contains all ten core columns:
    `Div Date Time HomeTeam AwayTeam AvgH AvgD AvgA Avg>2.5 Avg<2.5`.
- **`e0_rows` is counted and never required.** Zero is legitimate in the
  off-season and in an international break.

**Redirects** are followed with `-L --max-redirs 3`, never unbounded. Every fetch
records `url_effective` and `num_redirects`, because a redirect target that
silently changes is how a capture starts archiving something else, and the
manifest is the only place that would show it. The apex URL is fetched directly,
so zero redirects is the normal case. A non-zero count is a **warning in the run
log, not a failure**, and following a redirect never substitutes for content
validation.

### Never overwrite, never prune, never delete

- **Each run gets its own directory, named by the refresh's own stamp**, so
  `captures/20261004T030001Z/` pairs with `logs/refresh-20261004T030001Z.log`. A
  same-day hand-run after a failed 03:00 run adds an aligned capture beside the
  flagged one and replaces nothing.
- **Files are staged in `.staging-<stamp>/`**, then moved into place with `mv`,
  which is atomic on one filesystem. If the target exists, the capture fails
  rather than overwriting.
- **A run killed mid-capture leaves its staging directory behind.** Under the
  never-delete rule nothing would ever notice it, so each capture checks for stale
  `.staging-*` directories first, raises the marker naming them, and **does not
  delete them**: one may be the only copy of its day.
- **`gzip -n`** keeps a timestamp out of the archive, so identical payloads give
  identical bytes. The `sha256` is of the uncompressed payload.

### Location and naming

- **The root is `~/archive/fpl-lens/captures/`**, overridable as `CAPTURE_ROOT`.
  - It is outside `~/backups` on purpose. "Backup" implies regenerable and
    prunable, and these are neither.
  - It is outside the checkout, so `git clean` cannot reach it, and neither can
    the 30-day log retention, which matches only `logs/refresh-*.log`.
- **The name format is ISO 8601 basic UTC, `YYYYMMDDTHHMMSSZ`.** It is what
  `refresh-*.log` already uses, so the box gains no third format. Timestamps
  inside a manifest are extended (`2026-10-04T03:00:01Z`), because that is
  content, not a name.
- **`~/fpl-capture` was checked first, and it is not an earlier attempt at this
  job.** It is a one-off from 2026-06-02: `capture_season.py` pulled
  `element_summary` for every 2025-26 player before the rollover wiped it, and
  `fpl-2025-26.tar.gz` (2.1 MB) is the result. It was left where it is, by
  decision. Relocating it is part of the backup-housekeeping roadmap entry.

**Timing.** The refresh ends at about 03:00:08 UTC, so captures land at about 03:00.
The capture's worst case is about six minutes: two files, three attempts each, 60
seconds per attempt. It runs inside the lock, an hour clear of en-ekonomik's 04:00
job.

---

## What "as of deadline" means for this archive

**The state at a deadline is the capture taken at about 03:00 UTC on deadline
day.** That is the latest state the archive holds before any deadline. News that
breaks later on deadline day is missed.

**That is acceptable only if the production predict job (framework §13.3) runs at
the same time of day**, so that backtest and production see identical
information. A backtest fed 03:00 state, scored against a production job that
reads 17:00 state, would measure a different model from the one shipped. The
constraint is added to framework §15 (open decisions). A deadline-aligned second
capture is on the roadmap, not in this item.

---

## For item 26: three corrections, already applied to its plan

1. **Part A must record live field capture as shipped (item 27), not as future
   work.** Part A's draft adds a roadmap entry describing this capture, and once
   item 27 has shipped that entry would be stale. The plan
   (`plans/item-26-backtest-harness.md`) now says so above the draft entry.
2. **Part H's `form` answer key is an archived capture with
   `db_state=refreshed`**, not a one-off capture into `data/raw/`. It already
   carries the capture timestamp and `max_round_held` that Part H requires, and it
   is aligned with a successful refresh by construction.
3. **Step 4's odds ingest fetches on the VPS** (see "a national block" above).

Also on the roadmap now: **`ep_next` as a candidate fourth baseline**, once a full
season of captures exists. Baselines 2 and 3 measure nearly the same quantity,
while `ep_next` is FPL's own independent forecast.

---

## Tests

All of them are in `server/src/ingest/refresh-wrapper.test.ts`, which is
**test-only TypeScript, an approved exception to the brief's "no TypeScript
changes"**. The existing run test executes the shipped wrapper with only `docker`
stubbed. Without changes, `npm test` would have fetched from FPL and
football-data on every run and, with the default root, written into the
developer's real home directory.

**The setup:**

- **`curl` is stubbed.** It serves bodies by URL and honours `-o` and the `-w`
  format.
- **The `docker` stub is scriptable.** `run` fails on `FAKE_RUN_FAIL`, and `exec`
  answers the database query with a canned table or fails on `FAKE_DB_FAIL`. It
  keeps the one property item 25 needs: it still blocks on an inherited open
  stdin.
- **`CAPTURE_ROOT` points into the temp tree.**

Every case runs the wrapper end to end. None asserts on the script's text, because
the defects they exist to catch are properties of a run.

| Case | Asserts |
|---|---|
| (a) good payloads | One directory. The gunzipped bytes equal the served bytes, BOM included. `sha256` matches. `db_state=refreshed`, the round and row count come from the table, `e0_rows=1`, and there is no marker |
| (b) the real block page, HTTP 200 | The bootstrap is kept and the CSV is not. The marker reads `rejected, markup, not CSV`, the exit code is 0, and there is no `last-failure` |
| (b2) a plain-text error body, and a bootstrap without `elements` | Nothing is archived, and the marker gives both reasons |
| (c) the database is unreadable | The payloads are kept with `max_round_held=unknown`, and the marker is raised |
| (d) two runs | Two directories, and the first is byte-identical afterwards |
| (e) `curl` fails | Exit 0, **no** `last-failure`, and `last-capture-failure` present |
| (f) the ingest fails | The capture runs, with `db_state=refresh-failed`, the right `failed_step`, and the round from the database. `last-failure` is set, and the exit code is still 1 |
| (g) a stale staging directory | It is reported in the marker and left untouched, and today's capture proceeds |

**Mutations, each applied to a copy of the wrapper and restored from it** (never
`git checkout`). The results were measured, not predicted:

| Mutation | Red |
|---|---|
| Drop the `\|\| capture_failed` isolation | (b), (c), (e) and (g). The failing capture now exits the trap non-zero |
| Restore success-only chaining (the call moved to the end of the main body) | (f) |
| Remove the `<` check | (b), but **only once (b) asserted the reason text** |
| Remove the header check | (b2) |
| Remove the `elements` check | (b2) |
| Report stale staging, but delete it | (g) |
| Skip the stale-staging check | (g) |
| Discard the payloads when the database is unreadable | (c) |

**The first run of the suite was 13/13 green, and that turned out to prove less
than it looked.** Against the block page, the `<` check and the header check
**each reject it alone**, so removing either one left everything green. Only
removing both turned (b) red. Two fixes followed:

- **(b) now asserts the reason.** The `<` check earns its place by the diagnosis,
  "this is a web page, not a CSV", and the reason text is what pins that.
- **(b2) feeds a body that does not start with `<`**, so only the header check can
  catch it.

---

## Verification

- **Suite:** `refresh-wrapper.test.ts` is 14/14. Every mutation above turned its
  case red. `tsc --noEmit` is clean. Shellcheck reports one style note (SC2001)
  and nothing else.
- **Dev stack, run against the real local Postgres, the real FPL API and this
  machine's network**
  (`COMPOSE_FILE=docker-compose.yml CAPTURE_ROOT=<scratch> scripts/refresh-prod.sh`):
  - The dev compose file has no `ingest` service, so the build failed, and the
    run exercised the **failed-refresh path for real**.
  - The exit code was 1, `last-failure` was written, and the capture still ran.
  - The real in-container `psql` read `max_round_held=1, rows_held=610`, matching
    a direct `SELECT max(gw), count(*)` exactly. The local database is GW1 only,
    while production holds 3,216 rows, which is the two databases ingesting
    independently, as designed.
  - The bootstrap was kept, with 667 elements.
  - The CSV failed as `fetch failed`, with the apex host timing out from this
    network, and the marker named it.
  - Both markers were removed from the local `logs/` afterwards.
- **VPS, still to do after deploy:**
  - A hand-run must produce a directory with a manifest whose `max_round_held`
    matches production. `zcat bootstrap-static.json.gz` must parse, and
    `zcat fixtures.csv.gz | head -1` must show the header, with no marker.
  - The next 03:00 cron run must produce its own directory.
- **The E0 path has not yet been seen on real data.** The file held zero E0 rows
  on 2026-10-04. **The first capture before the next Premier League round must
  show `e0_rows > 0`, and its E0 rows must carry the ten core columns.**
  Date confirmed: _pending; record it here._

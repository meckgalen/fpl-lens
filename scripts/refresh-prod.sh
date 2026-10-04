#!/usr/bin/env bash
#
# The in-season refresh, run by cron on the VPS. Item 25.
#
#   crontab -e   (as the deploy user, not root)
#     CRON_TZ=UTC
#     0 3 * * * /home/kemal/fpl-lens/scripts/refresh-prod.sh \
#       >> /home/kemal/fpl-lens/logs/cron.log 2>&1
#
# Safe to run by hand at any time, and safe to run when there is nothing new:
# both ingests are upserts that delete no row, and both report a no-change run
# on stdout while exiting 0.
#
# ## What this script deliberately does NOT do
#
# Each of these is a thing somebody will reasonably want to add. Read the reason
# before adding it.
#
#   - **No `git pull`.** A cron job that pulls is a cron job that deploys
#     unreviewed code at 03:00. Deployment stays the README's manual sequence.
#     The build below exists to pick up code a *human* already pulled.
#   - **No `pg_dump` / `pg_restore`, in either direction.** Prod and local both
#     ingest independently from the FPL API and neither is a copy of the other;
#     prod is usually ahead in-season. The one-off restore that seeded GW1 is not
#     the refresh mechanism, and restoring local over prod reverts it.
#   - **No `up`, `down`, `restart` or `--build` on server or client**, and
#     `--no-deps` on both runs so Compose does not reconcile container state
#     either. Without it the first run after any edit to this compose file
#     RECREATES the Postgres container — observed locally on 3 September 2026,
#     converging once and not repeating. That is standard Compose reconciliation
#     and it is correct behaviour for `up`; it is a surprise restart of the
#     production database at 03:00 with nobody watching. A database that is down
#     is a loud failure with a marker, which is what the marker is for, not
#     something an unattended job should quietly fix by restarting things.
#   - **No `docker image prune` or volume operation.** Nothing destructive runs
#     unattended at 03:00.
#   - **No step that behaves differently when there is nothing new.** The
#     no-change path is the same path.
#   - **The raw capture (item 27) never fails the refresh, and never parses,
#     prunes, overwrites or deletes an archived capture**, a stale staging
#     directory included. It runs from the EXIT trap on both outcomes and has its
#     own marker, `last-capture-failure`. See "The raw capture" below.
#
# ## The order of the two ingests is a hard dependency
#
# `ingest-live-season.ts` runs first. `player_seasons` is written by it alone, so
# a player registered since the last run has no row and the gameweek sync rolls
# back on `element N has no player_seasons row`. That happened in prod on
# 3 September 2026, mid transfer window.
#
# The sync refreshes fixture *flags* itself and so has no ordering dependency on
# those — a genuinely different dependency, and the reason the two claims in
# `ingest-live-gameweeks.ts` are not in conflict.

set -euo pipefail

# Resolve the repo root from the script's own location, so the only place a path
# is written down is the cron line.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD

# Overridable so the script can be exercised against the dev stack:
#   COMPOSE_FILE=docker-compose.yml scripts/refresh-prod.sh
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}

# Generous: the gameweek sync is 564 API requests. A stuck-process guard, not a
# performance budget — it exists so a hung request cannot hold the lock until
# tomorrow's run.
STEP_TIMEOUT=${STEP_TIMEOUT:-20m}

LOG_DIR=$ROOT/logs
LOG_RETENTION_DAYS=30
LOCK=$LOG_DIR/.refresh.lock
FAILURE_MARKER=$LOG_DIR/last-failure
HOLE_MARKER=$LOG_DIR/last-hole

# Must match HOLE_SENTINEL in server/src/ingest/ingest-live-gameweeks.ts.
# A test asserts this file contains that exported string; do not reword one side.
HOLE_SENTINEL='settled fixture(s) served with a column unpublished'

# The raw capture (item 27). Outside the checkout and outside `~/backups` on
# purpose: a backup can be regenerated and pruned, and these can be neither.
# Overridable so the suite and the dev stack never touch the real archive.
CAPTURE_ROOT=${CAPTURE_ROOT:-$HOME/archive/fpl-lens/captures}
CAPTURE_MARKER=$LOG_DIR/last-capture-failure
BOOTSTRAP_URL='https://fantasy.premierleague.com/api/bootstrap-static/'
# The apex host. `www.` answers 302 to exactly this URL, so fetching it directly
# makes zero redirects the normal case and any redirect worth a warning.
FIXTURES_URL='https://football-data.co.uk/fixtures.csv'
# The stable core only. Bookmaker columns come and go (BFD, BMGM and Referee all
# appeared in 2026), so pinning one of them would reject a good file the day the
# site drops it.
FIXTURES_COLUMNS='Div Date Time HomeTeam AwayTeam AvgH AvgD AvgA Avg>2.5 Avg<2.5'

mkdir -p "$LOG_DIR"

# Only one writer at a time. A hand-run overlapping the cron run would put two
# processes on one database, and the gameweek sync is not instant. The
# descriptor is held for the life of the script, so the lock covers the exit
# trap too.
exec 9>"$LOCK"
if ! flock --nonblock 9; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) a refresh is already in progress; this run does nothing."
  exit 0
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG=$LOG_DIR/refresh-$STAMP.log
STEP='startup'
GW_OUT=$(mktemp)

# ## The raw capture (item 27)
#
# Archives FPL's bootstrap-static and football-data.co.uk's fixtures file, raw,
# once per run. It is the only record of FPL's daily state — `status`,
# `chance_of_playing_next_round`, `news`, `form`, prices, ownership — none of
# which the database stores, and of the odds as they stood that morning. Neither
# can be fetched again later, which is why nothing below ever deletes, prunes or
# overwrites a capture.
#
# It runs from the EXIT trap, so it runs whether the refresh succeeded or not:
# FPL's state and the odds are true that day whatever our ingest did. The trap is
# still inside the lock, so it never sees a half-run refresh. The refresh's exit
# code and `last-failure` are decided BEFORE it runs and are never changed by it.
# Its own failures go to `last-capture-failure` and nowhere else.
#
# **`set -e` does NOT apply inside this function**, because it is called in an
# `||` list, and bash ignores errexit there, in subshells as well. So every
# command that can fail is checked explicitly. A bare failing command would
# carry on and archive whatever it had left behind.
#
# The database query below is SQL outside `server/src/repositories/`, and it is
# a deliberate exception to Data Layer rule 20. It is a read-only row count that
# restates none of `measuredSum`, the count guard or `SETTLED_SQL`. It needs no
# settledness clause because the sync writes nothing that is not settled.
CAPTURE_PROBLEMS=()

capture_db_state() {
  # One row per round held, for the newest season (`latestSeason()`'s rule).
  # The LEFT JOIN gives a pre-season one row with gw empty and counts 0, so
  # "no rounds yet" is a parseable answer rather than an empty one.
  local sql="WITH s AS (SELECT max(season) AS season FROM player_seasons)
    SELECT s.season, pg.gw, count(pg.fixture_id), count(DISTINCT pg.fixture_id)
      FROM s LEFT JOIN player_gameweeks pg ON pg.season = s.season
     GROUP BY s.season, pg.gw ORDER BY pg.gw"
  # A failure early enough to precede `compose()`'s definition would otherwise
  # run whatever `compose` is on PATH, which on the dev box is the mailcap tool.
  declare -F compose > /dev/null || return 1
  # shellcheck disable=SC2016  # $POSTGRES_* expand inside the container.
  compose exec -T postgres sh -c \
    'PGOPTIONS="-c default_transaction_read_only=on" exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F "|" -v ON_ERROR_STOP=1 -c "$1"' \
    sh "$sql"
}

# Prints one line: a result (`elements=564`, `e0_rows=0`) on success, or the
# reason on failure, and exits non-zero. Judges the bytes, never the status: a
# block page arrives as HTTP 200 (the dev machine is served exactly that).
capture_validate() {
  python3 - "$1" "$2" "$FIXTURES_COLUMNS" <<'PY'
import json, sys
mode, path, required = sys.argv[1], sys.argv[2], sys.argv[3].split()
data = open(path, 'rb').read()
if not data.strip():
    print('empty body'); sys.exit(1)
if mode == 'json':
    try:
        doc = json.loads(data)
    except ValueError as e:
        print(f'not JSON ({type(e).__name__})'); sys.exit(1)
    elements = doc.get('elements') if isinstance(doc, dict) else None
    if not isinstance(elements, list) or not elements:
        print('no non-empty elements array'); sys.exit(1)
    print(f'elements={len(elements)}')
else:
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        print('not UTF-8'); sys.exit(1)
    if text.lstrip().startswith('<'):
        print("markup, not CSV (first byte '<')"); sys.exit(1)
    lines = text.splitlines()
    header = [c.strip() for c in lines[0].split(',')]
    missing = [c for c in required if c not in header]
    if missing:
        print('header lacks ' + ' '.join(missing)); sys.exit(1)
    # Zero is legitimate: off-season, or an international break.
    e0 = sum(1 for l in lines[1:] if l.split(',', 1)[0].strip() == 'E0')
    print(f'e0_rows={e0}')
PY
}

# capture_file NAME URL MODE STAGE MANIFEST. Keeps NAME.gz in STAGE if it
# validates, and records the outcome in MANIFEST either way. Returns 0 if kept.
capture_file() {
  local name=$1 url=$2 mode=$3 stage=$4 manifest=$5
  local raw=$stage/$name meta verdict status type size effective hops sha
  if ! meta=$(curl -sS -L --max-redirs 3 --max-time 60 --retry 2 -o "$raw" \
      -w '%{http_code} %{num_redirects} %{size_download} %{url_effective} %{content_type}' "$url"); then
    CAPTURE_PROBLEMS+=("$name: fetch failed ($url)")
    { echo "$name.url=$url"; echo "$name.kept=no"; echo "$name.reason=fetch failed"; } >> "$manifest"
    rm -f "$raw"
    return 1
  fi
  read -r status hops size effective type <<< "$meta"
  {
    echo "$name.url=$url"
    echo "$name.url_effective=$effective"
    echo "$name.num_redirects=$hops"
    echo "$name.http_status=$status"
    echo "$name.content_type=$type"
    echo "$name.bytes=$size"
  } >> "$manifest"
  if [ "$hops" != 0 ]; then
    echo "  warning: $name followed $hops redirect(s) to $effective"
  fi
  if ! verdict=$(capture_validate "$mode" "$raw"); then
    CAPTURE_PROBLEMS+=("$name: rejected, $verdict (HTTP $status, $type, $size bytes)")
    { echo "$name.kept=no"; echo "$name.reason=$verdict"; } >> "$manifest"
    rm -f "$raw"
    return 1
  fi
  if ! sha=$(sha256sum "$raw" | cut -d' ' -f1) || ! gzip -n -9 "$raw"; then
    CAPTURE_PROBLEMS+=("$name: could not hash or compress")
    echo "$name.kept=no" >> "$manifest"
    rm -f "$raw" "$raw.gz"
    return 1
  fi
  { echo "$name.kept=yes"; echo "$name.sha256=$sha"; echo "$name.$verdict"; } >> "$manifest"
  echo "  $name: kept ($size bytes, $verdict)"
  return 0
}

capture() {
  local code=$1 stage final manifest table kept=0 db_state
  final=$CAPTURE_ROOT/$STAMP
  stage=$CAPTURE_ROOT/.staging-$STAMP
  manifest=$stage/MANIFEST
  echo ""
  echo "--- raw capture -> $final"

  mkdir -p "$CAPTURE_ROOT" || { CAPTURE_PROBLEMS+=("cannot create $CAPTURE_ROOT"); return 1; }

  # A run killed mid-capture leaves its staging directory behind, and under the
  # never-delete rule nothing would ever notice it. Report it and do not delete
  # it: it may be the only copy of that day. The lock means none of these is in
  # use right now.
  local stale
  for stale in "$CAPTURE_ROOT"/.staging-*; do
    [ -e "$stale" ] || continue
    CAPTURE_PROBLEMS+=("stale staging directory left by an interrupted run: $stale")
  done

  mkdir "$stage" || { CAPTURE_PROBLEMS+=("cannot create $stage"); return 1; }

  if [ "$code" -eq 0 ]; then db_state=refreshed; else db_state=refresh-failed; fi
  {
    echo "captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "refresh_started_at=$STARTED_AT"
    echo "refresh_log=$LOG"
    echo "db_state=$db_state"
    if [ "$code" -ne 0 ]; then echo "failed_step=$STEP"; echo "refresh_exit=$code"; fi
    if [ -e "$HOLE_MARKER" ]; then echo "hole_marker_present=yes"; else echo "hole_marker_present=no"; fi
    echo "git_rev=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  } > "$manifest" || { CAPTURE_PROBLEMS+=("cannot write $manifest"); return 1; }

  # What the database holds, queried even when the refresh failed: it did not
  # advance, but it still holds something, and recording what keeps every
  # capture matchable to a database state.
  if table=$(capture_db_state) &&
     [ -n "$table" ] &&
     ! grep -qvE '^[0-9]{4}-[0-9]{2}\|[0-9]*\|[0-9]+\|[0-9]+$' <<< "$table"; then
    awk -F'|' '
      { season = $1; if ($2 != "") { rows += $3; if ($2 + 0 > max) max = $2 + 0; any = 1 } }
      END {
        print "season=" season
        print "max_round_held=" (any ? max : "none")
        print "rows_held=" rows + 0
      }' <<< "$table" >> "$manifest"
    { echo "# season|gw|rows|fixtures"; sed 's/^/round=/' <<< "$table"; } >> "$manifest"
  else
    CAPTURE_PROBLEMS+=("database state unreadable; payloads kept with max_round_held=unknown")
    { echo "season=unknown"; echo "max_round_held=unknown"; echo "rows_held=unknown"; } >> "$manifest"
  fi

  capture_file bootstrap-static.json "$BOOTSTRAP_URL" json "$stage" "$manifest" && kept=$((kept + 1))
  capture_file fixtures.csv "$FIXTURES_URL" csv "$stage" "$manifest" && kept=$((kept + 1))

  if [ "$kept" -eq 0 ]; then
    # Nothing worth keeping. Our own staging directory, not a stale one.
    rm -rf "$stage"
    CAPTURE_PROBLEMS+=("no payload passed validation; nothing archived")
    return 1
  fi
  # Atomic on one filesystem. A clash means a capture with this stamp already
  # exists, and it is never overwritten.
  if [ -e "$final" ] || ! mv "$stage" "$final"; then
    CAPTURE_PROBLEMS+=("could not move $stage to $final; left in place")
    return 1
  fi
  echo "  archived $kept file(s) at $final"
  [ "${#CAPTURE_PROBLEMS[@]}" -eq 0 ] || return 1
  rm -f "$CAPTURE_MARKER"
  return 0
}

# Must not fail: it runs inside the trap, after the exit code is decided.
capture_failed() {
  {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) raw capture had problems"
    echo "  refresh exit was $1 and is NOT changed by this; see last-failure for that."
    echo "  log:  $LOG"
    local p
    for p in "${CAPTURE_PROBLEMS[@]}"; do echo "  - $p"; done
  } > "$CAPTURE_MARKER" 2>/dev/null || true
  echo "!! raw capture had problems. Marker written to $CAPTURE_MARKER." || true
  return 0
}

# The failure signal. No MTA is assumed on this box, so a non-zero exit alone
# would be invisible: the marker is sticky and survives until the next success.
on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    {
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) refresh FAILED"
      echo "  step: $STEP"
      echo "  exit: $code"
      echo "  log:  $LOG"
    } > "$FAILURE_MARKER"
    echo ""
    echo "FAILED at step: $STEP (exit $code). Marker written to $FAILURE_MARKER."
  else
    rm -f "$FAILURE_MARKER"
  fi
  # After the refresh's verdict is written, before the descriptors close so its
  # lines reach the log, and on BOTH outcomes. `$code` is not touched by it.
  capture "$code" || capture_failed "$code"
  rm -f "$GW_OUT"
  # Close the descriptors so `tee` sees EOF, then wait for it: without this the
  # last lines of the run — including the two above — can be lost when the shell
  # exits before the process substitution has flushed.
  exec 1>&- 2>&- || true
  wait 2>/dev/null || true
  exit "$code"
}
trap on_exit EXIT

# Everything from here is tee'd. `pipefail` above is load-bearing: without it
# tee's exit status would mask a failing ingest.
exec > >(tee -a "$LOG") 2>&1

echo "=============================================================="
echo "fpl-lens refresh  $(date -u +%Y-%m-%dT%H:%M:%SZ)  compose=$COMPOSE_FILE"
echo "=============================================================="

# `timeout` lives INSIDE the function, not in front of the call. It is an
# external binary and cannot invoke a shell function, so `timeout ... compose`
# execs whatever `compose` is on PATH — on this dev box, the mailcap mime
# utility, which "succeeded" at being the wrong program entirely. Found by the
# failure-path check, which is the only run that read the command's output.
#
# `< /dev/null` is load-bearing, and it is on the function rather than at either
# call site so that both calls get it. `exec > >(tee …)` above redirects stdout
# and stderr and leaves stdin as whatever invoked the script; a
# `docker compose run` that inherits an interactive terminal there finishes its
# work — correct output, "All assertions passed", data committed — and then
# never returns, blocked on stream cleanup with the container already gone. The
# step timeout would eventually fire and write a failure marker for a step that
# actually succeeded.
#
# The trap is that it is INVOCATION-dependent: cron hands its child a closed
# stdin, so the scheduled run was unaffected while every hand-run hung. That is
# backwards from what verification needs — the path a human exercises is the
# one that breaks — so stdin is pinned here, and the two paths are identical
# rather than one of them relying on cron's environment.
#
# Step 3 pipes this function into `tee` and needs nothing further: in
# `cmd | tee f` it is the pipe that becomes tee's stdin, and cmd's stdin is this
# redirect. Both are driven end to end by `refresh-wrapper.test.ts`.
compose() { timeout "$STEP_TIMEOUT" docker compose -f "$COMPOSE_FILE" --profile ingest "$@" < /dev/null; }

# Step 1. Build FIRST, always.
#
# `docker compose run` reuses whatever image already exists and does NOT rebuild
# when source changes. On 3 September 2026 a stale image silently ran old code
# through a full pull-and-retry cycle. Deleting this step reintroduces exactly
# that, and nothing else in the run would report it.
STEP='build the ingest image'
echo ""
echo "--- $STEP"
compose build ingest

# Step 2. The roster, clubs, deadlines and fixtures. Must precede step 3.
STEP='ingest:live (season structure)'
echo ""
echo "--- $STEP"
compose run --rm --no-deps -T ingest npx tsx src/ingest/ingest-live-season.ts

# Step 3. The match rows for every round that has settled.
#
# Also captured to its own file: the hole check below greps it rather than the
# main log, which is written asynchronously by `tee` and may not have flushed.
STEP='ingest:live-gameweeks (match rows)'
echo ""
echo "--- $STEP"
compose run --rm --no-deps -T ingest npx tsx src/ingest/ingest-live-gameweeks.ts | tee "$GW_OUT"

STEP='post-run checks'

# Step 4. A hole exits 0, so cron would swallow it. Raise a sticky marker.
if grep -qF "$HOLE_SENTINEL" "$GW_OUT"; then
  {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) FPL served a settled round with a column unpublished."
    echo "  Those rows are stored as NULL. This self-heals ONLY if the sync is re-run"
    echo "  after FPL publishes — nothing in the database will tell you later."
    echo ""
    echo "  log:    $LOG"
    echo "  re-run: $ROOT/scripts/refresh-prod.sh"
    echo ""
    grep -F -A 6 "$HOLE_SENTINEL" "$GW_OUT"
  } > "$HOLE_MARKER"
  echo ""
  echo "!! Hole detected. Marker written to $HOLE_MARKER — re-run once FPL publishes."
fi

# Step 5. Flat 30-day retention. Deliberately no sparse archive: the only stated
# use for an old log is establishing how long after a round's last fixture the
# `finished` flag flips, and that needs consecutive recent runs. These logs are
# diagnostic, not backups.
find "$LOG_DIR" -maxdepth 1 -name 'refresh-*.log' -type f -mtime "+$LOG_RETENTION_DAYS" -delete

echo ""
echo "--- done  $(date -u +%Y-%m-%dT%H:%M:%SZ)"

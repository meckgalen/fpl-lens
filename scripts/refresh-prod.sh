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
LOG=$LOG_DIR/refresh-$STAMP.log
STEP='startup'
GW_OUT=$(mktemp)

# The failure signal. No MTA is assumed on this box, so a non-zero exit alone
# would be invisible: the marker is sticky and survives until the next success.
on_exit() {
  local code=$?
  rm -f "$GW_OUT"
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

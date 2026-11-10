#!/usr/bin/env bash
#
# The daily production database backup, run by cron on the VPS.
#
#   crontab -e   (as the deploy user, not root)
#     30 2 * * * /home/kemal/fpl-lens/scripts/backup-prod.sh \
#       >> /home/kemal/fpl-lens/logs/backup.log 2>&1
#
#   Times are UTC because the server's time zone is Etc/UTC; this cron ignores
#   CRON_TZ.
#
# A `pg_dump -Fc` taken inside the Postgres container, validated, kept in
# `~/backups` (newest 7 by count) and copied to R2. Safe to run by hand at any
# time. It is a separate script from `refresh-prod.sh` on purpose: that
# script's "no pg_dump / pg_restore in either direction" rule is about data
# MOVEMENT between prod and local, and it stands. Nothing here restores anything.
#
# ## What this script deliberately does NOT do
#
#   - **No restore, anywhere.** Restoring into production is not scripted and
#     needs a separate decision. The README has the restore TEST procedure,
#     which restores into a throwaway container with no network.
#   - **No `run`, `build`, `up` or anything else that can start, create or
#     reconcile a container.** Only `exec -T` into the running `postgres`
#     service. A database that is down is a failure with a marker, not
#     something an unattended job should start.
#   - **Nothing that prints credentials.** No `docker compose config`, no
#     `docker inspect`, no read of `.env`. The dump runs as the container's own
#     `$POSTGRES_USER` over its local socket, expanded inside the container.
#   - **No delete, overwrite or sync in R2.** `copyto --immutable` only.
#     Retention there is Cloudflare's: a 30-day bucket lock and a 35-day
#     lifecycle rule, both set in the dashboard.
#   - **No file in `~/backups` is touched unless its name is exactly
#     `fpl-lens-????-??-??T????Z.dump`.** That directory also holds other
#     projects' dumps and older manual fpl-lens dumps under other names.
#
# ## The refresh lock
#
# The backup takes the refresh's own lock, so a dump never overlaps an ingest.
# It WAITS for it (`flock -w`, default 600 s) where the refresh gives up at
# once, and holds it ONLY while pg_dump runs (itself capped at 600 s).
# Validation, upload and pruning run after it is released. So a 02:30 run
# releases the lock by about 02:51 at the very latest, and the 03:00 refresh —
# which does nothing if the lock is held — is not crowded out. Not getting the
# lock is a failure, with a marker.

set -euo pipefail
umask 077

# Resolve the repo root from the script's own location, so the only place a path
# is written down is the cron line.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD

# Overridable for local testing only; the defaults are production. E.g.:
#   COMPOSE_FILE=docker-compose.yml BACKUP_DIR=$(mktemp -d) \
#     LOCK=$(mktemp) LOG_DIR=$(mktemp -d) SKIP_UPLOAD=1 scripts/backup-prod.sh
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
PG_SERVICE=${PG_SERVICE:-postgres}
BACKUP_DIR=${BACKUP_DIR:-$HOME/backups}
LOG_DIR=${LOG_DIR:-$ROOT/logs}
LOCK=${LOCK:-$LOG_DIR/.refresh.lock}
RCLONE_DEST=${RCLONE_DEST:-r2-fpl:fpl-lens-backups}
SKIP_UPLOAD=${SKIP_UPLOAD:-0}
LOCK_WAIT=${LOCK_WAIT:-600}

DUMP_TIMEOUT=600
KEEP_LOCAL=7
# A glob, matched by `find -name`. The ONLY files the prune may delete.
DUMP_GLOB='fpl-lens-????-??-??T????Z.dump'
# Same naming convention as refresh-prod.sh's markers. `refresh-prod.sh` removes
# only `last-failure`, and its log prune matches only `refresh-*.log`, so it
# touches neither this marker nor `backup.log`; this script touches no file in
# the log directory but this marker and the lock.
FAILURE_MARKER=$LOG_DIR/last-backup-failure

NAME=fpl-lens-$(date -u +%Y-%m-%dT%H%MZ).dump
FINAL=$BACKUP_DIR/$NAME
# Ends in `.partial`, so DUMP_GLOB can never match one.
PARTIAL=$FINAL.partial
STAGE='startup'

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# The failure signal. No MTA is assumed on this box, so a non-zero exit alone
# would be invisible: the marker is sticky and survives until the next success.
on_exit() {
  local code=$?
  rm -f "$PARTIAL"
  if [ "$code" -ne 0 ]; then
    {
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup FAILED"
      echo "  stage: $STAGE"
      echo "  exit:  $code"
      echo "  file:  $NAME"
    } > "$FAILURE_MARKER" 2>/dev/null || true
    log "backup FAILED at stage: $STAGE (exit $code). Marker written to $FAILURE_MARKER." || true
  else
    rm -f "$FAILURE_MARKER"
  fi
  exit "$code"
}
trap on_exit EXIT

mkdir -p "$LOG_DIR" "$BACKUP_DIR"

# `< /dev/null` for the same reason as `compose()` in refresh-prod.sh: a
# `docker compose` child that inherits an interactive terminal can finish and
# never return. The validation call below supplies its own stdin instead.
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Stage 1. The lock, exactly the refresh's file. Opened for APPEND so it is
# never truncated, never removed: flock locks the inode, not the contents, so
# this and refresh-prod.sh's `exec 9>"$LOCK"` contend for the same lock.
STAGE='lock'
exec 9>>"$LOCK"
if ! flock -w "$LOCK_WAIT" 9; then
  log "could not take $LOCK within ${LOCK_WAIT}s; a refresh or another backup holds it."
  exit 1
fi

# Stage 2. The dump. Two timeouts: busybox `timeout` inside the container is the
# real one, because killing the `docker compose exec` client does not reliably
# stop the process it started; the outer one only guards a hung client.
STAGE='pg_dump'
# shellcheck disable=SC2016  # $POSTGRES_* expand inside the container.
timeout $((DUMP_TIMEOUT + 60)) docker compose -f "$COMPOSE_FILE" exec -T "$PG_SERVICE" sh -c \
  'exec timeout "$1" pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  sh "$DUMP_TIMEOUT" < /dev/null > "$PARTIAL"

flock -u 9
exec 9>&-

# Stage 3. Validation. Judges the file, not pg_dump's exit status alone.
STAGE='validate'
if [ ! -s "$PARTIAL" ]; then
  log "dump is empty."
  exit 1
fi
if [ "$(head -c 5 "$PARTIAL")" != PGDMP ]; then
  log "dump does not start with the custom-format header PGDMP."
  exit 1
fi
toc=$(compose exec -T "$PG_SERVICE" pg_restore --list < "$PARTIAL")
table_data=$(grep -c ' TABLE DATA ' <<< "$toc" || true)
if [ "$table_data" -lt 1 ]; then
  log "pg_restore --list lists no TABLE DATA entry."
  exit 1
fi

# Stage 4. Atomic, no-clobber publish of the name. `ln` fails if FINAL already
# exists (two runs in one minute), where `mv` would silently replace it.
STAGE='rename'
ln "$PARTIAL" "$FINAL"
rm -f "$PARTIAL"
SIZE=$(stat -c %s "$FINAL")

# Stage 5. Off-site copy. `--immutable` refuses to modify an existing object,
# so nothing in R2 is ever overwritten; the bucket lock would refuse it anyway.
if [ "$SKIP_UPLOAD" = 1 ]; then
  log "upload skipped (SKIP_UPLOAD=1)."
else
  STAGE='upload'
  rclone copyto --immutable "$FINAL" "$RCLONE_DEST/$NAME" < /dev/null
  STAGE='upload check'
  remote_size=$(rclone lsf --files-only --format s "$RCLONE_DEST/$NAME" < /dev/null)
  if [ "$remote_size" != "$SIZE" ]; then
    log "remote object $RCLONE_DEST/$NAME has size '${remote_size}', local is $SIZE."
    exit 1
  fi
fi

# Stage 6. Local retention, by count. Reached only once THIS run's dump has been
# validated (and uploaded, unless skipped), so a failing day never prunes a good
# file. The timestamp in the name sorts chronologically as text.
STAGE='prune'
mapfile -d '' -t dumps < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$DUMP_GLOB" -print0 | sort -z)
excess=$(( ${#dumps[@]} - KEEP_LOCAL ))
for ((i = 0; i < excess; i++)); do
  rm -f -- "${dumps[i]}"
  log "pruned $(basename -- "${dumps[i]}")"
done

STAGE='done'
log "backup ok: $NAME $SIZE"

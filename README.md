# FPL Lens

A Fantasy Premier League player analytics dashboard built on eleven seasons of Fantasy Premier League data — ten complete, plus the one in progress.

Live at **[fpl.karpuz.dev](https://fpl.karpuz.dev)**

## Why it exists

The official FPL site shows one row per previous season: totals, and nothing underneath. If you want to know whether a player's 180 points came from a steady run or from three explosive weeks and thirty quiet ones, the site cannot tell you.

FPL Lens keeps that familiar layout and makes every season row expand into its gameweek by gameweek detail. The intended use is planning a squad from what actually happened, rather than from a season total that hides its own shape.

It also refuses to relabel data. The official site prints carryover totals under a "this season" heading during pre-season. Here the current price and ownership sit beside the last completed season's totals, each one labelled for what it is.

## Features

- **Player list** with the current season roster, sortable on any visible column, filterable by club and position
- **Selectable stat columns**: 27 selectable, 13 shown by default. Columns a season has no rows for appear disabled with the reason attached ("Not recorded in 2016-17 · recorded from 2022-23.") rather than silently missing, so the gaps in the data become something the app teaches
- **Career history** on the player detail page, every season expandable into its rounds, with per season gameweek range and venue filters
- **Season selector** covering 2016-17 through the current season, with the availability of each stat recomputed per season
- **Player comparison** on a radar chart, up to four traces at once, scored against fixed per axis thresholds derived from a 2,827 player season cohort — smaller on the axes only the recent seasons measure — with the position's average drawn as a band underneath
- **Derived metrics** the official site does not carry: defensive contribution hits and hits per start, 10+ point and 4+ point returns and their per start ratios, points per match computed over appearances rather than rounds
- **Fixtures** with difficulty and results views of the same round
- Light, dark and system themes

## Stack

**Client**: React 18, TypeScript, Vite, Tailwind CSS, Vitest and React Testing Library
**Server**: Node, Express, TypeScript, node-pg-migrate
**Data**: PostgreSQL 16 as the source of truth, the public FPL API as an ingestion source
**Infrastructure**: Docker Compose, Nginx, deployed on a self hosted VPS

## The data layer

Postgres is the source of truth, not a cache in front of the FPL API. Ten complete seasons were ingested from historical CSVs, and the current season syncs from the live API once its rounds finish.

| Table | Rows |
| --- | --- |
| player_gameweeks | 253,509 |
| player_seasons | 7,902 |
| fixtures | 4,180 |
| players | 2,690 |
| team_seasons | 220 |
| teams | 35 |

Ten seasons of one competition is not ten copies of the same schema. A few of the things settled during ingestion, all of which the app now has to render:

- **Coverage is not monotonic.** Tackles, clearances and recoveries appear from 2016-17 to 2018-19, vanish for six seasons, and return in 2025-26. The expected goals family starts in 2022-23. Defensive contributions exist only from 2025-26.
- **Coverage is not even within a season.** The upstream scraper began collecting five columns partway through 2022-23, so a value can be real for one player and absent for another in the same season.
- **NULL and zero mean different things**, and the distinction is load bearing. NULL is not measured. Zero is measured, and nothing happened. There is also a third case: FPL computes defensive contribution as position scoped and assigns goalkeepers a zero rather than leaving it blank.
- **Rounds are not 1 to n.** The 2019-20 restart replayed rounds 30 to 38 as 39 to 47. The 2022-23 season skipped round 7 after the Queen's death.

Where a column is missing the app renders a placeholder, never a zero. Where an average is shown, its denominator is stated.

## Verification

Alongside the test suites there are read only scripts that check derived output against the source data rather than against the code that produced it. They run against a populated database and are deliberately kept out of `npm test`, since they need one:

```bash
npm run verify:ppg            # our points-per-appearance against FPL's own published points_per_game
npm run verify:history-past   # cross-checks season aggregates against FPL's own history_past
npm run verify:columns        # re-derives the per season availability matrix, then checks the withheld fields really arrive empty
npm run verify:defcon         # checks the defensive contribution hit count against a frozen distribution
npm run verify:haul           # checks the 10+ and 4+ point return counts
npm run verify:thresholds     # re-derives the comparison chart's per axis floors and ceilings
```

The first two reach the live FPL API as their second source; the rest need nothing but the database. `verify:history-past` caches its responses under `data/raw/`, so only the first run costs anything.

The gameweek sync was validated separately by replaying an entire season offline: 29,747 of 29,747 rows equivalent to the published CSV.

## Getting started

Requires Node 20+ and Docker.

**1. Clone and install**

```bash
git clone https://github.com/meckgalen/fpl-lens.git
cd fpl-lens
npm install
npm run install:all
```

**2. Configure the environment**

```bash
cp .env.example .env
```

Before starting Postgres, not after: `docker-compose.yml` reads the same file, and the container bakes its credentials into the volume on first start. Changing `POSTGRES_PASSWORD` afterwards locks you out of your own database.

**3. Start Postgres**

```bash
docker compose up -d postgres
```

The dev database publishes on host port 5434 to stay clear of a native Postgres on 5432. `DATABASE_URL` names the same port, so change the two together.

**4. Run the migrations**

```bash
npm run migrate:up
```

**5. Get the historical data**

The ten complete seasons are ingested from the [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) dataset. A script downloads the four files each season needs:

```bash
npx tsx scripts/fetch-raw-data.ts
```

They land in `data/raw/{season}/` — `players_raw.csv`, `teams.csv`, `fixtures.csv` and `gws/merged_gw.csv` — which is where the ingest scripts look, and which is gitignored. The path is not configurable. Files already on disk are skipped, and a 404 is logged rather than fatal: the early seasons legitimately have no `teams.csv` or `fixtures.csv`.

**6. Ingest**

Order matters: fixtures reference teams, and gameweeks reference both. Each script asserts its predecessors' row counts before it starts and names the one to run first, so the order is enforced rather than trusted.

```bash
npm run ingest:dimensions   # teams and players
npm run ingest:fixtures
npm run ingest:gameweeks    # the fact table, ~253k rows
```

Then pull the current season from the live API. Neither has an ordering constraint, and both are meant to be re-run — the first through the transfer window, the second as rounds finish. Only fixtures that have settled are written, so the second one writes nothing until a match has been played.

```bash
npm run ingest:live
npm run ingest:live-gameweeks
```

**7. Start the dev servers**

```bash
npm run dev
```

The client runs on 5173 and the server on 3001.

## Repository layout

```
client/                 React client
  src/lib/              shared logic, kept out of component modules
  src/services/api.ts   the single API boundary, mocked in every client test
server/
  src/repositories/     the only place SQL is written
  src/types/            wire, domain and api types, parsed at the boundary
  src/ingest/           CSV and live API ingestion
  src/verify/           read only cross-checks against the source data
  migrations/           node-pg-migrate
scripts/                fetch and profile the raw CSVs, check doc size, prod refresh and backup
data/raw/               the downloaded CSVs, by season; gitignored
docs/                   item records, testing notes, roadmap
```

Two conventions worth knowing before reading the code:

**FPL codes are the external contract.** Player and team identity crosses the wire as the FPL code, which is stable across seasons, never as a database id and never as the per season element id.

**No SQL outside `server/src/repositories/`.** Routes take domain objects. Parsing from the wire shape happens once, at the repository boundary.

## Testing

```bash
npm test
```

Runs a documentation size check, then both suites, continuing through failures so one red step does not hide the rest.

Client tests mock the API at `services/api.ts` and never touch a database. Server tests run against a real Postgres, each suite claiming a reserved synthetic season so parallel runs cannot collide.

## Deployment

Three containers: Postgres, the API server, and an Nginx serving the static client build and proxying `/api`, so the browser sees a single origin. Only the last publishes a port, and only on loopback — the host's Nginx fronts it. Postgres publishes nothing at all; the server reaches it over the compose network.

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

The migrate step is profile gated and sits between build and up, so the schema is ready before the new code reaches it.

### In-season refresh

Production ingests from the FPL API itself, on a schedule. `scripts/refresh-prod.sh` builds the ingest image and then runs the two ingests in their required order, and cron calls it. Times are UTC because the server's time zone is Etc/UTC; this cron ignores `CRON_TZ`.

```
0 3 * * * /home/kemal/fpl-lens/scripts/refresh-prod.sh >> /home/kemal/fpl-lens/logs/cron.log 2>&1
```

Every run writes a timestamped log under `logs/`, kept 30 days. Three sticky markers are the things worth looking at, all cleared or raised automatically:

- `logs/last-failure` — the run failed. Written on any non-zero exit, and removed by the next success.
- `logs/last-hole` — FPL served a settled round with a column unpublished, so those cells are stored as NULL. The run itself succeeded. Re-run once FPL publishes and the upsert overwrites them; nothing in the database will tell you later.
- `logs/last-capture-failure` — the raw capture had a problem: a payload was rejected or could not be fetched, the database state could not be read, or a stale `.staging-*` directory was found. It **never** fails the refresh, and it names the problem. Removed by the next clean capture.

**Every run also archives two raw files**, whether or not the refresh succeeded: the FPL bootstrap and football-data.co.uk's `fixtures.csv`, gzipped, under `~/archive/fpl-lens/captures/<YYYYMMDDTHHMMSSZ>/`. The stamp matches that run's log. They are the only history of FPL's daily state (`status`, `news`, prices and so on), which no table stores, so **nothing prunes them, and nothing should**. Each directory's `MANIFEST` is `key=value` lines. `db_state` is `refreshed` or `refresh-failed`, `max_round_held` and the `round=` lines show what the database held at that moment, and each file gets its URL, the redirects followed, the HTTP status, a `sha256` of the uncompressed bytes, and `kept=yes|no` with the reason. A `.staging-*` directory is a capture that was interrupted. It is reported, never deleted: look inside it before removing it by hand.

Three things about it that are easy to get wrong:

- **`ingest-live-season.ts` runs before `ingest-live-gameweeks.ts`.** `player_seasons` is written by the former alone, so a player registered since the last run leaves the sync with no row to attach a match to and it rolls back. The wrapper is where that order is written down.
- **Build first.** `docker compose run` reuses whatever image already exists and does not rebuild when source changes, so a stale image runs old code and says nothing.
- **Production and local ingest independently, and neither is a copy of the other.** In-season, production is usually ahead. The one-off `pg_restore` that seeded the first gameweek is not the refresh mechanism, and restoring local over production reverts it.

The ingest and migrate services both build from the Dockerfile's `build` stage, because the runtime image deliberately ships without tsx.

### Database backup

`scripts/backup-prod.sh` takes a daily `pg_dump -Fc` of the production database, checks it, keeps it locally and copies it off-site. It is separate from the refresh, and the refresh's "no `pg_dump` / `pg_restore` in either direction" rule still stands: that rule is about moving data between production and local, and nothing here restores anything. Cron calls it half an hour before the refresh. Times are UTC because the server's time zone is Etc/UTC; this cron ignores `CRON_TZ`.

```
30 2 * * * /home/kemal/fpl-lens/scripts/backup-prod.sh >> /home/kemal/fpl-lens/logs/backup.log 2>&1
```

What one run does, in order. The stage names are the ones a failure reports:

1. **`lock`** takes the refresh's own lock, `logs/.refresh.lock`, waiting up to 600 s for it. Failing to get it is a failure.
2. **`pg_dump`** runs `pg_dump -Fc` inside the running `postgres` container with `docker compose exec -T`, as the container's own `$POSTGRES_USER` and `$POSTGRES_DB`, capped at 600 s, into `~/backups/fpl-lens-<YYYY-MM-DDTHHMMZ>.dump.partial`. The lock is released as soon as it finishes. The script never runs `run`, `build` or `up`, and never prints credentials: no `docker compose config`, no `docker inspect`, no read of `.env`.
3. **`validate`** checks that the file is non-empty, starts with the custom-format header, and that `pg_restore --list` (run inside the container, from stdin) succeeds and lists at least one `TABLE DATA` entry.
4. **`rename`** publishes it as `~/backups/fpl-lens-<YYYY-MM-DDTHHMMZ>.dump`. The rename is atomic and refuses to replace an existing file. A trap removes the `.partial` file on any failure.
5. **`upload`** runs `rclone copyto --immutable` to `r2-fpl:fpl-lens-backups/<same name>`, and **`upload check`** confirms the object is there with the same size. Nothing in R2 is ever deleted, overwritten or synced.
6. **`prune`** keeps the newest 7 local files whose name is exactly `fpl-lens-????-??-??T????Z.dump`, by name, which sorts by time. It runs only after this run's dump has been validated and uploaded, so a failing day never prunes a good file. **Nothing else in `~/backups` is touched**: other projects' dumps, other archives, and the older manual fpl-lens dumps, whose names do not match.

Success logs one line, `backup ok: <file name> <size in bytes>`. Failure logs the stage, exits non-zero and writes the sticky marker **`logs/last-backup-failure`**, naming the stage and the file. The next success removes it. The two scripts keep out of each other's files: the refresh removes only `last-failure` and prunes only `refresh-*.log`, and the backup prunes only inside `~/backups`.

**The lock.** The two scripts never overlap, and the backup is the one that gives way. The refresh does nothing if the lock is held at 03:00, so the backup waits for the lock (at most 600 s) and holds it only while `pg_dump` runs (at most 600 s). Validation, upload and pruning run after it has let go. A 02:30 run has therefore released the lock by about 02:51 at the very latest. A backup run by hand during a refresh waits up to ten minutes and then fails with a marker, which is better than dumping mid-ingest.

**Retention.** Locally, 7 dumps by count. In R2 the script does no retention at all. The bucket `fpl-lens-backups` has a 30-day bucket lock rule, so objects cannot be deleted or overwritten for 30 days, and a lifecycle rule that deletes them after 35 days. Both are set in the Cloudflare dashboard. The rclone remote is `r2-fpl`, configured on the server with a token scoped to that bucket and `no_check_bucket = true`. Its credentials live only in the server's rclone config.

**Overrides, for local testing only.** The defaults are production. `COMPOSE_FILE`, `PG_SERVICE`, `BACKUP_DIR`, `LOG_DIR`, `LOCK`, `LOCK_WAIT`, `RCLONE_DEST`, and `SKIP_UPLOAD=1` to skip the upload:

```bash
COMPOSE_FILE=docker-compose.yml BACKUP_DIR=$(mktemp -d) LOG_DIR=$(mktemp -d) \
  LOCK=$(mktemp) SKIP_UPLOAD=1 scripts/backup-prod.sh
```

**Restore test.** This proves a dump restores. It never touches production. It is how the first manual dump was checked on 10 November 2026, and it is worth repeating now and then on a recent file, locally or one pulled from R2:

```bash
docker run -d --rm --network none --name fpl-restore-test -e POSTGRES_PASSWORD=throwaway postgres:16-alpine
docker exec fpl-restore-test psql -U postgres -c 'CREATE DATABASE restore_test'
docker cp fpl-lens-<stamp>.dump fpl-restore-test:/tmp/r.dump
docker exec fpl-restore-test pg_restore -U postgres -d restore_test \
  --no-owner --no-privileges --exit-on-error /tmp/r.dump
# then compare count(*) of all 8 tables against the source database
docker stop fpl-restore-test
```

`--network none` means the throwaway container cannot reach anything. `--no-owner --no-privileges` means it does not need production's roles.

**Restoring into production is not scripted, and needs its own decision.** The database is refreshed daily from the FPL API, so a restore throws away every round ingested since the dump. Whatever it gets restored over is gone too, unless it was dumped first.

## Roadmap

- An expected points model, built as a transparent weighted formula rather than an opaque one. If a projection cannot be explained it cannot be argued with, and the whole point is to argue with it
- Per 90 normalisation, which needs care: on a partially measured season the numerator covers fewer rounds than the minutes do
- Rolling form, fixture difficulty colouring on the player pages

## Credits

Historical season data comes from **[vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League)** by Vaastav Anand, which has collected and published FPL gameweek data since 2016-17. Ten of the eleven seasons in this project's database are ingested from it. The dataset asks to be cited:

> Anand, Vaastav. *FPL Historical Dataset*. Retrieved from <https://github.com/vaastav/Fantasy-Premier-League/>

Current season data comes from the official Fantasy Premier League API. Club badges and shirt images are served from Premier League assets.

FPL Lens is an unofficial project. It is not affiliated with, endorsed by, or in any way connected to the Premier League or Fantasy Premier League.

## License

The code in this repository is released under the [MIT License](LICENSE). The data it ingests is not covered by that licence and remains subject to the terms of its own sources.

---

Built by Kemal Genc.

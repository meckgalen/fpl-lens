# FPL Lens

A Fantasy Premier League player analytics dashboard built on eleven seasons of historical data.

Live at **[fpl.karpuz.dev](https://fpl.karpuz.dev)**

## Why it exists

The official FPL site shows one row per previous season: totals, and nothing underneath. If you want to know whether a player's 180 points came from a steady run or from three explosive weeks and thirty quiet ones, the site cannot tell you.

FPL Lens keeps that familiar layout and makes every season row expand into its gameweek by gameweek detail. The intended use is planning a squad from what actually happened, rather than from a season total that hides its own shape.

It also refuses to relabel data. The official site prints carryover totals under a "this season" heading during pre-season. Here the current price and ownership sit beside the last completed season's totals, each one labelled for what it is.

## Features

- **Player list** with the current season roster, sortable on any visible column, filterable by club and position
- **Selectable stat columns**: 25 available, 13 shown by default. Columns that a season never measured appear disabled with the reason attached ("Not measured before 2022-23") rather than silently missing, so the gaps in the data become something the app teaches
- **Career history** on the player detail page, every season expandable into its rounds, with per season gameweek range and venue filters
- **Season selector** covering 2016-17 through the current season, with the availability of each stat recomputed per season
- **Player comparison** on a radar chart, up to four traces at once, scored against fixed per axis thresholds derived from a 2,827 player season cohort, with the position's average drawn as a band underneath
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
| player_seasons | 7,338 |
| fixtures | 3,800 |
| players | 2,623 |
| team_seasons | 200 |
| teams | 34 |

Ten seasons of one competition is not ten copies of the same schema. A few of the things settled during ingestion, all of which the app now has to render:

- **Coverage is not monotonic.** Tackles, clearances and recoveries appear from 2016-17 to 2018-19, vanish for six seasons, and return in 2025-26. The expected goals family starts in 2022-23. Defensive contributions exist only from 2025-26.
- **Coverage is not even within a season.** The upstream scraper began collecting five columns partway through 2022-23, so a value can be real for one player and absent for another in the same season.
- **NULL and zero mean different things**, and the distinction is load bearing. NULL is not measured. Zero is measured, and nothing happened. There is also a third case: FPL computes defensive contribution as position scoped and assigns goalkeepers a zero rather than leaving it blank.
- **Rounds are not 1 to n.** The 2019-20 restart replayed rounds 30 to 38 as 39 to 47. The 2022-23 season skipped round 7 after the Queen's death.

Where a column is missing the app renders a placeholder, never a zero. Where an average is shown, its denominator is stated.

## Verification

Alongside the test suites there are read only scripts that check derived output against the source data rather than against the code that produced it. They run against a populated database and are deliberately kept out of `npm test`, since they need one:

```bash
npm run verify:history-past   # cross-checks season aggregates against FPL's own history_past
npm run verify:columns        # re-derives the per season availability matrix independently
npm run verify:defcon         # checks the defensive contribution threshold against a frozen distribution
npm run verify:haul           # checks the 10+ and 4+ point return counts
npm run verify:thresholds     # re-derives the comparison chart's per axis floors and ceilings
```

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

**2. Start Postgres**

```bash
docker compose up -d postgres
```

The dev database publishes on host port 5434 to stay clear of a native Postgres on 5432.

**3. Configure the environment**

```bash
cp .env.example .env
```

**4. Run the migrations**

```bash
npm run migrate:up
```

**5. Get the historical data**

The ten complete seasons are ingested from a local clone of the [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) dataset. Clone it anywhere and point `FPL_DATA_DIR` in your `.env` at it.

```bash
git clone https://github.com/vaastav/Fantasy-Premier-League.git
```

**6. Ingest**

Order matters: fixtures reference teams, and gameweeks reference both.

```bash
npm run ingest:dimensions   # teams and players
npm run ingest:fixtures
npm run ingest:gameweeks    # the fact table, ~253k rows
```

Then pull the current season from the live API:

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

Three containers behind Nginx: Postgres, the API server, and Nginx serving the static client build and proxying `/api` so the browser sees a single origin.

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

The migrate step is profile gated and sits between build and up, so the schema is ready before the new code reaches it. Production data arrives by `pg_restore`, not by ingestion: the runtime image deliberately ships without the tooling to write to the database.

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

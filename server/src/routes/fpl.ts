/**
 * The read API. Phase 0 step 6 moved all three routes off the live FPL API and
 * onto Postgres; step 7 typed the boundary.
 *
 * This file maps domain objects (../types/domain.ts) to response bodies
 * (../types/api.ts). The mapping is small on purpose — it adds the season and
 * the fields that exist in the shape but have no source in the data, and
 * nothing else. Everything that required a decision about meaning happened in
 * the repository.
 *
 * Three things about the shape, all in "API Identity Rules":
 *
 *   1. Ids in responses are permanent codes, never season-scoped FPL ids.
 *      `players[].id` is `players.fpl_code`, and every team id — `teams[].id`,
 *      `players[].team`, `history[].opponent_team` — is `teams.fpl_team_code`.
 *      FPL reassigns its element and team ids every August, so a URL or a
 *      cached id built on one silently comes to mean somebody else.
 *   2. Every response names its season (rule 7).
 *   3. Fields with no source are null, never invented (rule 4).
 *
 * No SQL lives in this file. It all lives in ../repositories.
 *
 * ../services/fplApi.ts is intentionally not imported here any more. It is not
 * dead code: it is the ingestion source for the live season.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { latestSeason, listSeasons, seasonExists } from '../repositories/seasons.js';
import { listTeams } from '../repositories/teams.js';
import {
  getPlayerCareer,
  getPlayerHistory,
  getPlayerIdentity,
  getPlayerUpcomingFixtures,
  listPlayerTotals,
  playerExists,
} from '../repositories/players.js';
import { listEvents, listFixtures } from '../repositories/fixtures.js';
import { listColumnHistory, seasonAvailability } from '../repositories/columns.js';
import { COMPARISON_THRESHOLDS } from '../comparison/thresholds.js';
import type {
  BootstrapResponse,
  ColumnHistoryResponse,
  ComparisonThresholdsResponse,
  ErrorResponse,
  FixturesResponse,
  PlayerCareerResponse,
  PlayerDetailResponse,
} from '../types/api.js';

const router = Router();

/** Rule 8: '2016-17'. Rejected early so a typo cannot reach a query. */
const SEASON_FORMAT = /^\d{4}-\d{2}$/;

/**
 * Resolve ?season=, defaulting to the latest season in the database.
 *
 * An unknown season is a 400 rather than a silent fall back to the default:
 * quietly serving 2025-26 to someone who asked for 2019-20 is worse than
 * saying no, because the response looks perfectly valid.
 *
 * The season it returns is the one every response then reports, so a client
 * that sends nothing is still told which season it got.
 */
async function resolveSeason(req: Request, res: Response): Promise<string | null> {
  const requested = req.query.season;
  if (requested === undefined) return latestSeason(pool);

  const season = String(requested);
  if (!SEASON_FORMAT.test(season) || !(await seasonExists(pool, season))) {
    const body: ErrorResponse = {
      error: `Unknown season '${season}'`,
      available: await listSeasons(pool),
    };
    res.status(400).json(body);
    return null;
  }
  return season;
}

// GET /api/bootstrap — all players, teams, gameweeks for one season
router.get('/bootstrap', async (req: Request, res: Response) => {
  try {
    const season = await resolveSeason(req, res);
    if (season === null) return;

    // `seasons` rides along here rather than on a route of its own: the
    // selector needs the list before it can render, and this is already the one
    // request the whole app blocks on at mount. Arriving on the same payload as
    // `season` also means "which season this is" and "which seasons exist"
    // cannot disagree. See BootstrapResponse for why it is not on the other two.
    const [players, teams, events, seasons] = await Promise.all([
      listPlayerTotals(pool, season),
      listTeams(pool, season),
      listEvents(pool, season),
      listSeasons(pool),
    ]);

    const positions = [
      { id: 1, name: 'Goalkeeper' },
      { id: 2, name: 'Defender' },
      { id: 3, name: 'Midfielder' },
      { id: 4, name: 'Forward' },
    ];

    const body: BootstrapResponse = {
      season,
      seasons,
      // Built from the `players` rows above rather than queried. See
      // seasonAvailability: ten of the eleven seasons pay no extra query.
      columns: await seasonAvailability(pool, season, players),
      players: players.map((p) => ({
        ...p,
        // Live-only fields. They describe the state of the game right now —
        // who is injured, what the market thinks — which is not something a
        // completed season has. They will be filled by the bootstrap sync that
        // ingests the live season; until then, null rather than an invented
        // value, and present rather than omitted so the shape does not move
        // when they become real.
        form: null,
        selected_by_percent: null,
        status: null,
        news: null,
        chance_of_playing_next_round: null,
      })),
      teams,
      // Passed straight through since item 4. The deadline comes from `events`
      // and the two flags are derived from it against the clock, both in
      // listEvents. They were hardcoded null/false/false here while nothing in
      // the database could answer them; over a completed season the values are
      // the same, because a season with no deadlines has no current or next
      // round (API identity rule 6).
      events,
      positions,
    };
    res.json(body);
  } catch (err) {
    console.error('Bootstrap query failed:', err);
    res.status(500).json({ error: 'Failed to load FPL data' } satisfies ErrorResponse);
  }
});

/**
 * GET /api/columns — column availability across every season.
 *
 * **Takes no `?season=` and rejects the idea of one.** It is the second response
 * in this API that spans seasons, `/player/:code/career` being the first, so it
 * follows the same rule: no top-level `season`, and every row carries its own
 * (API identity rule 7). Asking it for one season would be asking the bootstrap.
 *
 * It exists for the picker's reason strings rather than for what renders now —
 * "Not recorded in 2016-17 · recorded from 2022-23" is a claim about seasons
 * other than the one on screen, and no single-season payload can make it.
 * Nothing blocks on this: `bootstrap.columns` covers first paint and every
 * disabled entry already reads as a complete sentence without it.
 *
 * Measured at 57ms, which is why the client fetches it once per page load
 * off the critical path rather than on every picker open.
 *
 * No cache here, for the reason the bootstrap gives: a cache is a second source
 * of truth. The client not asking twice is a different thing from the server
 * remembering an answer.
 */
router.get('/columns', async (_req: Request, res: Response) => {
  try {
    const columns = await listColumnHistory(pool);
    res.json({ columns } satisfies ColumnHistoryResponse);
  } catch (err) {
    console.error('Column history query failed:', err);
    res.status(500).json({ error: 'Failed to load column availability' } satisfies ErrorResponse);
  }
});

/**
 * GET /api/comparison-thresholds — the frozen axis scales, per position.
 *
 * Static data, served rather than compiled into the client, and the reasons are
 * on `ComparisonThresholdsResponse` and on `comparison/thresholds.ts`. The short
 * version: re-derivation has to be a server-only change, and keeping these on
 * the server is what lets `verify:thresholds` import them with type checking
 * instead of reaching across packages.
 *
 * **No query, no season, and `?season=` is rejected rather than ignored.** A
 * threshold is derived from a *set* of seasons which it carries itself; asking
 * this route for one season is asking a question it has no form of. Rejecting
 * follows `/career`: accepting a parameter and silently doing something else
 * with it is how a caller ends up certain it filtered when it did not.
 *
 * No database access at all, so no try/catch and no 500 path — there is nothing
 * here that can fail at runtime that would not have failed at import.
 */
router.get('/comparison-thresholds', async (req: Request, res: Response) => {
  if (req.query.season !== undefined) {
    res.status(400).json({
      error:
        'Thresholds are frozen across seasons; ?season= is not accepted here. Each axis carries the seasons it was derived from.',
      available: await listSeasons(pool),
    } satisfies ErrorResponse);
    return;
  }

  res.json({ thresholds: COMPARISON_THRESHOLDS } satisfies ComparisonThresholdsResponse);
});

/**
 * GET /api/player/:code — gameweek-by-gameweek history.
 *
 * :code is `players.fpl_code`, NOT an FPL element id. This is the one
 * deliberate breaking change of step 6. The element id is reassigned every
 * August, so /api/player/328 would address a different footballer each season
 * and every bookmarked or stored URL would rot at rollover. The code is
 * permanent.
 */
router.get('/player/:code', async (req: Request, res: Response) => {
  try {
    const fplCode = Number(req.params.code);
    if (!Number.isInteger(fplCode)) {
      res.status(400).json({ error: 'Invalid player code' } satisfies ErrorResponse);
      return;
    }

    const season = await resolveSeason(req, res);
    if (season === null) return;

    if (!(await playerExists(pool, fplCode))) {
      res.status(404).json({ error: `No player with code ${fplCode}` } satisfies ErrorResponse);
      return;
    }

    // history: matches played. fixtures: what is left to play, which is empty
    // for every completed season. teams: that season's clubs, so the opponent
    // column can be named without borrowing the bootstrap's — which is the
    // latest season's twenty and cannot name a club relegated in 2017.
    const [history, fixtures, teams] = await Promise.all([
      getPlayerHistory(pool, fplCode, season),
      getPlayerUpcomingFixtures(pool, fplCode, season),
      listTeams(pool, season),
    ]);

    const body: PlayerDetailResponse = { season, history, fixtures, teams };
    res.json(body);
  } catch (err) {
    console.error('Player query failed:', err);
    res.status(500).json({ error: 'Failed to load player data' } satisfies ErrorResponse);
  }
});

/**
 * GET /api/player/:code/career — one summary row per season, newest first.
 *
 * The only response in the API that spans seasons, and so the only one with no
 * top-level `season`. API identity rule 7 asks that every piece of data on
 * screen be labelled with the season it came from; over ten seasons that label
 * belongs on the row, and `seasons[].season` carries it. A top-level null would
 * overload null, which means "not measured" everywhere else here (rule 6).
 *
 * `?season=` is rejected rather than ignored. Accepting a parameter and
 * silently doing something else with it is how a caller ends up certain it
 * filtered when it did not.
 */
router.get('/player/:code/career', async (req: Request, res: Response) => {
  try {
    const fplCode = Number(req.params.code);
    if (!Number.isInteger(fplCode)) {
      res.status(400).json({ error: 'Invalid player code' } satisfies ErrorResponse);
      return;
    }

    if (req.query.season !== undefined) {
      res.status(400).json({
        error: 'A career spans every season; ?season= is not accepted here. Use /api/player/:code?season= for one.',
        available: await listSeasons(pool),
      } satisfies ErrorResponse);
      return;
    }

    // One query where there were two: null is the same 404 `playerExists` gave,
    // and a hit is the identity block the response carries. That block is who
    // the player is with no season attached, which is what the detail page
    // renders him by when the selected season has no player-season for him.
    const player = await getPlayerIdentity(pool, fplCode);
    if (player === null) {
      res.status(404).json({ error: `No player with code ${fplCode}` } satisfies ErrorResponse);
      return;
    }

    const body: PlayerCareerResponse = { player, seasons: await getPlayerCareer(pool, fplCode) };
    res.json(body);
  } catch (err) {
    console.error('Career query failed:', err);
    res.status(500).json({ error: 'Failed to load player career' } satisfies ErrorResponse);
  }
});

// GET /api/fixtures — one season's fixtures (optional ?event=N to filter)
router.get('/fixtures', async (req: Request, res: Response) => {
  try {
    const season = await resolveSeason(req, res);
    if (season === null) return;

    const raw = req.query.event;
    let event: number | undefined;
    if (raw !== undefined) {
      event = Number(raw);
      if (!Number.isInteger(event)) {
        res.status(400).json({ error: 'Invalid event' } satisfies ErrorResponse);
        return;
      }
    }

    const fixtures = await listFixtures(pool, season, event);

    const body: FixturesResponse = {
      season,
      // FPL's own permanent fixture code, which was never ingested. Null, not
      // absent: the key is part of the shape (API identity rule 4).
      fixtures: fixtures.map((f) => ({ ...f, code: null })),
    };
    res.json(body);
  } catch (err) {
    console.error('Fixtures query failed:', err);
    res.status(500).json({ error: 'Failed to load fixtures' } satisfies ErrorResponse);
  }
});

export default router;

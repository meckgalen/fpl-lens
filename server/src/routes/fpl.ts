/**
 * The read API. Phase 0 step 6 moved all three routes off the live FPL API and
 * onto Postgres.
 *
 * The response shapes are unchanged from the live-API era, deliberately, so the
 * client keeps working untouched — with two intentional exceptions, both about
 * identity:
 *
 *   1. Ids in responses are permanent codes, never season-scoped FPL ids.
 *      `players[].id` is `players.fpl_code`, and every team id — `teams[].id`,
 *      `players[].team`, `history[].opponent_team` — is `teams.fpl_team_code`.
 *      FPL reassigns its element and team ids every August, so a URL or a
 *      cached id built on one silently comes to mean somebody else. The
 *      season-scoped ids stay in the ingest layer, where `player_seasons` and
 *      `team_seasons` translate them.
 *
 *   2. Seven fields have no source in the database. `photo` and
 *      `points_per_game` are derivable and are derived; the other five return
 *      null. See the comment on the bootstrap handler.
 *
 * The database holds ten seasons where the FPL shape assumes one, so both
 * player-facing routes take an optional ?season= and otherwise use the latest
 * season present. The client does not send it yet.
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
  getPlayerHistory,
  getPlayerUpcomingFixtures,
  listPlayerTotals,
  playerExists,
} from '../repositories/players.js';
import { listEvents, listFixtures } from '../repositories/fixtures.js';

const router = Router();

/** Rule 8: '2016-17'. Rejected early so a typo cannot reach a query. */
const SEASON_FORMAT = /^\d{4}-\d{2}$/;

/**
 * Resolve ?season=, defaulting to the latest season in the database.
 *
 * An unknown season is a 400 rather than a silent fall back to the default:
 * quietly serving 2025-26 to someone who asked for 2019-20 is worse than
 * saying no, because the response looks perfectly valid.
 */
async function resolveSeason(req: Request, res: Response): Promise<string | null> {
  const requested = req.query.season;
  if (requested === undefined) return latestSeason(pool);

  const season = String(requested);
  if (!SEASON_FORMAT.test(season) || !(await seasonExists(pool, season))) {
    res.status(400).json({
      error: `Unknown season '${season}'`,
      available: await listSeasons(pool),
    });
    return null;
  }
  return season;
}

// GET /api/bootstrap — all players, teams, gameweeks for one season
router.get('/bootstrap', async (req: Request, res: Response) => {
  try {
    const season = await resolveSeason(req, res);
    if (season === null) return;

    const [players, teams, events] = await Promise.all([
      listPlayerTotals(pool, season),
      listTeams(pool, season),
      listEvents(pool, season),
    ]);

    const positions = [
      { id: 1, name: 'Goalkeeper' },
      { id: 2, name: 'Defender' },
      { id: 3, name: 'Midfielder' },
      { id: 4, name: 'Forward' },
    ];

    // Deliberately no `season` key, tempting as it is: the brief is that the
    // shape does not move except for the two identity changes, and an added
    // key is still a moved shape. It belongs in the step 7 types split.
    res.json({
      players: players.map((p) => ({
        ...p,
        // Live-only fields, kept present so the response shape does not move.
        // They describe the state of the game right now — who is injured, what
        // the market thinks — which is not something a historical season has.
        // They will be filled by the bootstrap sync that ingests the live
        // season; until then, null rather than an invented value.
        form: null,
        selected_by_percent: null,
        status: null,
        news: null,
        chance_of_playing_next_round: null,
      })),
      teams,
      events,
      positions,
    });
  } catch (err) {
    console.error('Bootstrap query failed:', err);
    res.status(500).json({ error: 'Failed to load FPL data' });
  }
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
      res.status(400).json({ error: 'Invalid player code' });
      return;
    }

    const season = await resolveSeason(req, res);
    if (season === null) return;

    if (!(await playerExists(pool, fplCode))) {
      res.status(404).json({ error: `No player with code ${fplCode}` });
      return;
    }

    // history: matches played. fixtures: what is left to play, which is empty
    // for every completed season.
    const [history, fixtures] = await Promise.all([
      getPlayerHistory(pool, fplCode, season),
      getPlayerUpcomingFixtures(pool, fplCode, season),
    ]);

    res.json({ history, fixtures });
  } catch (err) {
    console.error('Player query failed:', err);
    res.status(500).json({ error: 'Failed to load player data' });
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
        res.status(400).json({ error: 'Invalid event' });
        return;
      }
    }

    const fixtures = await listFixtures(pool, season, event);
    res.json({ fixtures });
  } catch (err) {
    console.error('Fixtures query failed:', err);
    res.status(500).json({ error: 'Failed to load fixtures' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { getBootstrap, getPlayerDetail, getFixtures } from '../services/fplApi.js';

const router = Router();

// GET /api/bootstrap — all players, teams, gameweeks
router.get('/bootstrap', async (_req: Request, res: Response) => {
  try {
    const data = await getBootstrap();

    // Build a teams lookup for the frontend
    const teams = data.teams.map((t: any) => ({
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      strength_overall_home: t.strength_overall_home,
      strength_overall_away: t.strength_overall_away,
      strength_attack_home: t.strength_attack_home,
      strength_attack_away: t.strength_attack_away,
      strength_defence_home: t.strength_defence_home,
      strength_defence_away: t.strength_defence_away,
    }));

    // Slim down players to what the frontend needs
    const players = data.elements.map((p: any) => ({
      id: p.id,
      first_name: p.first_name,
      second_name: p.second_name,
      web_name: p.web_name,
      team: p.team,
      element_type: p.element_type, // 1=GKP, 2=DEF, 3=MID, 4=FWD
      now_cost: p.now_cost, // divide by 10 for actual price
      total_points: p.total_points,
      minutes: p.minutes,
      goals_scored: p.goals_scored,
      assists: p.assists,
      clean_sheets: p.clean_sheets,
      expected_goals: p.expected_goals,
      expected_assists: p.expected_assists,
      expected_goal_involvements: p.expected_goal_involvements,
      ict_index: p.ict_index,
      influence: p.influence,
      creativity: p.creativity,
      threat: p.threat,
      bonus: p.bonus,
      bps: p.bps,
      form: p.form,
      points_per_game: p.points_per_game,
      selected_by_percent: p.selected_by_percent,
      status: p.status, // a=available, d=doubtful, i=injured, s=suspended, u=unavailable
      chance_of_playing_next_round: p.chance_of_playing_next_round,
      news: p.news,
      photo: p.photo,
    }));

    const events = data.events.map((e: any) => ({
      id: e.id,
      name: e.name,
      deadline_time: e.deadline_time,
      finished: e.finished,
      is_current: e.is_current,
      is_next: e.is_next,
    }));

    const positions = [
      { id: 1, name: 'Goalkeeper' },
      { id: 2, name: 'Defender' },
      { id: 3, name: 'Midfielder' },
      { id: 4, name: 'Forward' },
    ];

    res.json({ players, teams, events, positions });
  } catch (err) {
    console.error('Bootstrap fetch failed:', err);
    res.status(500).json({ error: 'Failed to fetch FPL data' });
  }
});

// GET /api/player/:id — gameweek-by-gameweek history
router.get('/player/:id', async (req: Request, res: Response) => {
  try {
    const playerId = parseInt(req.params.id);
    if (isNaN(playerId)) {
      res.status(400).json({ error: 'Invalid player ID' });
      return;
    }

    const data = await getPlayerDetail(playerId);

    // data.history = past gameweek performances
    // data.fixtures = upcoming fixtures
    const history = data.history.map((gw: any) => ({
      round: gw.round,
      opponent_team: gw.opponent_team,
      was_home: gw.was_home,
      total_points: gw.total_points,
      minutes: gw.minutes,
      goals_scored: gw.goals_scored,
      assists: gw.assists,
      clean_sheets: gw.clean_sheets,
      goals_conceded: gw.goals_conceded,
      bonus: gw.bonus,
      bps: gw.bps,
      influence: gw.influence,
      creativity: gw.creativity,
      threat: gw.threat,
      ict_index: gw.ict_index,
      expected_goals: gw.expected_goals,
      expected_assists: gw.expected_assists,
      expected_goal_involvements: gw.expected_goal_involvements,
      value: gw.value, // price at that GW (divide by 10)
      selected: gw.selected,
      transfers_in: gw.transfers_in,
      transfers_out: gw.transfers_out,
    }));

    const fixtures = data.fixtures.map((f: any) => ({
      event: f.event,
      team_a: f.team_a,
      team_h: f.team_h,
      is_home: f.is_home,
      difficulty: f.difficulty,
    }));

    res.json({ history, fixtures });
  } catch (err) {
    console.error('Player detail fetch failed:', err);
    res.status(500).json({ error: 'Failed to fetch player data' });
  }
});

// GET /api/fixtures — all fixtures (optional ?event=N to filter)
router.get('/fixtures', async (req: Request, res: Response) => {
  try {
    const data = await getFixtures();
    const eventParam = req.query.event ? parseInt(req.query.event as string) : null;
    const fixtures = data
      .filter((f: any) => (eventParam == null ? true : f.event === eventParam))
      .map((f: any) => ({
        id: f.id,
        code: f.code,
        event: f.event,
        team_h: f.team_h,
        team_a: f.team_a,
        team_h_score: f.team_h_score,
        team_a_score: f.team_a_score,
        team_h_difficulty: f.team_h_difficulty,
        team_a_difficulty: f.team_a_difficulty,
        kickoff_time: f.kickoff_time,
        finished: f.finished,
      }));
    res.json({ fixtures });
  } catch (err) {
    console.error('Fixtures fetch failed:', err);
    res.status(500).json({ error: 'Failed to fetch fixtures' });
  }
});

export default router;

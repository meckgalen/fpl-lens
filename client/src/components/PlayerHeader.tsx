import type { Player, Team } from '../types/fpl';
import { POSITION_MAP, fmtNum, fmtOr, fmtPrice, statusOf } from '../types/fpl';
import { Card, CardContent } from './ui/Card';
import { PosBadge } from './PosBadge';

interface Props {
  player: Player;
  team: Team | undefined;
  /** The season these totals cover — see PlayerDetail for why it is passed. */
  season: string;
}

export default function PlayerHeader({ player, team, season }: Props) {
  const status = statusOf(player.status);

  // Form and Ownership have no source in the database and arrive null; xG, xA
  // and Starts are null for every season before 2022-23. All of them render the
  // "no value" placeholder rather than an empty tile, 'null%' or 'NaN'.
  //
  // Apps and Starts sit next to each other deliberately: a player can appear
  // more often than he starts, and on a double gameweek he can appear twice in
  // one round, so neither number is the count of rounds (rule 13).
  const stats: { label: string; value: string | number }[] = [
    { label: 'Total Pts', value: player.total_points },
    { label: 'PPG', value: fmtNum(player.points_per_game, 1) },
    { label: 'Form', value: fmtOr(player.form) },
    { label: 'Price', value: fmtPrice(player.now_cost) },
    { label: 'Ownership', value: fmtOr(player.selected_by_percent, '%') },
    { label: 'Minutes', value: player.minutes },
    { label: 'Apps', value: player.appearances },
    { label: 'Starts', value: fmtNum(player.starts, 0) },
    { label: 'Goals', value: player.goals_scored },
    { label: 'Assists', value: player.assists },
    { label: 'xG', value: fmtNum(player.expected_goals, 2) },
    { label: 'xA', value: fmtNum(player.expected_assists, 2) },
    { label: 'ICT', value: fmtNum(player.ict_index, 1) },
    { label: 'Bonus', value: player.bonus },
  ];

  return (
    <Card className="mb-4">
      <CardContent>
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              {player.first_name} {player.second_name}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground">{season}</span>
              <span>·</span>
              <span>{team?.name || 'Unknown'}</span>
              <span>·</span>
              <PosBadge pos={POSITION_MAP[player.element_type]} />
              <span>·</span>
              <span style={{ color: status.color }}>{status.label}</span>
              {player.news && (
                <>
                  <span>·</span>
                  <span className="italic">{player.news}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md bg-muted/60 px-2 py-2.5 text-center">
              <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground mb-1">{s.label}</div>
              <div className="font-display text-base font-semibold text-foreground tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

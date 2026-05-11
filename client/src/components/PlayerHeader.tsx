import type { Player, Team } from '../types/fpl';
import { POSITION_MAP, STATUS_MAP } from '../types/fpl';
import { Card, CardContent } from './ui/Card';
import { PosBadge } from './PosBadge';

interface Props {
  player: Player;
  team: Team | undefined;
}

export default function PlayerHeader({ player, team }: Props) {
  const status = STATUS_MAP[player.status] || STATUS_MAP['u'];

  const stats: { label: string; value: string | number }[] = [
    { label: 'Total Pts', value: player.total_points },
    { label: 'PPG', value: player.points_per_game },
    { label: 'Form', value: player.form },
    { label: 'Price', value: `£${(player.now_cost / 10).toFixed(1)}` },
    { label: 'Ownership', value: `${player.selected_by_percent}%` },
    { label: 'Minutes', value: player.minutes },
    { label: 'Goals', value: player.goals_scored },
    { label: 'Assists', value: player.assists },
    { label: 'xG', value: parseFloat(player.expected_goals).toFixed(2) },
    { label: 'xA', value: parseFloat(player.expected_assists).toFixed(2) },
    { label: 'ICT', value: parseFloat(player.ict_index).toFixed(1) },
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

import { useState, useRef, useEffect } from 'react';
import type { Player, Team } from '../types/fpl';
import { POSITION_MAP } from '../types/fpl';

interface Props {
  players: Player[];
  teams: Team[];
  onSelect: (player: Player) => void;
}

export default function PlayerSearch({ players, teams, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.short_name]));

  const filtered = query.length >= 2
    ? players
        .filter((p) => {
          const name = `${p.first_name} ${p.second_name}`.toLowerCase();
          const web = p.web_name.toLowerCase();
          const q = query.toLowerCase();
          return name.includes(q) || web.includes(q);
        })
        .slice(0, 12)
    : [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', maxWidth: 420 }}>
      <input
        type="text"
        placeholder="Search player..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        style={{
          width: '100%',
          padding: '10px 14px',
          fontSize: 16,
          border: '2px solid #333',
          borderRadius: 6,
          background: '#1a1a2e',
          color: '#e0e0e0',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {isOpen && filtered.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            margin: 0,
            padding: 0,
            listStyle: 'none',
            background: '#16213e',
            border: '1px solid #333',
            borderRadius: '0 0 6px 6px',
            maxHeight: 320,
            overflowY: 'auto',
            zIndex: 10,
          }}
        >
          {filtered.map((p) => (
            <li
              key={p.id}
              onClick={() => {
                onSelect(p);
                setQuery(p.web_name);
                setIsOpen(false);
              }}
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid #1a1a2e',
                color: '#e0e0e0',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a2e')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>
                <strong>{p.web_name}</strong>{' '}
                <span style={{ opacity: 0.6, fontSize: 13 }}>
                  {p.first_name} {p.second_name}
                </span>
              </span>
              <span style={{ fontSize: 13, opacity: 0.7 }}>
                {teamMap[p.team]} · {POSITION_MAP[p.element_type]} · £{(p.now_cost / 10).toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

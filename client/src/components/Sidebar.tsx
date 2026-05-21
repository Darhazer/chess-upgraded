import { useMemo } from 'react';
import MoveHistory from './MoveHistory.js';
import type { SavedRoom } from '../services/player-id.js';
import type { ServerPlayer } from '../features/game/derive-game-state.js';

const colorName = (c: string): string => (c === 'w' ? 'White' : 'Black');

function Invite({ roomCode }: { roomCode: string }) {
  const url = useMemo(
    () => `${window.location.origin}${window.location.pathname}?room=${roomCode}`,
    [roomCode],
  );
  const onCopy = (): void => { navigator.clipboard?.writeText(url); };
  return (
    <div className="invite">
      <p>Share this to invite a player:</p>
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button onClick={onCopy}>Copy invite link</button>
    </div>
  );
}

interface Result {
  result: string;
  reason: string;
}

function ResultBanner({ result }: { result: Result }) {
  const display = result.result === 'draw' ? 'Draw' : `${colorName(result.result[0]!)} wins`;
  return (
    <div className="result">
      <strong>Game over:</strong> {display} ({result.reason})
    </div>
  );
}

const variantName = (v: string): string => (v === 'cannibal' ? 'Cannibal Chess' : 'Chess Upgraded');

interface SidebarProps {
  room: SavedRoom;
  variant: string;
  status: 'waiting' | 'playing' | 'over' | undefined;
  result: Result | null | undefined;
  me: ServerPlayer | undefined;
  opponent: ServerPlayer | undefined;
  myTurn: boolean;
  onResign: () => void;
  onLeave: () => void;
  moveError: string;
  history: Array<{ kind?: string; san: string }>;
}

export default function Sidebar({
  room,
  variant,
  status,
  result,
  me,
  opponent,
  myTurn,
  onResign,
  onLeave,
  moveError,
  history,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="room-meta">
        <div><strong>Room:</strong> <span className="code">{room.code}</span></div>
        <div><strong>Variant:</strong> {variantName(variant)}</div>
        <div>
          <strong>You:</strong> {me?.name || colorName(room.color)} ({colorName(room.color)})
        </div>
        <div>
          <strong>Opponent:</strong>{' '}
          {opponent?.name || (status === 'waiting' ? 'waiting…' : '—')}
        </div>
      </div>

      {status === 'waiting' && <Invite roomCode={room.code} />}

      {status === 'playing' && (
        <div className="turn">{myTurn ? 'Your move' : "Opponent's move"}</div>
      )}

      {status === 'over' && result && <ResultBanner result={result} />}

      <div className="actions">
        {status === 'playing' && <button onClick={onResign}>Resign</button>}
        <button onClick={onLeave}>Leave</button>
      </div>

      {moveError && <p className="error">{moveError}</p>}

      <MoveHistory history={history} />
    </aside>
  );
}

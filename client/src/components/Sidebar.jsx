import { useMemo } from 'react';
import MoveHistory from './MoveHistory.jsx';

const colorName = (c) => (c === 'w' ? 'White' : 'Black');

function Invite({ roomCode }) {
  const url = useMemo(
    () => `${window.location.origin}${window.location.pathname}?room=${roomCode}`,
    [roomCode]
  );
  const onCopy = () => navigator.clipboard?.writeText(url);
  return (
    <div className="invite">
      <p>Share this to invite a player:</p>
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button onClick={onCopy}>Copy invite link</button>
    </div>
  );
}

function ResultBanner({ result }) {
  const display = result.result === 'draw' ? 'Draw' : `${colorName(result.result[0])} wins`;
  return (
    <div className="result">
      <strong>Game over:</strong> {display} ({result.reason})
    </div>
  );
}

const variantName = (v) => (v === 'cannibal' ? 'Cannibal Chess' : 'Chess Upgraded');

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
}) {
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

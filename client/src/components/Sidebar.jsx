import { useMemo } from 'react';
import UpgradeBar from './UpgradeBar.jsx';
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

export default function Sidebar({
  room,
  status,
  result,
  me,
  opponent,
  myTurn,
  myBar,
  oppBar,
  barMax,
  opponentColor,
  upgradeMode,
  canUpgrade,
  onStartUpgrade,
  onCancelUpgrade,
  onResign,
  onLeave,
  moveError,
  history,
}) {
  return (
    <aside className="sidebar">
      <div className="room-meta">
        <div><strong>Room:</strong> <span className="code">{room.code}</span></div>
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
        <>
          <div className="turn">{myTurn ? 'Your move' : "Opponent's move"}</div>
          <div className="bars">
            <UpgradeBar label={`You (${colorName(room.color)})`} value={myBar} max={barMax} mine />
            <UpgradeBar label={`Opp (${colorName(opponentColor)})`} value={oppBar} max={barMax} />
          </div>
          {!upgradeMode && (
            <button
              className={canUpgrade ? 'primary' : ''}
              disabled={!canUpgrade}
              onClick={onStartUpgrade}
            >
              {canUpgrade ? 'Upgrade a piece' : `Upgrade (${myBar}/${barMax})`}
            </button>
          )}
          {upgradeMode && (
            <div className="upgrade-prompt">
              <p>Click one of your highlighted pieces to upgrade.</p>
              <button onClick={onCancelUpgrade}>Cancel</button>
            </div>
          )}
        </>
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

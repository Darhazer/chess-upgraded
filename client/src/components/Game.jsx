import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { socket } from '../socket.js';
import { PIECE_SVGS } from '../piece-svgs.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];

// Mirror of server's _customMovesFor — returns squares an upgraded piece
// can reach via its bonus pattern, ignoring king-safety. Server is authoritative.
function customTargets(type, from, color, chess) {
  const f = from.charCodeAt(0) - 97;
  const r = parseInt(from[1], 10) - 1;
  let deltas = [];
  if (type === 'r') deltas = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  else if (type === 'b') deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  else if (type === 'n') deltas = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
  else if (type === 'k' || type === 'q')
    deltas = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2]];

  const out = [];
  for (const [df, dr] of deltas) {
    const tf = f + df, tr = r + dr;
    if (tf < 0 || tf > 7 || tr < 0 || tr > 7) continue;
    const target = FILES[tf] + (tr + 1);
    const dest = chess.get(target);
    if (type === 'k' || type === 'q') {
      if (dest) continue;
    } else {
      if (dest && dest.color === color) continue;
    }
    out.push(target);
  }
  return out;
}

export default function Game({ room, state, onLeave }) {
  const [moveError, setMoveError] = useState('');
  const [upgradeMode, setUpgradeMode] = useState(false);
  const [dragHints, setDragHints] = useState(null); // Set<square> | null

  const local = useMemo(() => {
    const c = new Chess();
    if (state?.fen) c.load(state.fen);
    return c;
  }, [state?.fen]);

  const orientation = room.color === 'b' ? 'black' : 'white';
  const fen = state?.fen || 'start';
  const myTurn = state?.status === 'playing' && state?.turn === room.color;
  const opponentColor = room.color === 'w' ? 'b' : 'w';
  const barMax = state?.barMax ?? 3;
  const myBar = state?.bar?.[room.color] ?? 0;
  const oppBar = state?.bar?.[opponentColor] ?? 0;
  const upgradedKey = (state?.upgraded || []).join(',');
  const upgradedSet = useMemo(() => new Set(state?.upgraded || []), [upgradedKey]);
  const canUpgrade = myTurn && myBar >= barMax;

  useEffect(() => {
    if (!myTurn && upgradeMode) setUpgradeMode(false);
    if (!myTurn) setDragHints(null);
  }, [myTurn, upgradeMode]);

  // react-chessboard's useDrag is memoized on [piece, square, currentPosition, id]
  // and does NOT include onPieceDragBegin/End in its deps. Without a stable
  // reference reading latest state via a ref, the callbacks captured at
  // initial render (when myTurn was false) would be the ones invoked, and
  // hints would never compute. Same pattern as isDraggablePiece.
  const dragStateRef = useRef({ myTurn, upgradeMode, local, color: room.color, upgradedSet });
  dragStateRef.current = { myTurn, upgradeMode, local, color: room.color, upgradedSet };

  const onPieceDragBegin = useCallback((_piece, sourceSquare) => {
    const s = dragStateRef.current;
    if (!s.myTurn || s.upgradeMode) return;
    const piece = s.local.get(sourceSquare);
    if (!piece || piece.color !== s.color) return;
    const targets = new Set();
    for (const m of s.local.moves({ square: sourceSquare, verbose: true })) {
      targets.add(m.to);
    }
    if (s.upgradedSet.has(sourceSquare)) {
      for (const t of customTargets(piece.type, sourceSquare, piece.color, s.local)) {
        targets.add(t);
      }
    }
    // Defer the state update so the in-flight drag isn't re-rendered
    // synchronously during react-dnd's drag-init path.
    setTimeout(() => setDragHints(targets), 0);
  }, []);

  const onPieceDragEnd = useCallback(() => {
    setTimeout(() => setDragHints(null), 0);
  }, []);

  const onPieceDrop = useCallback(
    (from, to) => {
      if (!myTurn || upgradeMode) return false;
      const piece = local.get(from);
      const isPawnPromotion =
        piece?.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
      const move = { from, to, ...(isPawnPromotion ? { promotion: 'q' } : {}) };
      setMoveError('');
      socket.emit('game:move', { code: room.code, move }, (res) => {
        if (!res?.ok) setMoveError(res?.error || 'illegal move');
      });
      return true;
    },
    [myTurn, upgradeMode, local, room.code]
  );

  // react-chessboard memoizes useDrag on [piece, square, ...] and does NOT
  // re-evaluate when isDraggablePiece's reference changes. Keeping this
  // function reference stable, with live state read from a ref, avoids the
  // stale-closure bug that was locking pieces from being dragged.
  const draggableStateRef = useRef({ myTurn, upgradeMode, color: room.color });
  draggableStateRef.current = { myTurn, upgradeMode, color: room.color };
  const isDraggablePiece = useCallback(({ piece }) => {
    const { myTurn: t, upgradeMode: u, color } = draggableStateRef.current;
    return t && !u && !!piece && piece[0].toLowerCase() === color;
  }, []);

  const onSquareClick = useCallback(
    (square) => {
      if (!upgradeMode) return;
      const piece = local.get(square);
      if (!piece || piece.color !== room.color) return;
      if (piece.type === 'p') return;
      if (upgradedSet.has(square)) return;
      setMoveError('');
      socket.emit('game:upgrade', { code: room.code, square }, (res) => {
        if (res?.ok) setUpgradeMode(false);
        else setMoveError(res?.error || 'upgrade failed');
      });
    },
    [upgradeMode, local, room.color, upgradedSet, room.code]
  );

  const resign = () => socket.emit('game:resign', { code: room.code });
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
  const copyInvite = () => navigator.clipboard?.writeText(inviteUrl);

  const opponent = state?.players?.find((p) => p.color !== room.color);
  const me = state?.players?.find((p) => p.color === room.color);
  const status = state?.status;
  const result = state?.result;

  // Minimal styles — only upgraded-piece highlight + upgrade-select highlight.
  const customSquareStyles = useMemo(() => {
    const styles = {};
    for (const sq of upgradedSet) {
      styles[sq] = {
        background:
          'radial-gradient(circle at center, rgba(255, 215, 60, 0.18) 0%, transparent 70%)',
      };
    }
    if (upgradeMode) {
      const board = local.board();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (!p || p.color !== room.color || p.type === 'p') continue;
          const sq = FILES[f] + (8 - r);
          if (upgradedSet.has(sq)) continue;
          styles[sq] = { ...(styles[sq] || {}), background: 'rgba(106, 169, 255, 0.45)' };
        }
      }
    }
    if (dragHints) {
      for (const sq of dragHints) {
        styles[sq] = {
          ...(styles[sq] || {}),
          boxShadow: 'inset 0 0 16px 2px rgba(106, 169, 255, 0.6)',
        };
      }
    }
    return styles;
  }, [upgradedSet, upgradeMode, local, room.color, dragHints]);

  // Custom piece renderer: same Cburnett SVG as the package default, but
  // the upgraded variant gets a piece-only drop-shadow + hue shift, so the
  // visual change is on the figure rather than around it. We read the
  // upgrade set from a ref so this map can stay stable across renders
  // (avoids the same useDrag stale-closure bug).
  const upgradedRef = useRef(upgradedSet);
  upgradedRef.current = upgradedSet;
  const customPieces = useMemo(() => {
    const out = {};
    for (const code of PIECE_CODES) {
      const html = PIECE_SVGS[code];
      out[code] = ({ squareWidth, square }) => {
        const isUpgraded = upgradedRef.current.has(square);
        return (
          <div
            style={{
              width: squareWidth,
              height: squareWidth,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              filter: isUpgraded
                ? 'drop-shadow(0 0 5px rgba(255, 215, 60, 1)) drop-shadow(0 0 2px rgba(255, 215, 60, 0.9)) hue-rotate(35deg) saturate(1.6)'
                : undefined,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      };
    }
    return out;
  }, []);

  return (
    <div className="game">
      <aside className="sidebar">
        <div className="room-meta">
          <div><strong>Room:</strong> <span className="code">{room.code}</span></div>
          <div><strong>You:</strong> {me?.name || (room.color === 'w' ? 'White' : 'Black')} ({room.color === 'w' ? 'White' : 'Black'})</div>
          <div><strong>Opponent:</strong> {opponent?.name || (status === 'waiting' ? 'waiting…' : '—')}</div>
        </div>

        {status === 'waiting' && (
          <div className="invite">
            <p>Share this to invite a player:</p>
            <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
            <button onClick={copyInvite}>Copy invite link</button>
          </div>
        )}

        {status === 'playing' && (
          <>
            <div className="turn">{myTurn ? 'Your move' : "Opponent's move"}</div>
            <div className="bars">
              <UpgradeBar label={`You (${room.color === 'w' ? 'White' : 'Black'})`} value={myBar} max={barMax} mine />
              <UpgradeBar label={`Opp (${opponentColor === 'w' ? 'White' : 'Black'})`} value={oppBar} max={barMax} />
            </div>
            {!upgradeMode && (
              <button
                className={canUpgrade ? 'primary' : ''}
                disabled={!canUpgrade}
                onClick={() => setUpgradeMode(true)}
              >
                {canUpgrade ? 'Upgrade a piece' : `Upgrade (${myBar}/${barMax})`}
              </button>
            )}
            {upgradeMode && (
              <div className="upgrade-prompt">
                <p>Click one of your highlighted pieces to upgrade.</p>
                <button onClick={() => setUpgradeMode(false)}>Cancel</button>
              </div>
            )}
          </>
        )}

        {status === 'over' && result && (
          <div className="result">
            <strong>Game over:</strong>{' '}
            {result.result === 'draw' ? 'Draw' : `${result.result} wins`} ({result.reason})
          </div>
        )}

        <div className="actions">
          {status === 'playing' && <button onClick={resign}>Resign</button>}
          <button onClick={onLeave}>Leave</button>
        </div>

        {moveError && <p className="error">{moveError}</p>}

        <div className="history">
          <h4>Moves</h4>
          <ol>
            {(state?.history || []).map((m, i) => (
              <li key={i} className={m.kind === 'upgrade' ? 'upgrade-entry' : m.kind === 'custom' ? 'custom-entry' : ''}>
                {m.san}
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <div className="board">
        <Chessboard
          position={fen === 'start' ? undefined : fen}
          onPieceDrop={onPieceDrop}
          onPieceDragBegin={onPieceDragBegin}
          onPieceDragEnd={onPieceDragEnd}
          onSquareClick={onSquareClick}
          boardOrientation={orientation}
          arePiecesDraggable={myTurn && !upgradeMode}
          isDraggablePiece={isDraggablePiece}
          customSquareStyles={customSquareStyles}
          customPieces={customPieces}
          boardWidth={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 360 : 560)}
        />
      </div>
    </div>
  );
}

function UpgradeBar({ label, value, max, mine }) {
  const pct = Math.min(100, (value / max) * 100);
  const full = value >= max;
  return (
    <div className={`bar ${mine ? 'mine' : ''} ${full ? 'full' : ''}`}>
      <div className="bar-label">
        <span>{label}</span>
        <span>{value}/{max}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

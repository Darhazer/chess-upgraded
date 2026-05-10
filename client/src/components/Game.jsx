import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../services/socket-context.jsx';
import { gameApi } from '../services/game-api.js';
import { useGameState } from '../features/game/useGameState.js';
import { useDragHints } from '../features/game/useDragHints.js';
import { useCustomPieces } from '../features/game/useCustomPieces.jsx';
import {
  dragHintLayer,
  mergeSquareStyles,
  upgradedGlowLayer,
  upgradePickableLayer,
} from '../features/game/square-styles.js';
import { useLatest } from '../hooks/useLatest.js';
import Sidebar from './Sidebar.jsx';
import Board from './Board.jsx';

export default function Game({ room, state, onLeave }) {
  const { socket } = useSocket();
  const g = useGameState(room, state);
  const [moveError, setMoveError] = useState('');
  const [upgradeMode, setUpgradeMode] = useState(false);

  const drag = useDragHints({
    myTurn: g.myTurn,
    upgradeMode,
    color: room.color,
    local: g.local,
    upgradedSet: g.upgradedSet,
  });

  // Leaving upgrade-mode and clearing hints when it's no longer our turn
  // are the only cross-cutting state effects — keep them visible here
  // rather than burying inside hooks.
  useEffect(() => {
    if (!g.myTurn && upgradeMode) setUpgradeMode(false);
    if (!g.myTurn) drag.clearHints();
  }, [g.myTurn, upgradeMode, drag]);

  const onPieceDrop = useCallback(
    (from, to) => {
      if (!g.myTurn || upgradeMode) return false;
      const piece = g.local.get(from);
      const isPromotion =
        piece?.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
      const move = { from, to, ...(isPromotion ? { promotion: 'q' } : {}) };
      setMoveError('');
      gameApi.move(socket, room.code, move).then((res) => {
        if (!res.ok) setMoveError(res.error || 'illegal move');
      });
      return true;
    },
    [g.myTurn, g.local, upgradeMode, socket, room.code]
  );

  // Same react-chessboard stale-closure caveat as useDragHints.
  const draggableRef = useLatest({ myTurn: g.myTurn, upgradeMode, color: room.color });
  const isDraggablePiece = useCallback(({ piece }) => {
    const { myTurn, upgradeMode, color } = draggableRef.current;
    return myTurn && !upgradeMode && !!piece && piece[0].toLowerCase() === color;
  }, [draggableRef]);

  const onSquareClick = useCallback(
    (square) => {
      if (!upgradeMode) return;
      const piece = g.local.get(square);
      if (!piece || piece.color !== room.color) return;
      if (piece.type === 'p' || g.upgradedSet.has(square)) return;
      setMoveError('');
      gameApi.upgrade(socket, room.code, square).then((res) => {
        if (res.ok) setUpgradeMode(false);
        else setMoveError(res.error || 'upgrade failed');
      });
    },
    [upgradeMode, g.local, g.upgradedSet, room.color, socket, room.code]
  );

  const customSquareStyles = useMemo(
    () => mergeSquareStyles(
      upgradedGlowLayer(g.upgradedSet),
      upgradeMode && upgradePickableLayer(g.local, room.color, g.upgradedSet),
      drag.hints && dragHintLayer(drag.hints),
    ),
    [g.upgradedSet, upgradeMode, g.local, room.color, drag.hints]
  );

  const customPieces = useCustomPieces(g.upgradedSet);

  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
  const copyInvite = () => navigator.clipboard?.writeText(inviteUrl);
  const boardWidth = Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 360 : 560);

  return (
    <div className="game">
      <Sidebar
        room={room}
        status={g.status}
        result={g.result}
        me={g.me}
        opponent={g.opponent}
        myTurn={g.myTurn}
        myBar={g.myBar}
        oppBar={g.oppBar}
        barMax={g.barMax}
        opponentColor={g.opponentColor}
        upgradeMode={upgradeMode}
        canUpgrade={g.canUpgrade}
        inviteUrl={inviteUrl}
        onCopyInvite={copyInvite}
        onStartUpgrade={() => setUpgradeMode(true)}
        onCancelUpgrade={() => setUpgradeMode(false)}
        onResign={() => gameApi.resign(socket, room.code)}
        onLeave={onLeave}
        moveError={moveError}
        history={g.history}
      />
      <Board
        fen={g.fen}
        orientation={g.orientation}
        myTurn={g.myTurn}
        upgradeMode={upgradeMode}
        onPieceDrop={onPieceDrop}
        onPieceDragBegin={drag.onDragBegin}
        onPieceDragEnd={drag.onDragEnd}
        onSquareClick={onSquareClick}
        isDraggablePiece={isDraggablePiece}
        customSquareStyles={customSquareStyles}
        customPieces={customPieces}
        width={boardWidth}
      />
    </div>
  );
}

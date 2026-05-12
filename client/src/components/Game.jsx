import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../services/socket-context.jsx';
import { gameApi } from '../services/game-api.js';
import { useGameState } from '../features/game/useGameState.js';
import { useDragHints } from '../features/game/useDragHints.js';
import { useTapMove } from '../features/game/useTapMove.js';
import { useCustomPieces } from '../features/game/useCustomPieces.jsx';
import {
  dragHintLayer,
  mergeSquareStyles,
  selectedSquareLayer,
  upgradedGlowLayer,
  upgradePickableLayer,
} from '../features/game/square-styles.js';
import { useLatest } from '../hooks/useLatest.js';
import Sidebar from './Sidebar.jsx';
import Board from './Board.jsx';

const MOBILE_BREAKPOINT = 720;

function useBoardWidth() {
  const [width, setWidth] = useState(() => computeBoardWidth());
  useEffect(() => {
    const onResize = () => setWidth(computeBoardWidth());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return width;
}

function computeBoardWidth() {
  if (typeof window === 'undefined') return 560;
  const w = window.innerWidth;
  if (w <= MOBILE_BREAKPOINT) return Math.min(w - 24, 560);
  return Math.min(560, w - 360);
}

export default function Game({ room, state, onLeave }) {
  const { socket } = useSocket();
  const g = useGameState(room, state);
  const [moveError, setMoveError] = useState('');
  const [upgradeMode, setUpgradeMode] = useState(false);
  // Tap-selection lives here (not inside useTapMove) so the drag handler
  // can clear it without reaching into another hook's API.
  const [selected, setSelected] = useState(null);

  // Upgrade mode is implicitly cancelled when it stops being our turn —
  // derive that rather than syncing via an effect. The hooks below
  // *also* gate on myTurn internally; the redundancy is intentional so
  // each hook stays self-consistent if used with different upstream
  // gating.
  const effectiveUpgradeMode = upgradeMode && g.myTurn;

  const submitMove = useCallback(
    (from, to) => {
      const piece = g.local.get(from);
      const isPromotion =
        piece?.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
      const move = { from, to, ...(isPromotion ? { promotion: 'q' } : {}) };
      setMoveError('');
      gameApi.move(socket, room.code, move).then((res) => {
        if (!res.ok) setMoveError(res.error || 'illegal move');
      });
    },
    [g.local, socket, room.code]
  );

  const drag = useDragHints({
    myTurn: g.myTurn,
    upgradeMode: effectiveUpgradeMode,
    color: room.color,
    local: g.local,
    upgradedSet: g.upgradedSet,
  });

  const tap = useTapMove({
    myTurn: g.myTurn,
    upgradeMode: effectiveUpgradeMode,
    color: room.color,
    local: g.local,
    upgradedSet: g.upgradedSet,
    submitMove,
    selected,
    setSelected,
  });

  // Hints from a drag/tap before it was our turn shouldn't render once we
  // hand the turn back. Deriving from myTurn instead of mutating state in
  // an effect.
  const visibleDragHints = g.myTurn ? drag.hints : null;
  const visibleSelected = g.myTurn ? tap.selected : null;
  const visibleTargets = g.myTurn ? tap.targets : null;

  const onDragBegin = useCallback((piece, square) => {
    setSelected(null);
    drag.onDragBegin(piece, square);
  }, [drag]);

  const onPieceDrop = useCallback(
    (from, to) => {
      if (!g.myTurn || effectiveUpgradeMode) return false;
      setSelected(null);
      submitMove(from, to);
      return true;
    },
    [g.myTurn, effectiveUpgradeMode, submitMove]
  );

  // Same react-chessboard stale-closure caveat as useDragHints.
  const draggableRef = useLatest({ myTurn: g.myTurn, upgradeMode: effectiveUpgradeMode, color: room.color });
  const isDraggablePiece = useCallback(({ piece }) => {
    const { myTurn, upgradeMode, color } = draggableRef.current;
    return myTurn && !upgradeMode && !!piece && piece[0].toLowerCase() === color;
  }, [draggableRef]);

  const onUpgradeClick = useCallback(
    (square) => {
      const piece = g.local.get(square);
      if (!piece || piece.color !== room.color) return;
      if (g.upgradedSet.has(square)) return;
      setMoveError('');
      gameApi.upgrade(socket, room.code, square).then((res) => {
        if (res.ok) setUpgradeMode(false);
        else setMoveError(res.error || 'upgrade failed');
      });
    },
    [g.local, g.upgradedSet, room.color, socket, room.code]
  );

  const onSquareClick = useCallback(
    (square) => {
      if (effectiveUpgradeMode) return onUpgradeClick(square);
      tap.onSquareClick(square);
    },
    [effectiveUpgradeMode, onUpgradeClick, tap]
  );

  const customSquareStyles = useMemo(
    () => mergeSquareStyles(
      upgradedGlowLayer(g.upgradedSet),
      effectiveUpgradeMode && upgradePickableLayer(g.local, room.color, g.upgradedSet),
      !effectiveUpgradeMode && selectedSquareLayer(visibleSelected),
      !effectiveUpgradeMode && visibleTargets && dragHintLayer(visibleTargets),
      visibleDragHints && dragHintLayer(visibleDragHints),
    ),
    [g.upgradedSet, effectiveUpgradeMode, g.local, room.color, visibleDragHints, visibleSelected, visibleTargets]
  );

  const customPieces = useCustomPieces(g.upgradedSet);
  const boardWidth = useBoardWidth();

  const startUpgrade = useCallback(() => setUpgradeMode(true), []);
  const cancelUpgrade = useCallback(() => setUpgradeMode(false), []);
  const resign = useCallback(() => gameApi.resign(socket, room.code), [socket, room.code]);

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
        upgradeMode={effectiveUpgradeMode}
        canUpgrade={g.canUpgrade}
        onStartUpgrade={startUpgrade}
        onCancelUpgrade={cancelUpgrade}
        onResign={resign}
        onLeave={onLeave}
        moveError={moveError}
        history={g.history}
      />
      <Board
        fen={g.fen}
        orientation={g.orientation}
        myTurn={g.myTurn}
        upgradeMode={effectiveUpgradeMode}
        onPieceDrop={onPieceDrop}
        onPieceDragBegin={onDragBegin}
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

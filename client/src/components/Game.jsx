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
  // Tap-selection lives here (not inside useTapMove) so the drag handler
  // can clear it without reaching into another hook's API.
  const [selected, setSelected] = useState(null);

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
    color: room.color,
    local: g.local,
    upgradedSet: g.upgradedSet,
  });

  const tap = useTapMove({
    myTurn: g.myTurn,
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
      if (!g.myTurn) return false;
      setSelected(null);
      submitMove(from, to);
      return true;
    },
    [g.myTurn, submitMove]
  );

  // Same react-chessboard stale-closure caveat as useDragHints.
  const draggableRef = useLatest({ myTurn: g.myTurn, color: room.color });
  const isDraggablePiece = useCallback(({ piece }) => {
    const { myTurn, color } = draggableRef.current;
    return myTurn && !!piece && piece[0].toLowerCase() === color;
  }, [draggableRef]);

  const onSquareClick = useCallback(
    (square) => tap.onSquareClick(square),
    [tap]
  );

  const customSquareStyles = useMemo(
    () => mergeSquareStyles(
      upgradedGlowLayer(g.upgradedSet),
      selectedSquareLayer(visibleSelected),
      visibleTargets && dragHintLayer(visibleTargets),
      visibleDragHints && dragHintLayer(visibleDragHints),
    ),
    [g.upgradedSet, visibleDragHints, visibleSelected, visibleTargets]
  );

  const customPieces = useCustomPieces(g.upgradedSet);
  const boardWidth = useBoardWidth();

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
        onResign={resign}
        onLeave={onLeave}
        moveError={moveError}
        history={g.history}
      />
      <Board
        fen={g.fen}
        orientation={g.orientation}
        myTurn={g.myTurn}
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../services/socket-context.js';
import { gameApi } from '../services/game-api.js';
import { useGameState } from '../features/game/useGameState.js';
import { useDragHints } from '../features/game/useDragHints.js';
import { useTapMove } from '../features/game/useTapMove.js';
import { useCustomPieces } from '../features/game/useCustomPieces.js';
import {
  dragHintLayer,
  mergeSquareStyles,
  selectedSquareLayer,
  upgradedGlowLayer,
} from '../features/game/square-styles.js';
import { useLatest } from '../hooks/useLatest.js';
import Sidebar from './Sidebar.js';
import Board from './Board.js';
import type { SavedRoom } from '../services/player-id.js';
import type { ServerRoomState } from '../features/game/derive-game-state.js';

const MOBILE_BREAKPOINT = 720;

function useBoardWidth(): number {
  const [width, setWidth] = useState<number>(() => computeBoardWidth());
  useEffect(() => {
    const onResize = (): void => setWidth(computeBoardWidth());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return width;
}

function computeBoardWidth(): number {
  if (typeof window === 'undefined') return 560;
  const w = window.innerWidth;
  if (w <= MOBILE_BREAKPOINT) return Math.min(w - 24, 560);
  return Math.min(560, w - 360);
}

interface GameProps {
  room: SavedRoom;
  state: ServerRoomState | null;
  onLeave: () => void;
}

export default function Game({ room, state, onLeave }: GameProps) {
  const { socket } = useSocket();
  const g = useGameState(room, state);
  const [moveError, setMoveError] = useState('');
  // Tap-selection lives here (not inside useTapMove) so the drag handler
  // can clear it without reaching into another hook's API.
  const [selected, setSelected] = useState<string | null>(null);

  const submitMove = useCallback(
    (from: string, to: string) => {
      const piece = g.local.get(from as never);
      const isPromotion =
        piece && piece.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
      const move = { from, to, ...(isPromotion ? { promotion: 'q' } : {}) };
      setMoveError('');
      void gameApi.move(socket, room.code, move).then((res) => {
        if (!res.ok) setMoveError(res.error || 'illegal move');
      });
    },
    [g.local, socket, room.code],
  );

  const drag = useDragHints({
    myTurn: g.myTurn,
    color: room.color,
    local: g.local,
    variant: g.variant,
    upgradedSet: g.upgradedSet,
    kingOverrides: g.kingOverrides,
  });

  const tap = useTapMove({
    myTurn: g.myTurn,
    color: room.color,
    local: g.local,
    variant: g.variant,
    upgradedSet: g.upgradedSet,
    kingOverrides: g.kingOverrides,
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

  const onDragBegin = useCallback((piece: string, square: string) => {
    setSelected(null);
    drag.onDragBegin(piece, square);
  }, [drag]);

  const onPieceDrop = useCallback(
    (from: string, to: string) => {
      if (!g.myTurn) return false;
      setSelected(null);
      submitMove(from, to);
      return true;
    },
    [g.myTurn, submitMove],
  );

  // Same react-chessboard stale-closure caveat as useDragHints.
  const draggableRef = useLatest({ myTurn: g.myTurn, color: room.color });
  const isDraggablePiece = useCallback(({ piece }: { piece: string }) => {
    const { myTurn, color } = draggableRef.current;
    return myTurn && !!piece && piece[0]!.toLowerCase() === color;
  }, [draggableRef]);

  const onSquareClick = useCallback(
    (square: string) => tap.onSquareClick(square),
    [tap],
  );

  const customSquareStyles = useMemo(
    () => mergeSquareStyles(
      upgradedGlowLayer(g.glowSquares),
      selectedSquareLayer(visibleSelected),
      visibleTargets && dragHintLayer(visibleTargets),
      visibleDragHints && dragHintLayer(visibleDragHints),
    ),
    [g.glowSquares, visibleDragHints, visibleSelected, visibleTargets],
  );

  const customPieces = useCustomPieces(g.glowSquares, g.kingOverrides);
  const boardWidth = useBoardWidth();

  const resign = useCallback(() => gameApi.resign(socket, room.code), [socket, room.code]);

  return (
    <div className="game">
      <Sidebar
        room={room}
        variant={g.variant}
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../services/socket-context.js';
import { gameApi } from '../services/game-api.js';
import { useGameState } from '../features/game/useGameState.js';
import { useDragHints } from '../features/game/useDragHints.js';
import { useTapMove } from '../features/game/useTapMove.js';
import { useCustomPieces } from '../features/game/useCustomPieces.js';
import { useActionAnimations } from '../features/game/useActionAnimations.js';
import {
  dragHintLayer,
  lockedSquareLayer,
  mergeSquareStyles,
  selectedSquareLayer,
  upgradedGlowLayer,
} from '../features/game/square-styles.js';
import { useLatest } from '../hooks/useLatest.js';
import Sidebar from './Sidebar.js';
import Board from './Board.js';
import OffBoardPanel from './OffBoardPanel.js';
import SelectedPiecePanel from './SelectedPiecePanel.js';
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
  connected: boolean;
  onLeave: () => void;
}

export default function Game({ room, state, connected, onLeave }: GameProps) {
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
    lockedSquare: g.lockedSquare,
  });

  const tap = useTapMove({
    myTurn: g.myTurn,
    color: room.color,
    local: g.local,
    variant: g.variant,
    upgradedSet: g.upgradedSet,
    kingOverrides: g.kingOverrides,
    lockedSquare: g.lockedSquare,
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
      lockedSquareLayer(g.lockedSquare),
    ),
    [g.glowSquares, g.lockedSquare, visibleDragHints, visibleSelected, visibleTargets],
  );

  const animations = useActionAnimations(g.history);
  const customPieces = useCustomPieces(g.glowSquares, g.kingOverrides, animations);
  const boardWidth = useBoardWidth();

  const resign = useCallback(() => gameApi.resign(socket, room.code), [socket, room.code]);

  const build = useCallback(
    (slotId: string) => {
      setMoveError('');
      void gameApi.build(socket, room.code, slotId).then((res) => {
        if (!res.ok) setMoveError(res.error || 'cannot build');
      });
    },
    [socket, room.code],
  );

  const upgrade = useCallback(
    (slotId: string, to: string) => {
      setMoveError('');
      void gameApi.upgrade(socket, room.code, slotId, to).then((res) => {
        if (!res.ok) setMoveError(res.error || 'cannot upgrade');
        else setSelected(null);
      });
    },
    [socket, room.code],
  );

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
        connected={connected}
        onResign={resign}
        onLeave={onLeave}
        moveError={moveError}
        history={g.history}
      />
      <div className="board-column">
        <div className="board-row">
          <div className="board-stack" style={{ width: boardWidth }}>
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
            {g.variant === 'rpg' && (
              <OffBoardPanel
                myColor={room.color}
                myTurn={g.myTurn}
                material={g.material}
                offBoard={g.offBoard}
                onBuild={build}
              />
            )}
          </div>
          {g.variant === 'rpg' && (
            <div className="selected-piece-slot">
              <SelectedPiecePanel
                square={visibleSelected}
                info={visibleSelected ? g.pieces[visibleSelected] : undefined}
                myColor={room.color}
                myTurn={g.myTurn}
                canAct={!g.lockedSquare}
                onUpgrade={upgrade}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

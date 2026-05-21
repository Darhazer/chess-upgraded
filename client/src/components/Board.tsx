import { Chessboard } from 'react-chessboard';
import type { CSSProperties } from 'react';

interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  myTurn: boolean;
  onPieceDrop: (from: string, to: string) => boolean;
  onPieceDragBegin: (piece: string, square: string) => void;
  onPieceDragEnd: () => void;
  onSquareClick: (square: string) => void;
  isDraggablePiece: (args: { piece: string }) => boolean;
  customSquareStyles: Record<string, CSSProperties>;
  customPieces: Record<string, (props: { squareWidth: number; square: string }) => JSX.Element>;
  width: number;
}

// Pure presentation around react-chessboard. All policy (whose turn,
// hint computation) is decided by the parent and passed in as
// ready-to-use props/callbacks.
export default function Board({
  fen,
  orientation,
  myTurn,
  onPieceDrop,
  onPieceDragBegin,
  onPieceDragEnd,
  onSquareClick,
  isDraggablePiece,
  customSquareStyles,
  customPieces,
  width,
}: BoardProps) {
  return (
    <div className="board">
      <Chessboard
        position={fen === 'start' ? undefined : fen}
        boardOrientation={orientation}
        arePiecesDraggable={myTurn}
        onPieceDrop={onPieceDrop}
        onPieceDragBegin={onPieceDragBegin}
        onPieceDragEnd={onPieceDragEnd}
        onSquareClick={onSquareClick}
        isDraggablePiece={isDraggablePiece}
        customSquareStyles={customSquareStyles}
        customPieces={customPieces}
        boardWidth={width}
      />
    </div>
  );
}

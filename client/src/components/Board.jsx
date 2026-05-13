import { Chessboard } from 'react-chessboard';

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
}) {
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

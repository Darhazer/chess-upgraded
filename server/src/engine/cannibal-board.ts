// Cannibal Chess board — a subclass of the vendored engine (./vendor/board.js).
//
// Normal chess applies, with one change: a capturing piece *becomes* the type
// of the piece it captured. A king that captures keeps its crown (it is still
// the piece that must be mated) but its movement becomes that of the captured
// piece — tracked in `configuration.kingType`, since the king keeps its 'k'
// board char. A royal piece moving as a pawn that reaches the last rank gains
// queen movement. Castling needs a king that still moves as a king.
//
// The subclass only overrides Board's variant extension points; all the heavy
// lifting (move generation, legality, search) is the inherited base engine.

import Board, { type AppliedMoveInfo, type BoardInput } from './vendor/board.js';
import { COLORS, upByColor, upLeftByColor, upRightByColor } from './vendor/const.js';
import type { EngineColor, EnginePiece, EngineSquare, MovementType } from './vendor/const.js';

// How much each king-movement-type is worth to the search, beyond the king's
// own material value. A king reduced to pawn movement is a serious liability;
// a king with queen movement is a real asset. Small relative to material
// (which the base engine scales x10) — a nudge, not a dominating term.
// Eyeballed, not tuned.
const KING_MOVEMENT_BONUS: Record<MovementType, number> = { k: 0, q: 8, r: 5, b: 3, n: 3, p: -15 };

export default class CannibalBoard extends Board {
  constructor(configuration?: BoardInput) {
    super(configuration);
    this.configuration.variant = 'cannibal';
    if (!this.configuration.kingType) {
      this.configuration.kingType = { white: 'k', black: 'k' };
    }
  }

  // A king moves and attacks as whatever it last cannibalised; every other
  // piece simply as itself.
  override movementType(piece: EnginePiece): string {
    if (piece.toLowerCase() === 'k') {
      const kt = this.configuration.kingType!;
      return kt[this.getPieceColor(piece)];
    }
    return piece.toLowerCase();
  }

  // The king's moveset follows `kingType`. The standard generators only read
  // `piece` for its colour, so they produce the right pattern for a 'K'/'k'
  // char too; `super` covers a king that is still a king.
  override getKingMoves(piece: EnginePiece, location: EngineSquare): EngineSquare[] {
    const kt = this.configuration.kingType!;
    switch (kt[this.getPieceColor(piece)]) {
    case 'p': return this.getCannibalKingPawnMoves(piece, location);
    case 'n': return this.getKnightMoves(piece, location);
    case 'r': return this.getRookMoves(piece, location);
    case 'b': return this.getBishopMoves(piece, location);
    case 'q': return this.getQueenMoves(piece, location);
    default: return super.getKingMoves(piece, location);
    }
  }

  // A royal piece moving as a pawn — minimal pawn rules: one step forward,
  // diagonal capture only. No initial double-step, no en passant.
  getCannibalKingPawnMoves(piece: EnginePiece, location: EngineSquare): EngineSquare[] {
    const moves: EngineSquare[] = [];
    const color = this.getPieceColor(piece);
    const forward = upByColor(location, color);
    if (forward && !this.getPiece(forward)) moves.push(forward);
    for (const diag of [upLeftByColor(location, color), upRightByColor(location, color)]) {
      if (diag && this.getPiece(diag) && this.getPieceOnLocationColor(diag) !== color) {
        moves.push(diag);
      }
    }
    return moves;
  }

  // Castling needs a king that still moves as a king.
  override playingKingCanCastle(): boolean {
    const kt = this.configuration.kingType!;
    return kt[this.getPlayingColor()] === 'k';
  }

  // Capture-transform: the capturing piece becomes what it captured; a king
  // keeps its crown but its movement-type changes. A royal piece moving as a
  // pawn that reaches the last rank gains queen movement.
  override onMoveApplied({ to, mover, captured, enPassantCapture, movingColor }: AppliedMoveInfo): void {
    const moverIsKing = mover.toLowerCase() === 'k';
    const capturedType: MovementType | null = captured
      ? (captured.toLowerCase() as MovementType)
      : (enPassantCapture ? 'p' : null);

    if (capturedType) {
      if (moverIsKing) {
        this.configuration.kingType![movingColor] = capturedType;
      } else {
        this.configuration.pieces[to] = movingColor === COLORS.WHITE
          ? capturedType.toUpperCase()
          : capturedType;
      }
    }

    const kt = this.configuration.kingType!;
    if (moverIsKing &&
      kt[movingColor] === 'p' &&
      (to[1] === '8' || to[1] === '1')) {
      kt[movingColor] = 'q';
    }
  }

  // Material score, plus a small term for how capable each king currently is
  // (see KING_MOVEMENT_BONUS) so the search avoids reducing its own king to a
  // weak piece for a marginal material gain.
  override calculateScore(playerColor: EngineColor = this.getPlayingColor()): number {
    const score = super.calculateScore(playerColor);
    // On a terminal node `super` returns a saturated +/-score — leave it.
    if (this.configuration.isFinished) return score;
    let bonus = 0;
    const kt = this.configuration.kingType!;
    for (const color of [COLORS.WHITE, COLORS.BLACK]) {
      const sign = color === playerColor ? 1 : -1;
      bonus += sign * (KING_MOVEMENT_BONUS[kt[color]] || 0);
    }
    return score + bonus;
  }
}

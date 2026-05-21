export interface TapPiece {
  color: 'w' | 'b';
}

export interface TapInput {
  myTurn: boolean;
  color: 'w' | 'b';
  selected: string | null;
  targets: Set<string> | null;
  piece: TapPiece | null | undefined | false;
  square: string;
}

export type TapAction =
  | Record<string, never>
  | { select: string | null }
  | { move: { from: string; to: string }; select: null };

// Pure state machine for a tap on `square` in tap-to-move mode. Pulled
// out of useTapMove so it can be unit-tested without a React harness —
// same pattern as deriveGameState / useGameState.
//
// Returns { select?, move? } where:
//   select === undefined → leave selection alone
//   select === null      → clear selection
//   select === 'e4'      → set selection to that square
//   move                 → submit move { from, to }
// A move action always also clears the selection (`select: null`) so the
// post-tap state is fully described by the return value.
export function computeTapAction({ myTurn, color, selected, targets, piece, square }: TapInput): TapAction {
  if (!myTurn) return {};
  if (selected) {
    if (square === selected) return { select: null };
    if (piece && piece.color === color) return { select: square };
    if (targets?.has(square)) return { move: { from: selected, to: square }, select: null };
    return { select: null };
  }
  if (piece && piece.color === color) return { select: square };
  return {};
}

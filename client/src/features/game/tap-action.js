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
export function computeTapAction({ myTurn, upgradeMode, color, selected, targets, piece, square }) {
  if (!myTurn || upgradeMode) return {};
  if (selected) {
    if (square === selected) return { select: null };
    if (piece && piece.color === color) return { select: square };
    if (targets?.has(square)) return { move: { from: selected, to: square }, select: null };
    return { select: null };
  }
  if (piece && piece.color === color) return { select: square };
  return {};
}

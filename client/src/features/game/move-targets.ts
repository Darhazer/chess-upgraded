import { customMoveTargets, type ChessLike, type PieceType } from '../../../../shared/upgrade-rules.js';
import { kingMoveTargets, type KingMovementType } from '../../../../shared/cannibal-rules.js';

interface MoveTargetCtx {
  variant?: string;
  upgradedSet?: Set<string>;
  kingOverrides?: Record<string, string>;
  lockedSquare?: string | null;
}

interface ChessJsLike extends ChessLike {
  moves: (opts: { square: string; verbose: true }) => Array<{ to: string }>;
}

// Legal destination squares for the piece on `square`, used to draw move
// hints. `ctx` carries the variant view-state:
//   - upgraded: chess.js moves + the move-only bonus pattern of upgraded pieces.
//   - cannibal: chess.js moves for every piece (a cannibalised piece is its new
//     type in the FEN, so chess.js is already right) except a cannibalised
//     king, whose moveset follows its kingType (kingOverrides[square]).
// Hints are advisory — the server is authoritative — so slight imprecision
// against an enemy cannibal king is acceptable.
export function legalTargets(local: ChessJsLike, square: string, ctx: MoveTargetCtx = {}): Set<string> {
  const { variant = 'upgraded', upgradedSet, kingOverrides, lockedSquare } = ctx;
  const piece = local.get(square);
  if (!piece) return new Set();
  // Chess RPG: a piece built this turn is locked until the next turn.
  if (lockedSquare && square === lockedSquare) return new Set();
  const targets = new Set<string>();

  if (variant === 'cannibal') {
    const kingType = kingOverrides?.[square] as KingMovementType | undefined;
    if (kingType) {
      for (const t of kingMoveTargets(kingType, square, piece.color, local)) targets.add(t);
    } else {
      for (const m of local.moves({ square, verbose: true })) targets.add(m.to);
    }
    return targets;
  }

  for (const m of local.moves({ square, verbose: true })) targets.add(m.to);
  if (upgradedSet?.has(square)) {
    for (const t of customMoveTargets(piece.type as PieceType, square, piece.color, local)) {
      targets.add(t);
    }
  }
  return targets;
}

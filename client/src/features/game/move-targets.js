import { customMoveTargets } from '../../../../shared/upgrade-rules.js';

// Legal destination squares for the piece on `square`: standard chess.js
// moves, plus the upgrade-specific extensions for upgraded pieces.
export function legalTargets(local, square, upgradedSet) {
  const piece = local.get(square);
  if (!piece) return new Set();
  const targets = new Set();
  for (const m of local.moves({ square, verbose: true })) targets.add(m.to);
  if (upgradedSet.has(square)) {
    for (const t of customMoveTargets(piece.type, square, piece.color, local)) {
      targets.add(t);
    }
  }
  return targets;
}

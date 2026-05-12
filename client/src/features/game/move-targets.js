import { customMoveTargets } from '../../../../shared/upgrade-rules.js';

// Legal destination squares for the piece on `square`: standard chess.js
// moves, plus the upgrade-specific extensions for upgraded pieces. An
// upgraded pawn is special — it *replaces* its standard moveset with the
// custom diagonal step / forward capture rather than adding to it.
export function legalTargets(local, square, upgradedSet) {
  const piece = local.get(square);
  if (!piece) return new Set();
  const upgraded = upgradedSet.has(square);
  const targets = new Set();
  if (!(upgraded && piece.type === 'p')) {
    for (const m of local.moves({ square, verbose: true })) targets.add(m.to);
  }
  if (upgraded) {
    for (const t of customMoveTargets(piece.type, square, piece.color, local)) {
      targets.add(t);
    }
  }
  return targets;
}

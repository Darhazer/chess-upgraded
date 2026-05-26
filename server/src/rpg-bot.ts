import type { Square as ChessJsSquare } from 'chess.js';
import { ChessRpgEngine } from './chess-rpg-engine.js';
import { PIECE_COST, type BuildableType } from '../../shared/chess-rpg-rules.js';

// Heuristic decision layer for the Chess RPG bot. Builds and upgrades are
// chosen by cheap greedy rules here on the main thread; the move itself is
// still picked by the vendored minimax (see ../engine/), so this module
// never touches the worker pool.
//
// One ability per turn (build OR upgrade) is enforced by the engine via
// `actionThisTurn`. This module just picks which one yields the most value
// and lets the engine reject anything illegal.
//
// Both heuristics run candidates through a *safety filter*: a candidate is
// skipped when the target square is attacked in a way that would let the
// opponent capture our new/upgraded piece on the next move for net material
// gain. The check is a one-ply mini-SEE (cheapest attacker vs piece value,
// plus a defender presence check) — not a full exchange evaluation, but
// enough to stop the bot from dropping a queen onto a square a pawn attacks.

export type RpgBuildAction = { kind: 'build'; slotId: string };
export type RpgUpgradeAction = { kind: 'upgrade'; slotId: string; to: BuildableType };
export type RpgAbilityAction = RpgBuildAction | RpgUpgradeAction;

interface Candidate<A extends RpgAbilityAction> {
  action: A;
  value: number;
}

// True when a piece of value `pieceCost` on `square` would survive the
// opponent's next turn — i.e. the opponent either can't capture it, or the
// resulting exchange is at least even for us.
//
// Rules:
//   - no attackers              → safe
//   - attackers but no defender → unsafe (free capture for them)
//   - attackers + defender(s)   → safe iff the cheapest attacker is worth at
//                                 least as much as `pieceCost` (so trading
//                                 nets neutral or positive for us)
//   - the enemy king as the sole attacker is special: it can only safely
//     capture when our piece is undefended; otherwise it would walk into
//     mate by our defender. Treated as "cost infinity" once defenders exist.
export function isSquareSafeForPiece(
  engine: ChessRpgEngine,
  square: string,
  color: 'w' | 'b',
  pieceCost: number,
): boolean {
  const enemy = color === 'w' ? 'b' : 'w';
  const attackerSquares = engine.chess.attackers(square as ChessJsSquare, enemy);
  if (attackerSquares.length === 0) return true;
  const defenderSquares = engine.chess.attackers(square as ChessJsSquare, color);
  if (defenderSquares.length === 0) return false;

  let cheapestAttacker = Infinity;
  for (const aSq of attackerSquares) {
    const piece = engine.chess.get(aSq);
    if (!piece) continue;
    // The enemy king can't profitably capture a defended piece — it would
    // be recaptured. Skip it from the cheapest-attacker calculation.
    if (piece.type === 'k') continue;
    const val = PIECE_COST[piece.type as BuildableType];
    if (typeof val === 'number' && val < cheapestAttacker) cheapestAttacker = val;
  }
  // If every non-king attacker is at least as valuable as our piece, trades
  // are neutral-or-better for us.
  return cheapestAttacker >= pieceCost;
}

// Build priority by piece type, parametrised on the *current* army state.
// Minor pieces lead in the opening; rooks come once a minor is out; the
// queen waits until a rook or two minors are on board; pawns are the
// fallback when nothing more useful is buildable. This replaces the old
// "highest cost" rule, which (with material=4 in the opening) would pick
// whichever of {knight, bishop, rook} appeared first in slot order — no
// strategic intent, and once material climbed it locked the bot into
// queen-first builds.
const BUILD_PRIORITY: Record<BuildableType, (state: { minorsOnBoard: number; rooksOnBoard: number }) => number> = {
  n: ({ minorsOnBoard }) => (minorsOnBoard < 2 ? 15 : 5),
  b: ({ minorsOnBoard }) => (minorsOnBoard < 2 ? 14 : 5),
  r: ({ minorsOnBoard, rooksOnBoard }) => (minorsOnBoard >= 1 && rooksOnBoard < 2 ? 10 : 3),
  q: ({ minorsOnBoard, rooksOnBoard }) => (rooksOnBoard >= 1 || minorsOnBoard >= 2 ? 8 : 4),
  p: () => 2,
};

// File-centrality tiebreaker: prefer central builds at the same priority
// (so b/g knights beat a/h rooks when knights aren't already strictly higher).
function fileCentrality(square: string): number {
  const file = square[0]!;
  if (file === 'd' || file === 'e') return 3;
  if (file === 'c' || file === 'f') return 2;
  if (file === 'b' || file === 'g') return 1;
  return 0;
}

// Best build candidate for `color`: walks the off-board slots and picks the
// highest-priority *and* safe one (see isSquareSafeForPiece). Returns null
// when nothing safe is buildable — the caller falls through to the regular
// move search rather than dropping a piece on a fork.
export function decideBuild(engine: ChessRpgEngine, color: 'w' | 'b'): Candidate<RpgBuildAction> | null {
  const slots = engine._offBoardDescriptors()[color];
  const pieces = engine._pieceInfoBySquare();
  let minorsOnBoard = 0;
  let rooksOnBoard = 0;
  for (const sq in pieces) {
    const info = pieces[sq]!;
    if (info.color !== color) continue;
    if (info.currentType === 'n' || info.currentType === 'b') minorsOnBoard++;
    else if (info.currentType === 'r') rooksOnBoard++;
  }
  const state = { minorsOnBoard, rooksOnBoard };
  let best: Candidate<RpgBuildAction> | null = null;
  let bestCentrality = -1;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    if (!isSquareSafeForPiece(engine, slot.home, color, slot.cost)) continue;
    const priority = BUILD_PRIORITY[slot.homeType](state);
    const centrality = fileCentrality(slot.home);
    if (!best || priority > best.value || (priority === best.value && centrality > bestCentrality)) {
      best = { action: { kind: 'build', slotId: slot.slotId }, value: priority };
      bestCentrality = centrality;
    }
  }
  return best;
}

// Best upgrade candidate for `color`: the on-board piece whose affordable
// upgrade maximises (target cost - current cost), filtered to those whose
// post-upgrade square is safe (see isSquareSafeForPiece). Ties broken by
// higher target cost (push toward queens). Kings excluded.
export function decideUpgrade(engine: ChessRpgEngine, color: 'w' | 'b'): Candidate<RpgUpgradeAction> | null {
  const pieces = engine._pieceInfoBySquare();
  let best: Candidate<RpgUpgradeAction> | null = null;
  let bestTargetCost = 0;
  for (const square in pieces) {
    const info = pieces[square]!;
    if (info.color !== color) continue;
    if (info.currentType === 'k') continue;
    const currentCost = PIECE_COST[info.currentType];
    for (const u of info.upgrades) {
      if (!u.affordable) continue;
      // Skip if the upgraded (more expensive) piece would be hanging.
      // We check using the target cost — a bigger piece is more at risk
      // than the original even on the same square.
      if (!isSquareSafeForPiece(engine, square, color, u.cost)) continue;
      const gain = u.cost - currentCost;
      if (!best || gain > best.value || (gain === best.value && u.cost > bestTargetCost)) {
        best = { action: { kind: 'upgrade', slotId: info.slotId, to: u.type }, value: gain };
        bestTargetCost = u.cost;
      }
    }
  }
  return best;
}

// Pick at most one ability action for `color`. Returns the higher-value
// candidate; ties go to build (army growth beats in-place strengthening).
// Returns null when neither is viable, in which case the caller should fall
// through to picking a move.
export function chooseAbilityAction(engine: ChessRpgEngine, color: 'w' | 'b'): RpgAbilityAction | null {
  if (engine.over) return null;
  if (engine.actionThisTurn[color]) return null;
  if (engine.turn() !== color) return null;
  const build = decideBuild(engine, color);
  const upgrade = decideUpgrade(engine, color);
  if (!build && !upgrade) return null;
  if (!upgrade) return build!.action;
  if (!build) return upgrade.action;
  return build.value >= upgrade.value ? build.action : upgrade.action;
}

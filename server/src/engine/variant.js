// Glue between the vendored js-chess-engine fork and the rest of the server.
//
// The fork (./vendor/board.js) speaks the engine's dialect: UPPERCASE squares
// ('E4'), 'white'/'black' colors, single-letter pieces (case = color). The
// referee (../rules-engine.js) and the shared move-pattern module
// (../../../shared/upgrade-rules.js) speak chess.js's dialect: lowercase
// squares, 'w'/'b', lowercase piece *types*. This module owns the translation,
// so the fork can reuse shared/upgrade-rules.js verbatim and so the action it
// finally proposes is in the exact shape RulesEngine.applyAction expects.

import { customMoveTargets } from '../../../shared/upgrade-rules.js';
import { getJSONfromFEN } from './vendor/utils.js';

// A king's 2-square teleport to one of its own castling squares (E1->C1/G1,
// E8->C8/G8) is written notationally identically to a castle, and the engine's
// `move()` always interprets that pair as a castle. So those particular
// teleport targets are tagged (`~C1`, `~G1`, ...) — `move()` strips the tag and
// relocates only the king. RulesEngine still picks the castle over the teleport
// when both are available (it's strictly better anyway), so this only matters
// once castling rights/rook are gone.
export const TELEPORT_PREFIX = '~';

// Evaluation tunables, ported from the previous hand-rolled bot but scaled to
// this engine's units (it multiplies raw piece values by 10, so a pawn ≈ 10).
// Eyeballed, not tuned. Upgraded pawns gain a real capability (sideways +
// backward step), so they get a small bonus too; the upgraded queen gains
// 8 move-only knight squares, which is worth more than the trimmed teleport.
export const UPGRADE_BONUS = { p: 3, n: 6, r: 8, b: 6, q: 20, k: 15 };

// Squares where a king's teleport collides with castling notation, by home sq.
const KING_CASTLE_SQUARES = { E1: new Set(['C1', 'G1']), E8: new Set(['C8', 'G8']) };

function pieceTypeAndColor(piece) {
  return { type: piece.toLowerCase(), color: piece === piece.toUpperCase() ? 'w' : 'b' };
}

// A `chess.js`-shaped adapter (just `.get(square)`) over an engine Board, so we
// can call shared/upgrade-rules.js's `customMoveTargets` without changes.
function chessAdapter(board) {
  return {
    get(stdSquare) {
      const p = board.getPiece(stdSquare.toUpperCase());
      return p ? pieceTypeAndColor(p) : null;
    },
  };
}

// Squares an upgraded piece at `locationUpper` may move to via its bonus
// pattern (for a pawn this *is* its whole moveset). Returned in the engine's
// UPPERCASE convention.
export function customBonusTargets(board, piece, locationUpper) {
  const { type, color } = pieceTypeAndColor(piece);
  const targets = customMoveTargets(type, locationUpper.toLowerCase(), color, chessAdapter(board))
    .map((s) => s.toUpperCase());
  const collide = type === 'k' ? KING_CASTLE_SQUARES[locationUpper] : null;
  if (!collide) return targets;
  return targets.map((t) => (collide.has(t) ? TELEPORT_PREFIX + t : t));
}

// Build the engine's board-config from a RulesEngine.publicState()-shaped
// object ({ fen, upgraded:[lowerSquares] }).
export function buildConfig(publicState) {
  const cfg = getJSONfromFEN(publicState.fen);
  cfg.upgraded = {};
  for (const sq of publicState.upgraded || []) cfg.upgraded[sq.toUpperCase()] = true;
  return cfg;
}

// Translate one engine move (`FROM` -> `TO`, both UPPERCASE) into a RulesEngine
// action. `cfg` is the pre-move board-config (used only to spot a pawn
// promotion). RulesEngine.tryMove classifies a `{kind:'move'}` itself — it
// falls through to the custom-move path when the source is an upgraded piece —
// so we never need to emit `{kind:'custom'}`.
export function actionFromMove(fromUpper, toUpper, cfg) {
  const toBare = toUpper[0] === TELEPORT_PREFIX ? toUpper.slice(TELEPORT_PREFIX.length) : toUpper;
  const from = fromUpper.toLowerCase();
  const to = toBare.toLowerCase();
  const action = { kind: 'move', from, to };
  const pieceAtFrom = cfg.pieces[fromUpper];
  // A pawn reaching the back rank needs `promotion` spelled out for
  // chess.js. The engine only ever auto-queens. Applies whether the pawn
  // is upgraded or not — an upgraded pawn keeps its standard moveset,
  // including push/capture promotions.
  if (pieceAtFrom && pieceAtFrom.toUpperCase() === 'P' &&
      (to[1] === '8' || to[1] === '1')) {
    action.promotion = 'q';
  }
  return action;
}

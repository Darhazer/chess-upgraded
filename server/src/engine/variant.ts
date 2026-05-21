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
import type { PieceType, Color, ChessLike } from '../../../shared/upgrade-rules.js';
import { getJSONfromFEN } from './vendor/utils.js';
import type Board from './vendor/board.js';
import type { BoardConfiguration, EnginePiece, EngineSquare, KingTypeMap, MovementType } from './vendor/const.js';

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
export const UPGRADE_BONUS: Record<string, number> = { p: 3, n: 6, r: 8, b: 6, q: 20, k: 15 };

// Squares where a king's teleport collides with castling notation, by home sq.
const KING_CASTLE_SQUARES: Record<string, Set<string>> = {
  E1: new Set(['C1', 'G1']),
  E8: new Set(['C8', 'G8']),
};

function pieceTypeAndColor(piece: EnginePiece): { type: PieceType; color: Color } {
  return {
    type: piece.toLowerCase() as PieceType,
    color: piece === piece.toUpperCase() ? 'w' : 'b',
  };
}

// A `chess.js`-shaped adapter (just `.get(square)`) over an engine Board, so we
// can call shared/upgrade-rules.js's `customMoveTargets` without changes.
function chessAdapter(board: Board): ChessLike {
  return {
    get(stdSquare: string) {
      const p = board.getPiece(stdSquare.toUpperCase());
      return p ? pieceTypeAndColor(p) : null;
    },
  };
}

// Squares an upgraded piece at `locationUpper` may move to via its bonus
// pattern (for a pawn this *is* its whole moveset). Returned in the engine's
// UPPERCASE convention.
export function customBonusTargets(board: Board, piece: EnginePiece, locationUpper: EngineSquare): EngineSquare[] {
  const { type, color } = pieceTypeAndColor(piece);
  const targets = customMoveTargets(type, locationUpper.toLowerCase(), color, chessAdapter(board))
    .map((s) => s.toUpperCase());
  const collide = type === 'k' ? KING_CASTLE_SQUARES[locationUpper] : null;
  if (!collide) return targets;
  return targets.map((t) => (collide.has(t) ? TELEPORT_PREFIX + t : t));
}

export interface PublicState {
  fen: string;
  variant?: string;
  upgraded?: string[];
  kingOverrides?: Record<string, MovementType>;
  turn?: string;
  history?: unknown[];
  result?: unknown;
}

// Build the engine's board-config from an engine publicState()-shaped object
// ({ fen, variant, upgraded:[lowerSquares], kingOverrides:{ lowerSquare: type } }).
export function buildConfig(publicState: PublicState): BoardConfiguration {
  const cfg = getJSONfromFEN(publicState.fen) as unknown as BoardConfiguration;
  cfg.variant = publicState.variant || 'upgraded';
  cfg.upgraded = {};
  for (const sq of publicState.upgraded || []) cfg.upgraded[sq.toUpperCase()] = true;
  if (cfg.variant === 'cannibal') {
    // The FEN keeps a cannibal king as a plain 'k'; its movement-type rides
    // alongside in kingOverrides. Default both kings to normal-king movement.
    const kingType: KingTypeMap = { white: 'k', black: 'k' };
    for (const [sq, type] of Object.entries(publicState.kingOverrides || {})) {
      const piece = cfg.pieces[sq.toUpperCase()];
      if (piece) kingType[piece === piece.toUpperCase() ? 'white' : 'black'] = type;
    }
    cfg.kingType = kingType;
  }
  return cfg;
}

export interface MoveAction {
  kind: 'move';
  from: string;
  to: string;
  promotion?: 'q';
}

// Translate one engine move (`FROM` -> `TO`, both UPPERCASE) into a RulesEngine
// action. `cfg` is the pre-move board-config (used only to spot a pawn
// promotion). RulesEngine.tryMove classifies a `{kind:'move'}` itself — it
// falls through to the custom-move path when the source is an upgraded piece —
// so we never need to emit `{kind:'custom'}`.
export function actionFromMove(fromUpper: string, toUpper: string, cfg: BoardConfiguration): MoveAction {
  const toBare = toUpper[0] === TELEPORT_PREFIX ? toUpper.slice(TELEPORT_PREFIX.length) : toUpper;
  const from = fromUpper.toLowerCase();
  const to = toBare.toLowerCase();
  const action: MoveAction = { kind: 'move', from, to };
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

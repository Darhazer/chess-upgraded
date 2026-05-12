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

export const DEFAULT_BAR_MAX = 3;

// An upgrade-pick is encoded inside the engine's `{ FROM: [TO] }` move map as a
// synthetic entry: from-key `@UPGRADE`, targets `@<square>` (e.g. `@E4`).
export const UPGRADE_FROM = '@UPGRADE';
export const UPGRADE_TARGET_PREFIX = '@';

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
// Eyeballed, not tuned. No pawn entry — an upgraded pawn's worth is captured by
// it being a pawn at all (and RulesEngine's bot had no pawn entry either).
export const UPGRADE_BONUS = { n: 6, r: 8, b: 6, q: 12, k: 15 };
export const BAR_WEIGHT = 1;

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
// object ({ fen, upgraded:[lowerSquares], bar:{w,b}, barMax }).
export function buildConfig(publicState) {
  const cfg = getJSONfromFEN(publicState.fen);
  cfg.upgraded = {};
  for (const sq of publicState.upgraded || []) cfg.upgraded[sq.toUpperCase()] = true;
  cfg.bar = { white: publicState.bar?.w ?? 0, black: publicState.bar?.b ?? 0 };
  cfg.barMax = publicState.barMax ?? DEFAULT_BAR_MAX;
  return cfg;
}

// Translate one engine move (`FROM` -> `TO`, both UPPERCASE, or the @UPGRADE
// encoding) into a RulesEngine action. `cfg` is the pre-move board-config (used
// only to spot a standard pawn promotion). RulesEngine.tryMove classifies a
// `{kind:'move'}` itself — it falls through to the custom-move path when the
// source is an upgraded piece — so we never need to emit `{kind:'custom'}`.
export function actionFromMove(fromUpper, toUpper, cfg) {
  if (fromUpper === UPGRADE_FROM) {
    return { kind: 'upgrade', square: toUpper.slice(UPGRADE_TARGET_PREFIX.length).toLowerCase() };
  }
  const toBare = toUpper[0] === TELEPORT_PREFIX ? toUpper.slice(TELEPORT_PREFIX.length) : toUpper;
  const from = fromUpper.toLowerCase();
  const to = toBare.toLowerCase();
  const action = { kind: 'move', from, to };
  const pieceAtFrom = cfg.pieces[fromUpper];
  // A *standard* pawn promotion needs the piece spelled out for chess.js; the
  // engine only ever auto-queens. An upgraded pawn reaching the back rank goes
  // through RulesEngine's custom-move path, which auto-queens and ignores this
  // field — so we omit it there to keep the action shape minimal.
  if (pieceAtFrom && pieceAtFrom.toUpperCase() === 'P' && !cfg.upgraded[fromUpper] &&
      (to[1] === '8' || to[1] === '1')) {
    action.promotion = 'q';
  }
  return action;
}

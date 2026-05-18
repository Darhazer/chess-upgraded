// Cannibal Chess move geometry. The server's authority is the variant engine
// (server/src/engine/cannibal-board.js); this module exists so the *client*
// can draw legal-move hints for a cannibalised king without re-deriving them.
//
// In Cannibal Chess a non-king piece is, after a capture, simply its new type
// — so chess.js already generates its moves correctly from the FEN. The one
// piece chess.js cannot model is a king that moves as something else: it stays
// a 'k' on the board but moves as whatever it cannibalised. `kingMoveTargets`
// fills exactly that gap.
//
// `chess` is any chess.js-compatible object exposing `.get(square)`.

import { fileIdx, rankIdx, sqOf } from './upgrade-rules.js';

const SLIDES = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

function onBoard(f, r) {
  return f >= 0 && f <= 7 && r >= 0 && r <= 7;
}

// Squares a king that moves as `kingType` may move to from `from`. `kingType`
// is the movement-type ('p' | 'n' | 'b' | 'r' | 'q'); a king still moving as a
// king ('k') is left to chess.js. Returns an array of destination squares.
export function kingMoveTargets(kingType, from, color, chess) {
  const f = fileIdx(from);
  const r = rankIdx(from);
  const targets = [];
  const isEnemy = (sq) => {
    const p = chess.get(sq);
    return p && p.color !== color;
  };
  const isEmpty = (sq) => !chess.get(sq);

  if (kingType === 'p') {
    const dr = color === 'w' ? 1 : -1;
    if (onBoard(f, r + dr) && isEmpty(sqOf(f, r + dr))) targets.push(sqOf(f, r + dr));
    for (const df of [-1, 1]) {
      if (onBoard(f + df, r + dr) && isEnemy(sqOf(f + df, r + dr))) {
        targets.push(sqOf(f + df, r + dr));
      }
    }
    return targets;
  }

  if (kingType === 'n') {
    for (const [df, dr] of KNIGHT_DELTAS) {
      if (!onBoard(f + df, r + dr)) continue;
      const sq = sqOf(f + df, r + dr);
      if (isEmpty(sq) || isEnemy(sq)) targets.push(sq);
    }
    return targets;
  }

  const dirs = SLIDES[kingType];
  if (!dirs) return targets;
  for (const [df, dr] of dirs) {
    let tf = f + df;
    let tr = r + dr;
    while (onBoard(tf, tr)) {
      const sq = sqOf(tf, tr);
      const p = chess.get(sq);
      if (!p) {
        targets.push(sq);
      } else {
        if (p.color !== color) targets.push(sq);
        break;
      }
      tf += df;
      tr += dr;
    }
  }
  return targets;
}

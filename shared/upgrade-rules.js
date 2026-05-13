// Upgraded-piece move/attack patterns. Shared by the server (authoritative
// rules engine) and the client (legal-target hints during drag). The single
// source of truth: a UI hint can no longer silently disagree with what the
// server will accept.
//
// Functions here take a chess.js-compatible `chess` argument (anything with
// `.get(square)`) so this module stays free of a chess.js import — both
// sides bring their own.

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const fileIdx = (sq) => sq.charCodeAt(0) - 97;
export const rankIdx = (sq) => parseInt(sq[1], 10) - 1;
export const sqOf = (f, r) => FILES[f] + (r + 1);

// Each entry is [df, dr] — file delta, rank delta. So [1, 0] is "one
// square right, same rank" (a sideways step), not a forward push.
const DELTAS = {
  // Rook gains a Ferz (1-step diagonal) → "Dragon King".
  r: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  // Bishop gains a Wazir (1-step orthogonal) → "Dragon Horse".
  b: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  // Knight gains a Wazir (1-step orthogonal) — the WOTN "NW" piece. The
  // knight, which normally cannot reach its 4 orthogonal neighbours, now
  // can — but move-only, so attack squares are unchanged.
  n: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  // King gains the 2-square orthogonal teleport (Dabbaba): may pass over
  // a single piece, destination must be empty. 4 directions only — the
  // diagonal teleport leg was dropped to make mating less escape-prone.
  k: [[2, 0], [-2, 0], [0, 2], [0, -2]],
  // Queen gains the knight's L-jump — a move-only Amazon. Standard queen
  // slides still apply; the bonus is the 8 knight squares (empty only).
  q: [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]],
};

// An upgraded pawn keeps every standard pawn move and adds the three
// non-forward Wazir steps: left, right, and one square backward (relative
// to the pawn's forward direction). Bonus stays move-only.
function pawnDeltas(color) {
  const back = color === 'w' ? -1 : 1;
  return [[1, 0], [-1, 0], [0, back]];
}

function deltasFor(type, color) {
  if (type === 'p') return pawnDeltas(color);
  return DELTAS[type] || [];
}

// Squares an upgraded piece can MOVE to via its bonus pattern, ignoring
// king-safety. Used both for server move enumeration and client drag hints.
// Every bonus pattern is move-only: the destination square must be empty,
// none of them can capture.
export function customMoveTargets(type, from, color, chess) {
  const f = fileIdx(from);
  const r = rankIdx(from);

  const targets = [];
  for (const [df, dr] of deltasFor(type, color)) {
    const tf = f + df;
    const tr = r + dr;
    if (tf < 0 || tf > 7 || tr < 0 || tr > 7) continue;
    // chess.js refuses to load FENs with pawns on rank 1 / rank 8; the
    // backward bonus step that would land there is illegal.
    if (type === 'p' && (tr === 0 || tr === 7)) continue;
    const target = sqOf(tf, tr);
    if (chess.get(target)) continue;
    targets.push(target);
  }
  return targets;
}

// Does (from, to) match the upgraded `type`'s bonus pattern?
// Returns { ok: true, noCapture } or { ok: false, reason }.
export function validateCustomPattern(type, from, to, color) {
  const df = fileIdx(to) - fileIdx(from);
  const dr = rankIdx(to) - rankIdx(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  if (type === 'p') {
    const toRank = rankIdx(to);
    // chess.js refuses pawn positions on rank 1 / rank 8; the backward
    // bonus step that would land there is illegal.
    if (toRank === 0 || toRank === 7) return { ok: false, reason: 'illegal upgraded pawn move' };
    if (adf === 1 && adr === 0) return { ok: true, noCapture: true };
    const back = color === 'w' ? -1 : 1;
    if (df === 0 && dr === back) return { ok: true, noCapture: true };
    return { ok: false, reason: 'illegal upgraded pawn move' };
  }
  if (type === 'r') {
    if (adf === 1 && adr === 1) return { ok: true, noCapture: true };
    return { ok: false, reason: 'illegal upgraded rook move' };
  }
  if (type === 'b') {
    if ((adf === 1 && adr === 0) || (adf === 0 && adr === 1)) return { ok: true, noCapture: true };
    return { ok: false, reason: 'illegal upgraded bishop move' };
  }
  if (type === 'n') {
    if ((adf === 1 && adr === 0) || (adf === 0 && adr === 1)) return { ok: true, noCapture: true };
    return { ok: false, reason: 'illegal upgraded knight move' };
  }
  if (type === 'k') {
    const isOrtho2 = (adf === 2 && adr === 0) || (adf === 0 && adr === 2);
    if (!isOrtho2) return { ok: false, reason: 'teleport must be 2 squares orthogonally' };
    return { ok: true, noCapture: true };
  }
  if (type === 'q') {
    if ((adf === 1 && adr === 2) || (adf === 2 && adr === 1)) return { ok: true, noCapture: true };
    return { ok: false, reason: 'illegal upgraded queen move' };
  }
  return { ok: false, reason: 'piece cannot be upgraded' };
}

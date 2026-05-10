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

const DELTAS = {
  r: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  b: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  n: [[2, 2], [2, -2], [-2, 2], [-2, -2]],
  kq: [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2]],
};

function deltasFor(type) {
  if (type === 'r') return DELTAS.r;
  if (type === 'b') return DELTAS.b;
  if (type === 'n') return DELTAS.n;
  if (type === 'k' || type === 'q') return DELTAS.kq;
  return [];
}

// Squares an upgraded piece can MOVE to via its bonus pattern, ignoring
// king-safety. Used both for server move enumeration and client drag hints.
export function customMoveTargets(type, from, color, chess) {
  const f = fileIdx(from);
  const r = rankIdx(from);
  const teleport = type === 'k' || type === 'q';
  const targets = [];
  for (const [df, dr] of deltasFor(type)) {
    const tf = f + df;
    const tr = r + dr;
    if (tf < 0 || tf > 7 || tr < 0 || tr > 7) continue;
    const target = sqOf(tf, tr);
    const dest = chess.get(target);
    if (teleport) {
      if (dest) continue;
    } else if (dest && dest.color === color) {
      continue;
    }
    targets.push(target);
  }
  return targets;
}

// Squares an upgraded piece ATTACKS via its bonus pattern. King/queen
// teleports cannot capture, so they contribute no attacks here — their
// normal attack patterns are covered by chess.js.
export function customAttackSquares(type, from) {
  if (type !== 'r' && type !== 'b' && type !== 'n') return [];
  const f = fileIdx(from);
  const r = rankIdx(from);
  const out = [];
  for (const [df, dr] of deltasFor(type)) {
    const tf = f + df;
    const tr = r + dr;
    if (tf < 0 || tf > 7 || tr < 0 || tr > 7) continue;
    out.push(sqOf(tf, tr));
  }
  return out;
}

// Does (from, to) match the upgraded `type`'s bonus pattern?
// Returns { ok: true, noCapture? } or { ok: false, reason }.
export function validateCustomPattern(type, from, to) {
  const df = fileIdx(to) - fileIdx(from);
  const dr = rankIdx(to) - rankIdx(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  if (type === 'r') {
    if (adf === 1 && adr === 1) return { ok: true };
    return { ok: false, reason: 'illegal upgraded rook move' };
  }
  if (type === 'b') {
    if ((adf === 1 && adr === 0) || (adf === 0 && adr === 1)) return { ok: true };
    return { ok: false, reason: 'illegal upgraded bishop move' };
  }
  if (type === 'n') {
    if (adf === 2 && adr === 2) return { ok: true };
    return { ok: false, reason: 'illegal upgraded knight move' };
  }
  if (type === 'k' || type === 'q') {
    const isOrtho2 = (adf === 2 && adr === 0) || (adf === 0 && adr === 2);
    const isDiag2 = adf === 2 && adr === 2;
    if (!isOrtho2 && !isDiag2)
      return { ok: false, reason: 'teleport must be 2 squares in any direction' };
    return { ok: true, noCapture: true };
  }
  return { ok: false, reason: 'piece cannot be upgraded' };
}

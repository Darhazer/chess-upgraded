// Square-style "layers" — each is a pure function returning a partial
// `{ [square]: cssProps }` map. mergeSquareStyles composes them so a new
// overlay (last-move, check, premove) just adds another layer rather
// than threading another branch through one big useMemo.

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function upgradedGlowLayer(upgradedSet) {
  const out = {};
  for (const sq of upgradedSet) {
    out[sq] = {
      background:
        'radial-gradient(circle at center, rgba(255, 215, 60, 0.18) 0%, transparent 70%)',
    };
  }
  return out;
}

export function upgradePickableLayer(local, color, upgradedSet) {
  const out = {};
  const board = local.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.color !== color || p.type === 'p') continue;
      const sq = FILES[f] + (8 - r);
      if (upgradedSet.has(sq)) continue;
      out[sq] = { background: 'rgba(106, 169, 255, 0.45)' };
    }
  }
  return out;
}

export function dragHintLayer(hints) {
  const out = {};
  for (const sq of hints) {
    out[sq] = { boxShadow: 'inset 0 0 16px 2px rgba(106, 169, 255, 0.6)' };
  }
  return out;
}

export function mergeSquareStyles(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [sq, style] of Object.entries(layer)) {
      out[sq] = { ...(out[sq] || {}), ...style };
    }
  }
  return out;
}

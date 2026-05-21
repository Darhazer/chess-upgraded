import type { CSSProperties } from 'react';

type StyleLayer = Record<string, CSSProperties> | null | undefined;

// Square-style "layers" — each is a pure function returning a partial
// `{ [square]: cssProps }` map. mergeSquareStyles composes them so a new
// overlay (last-move, check, premove) just adds another layer rather
// than threading another branch through one big useMemo.

export function upgradedGlowLayer(upgradedSet: Iterable<string>): Record<string, CSSProperties> {
  const out: Record<string, CSSProperties> = {};
  for (const sq of upgradedSet) {
    out[sq] = {
      background:
        'radial-gradient(circle at center, rgba(255, 215, 60, 0.18) 0%, transparent 70%)',
    };
  }
  return out;
}

export function dragHintLayer(hints: Iterable<string>): Record<string, CSSProperties> {
  const out: Record<string, CSSProperties> = {};
  for (const sq of hints) {
    out[sq] = { boxShadow: 'inset 0 0 16px 2px rgba(106, 169, 255, 0.6)' };
  }
  return out;
}

export function selectedSquareLayer(square: string | null | undefined): Record<string, CSSProperties> | null {
  if (!square) return null;
  return { [square]: { background: 'rgba(106, 169, 255, 0.35)' } };
}

// Chess RPG: highlights the square holding a piece that was just built this
// turn — that piece is locked from moving until the next turn.
export function lockedSquareLayer(square: string | null | undefined): Record<string, CSSProperties> | null {
  if (!square) return null;
  return { [square]: { boxShadow: 'inset 0 0 0 3px rgba(255, 99, 71, 0.7)' } };
}

export function mergeSquareStyles(...layers: StyleLayer[]): Record<string, CSSProperties> {
  const out: Record<string, CSSProperties> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [sq, style] of Object.entries(layer)) {
      out[sq] = { ...(out[sq] || {}), ...style };
    }
  }
  return out;
}

import { useEffect, useRef, useState } from 'react';
import type { PieceCode } from '../../piece-svgs.js';

export type ActionAnimation =
  | { kind: 'build' }
  | { kind: 'upgrade'; fromCode: PieceCode };

export type ActionAnimations = Record<string, ActionAnimation>;

interface HistoryEntry {
  kind?: string;
  color?: 'w' | 'b';
  san?: string;
  to?: string;
}

// Animation lengths — kept in sync with the keyframes in styles.css. Build
// is a slow 3s fade-in so the new piece is unmistakable. Upgrade is a 2s
// crossfade (1s old → 1s new) for the same readability reason.
const BUILD_MS = 3000;
const UPGRADE_MS = 2000;

// Watches the server's history tail for newly-arrived `build` or `upgrade`
// entries and returns a map of square → animation descriptor. The returned
// map drives CSS keyframes on the rendered piece (see useCustomPieces).
// Squares clear themselves after the per-kind duration fires; if a fresh
// state update brings a new event for the same square, the old timer is
// cancelled and the animation restarts.
//
// For upgrades, the *previous* piece type is parsed out of the SAN — the
// engine writes upgrades as `${oldTypeUpper}${square}>${newTypeUpper}`
// (e.g. `Pe2>N`), so `san[0]` reliably gives us the from-type letter. That
// letter + the entry's color yields a PieceCode the renderer can use to
// show the old SVG as a fading overlay during the first half of the
// animation.
export function useActionAnimations(history: HistoryEntry[] | undefined): ActionAnimations {
  const [animations, setAnimations] = useState<ActionAnimations>({});
  // Tracks how many history entries we have already inspected so a re-render
  // with the same state doesn't re-fire animations. `null` is the "we haven't
  // seen history yet" sentinel — on first mount we catch up to the current
  // length silently, otherwise a mid-game reconnect would replay the most
  // recent build/upgrade animation against the user.
  const seenRef = useRef<number | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const hist = history || [];
    if (seenRef.current === null) {
      seenRef.current = hist.length;
      return;
    }
    if (hist.length < seenRef.current) {
      seenRef.current = 0;
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
      setAnimations({});
    }
    const fresh = hist.slice(seenRef.current);
    seenRef.current = hist.length;
    if (fresh.length === 0) return;

    const next: ActionAnimations = {};
    const durations: Record<string, number> = {};
    for (const entry of fresh) {
      if (!entry.to) continue;
      if (entry.kind === 'build') {
        next[entry.to] = { kind: 'build' };
        durations[entry.to] = BUILD_MS;
      } else if (entry.kind === 'upgrade' && entry.color && entry.san) {
        const fromLetter = entry.san[0];
        if (!fromLetter) continue;
        const fromCode = `${entry.color}${fromLetter.toUpperCase()}` as PieceCode;
        next[entry.to] = { kind: 'upgrade', fromCode };
        durations[entry.to] = UPGRADE_MS;
      }
    }
    if (Object.keys(next).length === 0) return;

    setAnimations((prev) => ({ ...prev, ...next }));
    for (const square of Object.keys(next)) {
      const existing = timersRef.current.get(square);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timersRef.current.delete(square);
        setAnimations((prev) => {
          if (!(square in prev)) return prev;
          const copy = { ...prev };
          delete copy[square];
          return copy;
        });
      }, durations[square]);
      timersRef.current.set(square, t);
    }
  }, [history]);

  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  return animations;
}

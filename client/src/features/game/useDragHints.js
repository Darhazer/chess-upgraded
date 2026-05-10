import { useCallback, useState } from 'react';
import { useLatest } from '../../hooks/useLatest.js';
import { customMoveTargets } from '../../../../shared/upgrade-rules.js';

// Manages the legal-target highlight set shown while a piece is being
// dragged. Two subtleties baked in here so callers don't have to know:
//
// 1. react-chessboard memoizes its useDrag on [piece, square, ...] and
//    does NOT re-evaluate when the drag callbacks change identity. We
//    keep the callback identities stable and read live state via a ref
//    (see useLatest) — otherwise the closures captured at first render
//    (when myTurn was false) win and hints never compute.
//
// 2. Updating React state synchronously inside the drag-init path makes
//    react-dnd unhappy (re-renders the in-flight drag). We defer the
//    set/clear with setTimeout(0) to dodge that.
export function useDragHints({ myTurn, upgradeMode, color, local, upgradedSet }) {
  const [hints, setHints] = useState(null);
  const stateRef = useLatest({ myTurn, upgradeMode, color, local, upgradedSet });

  const onDragBegin = useCallback((_piece, sourceSquare) => {
    const s = stateRef.current;
    if (!s.myTurn || s.upgradeMode) return;
    const piece = s.local.get(sourceSquare);
    if (!piece || piece.color !== s.color) return;

    const targets = new Set();
    for (const m of s.local.moves({ square: sourceSquare, verbose: true })) {
      targets.add(m.to);
    }
    if (s.upgradedSet.has(sourceSquare)) {
      for (const t of customMoveTargets(piece.type, sourceSquare, piece.color, s.local)) {
        targets.add(t);
      }
    }
    setTimeout(() => setHints(targets), 0);
  }, [stateRef]);

  const onDragEnd = useCallback(() => {
    setTimeout(() => setHints(null), 0);
  }, []);

  return { hints, onDragBegin, onDragEnd, clearHints: () => setHints(null) };
}

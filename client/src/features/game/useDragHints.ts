import { useCallback, useMemo, useState } from 'react';
import { useLatest } from '../../hooks/useLatest.js';
import { legalTargets } from './move-targets.js';
import type { Chess } from 'chess.js';

interface DragHintsInput {
  myTurn: boolean;
  color: 'w' | 'b';
  local: Chess;
  variant: string;
  upgradedSet: Set<string>;
  kingOverrides: Record<string, string>;
  lockedSquare: string | null;
}

export interface DragHintsApi {
  hints: Set<string> | null;
  onDragBegin: (piece: string, sourceSquare: string) => void;
  onDragEnd: () => void;
}

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
export function useDragHints({ myTurn, color, local, variant, upgradedSet, kingOverrides, lockedSquare }: DragHintsInput): DragHintsApi {
  const [hints, setHints] = useState<Set<string> | null>(null);
  const stateRef = useLatest({ myTurn, color, local, variant, upgradedSet, kingOverrides, lockedSquare });

  const onDragBegin = useCallback((_piece: string, sourceSquare: string) => {
    const s = stateRef.current;
    if (!s.myTurn) return;
    const piece = s.local.get(sourceSquare as never);
    if (!piece || piece.color !== s.color) return;
    const targets = legalTargets(s.local as never, sourceSquare, {
      variant: s.variant,
      upgradedSet: s.upgradedSet,
      kingOverrides: s.kingOverrides,
      lockedSquare: s.lockedSquare,
    });
    setTimeout(() => setHints(targets), 0);
  }, [stateRef]);

  const onDragEnd = useCallback(() => {
    setTimeout(() => setHints(null), 0);
  }, []);

  return useMemo(
    () => ({ hints, onDragBegin, onDragEnd }),
    [hints, onDragBegin, onDragEnd],
  );
}

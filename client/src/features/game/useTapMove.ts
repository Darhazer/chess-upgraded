import { useCallback, useMemo } from 'react';
import { legalTargets } from './move-targets.js';
import { computeTapAction } from './tap-action.js';
import type { Chess } from 'chess.js';

interface TapMoveInput {
  myTurn: boolean;
  color: 'w' | 'b';
  local: Chess;
  variant: string;
  upgradedSet: Set<string>;
  kingOverrides: Record<string, string>;
  submitMove: (from: string, to: string) => void;
  selected: string | null;
  setSelected: (square: string | null) => void;
}

export interface TapMoveApi {
  selected: string | null;
  targets: Set<string> | null;
  onSquareClick: (square: string) => void;
}

// Tap-to-move counterpart of useDragHints. The pure state machine lives
// in tap-action.js; this hook just feeds React state into it. `selected`
// is owned by the caller so drag can clear it without going through here.
export function useTapMove({
  myTurn, color, local, variant, upgradedSet, kingOverrides, submitMove, selected, setSelected,
}: TapMoveInput): TapMoveApi {
  const effectiveSelected = myTurn ? selected : null;

  const targets = useMemo<Set<string> | null>(
    () => (effectiveSelected
      ? legalTargets(local as never, effectiveSelected, { variant, upgradedSet, kingOverrides })
      : null),
    [effectiveSelected, local, variant, upgradedSet, kingOverrides],
  );

  const onSquareClick = useCallback(
    (square: string) => {
      const piece = local.get(square as never);
      const action = computeTapAction({
        myTurn, color, selected: effectiveSelected, targets, piece, square,
      });
      if ('select' in action && action.select !== undefined) setSelected(action.select);
      if ('move' in action && action.move) submitMove(action.move.from, action.move.to);
    },
    [myTurn, local, color, effectiveSelected, targets, submitMove, setSelected],
  );

  return useMemo(
    () => ({ selected: effectiveSelected, targets, onSquareClick }),
    [effectiveSelected, targets, onSquareClick],
  );
}

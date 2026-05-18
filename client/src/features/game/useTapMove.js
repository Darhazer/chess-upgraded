import { useCallback, useMemo } from 'react';
import { legalTargets } from './move-targets.js';
import { computeTapAction } from './tap-action.js';

// Tap-to-move counterpart of useDragHints. The pure state machine lives
// in tap-action.js; this hook just feeds React state into it. `selected`
// is owned by the caller so drag can clear it without going through here.
export function useTapMove({
  myTurn, color, local, variant, upgradedSet, kingOverrides, submitMove, selected, setSelected,
}) {
  const effectiveSelected = myTurn ? selected : null;

  const targets = useMemo(
    () => (effectiveSelected
      ? legalTargets(local, effectiveSelected, { variant, upgradedSet, kingOverrides })
      : null),
    [effectiveSelected, local, variant, upgradedSet, kingOverrides]
  );

  const onSquareClick = useCallback(
    (square) => {
      const piece = local.get(square);
      const action = computeTapAction({
        myTurn, color, selected: effectiveSelected, targets, piece, square,
      });
      if (action.select !== undefined) setSelected(action.select);
      if (action.move) submitMove(action.move.from, action.move.to);
    },
    [myTurn, local, color, effectiveSelected, targets, submitMove, setSelected]
  );

  return useMemo(
    () => ({ selected: effectiveSelected, targets, onSquareClick }),
    [effectiveSelected, targets, onSquareClick]
  );
}

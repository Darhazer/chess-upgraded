import { useMemo } from 'react';
import { useLatest } from '../../hooks/useLatest.js';
import { PIECE_SVGS } from '../../piece-svgs.js';

const PIECE_CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];

// Same Cburnett SVG as react-chessboard's default, but the upgraded
// variant gets a piece-only drop-shadow + hue shift so the visual change
// lives on the figure rather than around it. The renderers stay stable
// across renders (same react-chessboard memoization caveat that
// useDragHints addresses) and read the upgrade set from a ref.
export function useCustomPieces(upgradedSet) {
  const upgradedRef = useLatest(upgradedSet);
  return useMemo(() => {
    const out = {};
    for (const code of PIECE_CODES) {
      const html = PIECE_SVGS[code];
      out[code] = ({ squareWidth, square }) => {
        const isUpgraded = upgradedRef.current.has(square);
        return (
          <div
            style={{
              width: squareWidth,
              height: squareWidth,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              filter: isUpgraded
                ? 'drop-shadow(0 0 5px rgba(255, 215, 60, 1)) drop-shadow(0 0 2px rgba(255, 215, 60, 0.9)) hue-rotate(35deg) saturate(1.6)'
                : undefined,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      };
    }
    return out;
  }, [upgradedRef]);
}

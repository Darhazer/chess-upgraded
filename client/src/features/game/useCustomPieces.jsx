import { useMemo } from 'react';
import { useLatest } from '../../hooks/useLatest.js';
import { PIECE_SVGS } from '../../piece-svgs.js';

const PIECE_CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];

const UPGRADED_FILTER =
  'drop-shadow(0 0 5px rgba(255, 215, 60, 1)) drop-shadow(0 0 2px rgba(255, 215, 60, 0.9)) hue-rotate(35deg) saturate(1.6)';

// Module-level so the renderer below stays a thin closure (just html +
// per-square props) instead of redefining a component on every hook call.
function UpgradedPiece({ html, isUpgraded, squareWidth }) {
  return (
    <div
      style={{
        width: squareWidth,
        height: squareWidth,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: isUpgraded ? UPGRADED_FILTER : undefined,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Same Cburnett SVG as react-chessboard's default, but a glowing square
// (an upgraded piece in chess-upgraded, or a cannibalised king in Cannibal
// Chess) gets a piece-only drop-shadow + hue shift so the visual change lives
// on the figure rather than around it.
//
// In Cannibal Chess a king that has captured keeps its 'k' in the FEN but is
// drawn as the piece it became: `kingOverrides` maps such a square to its new
// movement-type, and the renderer swaps in that piece's SVG (same colour).
//
// The renderers stay stable across renders (same react-chessboard memoization
// caveat useDragHints addresses) and read live state from refs.
export function useCustomPieces(glowSquares, kingOverrides = {}) {
  const glowRef = useLatest(glowSquares);
  const overridesRef = useLatest(kingOverrides);
  return useMemo(() => {
    const out = {};
    for (const code of PIECE_CODES) {
      const baseHtml = PIECE_SVGS[code];
      out[code] = ({ squareWidth, square }) => {
        const override = overridesRef.current[square];
        const html = override ? PIECE_SVGS[code[0] + override.toUpperCase()] : baseHtml;
        return (
          <UpgradedPiece
            html={html}
            isUpgraded={glowRef.current.has(square)}
            squareWidth={squareWidth}
          />
        );
      };
    }
    return out;
  }, [glowRef, overridesRef]);
}

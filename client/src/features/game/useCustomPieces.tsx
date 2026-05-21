import { useMemo } from 'react';
import { useLatest } from '../../hooks/useLatest.js';
import { PIECE_SVGS, type PieceCode } from '../../piece-svgs.js';
import type { ActionAnimation, ActionAnimations } from './useActionAnimations.js';

const PIECE_CODES: readonly PieceCode[] = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];

const UPGRADED_FILTER =
  'drop-shadow(0 0 5px rgba(255, 215, 60, 1)) drop-shadow(0 0 2px rgba(255, 215, 60, 0.9)) hue-rotate(35deg) saturate(1.6)';

interface UpgradedPieceProps {
  html: string;
  isUpgraded: boolean;
  squareWidth: number;
  animation?: ActionAnimation | undefined;
}

const centerFlex = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;

// Module-level so the renderer below stays a thin closure (just html +
// per-square props) instead of redefining a component on every hook call.
//
// For an `upgrade` animation we stack two layers on the same square:
//   - The base layer holds the *new* piece (whatever react-chessboard
//     handed us); its `piece-anim-upgrade-new` keyframe keeps it invisible
//     for the first 1s then fades it from 0.5 → 1 opacity.
//   - An absolute overlay holds the *old* piece SVG, animated by
//     `piece-anim-upgrade-old`: 1 → 0.5 opacity over 1s, then hidden.
// The visual reads as "old piece fades out, new piece fades in."
//
// For a `build` animation we only have the new piece — the base layer
// runs `piece-anim-build` (3s opacity 0 → 1) on its own.
function UpgradedPiece({ html, isUpgraded, squareWidth, animation }: UpgradedPieceProps) {
  const animKey = animation
    ? animation.kind === 'upgrade'
      ? `upgrade:${animation.fromCode}`
      : animation.kind
    : 'static';
  const baseClass =
    animation?.kind === 'build'
      ? 'piece-anim piece-anim-build'
      : animation?.kind === 'upgrade'
        ? 'piece-anim piece-anim-upgrade-new'
        : undefined;
  const wrapperStyle = {
    width: squareWidth,
    height: squareWidth,
    position: 'relative' as const,
  };
  const layerStyle = {
    width: squareWidth,
    height: squareWidth,
    ...centerFlex,
    filter: isUpgraded ? UPGRADED_FILTER : undefined,
  };
  const overlayStyle = {
    position: 'absolute' as const,
    inset: 0,
    width: squareWidth,
    height: squareWidth,
    ...centerFlex,
  };
  // `key` forces React to remount the wrapper when the animation kind
  // changes for the same square; otherwise restarting an animation on a
  // square that already had one would silently no-op (CSS class identical).
  return (
    <div key={animKey} style={wrapperStyle}>
      <div
        className={baseClass}
        style={layerStyle}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {animation?.kind === 'upgrade' && (
        <div
          className="piece-anim piece-anim-upgrade-old"
          style={overlayStyle}
          dangerouslySetInnerHTML={{ __html: PIECE_SVGS[animation.fromCode] }}
        />
      )}
    </div>
  );
}

type PieceRenderer = (props: { squareWidth: number; square: string }) => JSX.Element;

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
export function useCustomPieces(
  glowSquares: Set<string>,
  kingOverrides: Record<string, string> = {},
  animations: ActionAnimations = {},
): Record<PieceCode, PieceRenderer> {
  const glowRef = useLatest(glowSquares);
  const overridesRef = useLatest(kingOverrides);
  // `animations` is a real memo dependency (not just a ref) because we need
  // react-chessboard to see a new customPieces identity when an animation
  // starts or expires — otherwise it won't repaint the piece with the new
  // class. Glow + king overrides stay refs (they change less often and the
  // re-render isn't needed mid-animation for them).
  return useMemo(() => {
    const out: Partial<Record<PieceCode, PieceRenderer>> = {};
    for (const code of PIECE_CODES) {
      const baseHtml = PIECE_SVGS[code];
      out[code] = ({ squareWidth, square }) => {
        const override = overridesRef.current[square];
        const overrideKey = override
          ? (code[0] + override.toUpperCase()) as PieceCode
          : null;
        const html = overrideKey ? PIECE_SVGS[overrideKey] : baseHtml;
        return (
          <UpgradedPiece
            html={html}
            isUpgraded={glowRef.current.has(square)}
            squareWidth={squareWidth}
            animation={animations[square]}
          />
        );
      };
    }
    return out as Record<PieceCode, PieceRenderer>;
  }, [glowRef, overridesRef, animations]);
}

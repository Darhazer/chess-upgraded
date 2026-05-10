import { useMemo } from 'react';
import { Chess } from 'chess.js';
import { deriveGameState } from './derive-game-state.js';

// Thin React adapter over deriveGameState: builds the chess.js instance
// (which can't be pure — it owns mutable position state) and merges it
// into the derived view-state. All the field derivation logic lives in
// derive-game-state.js so it's testable without React.
export function useGameState(room, state) {
  const local = useMemo(() => {
    const c = new Chess();
    if (state?.fen) c.load(state.fen);
    return c;
  }, [state?.fen]);

  const derived = useMemo(() => deriveGameState(room, state), [room, state]);

  return useMemo(() => ({ ...derived, local }), [derived, local]);
}

import { useMemo } from 'react';
import { Chess } from 'chess.js';
import { deriveGameState, type DerivedGameState, type ServerRoomState } from './derive-game-state.js';
import type { SavedRoom } from '../../services/player-id.js';

export interface GameViewState extends DerivedGameState {
  local: Chess;
}

// Thin React adapter over deriveGameState: builds the chess.js instance
// (which can't be pure — it owns mutable position state) and merges it
// into the derived view-state. All the field derivation logic lives in
// derive-game-state.js so it's testable without React.
export function useGameState(room: SavedRoom, state: ServerRoomState | null | undefined): GameViewState {
  const local = useMemo(() => {
    const c = new Chess();
    if (state?.fen) c.load(state.fen);
    return c;
  }, [state?.fen]);

  const derived = useMemo(() => deriveGameState(room, state), [room, state]);

  return useMemo(() => ({ ...derived, local }), [derived, local]);
}

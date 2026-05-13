// Pure derivation of view-state from the raw room/server-broadcast pair.
// `local` (a chess.js instance built from FEN) is layered on by the
// useGameState hook — keeping this function pure means it can be tested
// without React or a real Chess instance.
export function deriveGameState(room, state) {
  const opponentColor = room.color === 'w' ? 'b' : 'w';
  const upgraded = state?.upgraded || [];
  const myTurn = state?.status === 'playing' && state?.turn === room.color;
  return {
    orientation: room.color === 'b' ? 'black' : 'white',
    fen: state?.fen || 'start',
    myTurn,
    opponentColor,
    upgradedSet: new Set(upgraded),
    me: state?.players?.find((p) => p.color === room.color),
    opponent: state?.players?.find((p) => p.color !== room.color),
    status: state?.status,
    result: state?.result,
    history: state?.history || [],
  };
}

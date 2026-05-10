// Pure derivation of view-state from the raw room/server-broadcast pair.
// `local` (a chess.js instance built from FEN) is layered on by the
// useGameState hook — keeping this function pure means it can be tested
// without React or a real Chess instance.
export function deriveGameState(room, state) {
  const opponentColor = room.color === 'w' ? 'b' : 'w';
  const upgraded = state?.upgraded || [];
  const barMax = state?.barMax ?? 3;
  const myBar = state?.bar?.[room.color] ?? 0;
  const oppBar = state?.bar?.[opponentColor] ?? 0;
  const myTurn = state?.status === 'playing' && state?.turn === room.color;
  return {
    orientation: room.color === 'b' ? 'black' : 'white',
    fen: state?.fen || 'start',
    myTurn,
    opponentColor,
    upgradedSet: new Set(upgraded),
    barMax,
    myBar,
    oppBar,
    canUpgrade: myTurn && myBar >= barMax,
    me: state?.players?.find((p) => p.color === room.color),
    opponent: state?.players?.find((p) => p.color !== room.color),
    status: state?.status,
    result: state?.result,
    history: state?.history || [],
  };
}

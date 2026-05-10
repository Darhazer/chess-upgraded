import { emitWithAck } from './socket-context.jsx';

// In-game actions. `move` and `upgrade` resolve to `{ ok }`/`{ ok, error }`;
// `resign` is fire-and-forget (server broadcasts the new state).
export const gameApi = {
  move: (socket, code, move) => emitWithAck(socket, 'game:move', { code, move }),
  upgrade: (socket, code, square) => emitWithAck(socket, 'game:upgrade', { code, square }),
  resign: (socket, code) => socket.emit('game:resign', { code }),
};

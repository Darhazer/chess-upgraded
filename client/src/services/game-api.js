import { emitWithAck } from './socket-context.jsx';

// In-game actions. `move` resolves to `{ ok }`/`{ ok, error }`; `resign`
// is fire-and-forget (server broadcasts the new state).
export const gameApi = {
  move: (socket, code, move) => emitWithAck(socket, 'game:move', { code, move }),
  resign: (socket, code) => socket.emit('game:resign', { code }),
};

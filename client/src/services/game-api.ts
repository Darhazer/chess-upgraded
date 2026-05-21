import { emitWithAck, type AckResponse } from './socket-context.js';
import type { Socket } from 'socket.io-client';

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
}

// In-game actions. `move` resolves to `{ ok }`/`{ ok, error }`; `resign`
// is fire-and-forget (server broadcasts the new state).
export const gameApi = {
  move: (socket: Socket, code: string, move: MoveInput): Promise<AckResponse> =>
    emitWithAck(socket, 'game:move', { code, move }),
  build: (socket: Socket, code: string, slotId: string): Promise<AckResponse> =>
    emitWithAck(socket, 'game:build', { code, slotId }),
  upgrade: (socket: Socket, code: string, slotId: string, to: string): Promise<AckResponse> =>
    emitWithAck(socket, 'game:upgrade', { code, slotId, to }),
  resign: (socket: Socket, code: string): void => {
    socket.emit('game:resign', { code });
  },
};

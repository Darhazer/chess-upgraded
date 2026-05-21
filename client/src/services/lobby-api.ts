import { emitWithAck, type AckResponse } from './socket-context.js';
import { getPlayerId } from './player-id.js';
import type { Socket } from 'socket.io-client';

export interface LobbyResponse extends AckResponse {
  code?: string;
  color?: 'w' | 'b';
}

// Lobby actions — typed call sites instead of raw socket.emit strings.
// Each returns `{ ok: true, code, color }` or `{ ok: false, error }`.
// playerId is injected here so call sites don't have to thread it through.
export const lobbyApi = {
  public: (socket: Socket, name: string, variant: string): Promise<LobbyResponse> =>
    emitWithAck(socket, 'lobby:public', { playerId: getPlayerId(), name, variant }),
  create: (socket: Socket, name: string, variant: string): Promise<LobbyResponse> =>
    emitWithAck(socket, 'lobby:create', { playerId: getPlayerId(), name, variant }),
  join: (socket: Socket, code: string, name?: string): Promise<LobbyResponse> =>
    emitWithAck(socket, 'lobby:join', { code, playerId: getPlayerId(), name }),
  bot: (socket: Socket, name: string, variant: string): Promise<LobbyResponse> =>
    emitWithAck(socket, 'lobby:bot', { playerId: getPlayerId(), name, variant }),
  rejoin: (socket: Socket, code: string): Promise<LobbyResponse> =>
    emitWithAck(socket, 'lobby:rejoin', { code, playerId: getPlayerId() }),
  leave: (socket: Socket, code: string): Promise<AckResponse> =>
    emitWithAck(socket, 'lobby:leave', { code }),
};

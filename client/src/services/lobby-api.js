import { emitWithAck } from './socket-context.jsx';
import { getPlayerId } from './player-id.js';

// Lobby actions — typed call sites instead of raw socket.emit strings.
// Each returns `{ ok: true, code, color }` or `{ ok: false, error }`.
// playerId is injected here so call sites don't have to thread it through.
export const lobbyApi = {
  public: (socket, name) => emitWithAck(socket, 'lobby:public', { playerId: getPlayerId(), name }),
  create: (socket, name) => emitWithAck(socket, 'lobby:create', { playerId: getPlayerId(), name }),
  join: (socket, code, name) =>
    emitWithAck(socket, 'lobby:join', { code, playerId: getPlayerId(), name }),
  bot: (socket, name) => emitWithAck(socket, 'lobby:bot', { playerId: getPlayerId(), name }),
  rejoin: (socket, code) =>
    emitWithAck(socket, 'lobby:rejoin', { code, playerId: getPlayerId() }),
  leave: (socket, code) => emitWithAck(socket, 'lobby:leave', { code }),
};

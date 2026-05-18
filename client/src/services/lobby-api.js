import { emitWithAck } from './socket-context.jsx';
import { getPlayerId } from './player-id.js';

// Lobby actions — typed call sites instead of raw socket.emit strings.
// Each returns `{ ok: true, code, color }` or `{ ok: false, error }`.
// playerId is injected here so call sites don't have to thread it through.
export const lobbyApi = {
  public: (socket, name, variant) =>
    emitWithAck(socket, 'lobby:public', { playerId: getPlayerId(), name, variant }),
  create: (socket, name, variant) =>
    emitWithAck(socket, 'lobby:create', { playerId: getPlayerId(), name, variant }),
  join: (socket, code, name) =>
    emitWithAck(socket, 'lobby:join', { code, playerId: getPlayerId(), name }),
  bot: (socket, name, variant) =>
    emitWithAck(socket, 'lobby:bot', { playerId: getPlayerId(), name, variant }),
  rejoin: (socket, code) =>
    emitWithAck(socket, 'lobby:rejoin', { code, playerId: getPlayerId() }),
  leave: (socket, code) => emitWithAck(socket, 'lobby:leave', { code }),
};

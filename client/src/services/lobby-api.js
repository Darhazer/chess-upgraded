import { emitWithAck } from './socket-context.jsx';

// Lobby actions — typed call sites instead of raw socket.emit strings.
// Each returns `{ ok: true, code, color }` or `{ ok: false, error }`.
export const lobbyApi = {
  public: (socket, name) => emitWithAck(socket, 'lobby:public', { name }),
  create: (socket, name) => emitWithAck(socket, 'lobby:create', { name }),
  join: (socket, code, name) => emitWithAck(socket, 'lobby:join', { code, name }),
  bot: (socket, name) => emitWithAck(socket, 'lobby:bot', { name }),
};

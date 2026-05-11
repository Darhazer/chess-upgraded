import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { RoomStore } from './rooms.js';
import { DEFAULT_BAR_MAX } from './rules-engine.js';
import { chooseAction, BOT_COLOR } from './bot.js';

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const BAR_MAX = parseInt(process.env.UPGRADE_BAR_MAX, 10) || DEFAULT_BAR_MAX;
// How long a player can be disconnected before we drop their seat. Short
// blips (page reloads, network hiccups, Socket.IO heartbeat timeouts) need
// to survive this window so the player can come back via lobby:rejoin.
const DISCONNECT_GRACE_MS = parseInt(process.env.DISCONNECT_GRACE_MS, 10) || 60_000;
const SWEEP_INTERVAL_MS = 15_000;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

const store = new RoomStore({ barMax: BAR_MAX });

// socketId -> { code, playerId } so disconnect can find the player slot.
const socketPlayer = new Map();

function attachSocket(socket, room, playerId) {
  socket.join(room.code);
  socketPlayer.set(socket.id, { code: room.code, playerId });
}

function emitRoomState(room) {
  io.to(room.code).emit('room:state', store.publicState(room));
}

function applyTerminal(room) {
  const status = room.engine.status();
  if (status.over) {
    room.status = 'over';
    room.result = { result: status.result, reason: status.reason };
  }
  return status.over;
}

function runBotIfNeeded(room) {
  if (room.mode !== 'bot' || room.status !== 'playing') return;
  if (room.engine.turn() !== BOT_COLOR) return;
  setImmediate(() => {
    if (room.status !== 'playing') return;
    if (room.engine.turn() !== BOT_COLOR) return;
    const action = chooseAction(room.engine);
    if (action) room.engine.applyAction(action);
    applyTerminal(room);
    emitRoomState(room);
  });
}

// Resolve which player a socket is acting as. Action handlers used to look
// up by socket.id, which broke across reconnects (the socket id changes but
// the player slot keeps the original id until rejoin updates it). We index
// via socketPlayer so a freshly rejoined socket also works.
function playerForSocket(room, socket) {
  const entry = socketPlayer.get(socket.id);
  if (entry && entry.code === room.code) {
    return store.findByPlayerId(room, entry.playerId) || null;
  }
  return room.players.find((p) => p.socketId === socket.id) || null;
}

// Drop a player slot and decide the room's fate. Called both from the
// explicit lobby:leave path and from the grace-period sweep.
function dropPlayer(room, player) {
  const idx = room.players.indexOf(player);
  if (idx !== -1) room.players.splice(idx, 1);

  if (room.mode === 'bot') {
    store.delete(room.code);
    return;
  }
  if (room.status === 'playing') {
    const result = {
      result: player.color === 'w' ? 'black' : 'white',
      reason: 'opponent disconnected',
    };
    room.status = 'over';
    room.result = result;
    room.engine.setOver(result);
    emitRoomState(room);
    return;
  }
  if (room.players.length === 0) {
    store.delete(room.code);
  } else {
    emitRoomState(room);
  }
}

function sweep() {
  const now = Date.now();
  for (const room of Array.from(store.rooms.values())) {
    const expired = room.players.filter(
      (p) => p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS,
    );
    for (const p of expired) dropPlayer(room, p);
  }
}
setInterval(sweep, SWEEP_INTERVAL_MS).unref();

io.on('connection', (socket) => {
  socket.on('lobby:public', ({ playerId, name } = {}, ack) => {
    if (!playerId) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.findOrCreatePublic();
    // Idempotent matchmaking: if this player is already seated in the room
    // we picked (because their previous socket hasn't been swept yet),
    // treat it as a rejoin instead of a duplicate seat.
    const existing = store.findByPlayerId(room, playerId);
    if (existing) {
      existing.socketId = socket.id;
      existing.disconnectedAt = null;
      attachSocket(socket, room, playerId);
      ack?.({ ok: true, code: room.code, color: existing.color });
      emitRoomState(room);
      return;
    }
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name });
    if (!color) return ack?.({ ok: false, error: 'room full' });
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('lobby:bot', ({ playerId, name } = {}, ack) => {
    if (!playerId) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.createBotRoom();
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name });
    if (!color) return ack?.({ ok: false, error: 'room full' });
    store.addBot(room);
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('lobby:create', ({ playerId, name } = {}, ack) => {
    if (!playerId) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.createRoom({ visibility: 'private' });
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name });
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('lobby:join', ({ code, playerId, name } = {}, ack) => {
    if (!code) return ack?.({ ok: false, error: 'code required' });
    if (!playerId) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.get(code.toUpperCase());
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    // If this playerId already has a seat (URL share opened in a new tab on
    // the same browser, or grace-period reconnect via the join button),
    // reattach instead of trying to grab a second seat.
    const existing = store.findByPlayerId(room, playerId);
    if (existing) {
      existing.socketId = socket.id;
      existing.disconnectedAt = null;
      attachSocket(socket, room, playerId);
      ack?.({ ok: true, code: room.code, color: existing.color });
      emitRoomState(room);
      return;
    }
    if (room.players.length >= 2) return ack?.({ ok: false, error: 'room full' });
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name });
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  // Fired by the client on every `connect` event when it has a saved
  // {code, playerId}. Pure reattach — does not create new seats.
  socket.on('lobby:rejoin', ({ code, playerId } = {}, ack) => {
    if (!code || !playerId) return ack?.({ ok: false, error: 'code and playerId required' });
    const room = store.get(code.toUpperCase());
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    const player = store.findByPlayerId(room, playerId);
    if (!player) return ack?.({ ok: false, error: 'not in room' });
    player.socketId = socket.id;
    player.disconnectedAt = null;
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color: player.color });
    emitRoomState(room);
  });

  // Explicit user-initiated leave. Bypasses the grace period so the room
  // cleans up immediately and a public-matchmaking partner can take the seat.
  socket.on('lobby:leave', ({ code } = {}, ack) => {
    if (!code) return ack?.({ ok: true });
    const room = store.get(code);
    if (!room) return ack?.({ ok: true });
    const player = playerForSocket(room, socket);
    if (!player) return ack?.({ ok: true });
    socketPlayer.delete(socket.id);
    socket.leave(code);
    dropPlayer(room, player);
    ack?.({ ok: true });
  });

  socket.on('game:move', ({ code, move } = {}, ack) => {
    const room = store.get(code);
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    if (room.status !== 'playing') return ack?.({ ok: false, error: 'game not active' });

    const player = playerForSocket(room, socket);
    if (!player) return ack?.({ ok: false, error: 'not in room' });
    if (player.color !== room.engine.turn()) return ack?.({ ok: false, error: 'not your turn' });

    const result = room.engine.tryMove(move);
    if (!result.ok) return ack?.({ ok: false, error: result.reason });

    applyTerminal(room);
    ack?.({ ok: true });
    emitRoomState(room);
    runBotIfNeeded(room);
  });

  socket.on('game:upgrade', ({ code, square } = {}, ack) => {
    const room = store.get(code);
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    if (room.status !== 'playing') return ack?.({ ok: false, error: 'game not active' });

    const player = playerForSocket(room, socket);
    if (!player) return ack?.({ ok: false, error: 'not in room' });
    if (player.color !== room.engine.turn()) return ack?.({ ok: false, error: 'not your turn' });

    const result = room.engine.tryUpgrade(square);
    if (!result.ok) return ack?.({ ok: false, error: result.reason });

    applyTerminal(room);
    ack?.({ ok: true });
    emitRoomState(room);
    runBotIfNeeded(room);
  });

  socket.on('game:resign', ({ code } = {}) => {
    const room = store.get(code);
    if (!room) return;
    const player = playerForSocket(room, socket);
    if (!player || room.status !== 'playing') return;
    const result = { result: player.color === 'w' ? 'black' : 'white', reason: 'resignation' };
    room.status = 'over';
    room.result = result;
    room.engine.setOver(result);
    emitRoomState(room);
  });

  socket.on('disconnect', () => {
    const entry = socketPlayer.get(socket.id);
    if (!entry) return;
    socketPlayer.delete(socket.id);
    const room = store.get(entry.code);
    if (!room) return;
    const player = store.findByPlayerId(room, entry.playerId);
    // Only stamp disconnectedAt if this socket is still the one bound to
    // the player; a later socket (rejoin) may have already taken over.
    if (!player || player.socketId !== socket.id) return;
    player.disconnectedAt = Date.now();
    emitRoomState(room);
  });
});

server.listen(PORT, () => {
  console.log(`chess server listening on :${PORT} (upgrade bar max: ${BAR_MAX})`);
});

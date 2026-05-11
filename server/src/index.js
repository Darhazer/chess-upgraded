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

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

const store = new RoomStore({ barMax: BAR_MAX });

// Tracks which room each socket belongs to so we can clean up on disconnect.
const socketRoom = new Map(); // socketId -> code

function joinRoom(socket, room) {
  socket.join(room.code);
  socketRoom.set(socket.id, room.code);
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

// After every human action in a bot room, give the engine a turn.
// Deferred to next tick so the human's ack/state emit reaches the client
// before the bot's reply lands.
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

io.on('connection', (socket) => {
  socket.on('lobby:public', ({ name } = {}, ack) => {
    const room = store.findOrCreatePublic();
    const color = store.addPlayer(room, { socketId: socket.id, name });
    if (!color) return ack?.({ ok: false, error: 'room full' });
    joinRoom(socket, room);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('lobby:bot', ({ name } = {}, ack) => {
    const room = store.createBotRoom();
    const color = store.addPlayer(room, { socketId: socket.id, name });
    if (!color) return ack?.({ ok: false, error: 'room full' });
    store.addBot(room);
    joinRoom(socket, room);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('lobby:create', ({ name } = {}, ack) => {
    const room = store.createRoom({ visibility: 'private' });
    const color = store.addPlayer(room, { socketId: socket.id, name });
    joinRoom(socket, room);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('lobby:join', ({ code, name } = {}, ack) => {
    if (!code) return ack?.({ ok: false, error: 'code required' });
    const room = store.get(code.toUpperCase());
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    if (room.players.length >= 2) return ack?.({ ok: false, error: 'room full' });
    const color = store.addPlayer(room, { socketId: socket.id, name });
    joinRoom(socket, room);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  socket.on('game:move', ({ code, move } = {}, ack) => {
    const room = store.get(code);
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    if (room.status !== 'playing') return ack?.({ ok: false, error: 'game not active' });

    const player = room.players.find((p) => p.socketId === socket.id);
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

    const player = room.players.find((p) => p.socketId === socket.id);
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
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player || room.status !== 'playing') return;
    const result = { result: player.color === 'w' ? 'black' : 'white', reason: 'resignation' };
    room.status = 'over';
    room.result = result;
    room.engine.setOver(result);
    emitRoomState(room);
  });

  socket.on('disconnect', () => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    socketRoom.delete(socket.id);
    const room = store.get(code);
    if (!room) return;

    const removed = store.removePlayer(room, socket.id);
    if (!removed) return;

    // Bot rooms are single-player; just discard them when the human leaves.
    if (room.mode === 'bot') {
      store.delete(code);
      return;
    }

    if (room.status === 'playing') {
      // Opponent wins by abandonment.
      const result = {
        result: removed.color === 'w' ? 'black' : 'white',
        reason: 'opponent disconnected',
      };
      room.status = 'over';
      room.result = result;
      room.engine.setOver(result);
      emitRoomState(room);
    } else if (room.players.length === 0) {
      store.delete(code);
    } else {
      emitRoomState(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`chess server listening on :${PORT} (upgrade bar max: ${BAR_MAX})`);
});

import express from 'express';
import http from 'http';
import { pathToFileURL } from 'url';
import cors from 'cors';
import { Server, type Socket } from 'socket.io';
import { RoomStore, VARIANTS, type Room, type Player, type Variant } from './rooms.js';
import { chooseAction, BOT_COLOR } from './bot.js';

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// How long a player can be disconnected before we drop their seat. Short
// blips (page reloads, network hiccups, Socket.IO heartbeat timeouts) need
// to survive this window so the player can come back via lobby:rejoin.
const DISCONNECT_GRACE_MS = parseInt(process.env.DISCONNECT_GRACE_MS ?? '', 10) || 60_000;
const SWEEP_INTERVAL_MS = 15_000;
// Per-socket rate limit for `lobby:*` events. Room codes gate access to a
// game, but nothing stops a client from spamming `lobby:create` /
// `lobby:public` / `lobby:bot` to mint rooms without bound. A token bucket
// per connection caps the burst (CAPACITY) and the sustained rate (one token
// per REFILL_MS). The defaults are generous — a human clicks through the
// lobby a handful of times — so legitimate reconnect/rejoin churn never trips
// it.
const LOBBY_RATE_CAPACITY = parseInt(process.env.LOBBY_RATE_CAPACITY ?? '', 10) || 10;
const LOBBY_RATE_REFILL_MS = parseInt(process.env.LOBBY_RATE_REFILL_MS ?? '', 10) || 3_000;
// The engine usually replies in a few ms — too instant to read as "the
// opponent moved". Hold each bot reply until at least this long has passed so
// it feels like it's thinking. Override with BOT_MIN_THINK_MS (0 disables it).
const BOT_MIN_THINK_MS = Number.isInteger(parseInt(process.env.BOT_MIN_THINK_MS ?? '', 10))
  ? parseInt(process.env.BOT_MIN_THINK_MS ?? '', 10)
  : 400;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

const store = new RoomStore();

interface SocketPlayerEntry {
  code: string;
  playerId: string;
}

// socketId -> { code, playerId } so disconnect can find the player slot.
const socketPlayer = new Map<string, SocketPlayerEntry>();

// Everything arriving over a socket is attacker-controlled. Socket.IO does
// not wrap event handlers in try/catch, so a thrown TypeError (e.g. a
// non-string `code` reaching `code.toUpperCase()`) escapes to the process
// `uncaughtException` handler and takes the whole server — every room on it —
// down. Validate field types at the edge before touching them.
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
// `move` may be a SAN string ("Nf3") or an object ({ from, to, promotion }).
const isMoveLike = (v: unknown): boolean => typeof v === 'string' || (typeof v === 'object' && v !== null && !Array.isArray(v));
// Names are optional and untrusted: only accept a short string, else drop it.
const sanitizeName = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 40) : undefined);
// Variant is client-chosen and untrusted: fall back to the default otherwise.
const sanitizeVariant = (v: unknown): Variant => ((VARIANTS as readonly string[]).includes(v as string) ? (v as Variant) : 'upgraded');

function attachSocket(socket: Socket, room: Room, playerId: string): void {
  socket.join(room.code);
  socketPlayer.set(socket.id, { code: room.code, playerId });
}

function emitRoomState(room: Room): void {
  io.to(room.code).emit('room:state', store.publicState(room));
}

function applyTerminal(room: Room): boolean {
  const status = room.engine.status();
  if (status.over) {
    room.status = 'over';
    room.result = { result: status.result, reason: status.reason };
  }
  return status.over;
}

function runBotIfNeeded(room: Room): void {
  if (room.mode !== 'bot' || room.status !== 'playing') return;
  if (room.engine.turn() !== BOT_COLOR) return;
  setImmediate(async () => {
    if (room.status !== 'playing' || room.engine.turn() !== BOT_COLOR) return;
    const startedAt = Date.now();
    let action = null;
    try {
      // Search runs in a worker (see engine/search-pool.js) — the await
      // yields the loop, so other rooms keep moving while the bot thinks.
      action = await chooseAction(room.engine);
    } catch (err) {
      console.error('[bot] failed to choose a move:', (err as Error)?.message);
      return;
    }
    // The game could have ended (resign/disconnect) while we were thinking.
    if (room.status !== 'playing' || room.engine.turn() !== BOT_COLOR) return;
    const pause = Math.max(0, BOT_MIN_THINK_MS - (Date.now() - startedAt));
    const commit = () => {
      // ...and could still end during the artificial think-pause below.
      if (room.status !== 'playing' || room.engine.turn() !== BOT_COLOR) return;
      // The action was dry-run validated in chooseAction, but applyAction is
      // the last unguarded thing on the bot path — a referee divergence here
      // must not become an uncaughtException that takes the whole process
      // (and every other room) down. Drop the move; the room just stalls.
      try {
        if (action) room.engine.applyAction(action);
        applyTerminal(room);
      } catch (err) {
        console.error('[bot] applying chosen move threw:', err);
        return;
      }
      emitRoomState(room);
    };
    if (pause === 0) commit();
    else setTimeout(commit, pause).unref();
  });
}

// Resolve which player a socket is acting as. Action handlers used to look
// up by socket.id, which broke across reconnects (the socket id changes but
// the player slot keeps the original id until rejoin updates it). We index
// via socketPlayer so a freshly rejoined socket also works.
function playerForSocket(room: Room, socket: Socket): Player | null {
  const entry = socketPlayer.get(socket.id);
  if (entry && entry.code === room.code) {
    return store.findByPlayerId(room, entry.playerId) || null;
  }
  return room.players.find((p) => p.socketId === socket.id) || null;
}

// Drop a player slot and decide the room's fate. Called both from the
// explicit lobby:leave path and from the grace-period sweep.
function dropPlayer(room: Room, player: Player): void {
  const idx = room.players.indexOf(player);
  if (idx !== -1) room.players.splice(idx, 1);

  if (room.mode === 'bot') {
    // Mark it over before unregistering so an in-flight bot search that
    // resolves after this sees a non-'playing' room and bails.
    room.status = 'over';
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

function sweep(): void {
  const now = Date.now();
  for (const room of Array.from(store.rooms.values())) {
    const expired = room.players.filter(
      (p) => p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS,
    );
    for (const p of expired) dropPlayer(room, p);
  }
}
setInterval(sweep, SWEEP_INTERVAL_MS).unref();

type AckFn = (response: unknown) => void;
type Handler = (payload: unknown, ack?: AckFn) => void;

io.on('connection', (socket: Socket) => {
  // Clients also control the ack argument: optional chaining (`ack?.()`) only
  // guards null/undefined, so a client sending an extra positional arg where
  // the ack would be makes `ack` a string and `ack?.()` throw. Socket.IO does
  // not wrap handlers in try/catch, so that would reach `uncaughtException`
  // and kill the process. `on()` normalizes a bogus ack to undefined and runs
  // the handler under a try/catch as a backstop for anything we missed.
  const on = (event: string, handler: Handler) => {
    socket.on(event, (payload: unknown, ack: unknown) => {
      const safeAck: AckFn | undefined = typeof ack === 'function' ? (ack as AckFn) : undefined;
      try {
        handler(payload, safeAck);
      } catch (err) {
        console.error(`socket handler ${event} threw:`, err);
        safeAck?.({ ok: false, error: 'internal error' });
      }
    });
  };

  // Token bucket scoped to this connection (see LOBBY_RATE_* above). Tokens
  // are fractional and refilled lazily on each check so we don't run a timer
  // per socket. `onLobby` is `on` plus a token spend up front.
  let lobbyTokens = LOBBY_RATE_CAPACITY;
  let lobbyRefilledAt = Date.now();
  const takeLobbyToken = (): boolean => {
    const now = Date.now();
    lobbyTokens = Math.min(
      LOBBY_RATE_CAPACITY,
      lobbyTokens + (now - lobbyRefilledAt) / LOBBY_RATE_REFILL_MS,
    );
    lobbyRefilledAt = now;
    if (lobbyTokens < 1) return false;
    lobbyTokens -= 1;
    return true;
  };
  const onLobby = (event: string, handler: Handler) => {
    on(event, (payload, ack) => {
      if (!takeLobbyToken()) return ack?.({ ok: false, error: 'rate limited' });
      handler(payload, ack);
    });
  };

  onLobby('lobby:public', (payload, ack) => {
    const { playerId, name, variant } = (payload || {}) as { playerId?: unknown; name?: unknown; variant?: unknown };
    if (!isNonEmptyString(playerId)) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.findOrCreatePublic(sanitizeVariant(variant));
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
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name: sanitizeName(name) });
    if (!color) return ack?.({ ok: false, error: 'room full' });
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  onLobby('lobby:bot', (payload, ack) => {
    const { playerId, name, variant } = (payload || {}) as { playerId?: unknown; name?: unknown; variant?: unknown };
    if (!isNonEmptyString(playerId)) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.createBotRoom(sanitizeVariant(variant));
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name: sanitizeName(name) });
    if (!color) return ack?.({ ok: false, error: 'room full' });
    store.addBot(room);
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  onLobby('lobby:create', (payload, ack) => {
    const { playerId, name, variant } = (payload || {}) as { playerId?: unknown; name?: unknown; variant?: unknown };
    if (!isNonEmptyString(playerId)) return ack?.({ ok: false, error: 'playerId required' });
    const room = store.createRoom({ visibility: 'private', variant: sanitizeVariant(variant) });
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name: sanitizeName(name) });
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  onLobby('lobby:join', (payload, ack) => {
    const { code, playerId, name } = (payload || {}) as { code?: unknown; playerId?: unknown; name?: unknown };
    if (!isNonEmptyString(code)) return ack?.({ ok: false, error: 'code required' });
    if (!isNonEmptyString(playerId)) return ack?.({ ok: false, error: 'playerId required' });
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
    const color = store.addPlayer(room, { socketId: socket.id, playerId, name: sanitizeName(name) });
    attachSocket(socket, room, playerId);
    ack?.({ ok: true, code: room.code, color });
    emitRoomState(room);
  });

  // Fired by the client on every `connect` event when it has a saved
  // {code, playerId}. Pure reattach — does not create new seats.
  onLobby('lobby:rejoin', (payload, ack) => {
    const { code, playerId } = (payload || {}) as { code?: unknown; playerId?: unknown };
    if (!isNonEmptyString(code) || !isNonEmptyString(playerId)) {
      return ack?.({ ok: false, error: 'code and playerId required' });
    }
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
  onLobby('lobby:leave', (payload, ack) => {
    const { code } = (payload || {}) as { code?: unknown };
    if (!isNonEmptyString(code)) return ack?.({ ok: true });
    const room = store.get(code);
    if (!room) return ack?.({ ok: true });
    const player = playerForSocket(room, socket);
    if (!player) return ack?.({ ok: true });
    socketPlayer.delete(socket.id);
    socket.leave(code);
    dropPlayer(room, player);
    ack?.({ ok: true });
  });

  on('game:move', (payload, ack) => {
    const { code, move } = (payload || {}) as { code?: unknown; move?: unknown };
    if (!isNonEmptyString(code)) return ack?.({ ok: false, error: 'room not found' });
    if (!isMoveLike(move)) return ack?.({ ok: false, error: 'invalid move' });
    const room = store.get(code);
    if (!room) return ack?.({ ok: false, error: 'room not found' });
    if (room.status !== 'playing') return ack?.({ ok: false, error: 'game not active' });

    const player = playerForSocket(room, socket);
    if (!player) return ack?.({ ok: false, error: 'not in room' });
    if (player.color !== room.engine.turn()) return ack?.({ ok: false, error: 'not your turn' });

    const result = room.engine.tryMove(move as never);
    if (!result.ok) return ack?.({ ok: false, error: result.reason });

    applyTerminal(room);
    ack?.({ ok: true });
    emitRoomState(room);
    runBotIfNeeded(room);
  });

  on('game:resign', (payload) => {
    const { code } = (payload || {}) as { code?: unknown };
    if (!isNonEmptyString(code)) return;
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

// Only start listening when run as the entrypoint; importing this module
// (e.g. from tests) gets the wired-up `server`/`io` without binding a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => {
    console.log(`chess server listening on :${PORT}`);
  });
}

export { app, server, io, store };

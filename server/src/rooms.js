import { customAlphabet } from 'nanoid';
import { RulesEngine } from './rules-engine.js';
import { CannibalEngine } from './cannibal-engine.js';

const codeId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// Supported game variants. 'upgraded' is the default chess-upgraded rule set;
// 'cannibal' is Cannibal Chess. Each maps to its own authoritative engine.
export const VARIANTS = ['upgraded', 'cannibal'];

function engineForVariant(variant) {
  return variant === 'cannibal' ? new CannibalEngine() : new RulesEngine();
}

// In-memory room registry. Each room has up to 2 players.
// Public rooms are auto-matched; private rooms are joined by code.
export class RoomStore {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom({ visibility, mode = 'pvp', variant = 'upgraded' }) {
    let code;
    do { code = codeId(); } while (this.rooms.has(code));
    const room = {
      code,
      visibility, // 'public' | 'private' | 'bot'
      mode,       // 'pvp' | 'bot'
      variant,    // 'upgraded' | 'cannibal'
      players: [], // [{ socketId, color, name }]
      engine: engineForVariant(variant),
      createdAt: Date.now(),
      status: 'waiting', // 'waiting' | 'playing' | 'over'
      result: null, // populated when status === 'over'
    };
    this.rooms.set(code, room);
    return room;
  }

  createBotRoom(variant = 'upgraded') {
    return this.createRoom({ visibility: 'bot', mode: 'bot', variant });
  }

  // Seat the synthetic opponent as black. Called *after* the human is
  // added (so addPlayer's "first arrival is white" rule assigns them
  // white), and flips the room to 'playing' the same way a second human
  // joiner would.
  addBot(room) {
    if (room.players.length >= 2) return null;
    room.players.push({ socketId: '__bot__', playerId: '__bot__', color: 'b', name: 'Computer' });
    if (room.players.length === 2) room.status = 'playing';
    return 'b';
  }

  findByPlayerId(room, playerId) {
    return room.players.find((p) => p.playerId === playerId);
  }

  get(code) {
    return this.rooms.get(code);
  }

  delete(code) {
    this.rooms.delete(code);
  }

  // Find an open public room for the given variant, or create one. Public
  // matchmaking only pairs players who chose the same variant.
  findOrCreatePublic(variant = 'upgraded') {
    for (const room of this.rooms.values()) {
      if (
        room.visibility === 'public' &&
        room.variant === variant &&
        room.status === 'waiting' &&
        room.players.length < 2
      ) {
        return room;
      }
    }
    return this.createRoom({ visibility: 'public', variant });
  }

  // Add a player. Creator (first to arrive) plays white.
  // Returns the assigned color, or null if the room is full.
  addPlayer(room, { socketId, playerId, name }) {
    if (room.players.length >= 2) return null;
    const color = room.players.length === 0 ? 'w' : 'b';
    room.players.push({
      socketId,
      playerId,
      color,
      name: name || (color === 'w' ? 'White' : 'Black'),
      disconnectedAt: null,
    });
    if (room.players.length === 2) room.status = 'playing';
    return color;
  }

  removePlayer(room, socketId) {
    const idx = room.players.findIndex((p) => p.socketId === socketId);
    if (idx === -1) return null;
    const [removed] = room.players.splice(idx, 1);
    return removed;
  }

  publicState(room) {
    const game = room.engine.publicState();
    return {
      code: room.code,
      visibility: room.visibility,
      mode: room.mode,
      variant: room.variant,
      status: room.status,
      players: room.players.map((p) => ({ color: p.color, name: p.name })),
      result: room.result || game.result,
      fen: game.fen,
      turn: game.turn,
      history: game.history,
      upgraded: game.upgraded,
      kingOverrides: game.kingOverrides,
    };
  }
}

import { customAlphabet } from 'nanoid';
import { RulesEngine } from './rules-engine.js';

const codeId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// In-memory room registry. Each room has up to 2 players.
// Public rooms are auto-matched; private rooms are joined by code.
export class RoomStore {
  constructor({ barMax } = {}) {
    this.rooms = new Map(); // code -> Room
    this.barMax = barMax;
  }

  createRoom({ visibility, mode = 'pvp' }) {
    let code;
    do { code = codeId(); } while (this.rooms.has(code));
    const room = {
      code,
      visibility, // 'public' | 'private' | 'bot'
      mode,       // 'pvp' | 'bot'
      players: [], // [{ socketId, color, name }]
      engine: new RulesEngine({ barMax: this.barMax }),
      createdAt: Date.now(),
      status: 'waiting', // 'waiting' | 'playing' | 'over'
      result: null, // populated when status === 'over'
    };
    this.rooms.set(code, room);
    return room;
  }

  createBotRoom() {
    return this.createRoom({ visibility: 'bot', mode: 'bot' });
  }

  // Seat the synthetic opponent as black. Called *after* the human is
  // added (so addPlayer's "first arrival is white" rule assigns them
  // white), and flips the room to 'playing' the same way a second human
  // joiner would.
  addBot(room) {
    if (room.players.length >= 2) return null;
    room.players.push({ socketId: '__bot__', color: 'b', name: 'Computer' });
    if (room.players.length === 2) room.status = 'playing';
    return 'b';
  }

  get(code) {
    return this.rooms.get(code);
  }

  delete(code) {
    this.rooms.delete(code);
  }

  // Find an open public room, or create one.
  findOrCreatePublic() {
    for (const room of this.rooms.values()) {
      if (
        room.visibility === 'public' &&
        room.status === 'waiting' &&
        room.players.length < 2
      ) {
        return room;
      }
    }
    return this.createRoom({ visibility: 'public' });
  }

  // Add a player. Creator (first to arrive) plays white.
  // Returns the assigned color, or null if the room is full.
  addPlayer(room, { socketId, name }) {
    if (room.players.length >= 2) return null;
    const color = room.players.length === 0 ? 'w' : 'b';
    room.players.push({ socketId, color, name: name || (color === 'w' ? 'White' : 'Black') });
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
      status: room.status,
      players: room.players.map((p) => ({ color: p.color, name: p.name })),
      result: room.result || game.result,
      fen: game.fen,
      turn: game.turn,
      history: game.history,
      upgraded: game.upgraded,
      bar: game.bar,
    };
  }
}

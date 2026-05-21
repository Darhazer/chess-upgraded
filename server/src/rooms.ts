import { customAlphabet } from 'nanoid';
import { RulesEngine } from './rules-engine.js';
import { CannibalEngine } from './cannibal-engine.js';

const codeId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// Supported game variants. 'upgraded' is the default chess-upgraded rule set;
// 'cannibal' is Cannibal Chess. Each maps to its own authoritative engine.
export const VARIANTS = ['upgraded', 'cannibal'] as const;
export type Variant = (typeof VARIANTS)[number];

export type Engine = RulesEngine | CannibalEngine;

function engineForVariant(variant: Variant): Engine {
  return variant === 'cannibal' ? new CannibalEngine() : new RulesEngine();
}

export type Visibility = 'public' | 'private' | 'bot';
export type Mode = 'pvp' | 'bot';
export type Color = 'w' | 'b';
export type RoomStatus = 'waiting' | 'playing' | 'over';

export interface Player {
  socketId: string;
  playerId: string;
  color: Color;
  name: string;
  disconnectedAt?: number | null;
}

export interface RoomResult {
  result: string;
  reason: string;
}

export interface Room {
  code: string;
  visibility: Visibility;
  mode: Mode;
  variant: Variant;
  players: Player[];
  engine: Engine;
  createdAt: number;
  status: RoomStatus;
  result: RoomResult | null;
}

interface CreateRoomOptions {
  visibility: Visibility;
  mode?: Mode;
  variant?: Variant;
}

// In-memory room registry. Each room has up to 2 players.
// Public rooms are auto-matched; private rooms are joined by code.
export class RoomStore {
  rooms: Map<string, Room>;

  constructor() {
    this.rooms = new Map();
  }

  createRoom({ visibility, mode = 'pvp', variant = 'upgraded' }: CreateRoomOptions): Room {
    let code: string;
    do { code = codeId(); } while (this.rooms.has(code));
    const room: Room = {
      code,
      visibility,
      mode,
      variant,
      players: [],
      engine: engineForVariant(variant),
      createdAt: Date.now(),
      status: 'waiting',
      result: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  createBotRoom(variant: Variant = 'upgraded'): Room {
    return this.createRoom({ visibility: 'bot', mode: 'bot', variant });
  }

  // Seat the synthetic opponent as black. Called *after* the human is
  // added (so addPlayer's "first arrival is white" rule assigns them
  // white), and flips the room to 'playing' the same way a second human
  // joiner would.
  addBot(room: Room): Color | null {
    if (room.players.length >= 2) return null;
    room.players.push({ socketId: '__bot__', playerId: '__bot__', color: 'b', name: 'Computer' });
    if (room.players.length === 2) room.status = 'playing';
    return 'b';
  }

  findByPlayerId(room: Room, playerId: string): Player | undefined {
    return room.players.find((p) => p.playerId === playerId);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  // Find an open public room for the given variant, or create one. Public
  // matchmaking only pairs players who chose the same variant.
  findOrCreatePublic(variant: Variant = 'upgraded'): Room {
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
  addPlayer(room: Room, { socketId, playerId, name }: { socketId: string; playerId: string; name?: string }): Color | null {
    if (room.players.length >= 2) return null;
    const color: Color = room.players.length === 0 ? 'w' : 'b';
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

  removePlayer(room: Room, socketId: string): Player | null {
    const idx = room.players.findIndex((p) => p.socketId === socketId);
    if (idx === -1) return null;
    const [removed] = room.players.splice(idx, 1);
    return removed ?? null;
  }

  publicState(room: Room) {
    const game = room.engine.publicState() as {
      fen: string;
      turn: string;
      upgraded: string[];
      history: unknown[];
      result: RoomResult | null;
      kingOverrides?: Record<string, string>;
    };
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

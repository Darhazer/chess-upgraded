import type { SavedRoom } from '../../services/player-id.js';
import type { SlotDescriptor, PieceInfo } from '../../../../shared/chess-rpg-rules.js';

export interface ServerPlayer {
  color: 'w' | 'b';
  name?: string;
}

export interface ServerRoomState {
  fen?: string;
  turn?: 'w' | 'b';
  variant?: string;
  status?: 'waiting' | 'playing' | 'over';
  upgraded?: string[];
  kingOverrides?: Record<string, string>;
  players?: ServerPlayer[];
  result?: { result: string; reason: string } | null;
  history?: Array<{ kind?: string; color?: 'w' | 'b'; san: string; from?: string; to?: string }>;
  material?: { w: number; b: number };
  offBoard?: { w: SlotDescriptor[]; b: SlotDescriptor[] };
  pieces?: Record<string, PieceInfo>;
  lockedSquare?: string | null;
}

export interface DerivedGameState {
  orientation: 'white' | 'black';
  fen: string;
  myTurn: boolean;
  opponentColor: 'w' | 'b';
  variant: string;
  upgradedSet: Set<string>;
  kingOverrides: Record<string, string>;
  glowSquares: Set<string>;
  me: ServerPlayer | undefined;
  opponent: ServerPlayer | undefined;
  status: ServerRoomState['status'];
  result: ServerRoomState['result'];
  history: NonNullable<ServerRoomState['history']>;
  material: { w: number; b: number };
  offBoard: { w: SlotDescriptor[]; b: SlotDescriptor[] };
  pieces: Record<string, PieceInfo>;
  lockedSquare: string | null;
}

// Pure derivation of view-state from the raw room/server-broadcast pair.
// `local` (a chess.js instance built from FEN) is layered on by the
// useGameState hook — keeping this function pure means it can be tested
// without React or a real Chess instance.
export function deriveGameState(room: SavedRoom, state: ServerRoomState | null | undefined): DerivedGameState {
  const opponentColor: 'w' | 'b' = room.color === 'w' ? 'b' : 'w';
  const variant = state?.variant || 'upgraded';
  const upgraded = state?.upgraded || [];
  // Cannibal Chess: { square: movementType } for kings that have cannibalised.
  const kingOverrides = state?.kingOverrides || {};
  const myTurn = state?.status === 'playing' && state?.turn === room.color;
  const pieces = state?.pieces || {};
  // The gold glow marks upgraded pieces (chess-upgraded), cannibalised kings,
  // or — in the RPG variant — pieces whose current XP can afford an upgrade.
  let glowSquares: Set<string>;
  if (variant === 'cannibal') {
    glowSquares = new Set(Object.keys(kingOverrides));
  } else if (variant === 'rpg') {
    glowSquares = new Set();
    for (const [square, info] of Object.entries(pieces)) {
      if (info.upgrades.some((u) => u.affordable)) glowSquares.add(square);
    }
  } else {
    glowSquares = new Set(upgraded);
  }
  return {
    orientation: room.color === 'b' ? 'black' : 'white',
    fen: state?.fen || 'start',
    myTurn,
    opponentColor,
    variant,
    upgradedSet: new Set(upgraded),
    kingOverrides,
    glowSquares,
    me: state?.players?.find((p) => p.color === room.color),
    opponent: state?.players?.find((p) => p.color !== room.color),
    status: state?.status,
    result: state?.result,
    history: state?.history || [],
    material: state?.material || { w: 0, b: 0 },
    offBoard: state?.offBoard || { w: [], b: [] },
    pieces,
    lockedSquare: state?.lockedSquare ?? null,
  };
}

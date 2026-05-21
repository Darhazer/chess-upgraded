// Shared constants for the Chess RPG variant. Imported by both the server
// engine (authoritative referee) and the client view-state derivation so
// they cannot drift on piece costs or home-square assignments.

export type Color = 'w' | 'b';
export type BuildableType = 'p' | 'n' | 'b' | 'r' | 'q';

// Material cost to build each piece type. King is never buildable.
export const PIECE_COST: Record<BuildableType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

// Starting FEN: each side has its king and the three pawns directly in
// front of it (d/e/f). Everything else — including the other five pawns —
// starts off-board and must be built. No castling rights; building a rook
// later does not retroactively grant castling.
export const RPG_INITIAL_FEN = '4k3/3ppp2/8/8/8/8/3PPP2/4K3 w - - 0 1';

// Pawn slots that start on the board. The rest of the pawn slots begin
// off-board, alongside the backrank slots.
export const RPG_INITIAL_PAWNS_ON_BOARD: Record<Color, readonly string[]> = {
  w: ['d2', 'e2', 'f2'],
  b: ['d7', 'e7', 'f7'],
};

// Seed material so the first turn already has something to do — letting
// the opener build a pawn rather than having to grind for the first point.
export const RPG_INITIAL_MATERIAL = 1;

// Each "slot" is a unique piece identity tied to a fixed home square.
// Backrank slots start off-board; pawn slots start on-board at their home.
export const RPG_BACKRANK_HOMES: Record<Color, readonly string[]> = {
  w: ['a1', 'b1', 'c1', 'd1', 'f1', 'g1', 'h1'],
  b: ['a8', 'b8', 'c8', 'd8', 'f8', 'g8', 'h8'],
};

export const RPG_PAWN_HOMES: Record<Color, readonly string[]> = {
  w: ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2'],
  b: ['a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7'],
};

// What each backrank home becomes when built.
export const RPG_HOME_TYPES: Record<string, BuildableType> = {
  a1: 'r', b1: 'n', c1: 'b', d1: 'q', f1: 'b', g1: 'n', h1: 'r',
  a8: 'r', b8: 'n', c8: 'b', d8: 'q', f8: 'b', g8: 'n', h8: 'r',
};

export function slotId(color: Color, home: string): string {
  return `${color}-${home}`;
}

export interface SlotDescriptor {
  slotId: string;
  color: Color;
  home: string;
  homeType: BuildableType;
  cost: number;
  enabled: boolean;
}

// XP gained for delivering check (+1 to the moving piece) and for a capture
// (+ceil(captured-piece-cost / 2)). Used by the engine to award XP and by
// the client to display upgrade affordances.
export function captureXp(capturedType: BuildableType): number {
  return Math.ceil(PIECE_COST[capturedType] / 2);
}

// Upgrade targets must have strictly greater material cost than the current
// type. The XP cost equals the target's material cost.
export function upgradeTargetsFor(currentType: BuildableType | 'k'): BuildableType[] {
  if (currentType === 'k') return [];
  const cur = PIECE_COST[currentType];
  return (Object.keys(PIECE_COST) as BuildableType[]).filter((t) => PIECE_COST[t] > cur);
}

// What the client needs to render an on-board piece: identity, XP, and
// which upgrades the current XP can afford.
export interface PieceInfo {
  slotId: string;
  color: Color;
  currentType: BuildableType | 'k';
  xp: number;
  upgrades: { type: BuildableType; cost: number; affordable: boolean }[];
}

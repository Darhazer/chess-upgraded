import { Chess } from 'chess.js';
import type { Square as ChessJsSquare, Color as ChessJsColor, Move } from 'chess.js';
import {
  PIECE_COST,
  RPG_INITIAL_FEN,
  RPG_INITIAL_MATERIAL,
  RPG_INITIAL_PAWNS_ON_BOARD,
  RPG_BACKRANK_HOMES,
  RPG_PAWN_HOMES,
  RPG_HOME_TYPES,
  captureXp,
  upgradeTargetsFor,
  slotId as makeSlotId,
  type BuildableType,
  type SlotDescriptor,
  type PieceInfo,
} from '../../shared/chess-rpg-rules.js';
import type {
  OverResult,
  StatusResult,
  TryMoveResult,
  MoveActionInput,
  ListedAction,
} from './rules-engine.js';

// Authoritative referee for Chess RPG. Mirrors the RulesEngine /
// CannibalEngine interface (turn / fen / clone / listActions / tryMove /
// publicState / status / setOver) so rooms.ts and index.ts treat it
// interchangeably. Adds a separate `tryBuild` action for placing
// off-board pieces back on the board.
//
// Starting position is kings + pawns only; backrank pieces sit off-board
// in per-color "slots", each tied to its original home square. Material
// accrues at the end of each turn from board *territory*: +1 per own piece
// in its own advanced half (ranks 3-4 for white, ranks 6-5 for black), +2
// per own piece in the opponent's half (ranks 5-8 for white, ranks 4-1 for
// black). Spending the standard piece value rebuilds a slot onto its home
// square — but every time a slot's piece is captured, its rebuild cost
// doubles (1 → 2 → 4 → 8 …), so losing pieces is increasingly expensive.
// A captured piece returns to its owner's pool; a promoted-then-captured
// piece returns as a pawn to its pawn-slot's home. Pawns gain +1 XP the
// first move they cross the midline (white reaches rank 5, black reaches
// rank 4). Castling is not supported in this variant (the FEN starts with
// no castling rights, and built rooks do not retroactively grant them).

export type RpgActionKind = 'move' | 'build' | 'upgrade';

export interface RpgHistoryEntry {
  kind: RpgActionKind;
  color: ChessJsColor;
  san: string;
  from: string;
  to: string;
}

// Kings have their own slot so XP from check/capture can accrue to them too,
// even though they can't be built or upgraded. homeType 'k' is the marker.
type SlotType = BuildableType | 'k';

interface Slot {
  id: string;
  color: ChessJsColor;
  home: string;
  homeType: SlotType;
  onBoard: boolean;
  square: string | null;
  currentType: SlotType;
  xp: number;
  // Number of times this slot's piece has been captured. Each capture
  // doubles the rebuild cost — `PIECE_COST[homeType] << captures`.
  captures: number;
}

export interface BuildResult {
  ok: boolean;
  reason?: string;
}

export interface UpgradeResult {
  ok: boolean;
  reason?: string;
}

export class ChessRpgEngine {
  chess: Chess;
  slots: Map<string, Slot>;
  pieceToSlot: Map<string, string>;
  material: { w: number; b: number };
  // A turn allows at most one of build OR upgrade, then a move. The flag
  // covers both — easier than tracking two separate counters since they
  // exclude each other.
  actionThisTurn: { w: boolean; b: boolean };
  lockedSquare: string | null;
  history: RpgHistoryEntry[];
  over: OverResult | null;
  variant: 'rpg';

  constructor() {
    this.chess = new Chess(RPG_INITIAL_FEN);
    this.slots = new Map();
    this.pieceToSlot = new Map();
    this.material = { w: RPG_INITIAL_MATERIAL, b: RPG_INITIAL_MATERIAL };
    this.actionThisTurn = { w: false, b: false };
    this.lockedSquare = null;
    this.history = [];
    this.over = null;
    this.variant = 'rpg';
    this._initSlots();
  }

  turn(): ChessJsColor { return this.chess.turn(); }
  fen(): string { return this.chess.fen(); }

  clone(): ChessRpgEngine {
    const copy = new ChessRpgEngine();
    copy.chess = new Chess(this.chess.fen());
    copy.slots = new Map();
    for (const [k, v] of this.slots) copy.slots.set(k, { ...v });
    copy.pieceToSlot = new Map(this.pieceToSlot);
    copy.material = { ...this.material };
    copy.actionThisTurn = { ...this.actionThisTurn };
    copy.lockedSquare = this.lockedSquare;
    copy.history = this.history.slice();
    copy.over = this.over ? { ...this.over } : null;
    return copy;
  }

  listActions(color: ChessJsColor = this.turn()): ListedAction[] {
    if (this.over || color !== this.turn()) return [];
    const actions: ListedAction[] = [];
    for (const m of this.chess.moves({ verbose: true })) {
      if (m.color !== color) continue;
      if (m.from === this.lockedSquare) continue;
      const action: ListedAction = { kind: 'move', from: m.from, to: m.to };
      if (m.promotion) action.promotion = m.promotion;
      actions.push(action);
    }
    return actions;
  }

  applyAction(action: MoveActionInput): TryMoveResult {
    return this.tryMove(action);
  }

  publicState() {
    return {
      fen: this.fen(),
      turn: this.turn(),
      variant: 'rpg' as const,
      upgraded: [] as string[],
      material: { ...this.material },
      offBoard: this._offBoardDescriptors(),
      pieces: this._pieceInfoBySquare(),
      lockedSquare: this.lockedSquare,
      history: this.history,
      result: this.over,
    };
  }

  status(): StatusResult {
    if (this.over) return { over: true, ...this.over };
    if (this.chess.isCheckmate()) {
      this.over = { result: this.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' };
      return { over: true, ...this.over };
    }
    // Standard stalemate detection. A player could in theory rescue themselves
    // by building a new piece; ignoring that edge case keeps the rule simple
    // and consistent with how chess.js decides.
    if (this.chess.isStalemate()) {
      this.over = { result: 'draw', reason: 'stalemate' };
      return { over: true, ...this.over };
    }
    if (this.chess.isInsufficientMaterial()) {
      this.over = { result: 'draw', reason: 'insufficient material' };
      return { over: true, ...this.over };
    }
    if (this.chess.isThreefoldRepetition()) {
      this.over = { result: 'draw', reason: 'threefold repetition' };
      return { over: true, ...this.over };
    }
    return { over: false, check: this.chess.isCheck() };
  }

  setOver(result: OverResult): void { this.over = result; }

  // --- Build action -------------------------------------------------

  tryBuild(rawSlotId: unknown): BuildResult {
    if (this.over) return { ok: false, reason: 'game over' };
    if (typeof rawSlotId !== 'string') return { ok: false, reason: 'invalid slot' };
    const slot = this.slots.get(rawSlotId);
    if (!slot) return { ok: false, reason: 'unknown slot' };
    if (slot.homeType === 'k') return { ok: false, reason: 'cannot build king' };
    const color = slot.color;
    if (color !== this.turn()) return { ok: false, reason: 'not your turn' };
    if (this.actionThisTurn[color]) return { ok: false, reason: 'already acted this turn' };
    if (slot.onBoard) return { ok: false, reason: 'piece already on board' };
    const cost = this._slotBuildCost(slot);
    if (this.material[color] < cost) return { ok: false, reason: 'insufficient material' };
    if (this.chess.get(slot.home as ChessJsSquare)) return { ok: false, reason: 'home square occupied' };

    const placed = this.chess.put({ type: slot.homeType, color }, slot.home as ChessJsSquare);
    if (!placed) return { ok: false, reason: 'could not place piece' };

    slot.onBoard = true;
    slot.square = slot.home;
    slot.currentType = slot.homeType;
    slot.xp = 0;
    this.pieceToSlot.set(slot.home, slot.id);
    this.material[color] -= cost;
    this.actionThisTurn[color] = true;
    this.lockedSquare = slot.home;

    this.history.push({
      kind: 'build',
      color,
      san: this._buildSan(slot),
      from: '*',
      to: slot.home,
    });
    return { ok: true };
  }

  // --- Upgrade action -----------------------------------------------

  tryUpgrade(rawSlotId: unknown, rawTo: unknown): UpgradeResult {
    if (this.over) return { ok: false, reason: 'game over' };
    if (typeof rawSlotId !== 'string') return { ok: false, reason: 'invalid slot' };
    if (typeof rawTo !== 'string') return { ok: false, reason: 'invalid upgrade target' };
    const slot = this.slots.get(rawSlotId);
    if (!slot) return { ok: false, reason: 'unknown slot' };
    const color = slot.color;
    if (color !== this.turn()) return { ok: false, reason: 'not your turn' };
    if (this.actionThisTurn[color]) return { ok: false, reason: 'already acted this turn' };
    if (!slot.onBoard || !slot.square) return { ok: false, reason: 'piece not on board' };
    if (slot.currentType === 'k') return { ok: false, reason: 'kings cannot be upgraded' };
    const toType = rawTo as BuildableType;
    const allowed = upgradeTargetsFor(slot.currentType);
    if (!allowed.includes(toType)) return { ok: false, reason: 'upgrade not allowed' };
    const cost = PIECE_COST[toType];
    if (slot.xp < cost) return { ok: false, reason: 'insufficient experience' };

    const placed = this.chess.put({ type: toType, color }, slot.square as ChessJsSquare);
    if (!placed) return { ok: false, reason: 'could not place piece' };

    const fromType = slot.currentType;
    slot.currentType = toType;
    slot.xp -= cost;
    this.actionThisTurn[color] = true;
    this.lockedSquare = slot.square;

    this.history.push({
      kind: 'upgrade',
      color,
      san: `${fromType.toUpperCase()}${slot.square}>${toType.toUpperCase()}`,
      from: slot.square,
      to: slot.square,
    });
    return { ok: true };
  }

  // --- Move action --------------------------------------------------

  tryMove(move: string | MoveActionInput | null | undefined): TryMoveResult {
    if (this.over) return { ok: false, reason: 'game over' };
    if (!move) return { ok: false, reason: 'invalid move' };

    let from: string | undefined;
    let to: string | undefined;
    let promotion: string | undefined;
    if (typeof move === 'object') {
      from = move.from;
      to = move.to;
      promotion = move.promotion;
    }

    if (from && this.lockedSquare && from === this.lockedSquare) {
      return { ok: false, reason: 'just-built piece cannot move this turn' };
    }

    if (typeof move === 'object' && from) {
      const piece = this.chess.get(from as ChessJsSquare);
      if (!piece || piece.color !== this.turn()) {
        return { ok: false, reason: 'invalid move' };
      }
    }

    let result: Move | null;
    try {
      result = this.chess.move(
        typeof move === 'string' ? move : { from: from!, to: to!, promotion },
      );
    } catch (err) {
      return { ok: false, reason: (err as Error).message || 'illegal move' };
    }
    if (!result) return { ok: false, reason: 'illegal move' };

    this._applyMoveBookkeeping(result);
    this.history.push({
      kind: 'move',
      color: result.color,
      san: result.san,
      from: result.from,
      to: result.to,
    });
    this.status();
    return { ok: true };
  }

  // --- Internals ----------------------------------------------------

  _initSlots(): void {
    for (const color of ['w', 'b'] as const) {
      const startOnBoard = new Set(RPG_INITIAL_PAWNS_ON_BOARD[color]);
      for (const home of RPG_PAWN_HOMES[color]) {
        const id = makeSlotId(color, home);
        const onBoard = startOnBoard.has(home);
        this.slots.set(id, {
          id, color, home, homeType: 'p',
          onBoard, square: onBoard ? home : null, currentType: 'p', xp: 0, captures: 0,
        });
        if (onBoard) this.pieceToSlot.set(home, id);
      }
      for (const home of RPG_BACKRANK_HOMES[color]) {
        const id = makeSlotId(color, home);
        const homeType = RPG_HOME_TYPES[home]!;
        this.slots.set(id, {
          id, color, home, homeType,
          onBoard: false, square: null, currentType: homeType, xp: 0, captures: 0,
        });
      }
      // King slot: always on-board, never built, never upgraded. Tracking it
      // as a slot keeps XP bookkeeping uniform for check/capture awards.
      const kingHome = color === 'w' ? 'e1' : 'e8';
      const kingId = makeSlotId(color, kingHome);
      this.slots.set(kingId, {
        id: kingId, color, home: kingHome, homeType: 'k',
        onBoard: true, square: kingHome, currentType: 'k', xp: 0, captures: 0,
      });
      this.pieceToSlot.set(kingHome, kingId);
    }
  }

  // Update slot identity tracking after a chess.js move. Handles captures
  // (including en passant), promotion (slot's currentType changes; homeType
  // is preserved so a captured promoted pawn returns to its pawn-home), and
  // mover-side material/XP rewards. Castling cannot occur in this variant.
  //
  // XP rules: the moving slot gains +ceil(cost/2) per captured piece and
  // +1 if the resulting position has the opponent in check. A promoted pawn
  // resets its XP to 0 — the new piece starts fresh.
  _applyMoveBookkeeping(m: Move): void {
    const enPassant = !!m.flags && m.flags.includes('e');
    const capturedSquare = enPassant ? m.to[0] + m.from[1] : m.to;
    let capturedType: BuildableType | null = null;
    if (m.captured) {
      const capturedSlotId = this.pieceToSlot.get(capturedSquare);
      if (capturedSlotId) {
        const capturedSlot = this.slots.get(capturedSlotId);
        if (capturedSlot) {
          // Kings can't be standard-captured; if we ever see one here the
          // XP award still falls through to the captured piece type.
          if (capturedSlot.currentType !== 'k') capturedType = capturedSlot.currentType;
          capturedSlot.onBoard = false;
          capturedSlot.square = null;
          capturedSlot.currentType = capturedSlot.homeType;
          capturedSlot.xp = 0;
          capturedSlot.captures += 1;
        }
        this.pieceToSlot.delete(capturedSquare);
      } else {
        // Slot mapping missing (shouldn't happen in normal play, but tests
        // can load arbitrary FENs). Fall back to chess.js's captured type.
        capturedType = m.captured as BuildableType;
      }
    }

    const movingSlotId = this.pieceToSlot.get(m.from);
    let movingSlot: Slot | undefined;
    if (movingSlotId) {
      this.pieceToSlot.delete(m.from);
      this.pieceToSlot.set(m.to, movingSlotId);
      movingSlot = this.slots.get(movingSlotId);
      if (movingSlot) {
        movingSlot.square = m.to;
        if (m.promotion) {
          movingSlot.currentType = m.promotion as BuildableType;
          movingSlot.xp = 0; // promotion resets XP
        }
      }
    }

    // Award XP to the moving slot (skipped if promotion just zeroed it).
    if (movingSlot && !m.promotion) {
      if (capturedType) movingSlot.xp += captureXp(capturedType);
      if (this.chess.isCheck()) movingSlot.xp += 1;
      // Pawn midline-crossing bonus: +1 XP the first move a pawn lands on
      // the opponent's half. White's first opponent-half rank is 5, black's
      // is 4. Pawns can only move forward one square (or two from start) or
      // capture diagonally, so this naturally fires at most once per pawn —
      // the move that brings it to rank 5 (white) or rank 4 (black). A
      // captured-then-rebuilt pawn starts fresh and can re-trigger.
      if (movingSlot.currentType === 'p') {
        const fromRank = m.from.charCodeAt(1) - 48;
        const toRank = m.to.charCodeAt(1) - 48;
        const crossed =
          (m.color === 'w' && fromRank < 5 && toRank === 5) ||
          (m.color === 'b' && fromRank > 4 && toRank === 4);
        if (crossed) movingSlot.xp += 1;
      }
    }

    // Territory-based material accrual: +1 per own piece in the player's
    // own advanced half (ranks 3-4 for white, ranks 6-5 for black), +2 per
    // own piece in the opponent's half (ranks 5-8 for white, ranks 4-1 for
    // black). Computed against the post-move position, so the just-moved
    // piece counts toward the bonus.
    this.material[m.color] += this._territoryMaterialFor(m.color);
    // Turn has flipped; per-turn flags reset for the new side.
    this.lockedSquare = null;
    this.actionThisTurn = { w: false, b: false };
  }

  _territoryMaterialFor(color: ChessJsColor): number {
    let bonus = 0;
    for (const slot of this.slots.values()) {
      if (slot.color !== color || !slot.onBoard || !slot.square) continue;
      const rank = slot.square.charCodeAt(1) - 48;
      if (color === 'w') {
        if (rank >= 5) bonus += 2;
        else if (rank >= 3) bonus += 1;
      } else {
        if (rank <= 4) bonus += 2;
        else if (rank <= 6) bonus += 1;
      }
    }
    return bonus;
  }

  // Build cost for a slot: base cost from PIECE_COST doubled per prior
  // capture. New (never-captured) slots cost the base; a slot captured
  // twice costs 4×, etc. Kings are never built and aren't covered here.
  _slotBuildCost(slot: Slot): number {
    if (slot.homeType === 'k') return Infinity;
    return PIECE_COST[slot.homeType] * (2 ** slot.captures);
  }

  _offBoardDescriptors(): { w: SlotDescriptor[]; b: SlotDescriptor[] } {
    const out: { w: SlotDescriptor[]; b: SlotDescriptor[] } = { w: [], b: [] };
    for (const slot of this.slots.values()) {
      if (slot.onBoard) continue;
      if (slot.homeType === 'k') continue; // kings never sit off-board
      const cost = this._slotBuildCost(slot);
      const homeEmpty = !this.chess.get(slot.home as ChessJsSquare);
      const enabled =
        !this.over &&
        slot.color === this.turn() &&
        !this.actionThisTurn[slot.color] &&
        this.material[slot.color] >= cost &&
        homeEmpty;
      out[slot.color].push({
        slotId: slot.id,
        color: slot.color,
        home: slot.home,
        homeType: slot.homeType,
        cost,
        enabled,
      });
    }
    return out;
  }

  // One PieceInfo per occupied board square. The client uses this to render
  // the XP + affordable-upgrade list when a piece is selected.
  _pieceInfoBySquare(): Record<string, PieceInfo> {
    const out: Record<string, PieceInfo> = {};
    for (const slot of this.slots.values()) {
      if (!slot.onBoard || !slot.square) continue;
      const upgrades = upgradeTargetsFor(slot.currentType).map((type) => ({
        type,
        cost: PIECE_COST[type],
        affordable: slot.xp >= PIECE_COST[type],
      }));
      out[slot.square] = {
        slotId: slot.id,
        color: slot.color,
        currentType: slot.currentType,
        xp: slot.xp,
        upgrades,
      };
    }
    return out;
  }

  _buildSan(slot: Slot): string {
    const letter = slot.homeType === 'p' ? '' : slot.homeType.toUpperCase();
    return `+${letter}${slot.home}`;
  }
}

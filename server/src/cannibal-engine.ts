import CannibalBoard from './engine/cannibal-board.js';
import { getFEN } from './engine/vendor/utils.js';
import type { EnginePiece, MovementType } from './engine/vendor/const.js';
import type { OverResult, StatusResult, TryMoveResult, HistoryEntry as RulesHistoryEntry, MoveActionInput, ListedAction } from './rules-engine.js';

// Authoritative referee for Cannibal Chess. Mirrors the RulesEngine interface
// (turn/fen/clone/listActions/tryMove/publicState/status/setOver) so rooms.js
// and index.js treat it interchangeably with the chess-upgraded engine.
//
// Unlike RulesEngine — which wraps chess.js — this wraps CannibalBoard (the
// variant-aware fork of js-chess-engine). The same board powers the bot search,
// so the referee and the bot can never disagree about what is legal.

export class CannibalEngine {
  board: CannibalBoard;
  history: RulesHistoryEntry[];
  over: OverResult | null;
  variant: 'cannibal';
  fenHistory: string[];

  constructor(board: CannibalBoard = new CannibalBoard()) {
    this.board = board;
    this.history = [];
    this.over = null;
    this.variant = 'cannibal';
    this.fenHistory = [this._positionKey()];
  }

  turn(): 'w' | 'b' {
    return this.board.getPlayingColor() === 'white' ? 'w' : 'b';
  }

  fen(): string {
    return getFEN(this.board.configuration);
  }

  clone(): CannibalEngine {
    const cfg = JSON.parse(JSON.stringify(this.board.configuration));
    const copy = new CannibalEngine(new CannibalBoard(cfg));
    copy.history = this.history.slice();
    copy.over = this.over ? { ...this.over } : null;
    copy.fenHistory = this.fenHistory.slice();
    return copy;
  }

  // Every legal action for `color` (the side to move), in the action shape
  // RulesEngine also emits: { kind:'move', from, to, promotion? }.
  listActions(color: 'w' | 'b' = this.turn()): ListedAction[] {
    if (this.over || color !== this.turn()) return [];
    const moves = this.board.getMoves();
    const actions: ListedAction[] = [];
    for (const from in moves) {
      for (const to of moves[from]!) {
        actions.push(this._action(from, to));
      }
    }
    return actions;
  }

  applyAction(action: MoveActionInput): TryMoveResult {
    return this.tryMove(action);
  }

  tryMove(move: string | MoveActionInput | null | undefined): TryMoveResult {
    if (this.over) return { ok: false, reason: 'game over' };
    if (!move || typeof move !== 'object' || !move.from || !move.to) {
      return { ok: false, reason: 'invalid move' };
    }
    const from = String(move.from).toUpperCase();
    const to = String(move.to).toUpperCase();
    const legal = this.board.getMoves();
    if (!legal[from] || !legal[from]!.includes(to)) {
      return { ok: false, reason: 'invalid move' };
    }

    const color = this.turn();
    const mover = this.board.getPiece(from);
    if (!mover) return { ok: false, reason: 'invalid move' };
    const captured = !!this.board.getPiece(to);
    // The king's movement-type *before* the move — needed to tell a real
    // castle from a cannibalised king merely sliding through a castle square.
    const moverKingType = this.board.configuration.kingType![color === 'w' ? 'white' : 'black'];
    this.board.move(from, to);
    this.fenHistory.push(this._positionKey());
    // Resolve terminal/check state first so the SAN can carry a +/# suffix.
    const result = this.status();
    this.history.push({
      kind: 'move',
      color,
      san: this._san(mover, from, to, captured, moverKingType) + this._checkSuffix(result),
      from: from.toLowerCase(),
      to: to.toLowerCase(),
    });
    return { ok: true };
  }

  publicState() {
    return {
      fen: this.fen(),
      turn: this.turn(),
      variant: 'cannibal' as const,
      upgraded: [], // Cannibal Chess has no upgraded pieces
      kingOverrides: this._kingOverrides(),
      history: this.history,
      result: this.over,
    };
  }

  status(): StatusResult {
    if (this.over) return { over: true, ...this.over };

    const moves = this.board.getMoves();
    const inCheck = this.board.hasPlayingPlayerCheck();
    if (!Object.keys(moves).length) {
      this.over = inCheck
        ? { result: this.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' }
        : { result: 'draw', reason: 'stalemate' };
      return { over: true, ...this.over };
    }
    // Two lone, ordinary kings — neither can mate, so it is a draw. Guarded on
    // kingType: a cannibalised king (a knight, queen, ...) *can* still attack,
    // so a lone king vs a lone king-knight is a live game, not a dead draw.
    const kt = this.board.configuration.kingType!;
    if (
      Object.keys(this.board.configuration.pieces).length === 2 &&
      kt.white === 'k' && kt.black === 'k'
    ) {
      this.over = { result: 'draw', reason: 'insufficient material' };
      return { over: true, ...this.over };
    }
    if (this.board.configuration.halfMove >= 100) {
      this.over = { result: 'draw', reason: 'fifty-move rule' };
      return { over: true, ...this.over };
    }
    const key = this._positionKey();
    if (this.fenHistory.filter((k) => k === key).length >= 3) {
      this.over = { result: 'draw', reason: 'threefold repetition' };
      return { over: true, ...this.over };
    }
    return { over: false, check: inCheck };
  }

  setOver(result: OverResult): void {
    this.over = result;
  }

  // --- helpers -------------------------------------------------------

  _action(fromUpper: string, toUpper: string): ListedAction {
    const action: ListedAction = { kind: 'move', from: fromUpper.toLowerCase(), to: toUpper.toLowerCase() };
    const piece = this.board.getPiece(fromUpper);
    // A genuine pawn reaching the back rank needs `promotion` spelled out for
    // the chess.js-shaped clients; a royal king-pawn promotes on its own.
    if (piece && piece.toUpperCase() === 'P' && (toUpper[1] === '8' || toUpper[1] === '1')) {
      action.promotion = 'q';
    }
    return action;
  }

  // A position is "the same" for threefold purposes when the board, side to
  // move, castling, en passant *and* both kings' movement-type all match.
  _positionKey(): string {
    const c = this.board.configuration;
    const kt = c.kingType || { white: 'k', black: 'k' };
    return getFEN(c).split(' ').slice(0, 4).join(' ') + ` ${kt.white}${kt.black}`;
  }

  // Squares whose king moves as something other than a king, mapped to that
  // movement-type — drives the client glow + piece redraw.
  _kingOverrides(): Record<string, MovementType> {
    const out: Record<string, MovementType> = {};
    const kt = this.board.configuration.kingType!;
    for (const location in this.board.configuration.pieces) {
      const piece = this.board.configuration.pieces[location];
      if (piece !== 'K' && piece !== 'k') continue;
      const type = kt[piece === 'K' ? 'white' : 'black'];
      if (type !== 'k') out[location.toLowerCase()] = type;
    }
    return out;
  }

  _san(mover: EnginePiece, fromUpper: string, toUpper: string, captured: boolean, moverKingType: MovementType): string {
    const from = fromUpper.toLowerCase();
    const to = toUpper.toLowerCase();
    const type = mover.toLowerCase();
    // Only a king still moving as a king can castle; a cannibalised king that
    // slides E1<->G1/C1 (e.g. as a rook) is an ordinary move, not a castle.
    if (type === 'k' && moverKingType === 'k' && (fromUpper === 'E1' || fromUpper === 'E8')) {
      if (toUpper === 'G1' || toUpper === 'G8') return 'O-O';
      if (toUpper === 'C1' || toUpper === 'C8') return 'O-O-O';
    }
    if (type === 'p') {
      // A non-capture push to the last rank auto-queens; a capture there
      // cannibalises into the captured piece instead (no promotion).
      const promotion = !captured && (to[1] === '8' || to[1] === '1') ? '=Q' : '';
      return (captured ? `${from[0]}x${to}` : to) + promotion;
    }
    return `${type.toUpperCase()}${captured ? 'x' : ''}${to}`;
  }

  // The check / checkmate marker conventional SAN carries.
  _checkSuffix(status: StatusResult): string {
    if (status.over) return status.reason === 'checkmate' ? '#' : '';
    return status.check ? '+' : '';
  }
}

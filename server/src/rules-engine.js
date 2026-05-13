import { Chess } from 'chess.js';
import {
  FILES,
  fileIdx,
  rankIdx,
  customMoveTargets,
  validateCustomPattern,
} from '../../shared/upgrade-rules.js';

// Wrapper around chess.js with the "upgrade" extension layered on top.
//
// Whenever a piece captures, the capturing piece is automatically marked
// as upgraded. An upgraded piece keeps its normal moveset and gains a
// move-only bonus pattern (see shared/upgrade-rules.js): a rook's
// diagonal step, a bishop's or knight's orthogonal step, a king's
// 2-square teleport, a queen's knight-jump, or a pawn's sideways /
// backward step. All bonus moves require an empty destination — none of
// them can capture. The upgrade follows the piece across moves and is
// lost when it's captured.
//
// chess.js drives standard moves and provides square-attack queries.
// Custom moves bypass chess.move() and instead build the post-move FEN
// by hand. Every bonus pattern is move-only, so chess.js's attacker view
// is the whole king-safety story — a piece that *relocates* via its
// bonus move to a square from which its normal lines give check is just
// an ordinary chess.js attack from the new square.

function noCaptureReason(type) {
  if (type === 'p') return 'upgraded pawn bonus move cannot capture';
  if (type === 'k') return 'cannot capture by teleport';
  if (type === 'q') return 'cannot capture by knight-jump';
  return 'upgraded bonus move cannot capture';
}

export class RulesEngine {
  constructor() {
    this.chess = new Chess();
    this.upgraded = new Set();
    this.history = []; // [{ kind, color, san, from?, to? }]
    this.over = null;
  }

  turn() { return this.chess.turn(); }
  fen() { return this.chess.fen(); }

  clone() {
    const copy = new RulesEngine();
    copy.chess = new Chess(this.chess.fen());
    copy.upgraded = new Set(this.upgraded);
    copy.history = this.history.slice();
    copy.over = this.over ? { ...this.over } : null;
    return copy;
  }

  // Enumerate every legal action for `color` (defaults to side to move):
  // standard moves and upgraded-piece custom moves.
  listActions(color = this.turn()) {
    if (this.over) return [];
    const actions = [];

    const stdMoves = this.chess.moves({ verbose: true });
    for (const m of stdMoves) {
      if (m.color !== color) continue;
      const result = this.chess.move(m);
      const prevUpgraded = new Set(this.upgraded);
      this._transferUpgradedForStandardMove(result);
      const safe = !this._isInCheck(color);
      this.upgraded = prevUpgraded;
      this.chess.undo();
      if (safe) {
        const action = { kind: 'move', from: m.from, to: m.to };
        if (m.promotion) action.promotion = m.promotion;
        actions.push(action);
      }
    }

    for (const sq of this.upgraded) {
      const piece = this.chess.get(sq);
      if (!piece || piece.color !== color) continue;
      const targets = customMoveTargets(piece.type, sq, color, this.chess);
      for (const target of targets) {
        const { chess: candidateChess } = this._customCandidate(sq, target);
        if (!this._isInCheckOn(candidateChess, color)) {
          actions.push({ kind: 'custom', from: sq, to: target });
        }
      }
    }

    return actions;
  }

  applyAction(action) {
    return this.tryMove(action);
  }

  publicState() {
    return {
      fen: this.fen(),
      turn: this.turn(),
      upgraded: [...this.upgraded],
      history: this.history,
      result: this.over,
    };
  }

  status() {
    if (this.over) return { over: true, ...this.over };
    const inCheck = this._isInCheck(this.turn());
    if (!this._hasAnyLegalMove(this.turn())) {
      this.over = inCheck
        ? { result: this.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' }
        : { result: 'draw', reason: 'stalemate' };
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
    return { over: false, check: inCheck };
  }

  setOver(result) { this.over = result; }

  // --- Public actions ------------------------------------------------

  tryMove(move) {
    if (this.over) return { ok: false, reason: 'game over' };
    if (!move) return { ok: false, reason: 'invalid move' };

    if (typeof move === 'object' && move.from) {
      const piece = this.chess.get(move.from);
      if (!piece) return { ok: false, reason: 'invalid move' };
      if (piece.color !== this.turn()) return { ok: false, reason: 'invalid move' };
    }

    const std = this._tryStandardMove(move);
    if (std.ok) {
      this._afterAction(std);
      return { ok: true };
    }

    // Only consult the custom-move path when the source piece is actually
    // upgraded. Otherwise the standard reason ("leaves king in check",
    // "illegal move") is the right thing to surface.
    if (
      typeof move === 'object' &&
      move.from &&
      move.to &&
      this.upgraded.has(move.from)
    ) {
      const custom = this._tryCustomMove(move);
      if (custom.ok) {
        this._afterAction(custom);
        return { ok: true };
      }
      return { ok: false, reason: custom.reason || std.reason || 'invalid move' };
    }

    return { ok: false, reason: std.reason || 'invalid move' };
  }

  // --- Standard moves -----------------------------------------------

  _tryStandardMove(move) {
    let result;
    try {
      result = this.chess.move(move);
    } catch (err) {
      return { ok: false, reason: err.message || 'illegal move' };
    }
    if (!result) return { ok: false, reason: 'illegal move' };

    // chess.js's move() already prevents standard king-in-check, so the
    // explicit re-check below is a no-op for now — but applying the
    // upgrade transfer first keeps the engine state consistent if the
    // move is rejected (we restore both halves together).
    const prevUpgraded = new Set(this.upgraded);
    this._transferUpgradedForStandardMove(result);

    if (this._isInCheck(result.color)) {
      this.upgraded = prevUpgraded;
      this.chess.undo();
      return { ok: false, reason: 'leaves king in check' };
    }

    return {
      kind: 'move',
      ok: true,
      color: result.color,
      san: result.san,
      from: result.from,
      to: result.to,
      flags: result.flags,
      captured: result.captured,
    };
  }

  _transferUpgradedForStandardMove({ from, to, flags, color, piece, captured }) {
    const enPassant = flags && flags.includes('e');
    const promotion = flags && flags.includes('p');
    // Did the captured piece itself carry the upgrade marker? Snapshot
    // before the delete below — used by the K/Q value-floor rule.
    const capturedWasUpgraded = captured ? this.upgraded.has(to) : false;
    if (enPassant) {
      const epSquare = to[0] + from[1];
      this.upgraded.delete(epSquare);
    } else if (captured) {
      this.upgraded.delete(to);
    }
    if (this.upgraded.has(from)) {
      this.upgraded.delete(from);
      // A promoted piece is a fresh queen, not an upgraded pawn — the
      // marker doesn't carry over. (An auto-upgrade-on-capture below
      // still applies if the promotion was also a capture.)
      if (!promotion) this.upgraded.add(to);
    }
    if (flags && (flags.includes('k') || flags.includes('q'))) {
      const kingside = flags.includes('k');
      const rank = color === 'w' ? '1' : '8';
      const rookFrom = (kingside ? 'h' : 'a') + rank;
      const rookTo = (kingside ? 'f' : 'd') + rank;
      if (this.upgraded.has(rookFrom)) {
        this.upgraded.delete(rookFrom);
        this.upgraded.add(rookTo);
      }
    }
    // Auto-upgrade the capturing piece. Applies to standard captures and
    // en passant alike. If the move was a promotion, the destination
    // square now holds the promoted piece, which inherits the upgrade.
    //
    // Exception: a king or queen capturing an unupgraded pawn doesn't
    // earn the upgrade — keeps the strongest pieces from ramping up on
    // free pawn-snacks. An already-upgraded pawn still grants it; the
    // pawn proved its weight by capturing earlier.
    if (captured || enPassant) {
      const cheapCapture =
        (piece === 'k' || piece === 'q') &&
        captured === 'p' &&
        !capturedWasUpgraded;
      if (!cheapCapture) this.upgraded.add(to);
    }
  }

  // --- Custom (upgraded) moves --------------------------------------

  _tryCustomMove(move) {
    const color = this.turn();
    if (!this.upgraded.has(move.from)) return { ok: false, reason: 'piece not upgraded' };
    const piece = this.chess.get(move.from);
    if (!piece || piece.color !== color) return { ok: false, reason: 'not your piece' };

    const validation = validateCustomPattern(piece.type, move.from, move.to, piece.color);
    if (!validation.ok) return validation;

    const dest = this.chess.get(move.to);
    if (validation.noCapture && dest) return { ok: false, reason: noCaptureReason(piece.type) };
    if (dest && dest.color === color) return { ok: false, reason: 'cannot capture own piece' };

    // Build a candidate Chess + upgraded set, then run the same king-safety
    // check we use everywhere.
    const { chess: candidateChess, upgraded: candidateUpgraded } = this._customCandidate(move.from, move.to);

    if (this._isInCheckOn(candidateChess, color)) {
      return { ok: false, reason: 'leaves king in check' };
    }

    // Commit.
    this.upgraded = candidateUpgraded;
    const finalFen = this._buildFenAfterCustom(move.from, move.to, color, !!dest, /*flipTurn*/ true);
    this.chess.load(finalFen);

    return {
      kind: 'custom',
      ok: true,
      color,
      san: this._customSan(piece.type, move.from, move.to, !!dest),
      from: move.from,
      to: move.to,
      captured: dest ? dest.type : undefined,
    };
  }

  // Post-custom-move board state for king-safety checks: a fresh chess.js
  // at the (turn-unflipped) candidate FEN plus the updated upgrade set.
  // Bonus moves are move-only and never reach the back rank (pawn's
  // sideways and backward steps both move away from the opponent's back
  // rank), so no promotion handling is needed here.
  _customCandidate(from, to) {
    const piece = this.chess.get(from);
    const dest = this.chess.get(to);
    const chess = new Chess(this._buildFenAfterCustom(from, to, piece.color, !!dest, /*flipTurn*/ false));
    const upgraded = new Set(this.upgraded);
    upgraded.delete(from);
    upgraded.delete(to);
    upgraded.add(to);
    return { chess, upgraded };
  }

  _customSan(type, from, to, captured) {
    const head = type === 'p' ? '' : type.toUpperCase();
    return `${head}${from}${captured ? 'x' : '-'}${to}*`;
  }

  _buildFenAfterCustom(from, to, color, captured, flipTurn) {
    const board = this.chess.board().map((row) => row.slice());
    const fromR = 7 - rankIdx(from);
    const fromF = fileIdx(from);
    const toR = 7 - rankIdx(to);
    const toF = fileIdx(to);
    const moving = board[fromR][fromF];
    board[fromR][fromF] = null;
    board[toR][toF] = moving;

    const lines = [];
    for (let r = 0; r < 8; r++) {
      let line = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const sq = board[r][f];
        if (!sq) { empty++; continue; }
        if (empty) { line += empty; empty = 0; }
        line += sq.color === 'w' ? sq.type.toUpperCase() : sq.type;
      }
      if (empty) line += empty;
      lines.push(line);
    }
    const position = lines.join('/');

    const oldParts = this.chess.fen().split(' ');
    let castling = oldParts[2];
    if (moving.type === 'k') {
      castling = castling.replace(color === 'w' ? /[KQ]/g : /[kq]/g, '');
    }
    if (moving.type === 'r') {
      if (from === 'a1') castling = castling.replace('Q', '');
      if (from === 'h1') castling = castling.replace('K', '');
      if (from === 'a8') castling = castling.replace('q', '');
      if (from === 'h8') castling = castling.replace('k', '');
    }
    if (to === 'a1') castling = castling.replace('Q', '');
    if (to === 'h1') castling = castling.replace('K', '');
    if (to === 'a8') castling = castling.replace('q', '');
    if (to === 'h8') castling = castling.replace('k', '');
    if (!castling) castling = '-';

    const enPassant = '-';
    let halfmove = parseInt(oldParts[4], 10);
    halfmove = captured || moving.type === 'p' ? 0 : halfmove + 1;
    let fullmove = parseInt(oldParts[5], 10);
    if (color === 'b') fullmove += 1;

    const sideToMove = flipTurn ? (color === 'w' ? 'b' : 'w') : color;
    return `${position} ${sideToMove} ${castling} ${enPassant} ${halfmove} ${fullmove}`;
  }

  // --- Bookkeeping --------------------------------------------------

  _afterAction(action) {
    this.history.push({
      kind: action.kind,
      color: action.color,
      san: action.san,
      from: action.from,
      to: action.to,
    });
    this.status();
  }

  // --- Check / legal-move helpers ----------------------------------

  _kingSquareOn(chess, color) {
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === color) return FILES[f] + (8 - r);
      }
    }
    return null;
  }

  // `color`'s king attacked under standard chess rules. Every bonus
  // pattern is move-only, so chess.js's attacker view is the whole story.
  _isInCheck(color) {
    return this._isInCheckOn(this.chess, color);
  }

  _isInCheckOn(chess, color) {
    const kingSq = this._kingSquareOn(chess, color);
    if (!kingSq) return false;
    const opp = color === 'w' ? 'b' : 'w';
    return chess.attackers(kingSq, opp).length > 0;
  }

  _hasAnyLegalMove(color) {
    // Standard moves: chess.js already filters out moves that leave the
    // king in check.
    const stdMoves = this.chess.moves({ verbose: true });
    for (const m of stdMoves) {
      const result = this.chess.move(m);
      const prevUpgraded = new Set(this.upgraded);
      this._transferUpgradedForStandardMove(result);
      const safe = !this._isInCheck(color);
      this.upgraded = prevUpgraded;
      this.chess.undo();
      if (safe) return true;
    }

    // Custom (upgraded) moves.
    for (const sq of this.upgraded) {
      const piece = this.chess.get(sq);
      if (!piece || piece.color !== color) continue;
      const targets = customMoveTargets(piece.type, sq, color, this.chess);
      for (const target of targets) {
        const { chess: candidateChess } = this._customCandidate(sq, target);
        if (!this._isInCheckOn(candidateChess, color)) return true;
      }
    }

    return false;
  }

}

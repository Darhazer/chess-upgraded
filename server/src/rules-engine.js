import { Chess } from 'chess.js';
import {
  FILES,
  fileIdx,
  rankIdx,
  customAttackSquares,
  customMoveTargets,
  validateCustomPattern,
} from '../../shared/upgrade-rules.js';

// Wrapper around chess.js with the "upgrade" extension layered on top.
//
// Each side has an upgrade bar that fills 1 unit per move (capped at
// barMax). When full, the player can spend a turn to mark one of their
// pieces as upgraded. Most upgraded pieces *gain* extra moves on top of
// their normal ones (see shared/upgrade-rules.js). A pawn is the
// exception: upgrading it *replaces* its moveset — it no longer pushes
// forward or captures on the diagonal; instead it steps one square
// diagonally (no capture) and captures the piece directly ahead. The
// upgrade follows the piece across moves and is lost when it's captured.
//
// chess.js drives standard moves and provides square-attack queries.
// Custom moves bypass chess.move() and instead build the post-move FEN
// by hand. King-safety considers BOTH standard attacks (via chess.js,
// minus the diagonal attack an upgraded enemy pawn no longer has) AND
// attacks via upgraded enemy pieces — so an upgraded rook can
// deliver/escape check via its diagonal step, an upgraded pawn via its
// forward capture, etc.

export const DEFAULT_BAR_MAX = 3;

export class RulesEngine {
  constructor({ barMax = DEFAULT_BAR_MAX } = {}) {
    this.chess = new Chess();
    this.upgraded = new Set();
    this.bar = { w: 0, b: 0 };
    this.barMax = barMax;
    this.history = []; // [{ kind, color, san, from?, to?, square? }]
    this.over = null;
  }

  turn() { return this.chess.turn(); }
  fen() { return this.chess.fen(); }

  clone() {
    const copy = new RulesEngine({ barMax: this.barMax });
    copy.chess = new Chess(this.chess.fen());
    copy.upgraded = new Set(this.upgraded);
    copy.bar = { ...this.bar };
    copy.history = this.history.slice();
    copy.over = this.over ? { ...this.over } : null;
    return copy;
  }

  // Enumerate every legal action for `color` (defaults to side to move):
  // standard moves, upgraded-piece custom moves, and (when the bar is full
  // and not in check) one upgrade-pick action per eligible piece.
  listActions(color = this.turn()) {
    if (this.over) return [];
    const actions = [];

    const stdMoves = this.chess.moves({ verbose: true });
    for (const m of stdMoves) {
      if (m.color !== color) continue;
      if (m.piece === 'p' && this.upgraded.has(m.from)) continue; // upgraded pawn has no standard moves
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
        const { chess: candidateChess, upgraded: candidateUpgraded } = this._customCandidate(sq, target);
        if (!this._isInCheckOn(candidateChess, candidateUpgraded, color)) {
          actions.push({ kind: 'custom', from: sq, to: target });
        }
      }
    }

    if (this.bar[color] >= this.barMax && !this._isInCheck(color)) {
      const board = this.chess.board();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (!p || p.color !== color) continue;
          const sq = FILES[f] + (8 - r);
          if (this.upgraded.has(sq)) continue;
          actions.push({ kind: 'upgrade', square: sq });
        }
      }
    }

    return actions;
  }

  applyAction(action) {
    if (action.kind === 'upgrade') return this.tryUpgrade(action.square);
    return this.tryMove(action);
  }

  publicState() {
    return {
      fen: this.fen(),
      turn: this.turn(),
      upgraded: [...this.upgraded],
      bar: { ...this.bar },
      barMax: this.barMax,
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

  tryUpgrade(square) {
    if (this.over) return { ok: false, reason: 'game over' };
    const color = this.turn();
    if (this.bar[color] < this.barMax) return { ok: false, reason: 'upgrade bar not full' };
    if (this._isInCheck(color)) return { ok: false, reason: 'cannot upgrade while in check' };

    const piece = this.chess.get(square);
    if (!piece || piece.color !== color) return { ok: false, reason: 'not your piece' };
    if (this.upgraded.has(square)) return { ok: false, reason: 'piece already upgraded' };

    this.upgraded.add(square);
    this.bar[color] = 0;

    const parts = this.chess.fen().split(' ');
    parts[1] = color === 'w' ? 'b' : 'w';
    parts[3] = '-';
    parts[4] = String(parseInt(parts[4], 10) + 1);
    if (color === 'b') parts[5] = String(parseInt(parts[5], 10) + 1);
    this.chess.load(parts.join(' '));

    this._afterAction({
      kind: 'upgrade',
      color,
      square,
      san: `+${piece.type.toUpperCase()}@${square}`,
    });
    return { ok: true };
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

    // An upgraded pawn forfeits its standard moveset — it only has the
    // custom diagonal step / forward capture.
    if (result.piece === 'p' && this.upgraded.has(result.from)) {
      this.chess.undo();
      return { ok: false, reason: 'upgraded pawn cannot make standard pawn moves' };
    }

    // chess.js's move() already prevents standard king-in-check. We must
    // additionally reject moves that leave our king attacked by an
    // upgraded enemy piece. Apply the upgrade transfer first so the
    // attack check sees the post-move upgrade markers.
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

  _transferUpgradedForStandardMove({ from, to, flags, color, captured }) {
    if (flags && flags.includes('e')) {
      const epSquare = to[0] + from[1];
      this.upgraded.delete(epSquare);
    } else if (captured) {
      this.upgraded.delete(to);
    }
    if (this.upgraded.has(from)) {
      this.upgraded.delete(from);
      this.upgraded.add(to);
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
    if (validation.noCapture && dest) return { ok: false, reason: piece.type === 'p' ? 'upgraded pawn diagonal move cannot capture' : 'cannot capture by teleport' };
    if (validation.mustCapture && !dest) return { ok: false, reason: 'upgraded pawn forward move requires a capture' };
    if (dest && dest.color === color) return { ok: false, reason: 'cannot capture own piece' };

    // Build a candidate Chess + upgraded set, then run the same king-safety
    // check we use everywhere (standard attacks + upgraded attacks).
    const { chess: candidateChess, upgraded: candidateUpgraded } = this._customCandidate(move.from, move.to);

    if (this._isInCheckOn(candidateChess, candidateUpgraded, color)) {
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
      san: this._customSan(piece.type, move.from, move.to, !!dest, validation.promotion),
      from: move.from,
      to: move.to,
      captured: dest ? dest.type : undefined,
    };
  }

  // Post-custom-move board state for king-safety checks: a fresh chess.js
  // at the (turn-unflipped) candidate FEN plus the updated upgrade set. A
  // promoting pawn lands as a queen, which drops its upgrade marker.
  _customCandidate(from, to) {
    const piece = this.chess.get(from);
    const dest = this.chess.get(to);
    const chess = new Chess(this._buildFenAfterCustom(from, to, piece.color, !!dest, /*flipTurn*/ false));
    const upgraded = new Set(this.upgraded);
    upgraded.delete(from);
    upgraded.delete(to);
    const promotes = piece.type === 'p' && (to[1] === '1' || to[1] === '8');
    if (!promotes) upgraded.add(to);
    return { chess, upgraded };
  }

  _customSan(type, from, to, captured, promotion) {
    const head = type === 'p' ? '' : type.toUpperCase();
    return `${head}${from}${captured ? 'x' : '-'}${to}${promotion ? '=Q' : ''}*`;
  }

  _buildFenAfterCustom(from, to, color, captured, flipTurn) {
    const board = this.chess.board().map((row) => row.slice());
    const fromR = 7 - rankIdx(from);
    const fromF = fileIdx(from);
    const toR = 7 - rankIdx(to);
    const toF = fileIdx(to);
    const moving = board[fromR][fromF];
    board[fromR][fromF] = null;
    // An upgraded pawn reaching the back rank auto-queens.
    const promotes = moving.type === 'p' && (toR === 0 || toR === 7);
    board[toR][toF] = promotes ? { ...moving, type: 'q' } : moving;

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
    if (action.kind === 'move' || action.kind === 'custom') {
      this.bar[action.color] = Math.min(this.barMax, this.bar[action.color] + 1);
    }
    this.history.push({
      kind: action.kind,
      color: action.color,
      san: action.san,
      from: action.from,
      to: action.to,
      square: action.square,
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

  // `color`'s king attacked under standard chess rules OR by any
  // upgraded enemy piece using its bonus pattern.
  _isInCheck(color) {
    return this._isInCheckOn(this.chess, this.upgraded, color);
  }

  _isInCheckOn(chess, upgraded, color) {
    const kingSq = this._kingSquareOn(chess, color);
    if (!kingSq) return false;
    const opp = color === 'w' ? 'b' : 'w';
    // Standard attackers — but an upgraded enemy pawn has traded its
    // diagonal capture for a forward one, so it doesn't threaten the king
    // via the squares chess.js still thinks it attacks.
    for (const sq of chess.attackers(kingSq, opp)) {
      const p = chess.get(sq);
      if (p && p.type === 'p' && upgraded.has(sq)) continue;
      return true;
    }
    for (const sq of upgraded) {
      const p = chess.get(sq);
      if (!p || p.color !== opp) continue;
      if (customAttackSquares(p.type, sq, p.color).includes(kingSq)) return true;
    }
    return false;
  }

  _hasAnyLegalMove(color) {
    // Standard moves: chess.js returns moves that don't leave king in
    // check by standard attacks. We additionally filter out moves that
    // would leave it in check by an upgraded enemy piece.
    const stdMoves = this.chess.moves({ verbose: true });
    for (const m of stdMoves) {
      if (m.piece === 'p' && this.upgraded.has(m.from)) continue; // upgraded pawn has no standard moves
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
        const { chess: candidateChess, upgraded: candidateUpgraded } = this._customCandidate(sq, target);
        if (!this._isInCheckOn(candidateChess, candidateUpgraded, color)) return true;
      }
    }

    return false;
  }

}

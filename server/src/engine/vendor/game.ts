// Vendored from js-chess-engine v1.0.3 by Josef Jadrny (MIT — see ./LICENSE).
// Only the import paths changed (.mjs -> .js); rest is upstream verbatim.
import Board, { type BoardInput, type ExportedJson, type HistoryEntry } from './board.js';
import type { EngineSquare } from './const.js';
import { printToConsole, getFEN } from './utils.js';

export class Game {
  board: Board;

  constructor(configuration?: BoardInput) {
    this.board = new Board(configuration);
  }

  move(from: string, to: string): Record<EngineSquare, EngineSquare> {
    from = from.toUpperCase();
    to = to.toUpperCase();
    const possibleMoves = this.board.getMoves();
    if (!possibleMoves[from] || !possibleMoves[from]!.includes(to)) {
      throw new Error(`Invalid move from ${from} to ${to} for ${this.board.getPlayingColor()}`);
    }
    this.board.addMoveToHistory(from, to);
    this.board.move(from, to);
    return { [from]: to };
  }

  moves(from: string | null = null): Record<EngineSquare, EngineSquare[]> | EngineSquare[] {
    if (from) {
      return this.board.getMoves()[from.toUpperCase()] || [];
    }
    return this.board.getMoves() || {};
  }

  setPiece(location: string, piece: string): void {
    this.board.setPiece(location, piece);
  }

  removePiece(location: string): void {
    this.board.removePiece(location);
  }

  aiMove(level = 2): Record<EngineSquare, EngineSquare> {
    const move = this.board.calculateAiMove(level);
    return this.move(move.from, move.to);
  }

  getHistory(reversed = false): HistoryEntry[] {
    return reversed ? this.board.history.reverse() : this.board.history;
  }

  printToConsole(): void {
    printToConsole(this.board.configuration);
  }

  exportJson(): ExportedJson {
    return this.board.exportJson();
  }

  exportFEN(): string {
    return getFEN(this.board.configuration);
  }
}

export function moves(config: BoardInput): Record<EngineSquare, EngineSquare[]> | EngineSquare[] {
  if (!config) {
    throw new Error('Configuration param required.');
  }
  const game = new Game(config);
  return game.moves();
}

export function status(config: BoardInput): ExportedJson {
  if (!config) {
    throw new Error('Configuration param required.');
  }
  const game = new Game(config);
  return game.exportJson();
}

export function getFen(config: BoardInput): string {
  if (!config) {
    throw new Error('Configuration param required.');
  }
  const game = new Game(config);
  return game.exportFEN();
}

export function move(config: BoardInput, from: string, to: string): ExportedJson | string {
  if (!config) {
    throw new Error('Configuration param required.');
  }
  const game = new Game(config);
  game.move(from, to);
  if (typeof config === 'object') {
    return game.exportJson();
  } else {
    return game.exportFEN();
  }
}

export function aiMove(config: BoardInput, level = 2): Record<EngineSquare, EngineSquare> {
  if (!config) {
    throw new Error('Configuration param required.');
  }
  const game = new Game(config);
  const move = game.board.calculateAiMove(level);
  return { [move.from]: move.to };
}

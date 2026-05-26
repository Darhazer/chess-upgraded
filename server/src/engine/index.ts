// Public surface of the variant chess engine (a fork of js-chess-engine — see
// ./vendor/LICENSE). The server's bot adapter (../bot.js) calls
// `chooseVariantAction`; tests use `listVariantActions` for action-parity
// checks against the authoritative RulesEngine.

import Board from './vendor/board.js';
import CannibalBoard from './cannibal-board.js';
import RpgBoard from './rpg-board.js';
import { buildConfig, actionFromMove } from './variant.js';
import type { MoveAction, PublicState } from './variant.js';
import type { BoardConfiguration } from './vendor/const.js';

// Instantiate the right (sub)class of the variant engine for a board-config.
// Chess RPG plays standard chess at the move level — no upgraded custom moves,
// no cannibal mutation — so RpgBoard inherits the vendored move search and
// only overrides `calculateScore` to value territory. Build and upgrade
// decisions are made above this layer in ../rpg-bot.ts.
function boardFor(cfg: BoardConfiguration): Board {
  if (cfg.variant === 'cannibal') return new CannibalBoard(cfg);
  if (cfg.variant === 'rpg') return new RpgBoard(cfg);
  return new Board(cfg);
}

// js-chess-engine accepts levels 0–4 (depth grows with the level; the engine
// also auto-deepens one ply in the endgame). 2 is a "club player" feel and is
// fast enough to run synchronously after every human move.
export const DEFAULT_BOT_LEVEL = 2;
const MIN_LEVEL = 0;
const MAX_LEVEL = 4;

function clampLevel(level: unknown): number {
  const n = Math.trunc(Number(level));
  if (!Number.isFinite(n)) return DEFAULT_BOT_LEVEL;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, n));
}

export interface ChooseOptions {
  level?: number;
  // Engine-side `from` square (UPPERCASE or lowercase) to forbid as the
  // source of the chosen move. Used by Chess RPG: a piece built/upgraded
  // this turn is locked and cannot move, but the vendored search has no
  // concept of that — passing the locked square here lets the search skip
  // it instead of having the caller pick a random fallback move.
  excludeFrom?: string;
}

// Pick the bot's action for the given position. Returns a RulesEngine action
// ({kind:'move',from,to[,promotion]}) or null when there's nothing to play
// (game over / no legal action / every legal move is excluded).
export function chooseVariantAction(publicState: PublicState, { level = DEFAULT_BOT_LEVEL, excludeFrom }: ChooseOptions = {}): MoveAction | null {
  const cfg = buildConfig(publicState);
  const board = boardFor(cfg);
  const excludeUpper = excludeFrom ? excludeFrom.toUpperCase() : null;
  if (!excludeUpper) {
    const best = board.calculateAiMove(clampLevel(level));
    if (!best) return null;
    return actionFromMove(best.from, best.to, cfg);
  }
  // Re-rank to skip locked-square moves rather than letting the caller
  // fall back to a random legal move. `calculateAiMoves` returns the full
  // sorted score table, so the cost is the same as the single-best path.
  const scored = board.calculateAiMoves(clampLevel(level));
  const best = scored.find((s) => s.from !== excludeUpper);
  if (!best) return null;
  return actionFromMove(best.from, best.to, cfg);
}

// Every legal action the engine sees for the position, in RulesEngine-action
// shape. Used by the parity tests to assert the bot considers exactly the same
// moves the referee allows.
export function listVariantActions(publicState: PublicState): MoveAction[] {
  const cfg = buildConfig(publicState);
  const board = boardFor(cfg);
  const moves = board.getMoves();
  const out: MoveAction[] = [];
  for (const from in moves) {
    for (const to of moves[from]!) out.push(actionFromMove(from, to, cfg));
  }
  return out;
}

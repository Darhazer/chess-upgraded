// Public surface of the variant chess engine (a fork of js-chess-engine — see
// ./vendor/LICENSE). The server's bot adapter (../bot.js) calls
// `chooseVariantAction`; tests use `listVariantActions` for action-parity
// checks against the authoritative RulesEngine.

import Board from './vendor/board.js';
import { buildConfig, actionFromMove } from './variant.js';

// js-chess-engine accepts levels 0–4 (depth grows with the level; the engine
// also auto-deepens one ply in the endgame). 2 is a "club player" feel and is
// fast enough to run synchronously after every human move.
export const DEFAULT_BOT_LEVEL = 2;
const MIN_LEVEL = 0;
const MAX_LEVEL = 4;

function clampLevel(level) {
  const n = Math.trunc(Number(level));
  if (!Number.isFinite(n)) return DEFAULT_BOT_LEVEL;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, n));
}

// Pick the bot's action for the given position. Returns a RulesEngine action
// ({kind:'move',from,to[,promotion]} or {kind:'upgrade',square}), or null when
// there's nothing to play (game over / no legal action).
export function chooseVariantAction(publicState, { level = DEFAULT_BOT_LEVEL } = {}) {
  const cfg = buildConfig(publicState);
  const board = new Board(cfg);
  const best = board.calculateAiMove(clampLevel(level)); // { from, to, score } | undefined
  if (!best) return null;
  return actionFromMove(best.from, best.to, cfg);
}

// Every legal action the engine sees for the position, in RulesEngine-action
// shape. Used by the parity tests to assert the bot considers exactly the same
// moves the referee allows.
export function listVariantActions(publicState) {
  const cfg = buildConfig(publicState);
  const board = new Board(cfg);
  const moves = board.getMoves();
  const out = [];
  for (const from in moves) {
    for (const to of moves[from]) out.push(actionFromMove(from, to, cfg));
  }
  return out;
}

import { FILES } from '../../shared/upgrade-rules.js';

// Variant-aware computer opponent. Iterative-deepening alpha-beta over the
// RulesEngine action list — so it natively handles upgraded-piece moves,
// teleports, the bar mechanic, and game-over detection. Time-bounded (the
// variant move generator clones chess.js on every custom move, so we cap
// the search wall-clock rather than the depth).

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Upgrades are powerful but situational; calibrated by eyeball, not tuned.
const UPGRADE_BONUS = { n: 60, r: 80, b: 60, q: 120, k: 150 };
const MATE = 1_000_000;

export const BOT_COLOR = 'b';
const DEFAULT_TIME_MS = 700;
const DEFAULT_MAX_DEPTH = 4;
const RANDOM_UPGRADE_CHANCE = 0.35;

function evaluate(engine, botColor) {
  const oppColor = botColor === 'w' ? 'b' : 'w';
  let score = 0;
  const board = engine.chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const sq = FILES[f] + (8 - r);
      let v = PIECE_VALUES[p.type] || 0;
      if (engine.upgraded.has(sq)) v += UPGRADE_BONUS[p.type] || 0;
      score += p.color === botColor ? v : -v;
    }
  }
  score += 8 * (engine.bar[botColor] - engine.bar[oppColor]);
  return score;
}

function orderActions(engine, actions) {
  return actions
    .map((a) => {
      let priority = 0;
      if (a.kind === 'upgrade') priority = 50;
      else {
        const dest = engine.chess.get(a.to);
        if (dest) priority = 100 + (PIECE_VALUES[dest.type] || 0);
      }
      return { a, priority };
    })
    .sort((x, y) => y.priority - x.priority)
    .map((x) => x.a);
}

function terminalScore(engine, botColor, ply) {
  if (!engine.over) return null;
  if (engine.over.result === 'draw') return 0;
  const botResult = botColor === 'w' ? 'white' : 'black';
  return engine.over.result === botResult ? MATE - ply : -MATE + ply;
}

function search(engine, depth, alpha, beta, botColor, deadline, ply) {
  const term = terminalScore(engine, botColor, ply);
  if (term !== null) return term;
  if (depth === 0) return evaluate(engine, botColor);
  if (Date.now() > deadline) return evaluate(engine, botColor);

  const maxNode = engine.turn() === botColor;
  const actions = orderActions(engine, engine.listActions());
  if (actions.length === 0) {
    const inCheck = engine._isInCheck(engine.turn());
    if (inCheck) return maxNode ? -MATE + ply : MATE - ply;
    return 0;
  }

  if (maxNode) {
    let best = -Infinity;
    for (const action of actions) {
      const child = engine.clone();
      if (!child.applyAction(action).ok) continue;
      const score = search(child, depth - 1, alpha, beta, botColor, deadline, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const action of actions) {
    const child = engine.clone();
    if (!child.applyAction(action).ok) continue;
    const score = search(child, depth - 1, alpha, beta, botColor, deadline, ply + 1);
    if (score < best) best = score;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchRoot(engine, depth, botColor, deadline) {
  const actions = orderActions(engine, engine.listActions());
  if (actions.length === 0) return null;
  let bestScore = -Infinity;
  let bestAction = actions[0];
  let alpha = -Infinity;
  const beta = Infinity;
  for (const action of actions) {
    const child = engine.clone();
    if (!child.applyAction(action).ok) continue;
    const score = search(child, depth - 1, alpha, beta, botColor, deadline, 1);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
    if (bestScore > alpha) alpha = bestScore;
    if (Date.now() > deadline) break;
  }
  return { action: bestAction, score: bestScore };
}

// Random upgrade pick — fires when the bar is full, we're not in check, and
// we have an upgradable piece. Per the brief, the bot picks the *piece*
// randomly rather than searching for the best target.
function maybeRandomUpgrade(engine, botColor) {
  if (engine.bar[botColor] < engine.barMax) return null;
  if (engine._isInCheck(botColor)) return null;
  if (Math.random() >= RANDOM_UPGRADE_CHANCE) return null;
  const candidates = engine
    .listActions(botColor)
    .filter((a) => a.kind === 'upgrade');
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function chooseAction(engine, {
  botColor = BOT_COLOR,
  timeMs = DEFAULT_TIME_MS,
  maxDepth = DEFAULT_MAX_DEPTH,
} = {}) {
  if (engine.over) return null;
  if (engine.turn() !== botColor) return null;

  const upgrade = maybeRandomUpgrade(engine, botColor);
  if (upgrade) return upgrade;

  const deadline = Date.now() + timeMs;
  let best = null;
  for (let d = 1; d <= maxDepth; d++) {
    const result = searchRoot(engine, d, botColor, deadline);
    if (result) best = result;
    if (Date.now() > deadline) break;
    if (best && Math.abs(best.score) >= MATE - 100) break;
  }
  return best?.action ?? null;
}

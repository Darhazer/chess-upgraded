import { DEFAULT_BOT_LEVEL } from './engine/index.js';
import { searchPool } from './engine/search-pool.js';
import type { MoveAction } from './engine/variant.js';
import type { Engine } from './rooms.js';

// Computer opponent. The brain is a fork of the js-chess-engine search that's
// been taught the upgrade variant (see server/src/engine/). This module is the
// thin adapter to the game loop: it runs the search off the main thread via the
// worker pool, then validates the engine's choice against the *authoritative*
// RulesEngine before committing it — if the engine ever proposed something the
// referee would reject (a fork/referee divergence), or the worker errored out,
// the bot must not stall, so we fall back to a random legal action.

export const BOT_COLOR = 'b';

const ENV_LEVEL = parseInt(process.env.BOT_LEVEL ?? '', 10);
const DEFAULT_LEVEL = Number.isInteger(ENV_LEVEL) ? ENV_LEVEL : DEFAULT_BOT_LEVEL;

function randomLegalAction(engine: Engine, color: 'w' | 'b'): MoveAction | null {
  const legal = engine.listActions(color);
  if (legal.length === 0) return null;
  const picked = legal[Math.floor(Math.random() * legal.length)]!;
  // ListedAction shares the {kind:'move',from,to,promotion?} shape MoveAction
  // uses, plus a 'custom' kind that the referee also accepts.
  return picked as unknown as MoveAction;
}

export interface ChooseOptions {
  botColor?: 'w' | 'b';
  level?: number;
}

// Resolves with the bot's action for the position, or null when there's
// nothing to play. The (cheap) referee validation and the random-fallback run
// on the main thread; only the minimax goes to a worker.
export async function chooseAction(
  engine: Engine,
  { botColor = BOT_COLOR, level = DEFAULT_LEVEL }: ChooseOptions = {},
): Promise<MoveAction | null> {
  if (engine.over) return null;
  if (engine.turn() !== botColor) return null;

  let action: MoveAction | null = null;
  try {
    action = await searchPool.run(engine.publicState(), level);
  } catch (err) {
    console.warn('[bot] engine search failed, falling back to a random legal move:', (err as Error)?.message);
  }

  if (action) {
    // Dry-run on a clone; the live engine is only mutated by the caller.
    if (engine.clone().applyAction(action).ok) return action;
    console.warn(
      '[bot] engine proposed an action the referee rejected; falling back.',
      'action=', JSON.stringify(action), 'fen=', engine.fen(),
    );
  }
  return randomLegalAction(engine, botColor);
}

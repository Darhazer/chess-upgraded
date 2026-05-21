import { DEFAULT_BOT_LEVEL } from './engine/index.js';
import { searchPool } from './engine/search-pool.js';
import type { MoveAction } from './engine/variant.js';
import type { Engine } from './rooms.js';
import { ChessRpgEngine } from './chess-rpg-engine.js';
import { chooseAbilityAction, type RpgAbilityAction } from './rpg-bot.js';

// Computer opponent. The brain is a fork of the js-chess-engine search that's
// been taught the upgrade variant (see server/src/engine/). This module is the
// thin adapter to the game loop: it runs the search off the main thread via the
// worker pool, then validates the engine's choice against the *authoritative*
// RulesEngine before committing it — if the engine ever proposed something the
// referee would reject (a fork/referee divergence), or the worker errored out,
// the bot must not stall, so we fall back to a random legal action.
//
// For Chess RPG the bot may also build or upgrade before its move. Those
// decisions are made in `rpg-bot.ts` by simple heuristics on the main thread;
// only the move itself ever hits the worker pool.

export const BOT_COLOR = 'b';

const ENV_LEVEL = parseInt(process.env.BOT_LEVEL ?? '', 10);
const DEFAULT_LEVEL = Number.isInteger(ENV_LEVEL) ? ENV_LEVEL : DEFAULT_BOT_LEVEL;

// The bot's per-call output. For non-RPG engines this is always a MoveAction;
// for RPG it can additionally be a build or upgrade — runBotIfNeeded loops
// until a move (the action that flips the turn) is applied.
export type BotAction = MoveAction | RpgAbilityAction;

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

// Resolves with the bot's next action, or null when there's nothing to play.
// For Chess RPG, first tries a build/upgrade via the heuristic; if neither
// applies (or the bot has already used its ability this turn), falls through
// to the standard move search.
export async function chooseAction(
  engine: Engine,
  { botColor = BOT_COLOR, level = DEFAULT_LEVEL }: ChooseOptions = {},
): Promise<BotAction | null> {
  if (engine.over) return null;
  if (engine.turn() !== botColor) return null;

  if (engine instanceof ChessRpgEngine) {
    const ability = chooseAbilityAction(engine, botColor);
    if (ability) return ability;
  }

  return chooseMoveAction(engine, { botColor, level });
}

async function chooseMoveAction(
  engine: Engine,
  { botColor, level }: { botColor: 'w' | 'b'; level: number },
): Promise<MoveAction | null> {
  let action: MoveAction | null = null;
  try {
    action = await searchPool.run(engine.publicState(), level);
  } catch (err) {
    console.warn('[bot] engine search failed, falling back to a random legal move:', (err as Error)?.message);
  }

  // For Chess RPG, the just-built/upgraded piece can't move this turn. The
  // vendored search doesn't know about that, so post-filter: if the chosen
  // move comes from the locked square, fall back to a random non-locked move
  // (engine.listActions already strips the locked source).
  if (action && engine instanceof ChessRpgEngine && engine.lockedSquare && action.from === engine.lockedSquare) {
    return randomLegalAction(engine, botColor);
  }

  if (action) {
    if (engine.clone().applyAction(action).ok) return action;
    console.warn(
      '[bot] engine proposed an action the referee rejected; falling back.',
      'action=', JSON.stringify(action), 'fen=', engine.fen(),
    );
  }
  return randomLegalAction(engine, botColor);
}

// Dispatch a bot-chosen action onto the live engine. Moves go through
// `applyAction` (which routes both 'move' and 'custom' to tryMove); RPG
// abilities go through their respective methods on ChessRpgEngine.
//
// Returns `{ ok: true }` on success, `{ ok: false, reason }` on rejection.
// The caller is responsible for stopping the bot loop on failure.
export function applyBotAction(engine: Engine, action: BotAction): { ok: boolean; reason?: string } {
  if (action.kind === 'build') {
    if (!(engine instanceof ChessRpgEngine)) return { ok: false, reason: 'build only available in rpg' };
    return engine.tryBuild(action.slotId);
  }
  if (action.kind === 'upgrade') {
    if (!(engine instanceof ChessRpgEngine)) return { ok: false, reason: 'upgrade only available in rpg' };
    return engine.tryUpgrade(action.slotId, action.to);
  }
  // 'move' or 'custom' — applyAction dispatches both.
  return engine.applyAction(action);
}

// True when the action ends the turn (i.e. flips side to move). Builds and
// upgrades keep the turn with the same player; only a move advances it.
// `randomLegalAction` can route a 'custom' (upgraded-piece bonus move) here
// at runtime even though MoveAction's static `kind` is just 'move' — both
// flip the turn, so widen the check.
export function isTurnEndingAction(action: BotAction): boolean {
  const k = action.kind as string;
  return k === 'move' || k === 'custom';
}

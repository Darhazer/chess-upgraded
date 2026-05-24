// Chess RPG board — a subclass of the vendored engine (./vendor/board.js).
//
// The RPG variant plays standard chess at the move level (no upgraded custom
// moves, no cannibal mutation), but its economy is driven by *territory*:
// at the end of each turn a side gains material equal to +1 per own piece on
// its near-advanced ranks (3–4 for white, 5–6 for black) and +2 per own
// piece in the opponent's half (5–8 for white, 1–4 for black). See
// server/src/chess-rpg-engine.ts:_territoryMaterialFor for the authoritative
// rule. Build/upgrade decisions are made above this layer in ../rpg-bot.ts;
// here we only teach the move search that advanced squares are worth more.
//
// Without this term the vendored js-chess-engine evaluation only sees raw
// material + the upgrade bonus + classic piece-square tables, so it never
// pushes pawns into rank 5+ and the bot starves of territory income.

import Board, { type BoardInput } from './vendor/board.js';
import { COLORS } from './vendor/const.js';
import type { EngineColor } from './vendor/const.js';

// Scaled to match the base engine's material multiplier (pawn = 10 score
// units). A piece in opponent's half generates +2 material per turn; a
// piece in our own advanced half +1. The static bonus represents roughly
// the expected income over the piece's near-term lifetime on that square —
// strong enough to make pawn pushes the obvious play, weak enough not to
// drown out tactics. Eyeballed, not tuned.
const TERRITORY_FAR = 15;
const TERRITORY_NEAR = 6;

export default class RpgBoard extends Board {
  constructor(configuration?: BoardInput) {
    super(configuration);
    this.configuration.variant = 'rpg';
  }

  override calculateScore(playerColor: EngineColor = this.getPlayingColor()): number {
    const score = super.calculateScore(playerColor);
    // On a terminal node `super` returns a saturated +/-score — leave it.
    if (this.configuration.checkMate || this.configuration.isFinished) return score;

    let bonus = 0;
    for (const location in this.configuration.pieces) {
      const piece = this.getPiece(location);
      if (!piece) continue;
      const color = this.getPieceColor(piece);
      const sign = color === playerColor ? 1 : -1;
      const rank = Number(location[1]);
      if (color === COLORS.WHITE) {
        if (rank >= 5) bonus += sign * TERRITORY_FAR;
        else if (rank >= 3) bonus += sign * TERRITORY_NEAR;
      } else {
        if (rank <= 4) bonus += sign * TERRITORY_FAR;
        else if (rank <= 6) bonus += sign * TERRITORY_NEAR;
      }
    }
    return score + bonus;
  }
}

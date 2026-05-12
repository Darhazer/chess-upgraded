import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { legalTargets } from '../src/features/game/move-targets.js';

describe('legalTargets', () => {
  it('returns standard moves for a non-upgraded piece', () => {
    const c = new Chess();
    assert.deepEqual(legalTargets(c, 'e2', new Set()), new Set(['e3', 'e4']));
  });

  it('adds the bonus pattern for an upgraded non-pawn (additive)', () => {
    const c = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const t = legalTargets(c, 'a1', new Set(['a1']));
    // Standard rook moves along rank 1 / file a, plus the 1-step diagonal b2.
    assert.ok(t.has('a8'), 'standard rook move kept');
    assert.ok(t.has('b2'), 'upgraded diagonal step added');
  });

  it('REPLACES the moveset for an upgraded pawn — diagonal step, forward capture', () => {
    // White pawn d4 (upgraded): black pawns on c5 (diagonal — NOT
    // capturable) and d5 (forward — capturable); e5 empty (diagonal move).
    const c = new Chess('4k3/8/8/2pp4/3P4/8/8/4K3 w - - 0 1');
    const t = legalTargets(c, 'd4', new Set(['d4']));
    assert.deepEqual(t, new Set(['e5', 'd5']));
    // No standard pawn push and no diagonal capture of c5.
    assert.ok(!t.has('c5'));
  });

  it('an upgraded pawn with the forward square empty and diagonals blocked has no targets', () => {
    const c = new Chess('4k3/8/8/2P1P3/3P4/8/8/4K3 w - - 0 1');
    // d4 white pawn (upgraded): c5/e5 own pawns block the diagonals, d5
    // empty so no forward capture.
    const t = legalTargets(c, 'd4', new Set(['d4']));
    assert.deepEqual(t, new Set());
  });

  it('an upgraded pawn on its 7th rank can still target the back rank (promotion)', () => {
    // White pawn b7 (upgraded): a8/c8 empty diagonal steps; b8 empty so no
    // forward capture there.
    const c = new Chess('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const t = legalTargets(c, 'b7', new Set(['b7']));
    assert.deepEqual(t, new Set(['a8', 'c8']));
  });
});

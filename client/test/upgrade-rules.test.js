import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  customAttackSquares,
  customMoveTargets,
  validateCustomPattern,
} from '../../shared/upgrade-rules.js';

// Tiny stand-in for chess.js — customMoveTargets only needs `.get(sq)`.
// Useful for tests that don't care about a real board.
function fakeBoard(pieces = {}) {
  return { get: (sq) => pieces[sq] || null };
}

describe('customMoveTargets', () => {
  it('rook gains the four 1-step diagonals', () => {
    const t = customMoveTargets('r', 'd4', 'w', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['e5', 'e3', 'c5', 'c3']));
  });

  it('bishop gains the four 1-step orthogonals', () => {
    const t = customMoveTargets('b', 'd4', 'w', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['d5', 'd3', 'e4', 'c4']));
  });

  it('knight gains four (±2, ±2) jumps', () => {
    const t = customMoveTargets('n', 'd4', 'w', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['f6', 'f2', 'b6', 'b2']));
  });

  it('king/queen teleport: 8 directions, 2 squares', () => {
    const t = customMoveTargets('k', 'd4', 'w', fakeBoard());
    assert.deepEqual(
      new Set(t),
      new Set(['d6', 'd2', 'f4', 'b4', 'f6', 'f2', 'b6', 'b2'])
    );
  });

  it('drops targets off the board', () => {
    // a1 corner: only NE-quadrant deltas survive bounds for a rook.
    const t = customMoveTargets('r', 'a1', 'w', fakeBoard());
    assert.deepEqual(t, ['b2']);
  });

  it('drops targets occupied by own pieces', () => {
    const board = fakeBoard({ e5: { color: 'w', type: 'p' } });
    const t = customMoveTargets('r', 'd4', 'w', board);
    assert.ok(!t.includes('e5'));
    assert.ok(t.includes('c5'));
  });

  it('drops targets occupied by enemy pieces — bonus moves never capture', () => {
    const board = fakeBoard({ e5: { color: 'b', type: 'p' } });
    const t = customMoveTargets('r', 'd4', 'w', board);
    assert.ok(!t.includes('e5'));
    assert.ok(t.includes('c5'));
  });

  it('teleport (king/queen) drops ANY occupied square — no capture', () => {
    const board = fakeBoard({ d6: { color: 'b', type: 'p' } });
    const t = customMoveTargets('k', 'd4', 'w', board);
    assert.ok(!t.includes('d6'));
  });

  it('pawn (white): diagonal-forward to empty squares, forward capture only when an enemy is there', () => {
    // White pawn d4: diagonals are c5/e5, forward is d5.
    const board = fakeBoard({
      d5: { color: 'b', type: 'p' }, // enemy directly ahead — forward capture
      c5: { color: 'w', type: 'p' }, // own piece on diagonal — blocked
    });
    const t = customMoveTargets('p', 'd4', 'w', board);
    // c5 blocked (own piece), e5 empty (diagonal move OK), d5 enemy (forward capture OK).
    assert.deepEqual(new Set(t), new Set(['e5', 'd5']));
  });

  it('pawn (white): diagonal target with enemy is NOT a valid move (no diagonal capture)', () => {
    const board = fakeBoard({
      c5: { color: 'b', type: 'p' }, // enemy on diagonal
      e5: { color: 'b', type: 'p' }, // enemy on other diagonal
    });
    const t = customMoveTargets('p', 'd4', 'w', board);
    assert.ok(!t.includes('c5'), 'diagonal capture not allowed via the custom path');
    assert.ok(!t.includes('e5'), 'diagonal capture not allowed via the custom path');
  });

  it('pawn (black): mirrored direction', () => {
    // Black pawn on d5: diagonals forward are c4/e4; forward is d4.
    const board = fakeBoard({ d4: { color: 'w', type: 'p' } });
    const t = customMoveTargets('p', 'd5', 'b', board);
    assert.deepEqual(new Set(t), new Set(['c4', 'e4', 'd4']));
  });

  it('pawn diagonal move requires the diagonal square to be empty', () => {
    // White pawn d4, enemy on c5 — diagonal blocked because diagonals
    // are move-only (no capture). c5 must not be a target.
    const board = fakeBoard({ c5: { color: 'b', type: 'p' } });
    const t = customMoveTargets('p', 'd4', 'w', board);
    assert.ok(!t.includes('c5'));
  });

  it('pawn forward move only when an enemy occupies the square', () => {
    const t = customMoveTargets('p', 'd4', 'w', fakeBoard()); // empty board
    assert.ok(!t.includes('d5'), 'no enemy ahead → no forward custom move');
    const blocked = customMoveTargets('p', 'd4', 'w', fakeBoard({ d5: { color: 'w', type: 'p' } }));
    assert.ok(!blocked.includes('d5'), 'own piece ahead → no forward capture');
  });

  it('pawn can target the back rank (it promotes there)', () => {
    // White pawn on a7: b8 empty (diagonal step), a8 enemy (forward capture).
    const board = fakeBoard({ a8: { color: 'b', type: 'r' } });
    assert.deepEqual(new Set(customMoveTargets('p', 'a7', 'w', board)), new Set(['b8', 'a8']));
    // Black pawn on b2 mirrors: a1/c1 diagonals, b1 forward.
    const board2 = fakeBoard({ b1: { color: 'w', type: 'r' } });
    assert.deepEqual(new Set(customMoveTargets('p', 'b2', 'b', board2)), new Set(['a1', 'c1', 'b1']));
  });

  it('works with a real chess.js instance', () => {
    const c = new Chess();
    const t = customMoveTargets('r', 'a1', 'w', c);
    // a1 is a white rook in the start position, b2 has a white pawn — own piece blocks.
    assert.deepEqual(t, []);
  });
});

describe('customAttackSquares', () => {
  it('returns [] for r/b/n — their bonus moves are move-only (no capture)', () => {
    for (const type of ['r', 'b', 'n']) {
      assert.deepEqual(customAttackSquares(type, 'd4', 'w'), []);
    }
  });

  it('returns [] for king/queen — teleports cannot capture', () => {
    assert.deepEqual(customAttackSquares('k', 'd4'), []);
    assert.deepEqual(customAttackSquares('q', 'd4'), []);
  });

  it('pawn attacks the square directly in front, color-aware', () => {
    assert.deepEqual(customAttackSquares('p', 'd4', 'w'), ['d5']);
    assert.deepEqual(customAttackSquares('p', 'd4', 'b'), ['d3']);
  });

  it('pawn attack square drops off the board at the back rank', () => {
    assert.deepEqual(customAttackSquares('p', 'd8', 'w'), []);
    assert.deepEqual(customAttackSquares('p', 'd1', 'b'), []);
  });
});

describe('validateCustomPattern', () => {
  it('rook: accepts 1-step diagonal (move-only), rejects everything else', () => {
    const ok = validateCustomPattern('r', 'a1', 'b2');
    assert.equal(ok.ok, true);
    assert.equal(ok.noCapture, true);
    assert.equal(validateCustomPattern('r', 'a1', 'c3').ok, false);
    assert.equal(validateCustomPattern('r', 'a1', 'a2').ok, false);
  });

  it('bishop: accepts 1-step orthogonal (move-only), rejects everything else', () => {
    const ok = validateCustomPattern('b', 'd4', 'd5');
    assert.equal(ok.ok, true);
    assert.equal(ok.noCapture, true);
    assert.equal(validateCustomPattern('b', 'd4', 'e4').noCapture, true);
    assert.equal(validateCustomPattern('b', 'd4', 'e5').ok, false);
  });

  it('knight: accepts (2,2) move-only, rejects standard L', () => {
    const ok = validateCustomPattern('n', 'd4', 'f6');
    assert.equal(ok.ok, true);
    assert.equal(ok.noCapture, true);
    assert.equal(validateCustomPattern('n', 'd4', 'e6').ok, false);
  });

  it('king/queen: accepts 2-step ortho or 2-step diag, marks noCapture', () => {
    const ortho = validateCustomPattern('k', 'd4', 'd6');
    assert.equal(ortho.ok, true);
    assert.equal(ortho.noCapture, true);

    const diag = validateCustomPattern('q', 'd4', 'f6');
    assert.equal(diag.ok, true);
    assert.equal(diag.noCapture, true);

    assert.equal(validateCustomPattern('k', 'd4', 'd5').ok, false);
    assert.equal(validateCustomPattern('k', 'd4', 'f5').ok, false);
  });

  it('pawn (white): diagonal forward is move-only, forward is capture-only', () => {
    const diag = validateCustomPattern('p', 'd4', 'e5', 'w');
    assert.equal(diag.ok, true);
    assert.equal(diag.noCapture, true);
    assert.equal(diag.promotion, false);

    const fwd = validateCustomPattern('p', 'd4', 'd5', 'w');
    assert.equal(fwd.ok, true);
    assert.equal(fwd.mustCapture, true);
    assert.equal(fwd.promotion, false);

    // Backward / sideways / two-square — all rejected.
    assert.equal(validateCustomPattern('p', 'd4', 'd3', 'w').ok, false);
    assert.equal(validateCustomPattern('p', 'd4', 'e4', 'w').ok, false);
    assert.equal(validateCustomPattern('p', 'd4', 'd6', 'w').ok, false);
  });

  it('pawn (black): mirrored direction', () => {
    assert.equal(validateCustomPattern('p', 'd5', 'c4', 'b').ok, true);
    assert.equal(validateCustomPattern('p', 'd5', 'd4', 'b').mustCapture, true);
    assert.equal(validateCustomPattern('p', 'd5', 'd6', 'b').ok, false);
  });

  it('pawn: marks back-rank moves as promotions', () => {
    const diag = validateCustomPattern('p', 'a7', 'b8', 'w');
    assert.equal(diag.ok, true);
    assert.equal(diag.noCapture, true);
    assert.equal(diag.promotion, true);

    const fwd = validateCustomPattern('p', 'a2', 'a1', 'b');
    assert.equal(fwd.ok, true);
    assert.equal(fwd.mustCapture, true);
    assert.equal(fwd.promotion, true);
  });
});

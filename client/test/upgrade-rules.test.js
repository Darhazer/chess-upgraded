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

  it('keeps targets occupied by enemy pieces (capture allowed)', () => {
    const board = fakeBoard({ e5: { color: 'b', type: 'p' } });
    const t = customMoveTargets('r', 'd4', 'w', board);
    assert.ok(t.includes('e5'));
  });

  it('teleport (king/queen) drops ANY occupied square — no capture', () => {
    const board = fakeBoard({ d6: { color: 'b', type: 'p' } });
    const t = customMoveTargets('k', 'd4', 'w', board);
    assert.ok(!t.includes('d6'));
  });

  it('returns empty for unsupported piece types (pawn)', () => {
    assert.deepEqual(customMoveTargets('p', 'd4', 'w', fakeBoard()), []);
  });

  it('works with a real chess.js instance', () => {
    const c = new Chess();
    const t = customMoveTargets('r', 'a1', 'w', c);
    // a1 is a white rook in the start position, b2 has a white pawn — own piece blocks.
    assert.deepEqual(t, []);
  });
});

describe('customAttackSquares', () => {
  it('matches customMoveTargets for r/b/n on an empty board', () => {
    for (const type of ['r', 'b', 'n']) {
      const moves = customMoveTargets(type, 'd4', 'w', fakeBoard());
      const attacks = customAttackSquares(type, 'd4');
      assert.deepEqual(new Set(attacks), new Set(moves));
    }
  });

  it('returns [] for king/queen — teleports cannot capture', () => {
    assert.deepEqual(customAttackSquares('k', 'd4'), []);
    assert.deepEqual(customAttackSquares('q', 'd4'), []);
  });

  it('respects board edges', () => {
    assert.deepEqual(customAttackSquares('n', 'a1'), ['c3']);
  });
});

describe('validateCustomPattern', () => {
  it('rook: accepts 1-step diagonal, rejects everything else', () => {
    assert.equal(validateCustomPattern('r', 'a1', 'b2').ok, true);
    assert.equal(validateCustomPattern('r', 'a1', 'c3').ok, false);
    assert.equal(validateCustomPattern('r', 'a1', 'a2').ok, false);
  });

  it('bishop: accepts 1-step orthogonal, rejects everything else', () => {
    assert.equal(validateCustomPattern('b', 'd4', 'd5').ok, true);
    assert.equal(validateCustomPattern('b', 'd4', 'e4').ok, true);
    assert.equal(validateCustomPattern('b', 'd4', 'e5').ok, false);
  });

  it('knight: accepts (2,2), rejects standard L', () => {
    assert.equal(validateCustomPattern('n', 'd4', 'f6').ok, true);
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

  it('rejects piece types that cannot be upgraded', () => {
    assert.equal(validateCustomPattern('p', 'a2', 'a3').ok, false);
  });
});

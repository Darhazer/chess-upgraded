import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
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

  it('knight gains the four 1-step orthogonals', () => {
    const t = customMoveTargets('n', 'd4', 'w', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['d5', 'd3', 'e4', 'c4']));
  });

  it('king teleport: 4 orthogonal directions, 2 squares', () => {
    const t = customMoveTargets('k', 'd4', 'w', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['d6', 'd2', 'f4', 'b4']));
  });

  it('queen gains the 8 knight-L destinations', () => {
    const t = customMoveTargets('q', 'd4', 'w', fakeBoard());
    assert.deepEqual(
      new Set(t),
      new Set(['e6', 'f5', 'f3', 'e2', 'c2', 'b3', 'b5', 'c6'])
    );
  });

  it('pawn gains sideways + 1-step backward (white moves back toward rank 1)', () => {
    const t = customMoveTargets('p', 'd4', 'w', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['c4', 'e4', 'd3']));
  });

  it('pawn backward direction flips for black (toward rank 8)', () => {
    const t = customMoveTargets('p', 'd5', 'b', fakeBoard());
    assert.deepEqual(new Set(t), new Set(['c5', 'e5', 'd6']));
  });

  it('drops targets off the board', () => {
    // a1 corner: only NE-quadrant deltas survive bounds for a rook.
    const t = customMoveTargets('r', 'a1', 'w', fakeBoard());
    assert.deepEqual(t, ['b2']);
  });

  it('pawn sideways drops off-board at the a/h files (backward stays in bounds)', () => {
    assert.deepEqual(new Set(customMoveTargets('p', 'a4', 'w', fakeBoard())), new Set(['b4', 'a3']));
    assert.deepEqual(new Set(customMoveTargets('p', 'h4', 'w', fakeBoard())), new Set(['g4', 'h3']));
  });

  it('pawn backward step is filtered when it would land on rank 1 / rank 8', () => {
    // chess.js refuses pawns on the back rank, so backward from rank 2 / 7
    // is dropped at the targets level — only sideways squares remain.
    assert.deepEqual(new Set(customMoveTargets('p', 'd2', 'w', fakeBoard())), new Set(['c2', 'e2']));
    assert.deepEqual(new Set(customMoveTargets('p', 'd7', 'b', fakeBoard())), new Set(['c7', 'e7']));
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

  it('pawn sideways/backward cannot capture either', () => {
    const board = fakeBoard({
      e4: { color: 'b', type: 'p' },
      d3: { color: 'b', type: 'p' },
    });
    const t = customMoveTargets('p', 'd4', 'w', board);
    assert.ok(!t.includes('e4'), 'sideways capture rejected');
    assert.ok(!t.includes('d3'), 'backward capture rejected');
    assert.ok(t.includes('c4'), 'other-side sideways still available');
  });

  it('king teleport drops ANY occupied square — no capture', () => {
    const board = fakeBoard({ d6: { color: 'b', type: 'p' } });
    const t = customMoveTargets('k', 'd4', 'w', board);
    assert.ok(!t.includes('d6'));
  });

  it('queen knight-jump drops ANY occupied square — no capture', () => {
    const board = fakeBoard({ e6: { color: 'b', type: 'p' } });
    const t = customMoveTargets('q', 'd4', 'w', board);
    assert.ok(!t.includes('e6'));
    assert.ok(t.includes('f5'));
  });

  it('works with a real chess.js instance', () => {
    const c = new Chess();
    const t = customMoveTargets('r', 'a1', 'w', c);
    // a1 is a white rook in the start position, b2 has a white pawn — own piece blocks.
    assert.deepEqual(t, []);
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

  it('knight: accepts 1-step orthogonal move-only, rejects standard L and old (2,2) jump', () => {
    const ok = validateCustomPattern('n', 'd4', 'd5');
    assert.equal(ok.ok, true);
    assert.equal(ok.noCapture, true);
    assert.equal(validateCustomPattern('n', 'd4', 'e4').noCapture, true);
    assert.equal(validateCustomPattern('n', 'd4', 'e6').ok, false, 'standard L is not a bonus');
    assert.equal(validateCustomPattern('n', 'd4', 'f6').ok, false, '(2,2) is no longer the bonus');
  });

  it('king: accepts 2-step orthogonal, rejects diagonals and shorter steps', () => {
    const ortho = validateCustomPattern('k', 'd4', 'd6');
    assert.equal(ortho.ok, true);
    assert.equal(ortho.noCapture, true);

    // Diagonal 2-step is no longer a king bonus pattern.
    assert.equal(validateCustomPattern('k', 'd4', 'f6').ok, false);
    assert.equal(validateCustomPattern('k', 'd4', 'd5').ok, false);
    assert.equal(validateCustomPattern('k', 'd4', 'f5').ok, false);
  });

  it('queen: accepts knight L-jumps (move-only), rejects the old teleport pattern', () => {
    const l1 = validateCustomPattern('q', 'd4', 'e6');
    assert.equal(l1.ok, true);
    assert.equal(l1.noCapture, true);

    const l2 = validateCustomPattern('q', 'd4', 'f5');
    assert.equal(l2.ok, true);
    assert.equal(l2.noCapture, true);

    // Old 2-step teleport is no longer a queen bonus pattern.
    assert.equal(validateCustomPattern('q', 'd4', 'd6').ok, false);
    assert.equal(validateCustomPattern('q', 'd4', 'f6').ok, false);
  });

  it('pawn: accepts sideways and backward (color-dependent), rejects everything else', () => {
    // Sideways (color-agnostic, rank-preserving).
    assert.equal(validateCustomPattern('p', 'd4', 'c4', 'w').ok, true);
    assert.equal(validateCustomPattern('p', 'd4', 'e4', 'w').ok, true);
    assert.equal(validateCustomPattern('p', 'd5', 'c5', 'b').ok, true);

    // Backward 1 square: white moves to rank-1, black to rank+1.
    const wback = validateCustomPattern('p', 'd4', 'd3', 'w');
    assert.equal(wback.ok, true);
    assert.equal(wback.noCapture, true);
    const bback = validateCustomPattern('p', 'd5', 'd6', 'b');
    assert.equal(bback.ok, true);
    assert.equal(bback.noCapture, true);

    // Backward in the wrong direction (i.e. forward) is NOT a bonus pattern —
    // forward moves go through the standard chess.js path.
    assert.equal(validateCustomPattern('p', 'd4', 'd5', 'w').ok, false);
    assert.equal(validateCustomPattern('p', 'd5', 'd4', 'b').ok, false);

    // Diagonal / two-square — rejected by the bonus pattern.
    assert.equal(validateCustomPattern('p', 'd4', 'e5', 'w').ok, false);
    assert.equal(validateCustomPattern('p', 'd4', 'd2', 'w').ok, false);
    assert.equal(validateCustomPattern('p', 'd4', 'f4', 'w').ok, false);
  });
});

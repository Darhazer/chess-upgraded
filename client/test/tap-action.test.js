import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTapAction } from '../src/features/game/tap-action.js';

const W_PAWN = { type: 'p', color: 'w' };
const W_KNIGHT = { type: 'n', color: 'w' };
const B_PAWN = { type: 'p', color: 'b' };

// Convenience: build the input bag with sensible defaults so each test
// can override just what it cares about.
const ctx = (overrides) => ({
  myTurn: true,
  color: 'w',
  selected: null,
  targets: null,
  piece: null,
  square: 'e4',
  ...overrides,
});

describe('computeTapAction — gating', () => {
  it('no-ops when it is not our turn', () => {
    assert.deepEqual(computeTapAction(ctx({ myTurn: false, piece: W_PAWN })), {});
  });
});

describe('computeTapAction — no current selection', () => {
  it('selects when tapping own piece', () => {
    assert.deepEqual(
      computeTapAction(ctx({ piece: W_PAWN, square: 'e2' })),
      { select: 'e2' }
    );
  });

  it('no-ops when tapping an empty square', () => {
    assert.deepEqual(computeTapAction(ctx({ piece: null })), {});
  });

  it("no-ops when tapping opponent's piece", () => {
    assert.deepEqual(computeTapAction(ctx({ piece: B_PAWN })), {});
  });
});

describe('computeTapAction — with current selection', () => {
  const base = { selected: 'e2', targets: new Set(['e3', 'e4']) };

  it('deselects when tapping the same square', () => {
    assert.deepEqual(
      computeTapAction(ctx({ ...base, square: 'e2' })),
      { select: null }
    );
  });

  it('switches selection when tapping another own piece', () => {
    assert.deepEqual(
      computeTapAction(ctx({ ...base, piece: W_KNIGHT, square: 'g1' })),
      { select: 'g1' }
    );
  });

  it('submits a move when tapping a legal target (and clears selection)', () => {
    assert.deepEqual(
      computeTapAction(ctx({ ...base, square: 'e4' })),
      { move: { from: 'e2', to: 'e4' }, select: null }
    );
  });

  it('submits a capture when the target square holds an enemy piece', () => {
    assert.deepEqual(
      computeTapAction(ctx({ ...base, piece: B_PAWN, square: 'e3' })),
      { move: { from: 'e2', to: 'e3' }, select: null }
    );
  });

  it('deselects when tapping an illegal empty square', () => {
    assert.deepEqual(
      computeTapAction(ctx({ ...base, square: 'h8' })),
      { select: null }
    );
  });

  it("deselects when tapping an enemy piece that isn't a legal target", () => {
    assert.deepEqual(
      computeTapAction(ctx({ ...base, piece: B_PAWN, square: 'd5' })),
      { select: null }
    );
  });

  it('treats a null targets set as "no legal moves" — tap on enemy deselects', () => {
    assert.deepEqual(
      computeTapAction(ctx({ selected: 'e2', targets: null, piece: B_PAWN, square: 'e3' })),
      { select: null }
    );
  });
});

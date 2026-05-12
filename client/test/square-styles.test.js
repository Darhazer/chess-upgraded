import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  dragHintLayer,
  mergeSquareStyles,
  upgradedGlowLayer,
  upgradePickableLayer,
} from '../src/features/game/square-styles.js';

describe('upgradedGlowLayer', () => {
  it('emits a radial-gradient background per upgraded square', () => {
    const out = upgradedGlowLayer(new Set(['a1', 'h8']));
    assert.deepEqual(Object.keys(out).sort(), ['a1', 'h8']);
    assert.match(out.a1.background, /radial-gradient/);
  });

  it('returns {} for an empty set', () => {
    assert.deepEqual(upgradedGlowLayer(new Set()), {});
  });
});

describe('upgradePickableLayer', () => {
  it('highlights the moving side\'s non-pawn pieces, skipping already-upgraded', () => {
    const c = new Chess();
    c.load('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    const out = upgradePickableLayer(c, 'w', new Set(['h1']));
    // Eligible: a1 (rook), e1 (king). h1 is upgraded — excluded.
    assert.deepEqual(Object.keys(out).sort(), ['a1', 'e1']);
    assert.match(out.a1.background, /106, 169, 255/);
  });

  it('ignores opponent pieces and skips already-upgraded squares', () => {
    const c = new Chess(); // start position
    const out = upgradePickableLayer(c, 'w', new Set(['a2']));
    // Black pieces must NOT be highlighted.
    assert.equal(out.e8, undefined);
    for (const f of 'abcdefgh') assert.equal(out[`${f}7`], undefined);
    // a2 is already upgraded → excluded.
    assert.equal(out.a2, undefined);
    // Other white pawns ARE pickable now that pawns are upgradeable.
    for (const sq of ['b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2']) {
      assert.ok(out[sq], `${sq} should be pickable`);
    }
    // White non-pawn back rank should be there too.
    for (const sq of ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']) {
      assert.ok(out[sq], `${sq} should be pickable`);
    }
  });
});

describe('dragHintLayer', () => {
  it('emits an inset boxShadow per hint square', () => {
    const out = dragHintLayer(new Set(['e4', 'e5']));
    assert.deepEqual(Object.keys(out).sort(), ['e4', 'e5']);
    assert.match(out.e4.boxShadow, /inset/);
  });
});

describe('mergeSquareStyles', () => {
  it('merges per-square objects, later layers winning on key conflicts', () => {
    const a = { e4: { background: 'red', color: 'white' } };
    const b = { e4: { background: 'blue' } };
    const merged = mergeSquareStyles(a, b);
    assert.deepEqual(merged.e4, { background: 'blue', color: 'white' });
  });

  it('skips falsy layers (so callers can pass `cond && layer(...)`)', () => {
    const merged = mergeSquareStyles(
      { a1: { background: 'x' } },
      false,
      null,
      undefined,
      { h8: { background: 'y' } }
    );
    assert.deepEqual(Object.keys(merged).sort(), ['a1', 'h8']);
  });

  it('combines glow + pickable + hints without losing fields', () => {
    const c = new Chess();
    c.load('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const merged = mergeSquareStyles(
      upgradedGlowLayer(new Set(['a1'])),
      upgradePickableLayer(c, 'w', new Set(['a1'])),
      dragHintLayer(new Set(['a1']))
    );
    // a1 is upgraded (glow), excluded from pickable, hinted as drag target.
    assert.match(merged.a1.background, /radial-gradient/);
    assert.match(merged.a1.boxShadow, /inset/);
  });
});

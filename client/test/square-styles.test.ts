import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dragHintLayer,
  mergeSquareStyles,
  upgradedGlowLayer,
} from '../src/features/game/square-styles.js';

describe('upgradedGlowLayer', () => {
  it('emits a radial-gradient background per upgraded square', () => {
    const out = upgradedGlowLayer(new Set(['a1', 'h8']));
    assert.deepEqual(Object.keys(out).sort(), ['a1', 'h8']);
    assert.match(String(out.a1!.background), /radial-gradient/);
  });

  it('returns {} for an empty set', () => {
    assert.deepEqual(upgradedGlowLayer(new Set()), {});
  });
});

describe('dragHintLayer', () => {
  it('emits an inset boxShadow per hint square', () => {
    const out = dragHintLayer(new Set(['e4', 'e5']));
    assert.deepEqual(Object.keys(out).sort(), ['e4', 'e5']);
    assert.match(String(out.e4!.boxShadow), /inset/);
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
      false as unknown as null,
      null,
      undefined,
      { h8: { background: 'y' } },
    );
    assert.deepEqual(Object.keys(merged).sort(), ['a1', 'h8']);
  });

  it('combines glow + hints without losing fields', () => {
    const merged = mergeSquareStyles(
      upgradedGlowLayer(new Set(['a1'])),
      dragHintLayer(new Set(['a1'])),
    );
    assert.match(String(merged.a1!.background), /radial-gradient/);
    assert.match(String(merged.a1!.boxShadow), /inset/);
  });
});

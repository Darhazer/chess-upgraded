import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { legalTargets } from '../src/features/game/move-targets.js';

describe('legalTargets', () => {
  it('returns standard moves for a non-upgraded piece', () => {
    const c = new Chess();
    assert.deepEqual(legalTargets(c as never, 'e2', { upgradedSet: new Set() }), new Set(['e3', 'e4']));
  });

  it('adds the bonus pattern for an upgraded non-pawn (additive)', () => {
    const c = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const t = legalTargets(c as never, 'a1', { upgradedSet: new Set(['a1']) });
    assert.ok(t.has('a8'), 'standard rook move kept');
    assert.ok(t.has('b2'), 'upgraded diagonal step added');
  });

  it('does not offer a capture via an upgraded non-pawn bonus pattern', () => {
    const c = new Chess('4k3/8/8/8/8/8/1p6/R3K3 w - - 0 1');
    const t = legalTargets(c as never, 'a1', { upgradedSet: new Set(['a1']) });
    assert.ok(!t.has('b2'), 'cannot capture via bonus diagonal step');
    assert.ok(t.has('a7'), 'standard rook move kept');
  });

  it('an upgraded pawn keeps every standard move and gains sideways + backward steps', () => {
    const c = new Chess('4k3/8/8/2p5/3P4/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'd4', { upgradedSet: new Set(['d4']) });
    assert.ok(t.has('d5'), 'standard forward push kept');
    assert.ok(t.has('c5'), 'standard diagonal capture kept');
    assert.ok(t.has('c4'), 'sideways bonus added (left)');
    assert.ok(t.has('e4'), 'sideways bonus added (right)');
    assert.ok(t.has('d3'), 'backward bonus added');
    assert.ok(!t.has('e5'), 'no diagonal move without a capture');
  });

  it('upgraded pawn sideways/backward is move-only — cannot capture an adjacent enemy', () => {
    const c = new Chess('4k3/8/8/8/3Pp3/3p4/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'd4', { upgradedSet: new Set(['d4']) });
    assert.ok(!t.has('e4'), 'cannot capture sideways via bonus pattern');
    assert.ok(!t.has('d3'), 'cannot capture backward via bonus pattern');
    assert.ok(t.has('c4'), 'other-side sideways still available');
  });

  it('upgraded pawn at h-file has only the one in-bounds sideways step (plus backward)', () => {
    const c = new Chess('4k3/8/8/8/7P/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'h4', { upgradedSet: new Set(['h4']) });
    assert.ok(t.has('g4'));
    assert.ok(t.has('h3'), 'backward step still available');
    assert.ok(!t.has('i4'));
  });

  it('an upgraded knight gains the four 1-step orthogonals (move-only)', () => {
    const c = new Chess('4k3/8/8/3p4/3N4/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'd4', { upgradedSet: new Set(['d4']) });
    assert.ok(!t.has('d5'), 'bonus cannot capture');
    assert.ok(t.has('d3'), 'bonus orthogonal step added (south)');
    assert.ok(t.has('c4'), 'bonus orthogonal step added (west)');
    assert.ok(t.has('e4'), 'bonus orthogonal step added (east)');
    assert.ok(t.has('c6'), 'standard L-jump kept');
  });

  it('an upgraded queen gains 8 knight-L destinations (move-only)', () => {
    const c = new Chess('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'd4', { upgradedSet: new Set(['d4']) });
    for (const sq of ['e6', 'f5', 'f3', 'e2', 'c2', 'b3', 'b5', 'c6']) {
      assert.ok(t.has(sq), `knight L-jump target ${sq} added`);
    }
    assert.ok(t.has('d8'), 'standard queen slide kept');
    assert.ok(t.has('h4'), 'standard queen slide kept');
  });

  it('upgraded queen knight-jump is move-only — cannot capture an enemy on a knight square', () => {
    const c = new Chess('4k3/8/4p3/8/3Q4/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'd4', { upgradedSet: new Set(['d4']) });
    assert.ok(!t.has('e6'), 'cannot capture via knight-jump');
    assert.ok(t.has('f5'), 'other knight squares still offered');
  });
});

describe('legalTargets — cannibal variant', () => {
  it('a non-king piece uses its standard moveset (it is its real type in the FEN)', () => {
    const c = new Chess('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'd4', { variant: 'cannibal' });
    assert.ok(t.has('c6'), 'standard L-jump');
    assert.ok(!t.has('d3'), 'no upgrade-style orthogonal bonus in cannibal');
  });

  it('a king cannibalised to a knight moves as a knight', () => {
    const c = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'e1', { variant: 'cannibal', kingOverrides: { e1: 'n' } });
    assert.deepEqual(t, new Set(['c2', 'd3', 'f3', 'g2']));
  });

  it('a king cannibalised to a pawn steps one forward and captures diagonally', () => {
    const c = new Chess('4k3/8/8/8/8/3r4/4K3/8 w - - 0 1');
    const t = legalTargets(c as never, 'e2', { variant: 'cannibal', kingOverrides: { e2: 'p' } });
    assert.ok(t.has('e3'), 'one step forward');
    assert.ok(t.has('d3'), 'diagonal capture of the enemy');
    assert.ok(!t.has('f3'), 'no diagonal move without a capture');
    assert.ok(!t.has('e4'), 'no double-step');
  });

  it('a king still moving as a king uses the standard king moveset', () => {
    const c = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const t = legalTargets(c as never, 'e1', { variant: 'cannibal', kingOverrides: {} });
    assert.ok(t.has('d2') && t.has('e2') && t.has('f2'));
    assert.ok(!t.has('e3'), 'a normal king only steps one square');
  });
});

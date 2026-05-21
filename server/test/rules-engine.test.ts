import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RulesEngine } from '../src/rules-engine.js';
import type { Square } from 'chess.js';

interface SetupArgs {
  fen?: string;
  upgraded?: string[];
}

// Force a position via FEN, with optional upgraded squares.
function setup({ fen, upgraded = [] }: SetupArgs = {}): RulesEngine {
  const e = new RulesEngine();
  if (fen) e.chess.load(fen);
  e.upgraded = new Set(upgraded);
  return e;
}

const sq = (s: string): Square => s as Square;

// Helper to read .reason from a TryMoveResult union without TS griping.
function reason(r: { ok: boolean; reason?: string }): string {
  return r.reason ?? '';
}

describe('auto-upgrade on capture', () => {
  it('upgrades the capturing piece after a standard capture', () => {
    // White knight on f3, black bishop on d4. Nxd4 -> knight on d4 becomes upgraded.
    const e = setup({ fen: '4k3/8/8/8/3b4/5N2/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'f3', to: 'd4' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d4'));
  });

  it('does not upgrade after a quiet move', () => {
    const e = new RulesEngine();
    const r = e.tryMove('e4');
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.size, 0);
  });

  it('upgrades the capturing pawn after en passant', () => {
    const e = setup({ fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1' });
    const r = e.tryMove({ from: 'e5', to: 'd6' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d6'));
  });

  it('upgrades the promoted queen when the promotion was also a capture', () => {
    const e = setup({ fen: '5r1k/4P3/8/8/8/8/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'e7', to: 'f8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get(sq('f8')), { type: 'q', color: 'w' });
    assert.ok(e.upgraded.has('f8'));
  });

  it('does not upgrade a non-capture promotion', () => {
    const e = setup({ fen: '7k/4P3/8/8/8/8/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'e7', to: 'e8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.has('e8'), false);
  });

  it('queen capturing an unupgraded pawn does NOT earn the upgrade', () => {
    const e = setup({ fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1' });
    const r = e.tryMove({ from: 'd1', to: 'd7' });
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.has('d7'), false);
  });

  it('queen capturing an UPGRADED pawn does earn the upgrade', () => {
    const e = setup({ fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1', upgraded: ['d7'] });
    const r = e.tryMove({ from: 'd1', to: 'd7' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d7'));
  });

  it('queen capturing a knight does earn the upgrade (non-pawn capture)', () => {
    const e = setup({ fen: '4k3/3n4/8/8/8/8/8/3QK3 w - - 0 1' });
    const r = e.tryMove({ from: 'd1', to: 'd7' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d7'));
  });

  it('king capturing an unupgraded pawn does NOT earn the upgrade', () => {
    const e = setup({ fen: '4k3/8/8/3p4/3K4/8/8/8 w - - 0 1' });
    const r = e.tryMove({ from: 'd4', to: 'd5' });
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.has('d5'), false);
  });

  it('king capturing an UPGRADED pawn does earn the upgrade', () => {
    const e = setup({ fen: '4k3/8/8/3p4/3K4/8/8/8 w - - 0 1', upgraded: ['d5'] });
    const r = e.tryMove({ from: 'd4', to: 'd5' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d5'));
  });

  it('knight capturing an unupgraded pawn DOES earn the upgrade (rule applies only to K/Q)', () => {
    const e = setup({ fen: '4k3/8/8/8/3p4/5N2/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'f3', to: 'd4' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d4'));
  });

  it('already-upgraded queen capturing an unupgraded pawn keeps its upgrade', () => {
    const e = setup({ fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1', upgraded: ['d1'] });
    const r = e.tryMove({ from: 'd1', to: 'd7' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d7'), 'upgrade follows the queen even on a cheap capture');
    assert.equal(e.upgraded.has('d1'), false);
  });

  it('capture-then-recapture swaps the upgrade marker between pieces', () => {
    const e = setup({
      fen: '4k3/8/3q4/8/3N4/8/8/4K3 b - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd6', to: 'd4' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d4'), 'new occupant (black queen) is upgraded');
    assert.equal(e.chess.get(sq('d4'))!.type, 'q');
    assert.equal(e.chess.get(sq('d4'))!.color, 'b');
    assert.equal(e.upgraded.size, 1);
  });
});

describe('upgraded rook (+1 diagonal step)', () => {
  it('moves diagonally one square', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      upgraded: ['a1'],
    });
    const r = e.tryMove({ from: 'a1', to: 'b2' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('b2'));
    assert.equal(e.upgraded.has('a1'), false);
  });

  it('rejects two-square diagonals', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      upgraded: ['a1'],
    });
    const r = e.tryMove({ from: 'a1', to: 'c3' });
    assert.equal(r.ok, false);
  });

  it('cannot capture with the diagonal step (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/1p6/R3K3 w - - 0 1',
      upgraded: ['a1'],
    });
    const r = e.tryMove({ from: 'a1', to: 'b2' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });
});

describe('upgraded bishop (+1 orthogonal step)', () => {
  it('moves one square orthogonally', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1',
      upgraded: ['c1'],
    });
    const r = e.tryMove({ from: 'c1', to: 'c2' });
    assert.equal(r.ok, true);
  });

  it('cannot capture with the orthogonal step (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/2p5/2B1K3 w - - 0 1',
      upgraded: ['c1'],
    });
    const r = e.tryMove({ from: 'c1', to: 'c2' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });
});

describe('upgraded knight (+1 orthogonal step)', () => {
  it('steps one square orthogonally', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/4K2N w - - 0 1',
      upgraded: ['h1'],
    });
    const r = e.tryMove({ from: 'h1', to: 'h2' });
    assert.equal(r.ok, true);
  });

  it('rejects the old (2,2) jump (no longer the bonus pattern)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/4K2N w - - 0 1',
      upgraded: ['h1'],
    });
    const r = e.tryMove({ from: 'h1', to: 'f3' });
    assert.equal(r.ok, false);
  });

  it('cannot capture with the orthogonal step (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/7p/4K2N w - - 0 1',
      upgraded: ['h1'],
    });
    const r = e.tryMove({ from: 'h1', to: 'h2' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });

  it('still allows the standard L-jump (no need to be upgraded)', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'g1', to: 'f3' });
    assert.equal(r.ok, true);
  });
});

describe('upgraded king teleport', () => {
  it('teleports 2 squares orthogonally over an own piece', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e1'],
    });
    const r = e.tryMove({ from: 'e1', to: 'e3' });
    assert.equal(r.ok, true);
  });

  it('rejects teleport that would land on an occupied square (no capture)', () => {
    const e = setup({
      fen: '4k3/8/4p3/8/4K3/8/8/8 w - - 0 1',
      upgraded: ['e4'],
    });
    const r = e.tryMove({ from: 'e4', to: 'e6' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });

  it('allows teleport jumping over an enemy piece to an empty square', () => {
    const e = setup({
      fen: '4k3/8/8/4p3/4K3/8/8/8 w - - 0 1',
      upgraded: ['e4'],
    });
    const r = e.tryMove({ from: 'e4', to: 'e6' });
    assert.equal(r.ok, true);
  });

  it('rejects the diagonal 2-step teleport (orthogonal only now)', () => {
    const e = setup({
      fen: '4k3/8/8/8/4K3/8/8/8 w - - 0 1',
      upgraded: ['e4'],
    });
    const r = e.tryMove({ from: 'e4', to: 'g6' });
    assert.equal(r.ok, false);
  });
});

describe('upgraded queen (+knight L-jump, move-only)', () => {
  it('leaps to a knight square', () => {
    const e = setup({
      fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'e6' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('e6'));
  });

  it('leaps over a blocker that would stop a normal queen slide', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/3P4/3QK3 w - - 0 1',
      upgraded: ['d1'],
    });
    const r = e.tryMove({ from: 'd1', to: 'e3' });
    assert.equal(r.ok, true);
  });

  it('cannot capture via the knight-jump (move-only)', () => {
    const e = setup({
      fen: '4k3/8/4p3/8/3Q4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'e6' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });

  it('rejects 2-square teleport patterns (no longer a queen bonus)', () => {
    const e = setup({
      fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    assert.equal(e.tryMove({ from: 'd4', to: 'd6' }).ok, true, 'normal queen slide unaffected');
    const blocked = setup({
      fen: '4k3/8/8/8/8/8/3P4/3QK3 w - - 0 1',
      upgraded: ['d1'],
    });
    const r = blocked.tryMove({ from: 'd1', to: 'd3' });
    assert.equal(r.ok, false);
  });
});

describe('upgraded pawn (keeps standard moveset + sideways/backward step)', () => {
  it('keeps the standard forward push', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'e3' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('e3'));
  });

  it('keeps the standard two-square push from the starting rank', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'e4' });
    assert.equal(r.ok, true);
  });

  it('keeps the standard diagonal capture', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/3p4/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'd3' });
    assert.equal(r.ok, true);
    assert.equal(e.chess.get(sq('d3'))!.color, 'w');
    assert.ok(e.upgraded.has('d3'));
  });

  it('gains a one-square sideways move (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'e4' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('e4'));
    assert.equal(e.upgraded.has('d4'), false);
  });

  it('gains a one-square backward move (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'd3' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d3'));
    assert.equal(e.upgraded.has('d4'), false);
  });

  it('backward direction depends on color (black moves backward = toward rank 8)', () => {
    const e = setup({
      fen: '4k3/8/8/3p4/8/8/8/4K3 b - - 0 1',
      upgraded: ['d5'],
    });
    const r = e.tryMove({ from: 'd5', to: 'd6' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d6'));
  });

  it('sideways step cannot capture', () => {
    const e = setup({
      fen: '4k3/8/8/8/3Pp3/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'e4' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });

  it('rejects backward step onto own back rank (chess.js disallows pawns there)', () => {
    const w = setup({
      fen: '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1',
      upgraded: ['d2'],
    });
    assert.equal(w.tryMove({ from: 'd2', to: 'd1' }).ok, false);

    const b = setup({
      fen: '4k3/3p4/8/8/8/8/8/4K3 b - - 0 1',
      upgraded: ['d7'],
    });
    assert.equal(b.tryMove({ from: 'd7', to: 'd8' }).ok, false);
  });

  it('backward step cannot capture', () => {
    const e = setup({
      fen: '4k3/8/8/8/3P4/3p4/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'd3' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /capture/i);
  });

  it('upgraded enemy pawn still gives check on the diagonal', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/3K4/8 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e._isInCheck('w'), true);
  });

  it('does NOT attack the square directly ahead', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/4K3/8 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e._isInCheck('w'), false);
  });

  it('does NOT attack sideways either (bonus move is move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/3Kp3/8/8/8 w - - 0 1',
      upgraded: ['e4'],
    });
    assert.equal(e._isInCheck('w'), false);
  });

  it('promotes via standard push, dropping the upgrade marker (no capture)', () => {
    const e = setup({
      fen: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1',
      upgraded: ['e7'],
    });
    const r = e.tryMove({ from: 'e7', to: 'e8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get(sq('e8')), { type: 'q', color: 'w' });
    assert.equal(e.upgraded.has('e8'), false);
    assert.match(e.history.at(-1)!.san, /=Q/);
  });

  it('promotes via standard diagonal capture, keeping the upgrade (auto-upgrade on capture)', () => {
    const e = setup({
      fen: '5r1k/4P3/8/8/8/8/8/4K3 w - - 0 1',
      upgraded: ['e7'],
    });
    const r = e.tryMove({ from: 'e7', to: 'f8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get(sq('f8')), { type: 'q', color: 'w' });
    assert.ok(e.upgraded.has('f8'));
  });
});

describe('upgrade marker tracking', () => {
  it('follows the piece across a normal move', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      upgraded: ['a1'],
    });
    const r = e.tryMove({ from: 'a1', to: 'a4' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('a4'));
    assert.equal(e.upgraded.has('a1'), false);
  });

  it('is lost when an upgraded piece is captured', () => {
    const e = setup({
      fen: '4k3/8/8/8/6b1/5N2/8/4K3 b - - 0 1',
      upgraded: ['f3'],
    });
    const r = e.tryMove({ from: 'g4', to: 'f3' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('f3'));
    assert.equal(e.chess.get(sq('f3'))!.type, 'b');
  });

  it('transfers via castling for the rook', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
      upgraded: ['h1'],
    });
    const r = e.tryMove({ from: 'e1', to: 'g1' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('f1'));
    assert.equal(e.upgraded.has('h1'), false);
  });
});

describe('check detection includes upgraded attacks', () => {
  it("an upgraded rook's diagonal step does NOT count as an attack (move-only)", () => {
    const e = setup({
      fen: '8/8/8/8/8/1k6/2R5/4K3 b - - 0 1',
      upgraded: ['c2'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it("an upgraded knight's orthogonal step does NOT count as an attack (move-only)", () => {
    const e = setup({
      fen: '8/8/8/8/8/2k5/2N5/4K3 b - - 0 1',
      upgraded: ['c2'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it("an upgraded bishop's orthogonal step does NOT count as an attack (move-only)", () => {
    const e = setup({
      fen: '8/8/8/8/8/8/1k6/1B2K3 b - - 0 1',
      upgraded: ['b1'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it('king teleport does NOT count as an attack (no capture)', () => {
    const e = setup({
      fen: '8/8/8/8/8/k7/P7/K7 b - - 0 1',
      upgraded: ['a1'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it("an upgraded queen's knight-jump does NOT count as an attack (move-only)", () => {
    const e = setup({
      fen: '8/8/8/8/8/1k6/8/Q3K3 b - - 0 1',
      upgraded: ['a1'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it('an upgraded enemy pawn still threatens its diagonal squares', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/8/4K3 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e.tryMove({ from: 'e1', to: 'e2' }).ok, true);
    const e2 = setup({
      fen: '4k3/8/8/8/8/4p3/8/4K3 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e2.tryMove({ from: 'e1', to: 'd2' }).ok, false);
  });
});

describe('move validation', () => {
  it('rejects moving from an empty square', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'd4', to: 'd5' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /invalid/i);
  });

  it('rejects moving an opponent piece', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'e7', to: 'e5' });
    assert.equal(r.ok, false);
    assert.match(reason(r), /invalid/i);
  });
});

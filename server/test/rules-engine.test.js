import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RulesEngine } from '../src/rules-engine.js';

// Helper: play a series of standard SAN moves; assert all succeed.
function play(engine, sans) {
  for (const san of sans) {
    const r = engine.tryMove(san);
    assert.equal(r.ok, true, `move ${san} should succeed: ${r.reason}`);
  }
}

// Force a position via FEN, with optional upgraded squares + bars.
function setup({ fen, upgraded = [], bar = { w: 0, b: 0 }, barMax = 3 } = {}) {
  const e = new RulesEngine({ barMax });
  if (fen) e.chess.load(fen);
  e.upgraded = new Set(upgraded);
  e.bar = { ...bar };
  return e;
}

describe('upgrade bar', () => {
  it('starts empty for both sides', () => {
    const e = new RulesEngine();
    assert.deepEqual(e.bar, { w: 0, b: 0 });
  });

  it('increments only the moving side and caps at barMax', () => {
    const e = new RulesEngine({ barMax: 3 });
    play(e, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
    // White made 4 moves -> capped at 3. Black made 3 moves.
    assert.equal(e.bar.w, 3);
    assert.equal(e.bar.b, 3);
  });

  it('upgrade resets the spending side\'s bar and ends the turn', () => {
    const e = new RulesEngine({ barMax: 3 });
    play(e, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    // White to move, white bar full.
    assert.equal(e.turn(), 'w');
    assert.equal(e.bar.w, 3);
    const r = e.tryUpgrade('b5');
    assert.equal(r.ok, true);
    assert.equal(e.bar.w, 0);
    assert.equal(e.turn(), 'b');
    assert.ok(e.upgraded.has('b5'));
  });
});

describe('tryUpgrade', () => {
  it('rejects when bar not full', () => {
    const e = new RulesEngine({ barMax: 3 });
    play(e, ['e4']);
    const r = e.tryUpgrade('e1');
    assert.equal(r.ok, false);
    assert.match(r.reason, /not full/i);
  });

  it('rejects pawns', () => {
    const e = setup({ bar: { w: 3, b: 0 }, barMax: 3 });
    const r = e.tryUpgrade('e2');
    assert.equal(r.ok, false);
    assert.match(r.reason, /pawn/i);
  });

  it('rejects opponent pieces', () => {
    const e = setup({ bar: { w: 3, b: 0 }, barMax: 3 });
    const r = e.tryUpgrade('e8');
    assert.equal(r.ok, false);
    assert.match(r.reason, /your piece/i);
  });

  it('rejects already-upgraded squares', () => {
    const e = setup({ bar: { w: 3, b: 0 }, upgraded: ['e1'], barMax: 3 });
    const r = e.tryUpgrade('e1');
    assert.equal(r.ok, false);
    assert.match(r.reason, /already/i);
  });

  it('rejects upgrade while in check', () => {
    // Black queen on e2 gives white check via the e file.
    const e = setup({
      fen: '4k3/8/8/8/8/8/4q3/4K3 w - - 0 1',
      bar: { w: 3, b: 0 },
      barMax: 3,
    });
    const r = e.tryUpgrade('e1');
    assert.equal(r.ok, false);
    assert.match(r.reason, /check/i);
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
});

describe('upgraded knight (+2,2 jump)', () => {
  it('makes the equal-length L-jump', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/8/4K2N w - - 0 1',
      upgraded: ['h1'],
    });
    const r = e.tryMove({ from: 'h1', to: 'f3' });
    assert.equal(r.ok, true);
  });

  it('still allows the standard L-jump (no need to be upgraded)', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'g1', to: 'f3' });
    assert.equal(r.ok, true);
  });
});

describe('upgraded king/queen teleport', () => {
  it('king teleports 2 squares orthogonally over an own piece', () => {
    // White pawn on e2 sits between king e1 and target e3.
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e1'],
    });
    // e3 is not attacked here, so king-safety holds.
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
    assert.match(r.reason, /capture/i);
  });

  it('allows teleport jumping over an enemy piece to an empty square', () => {
    const e = setup({
      fen: '4k3/8/8/4p3/4K3/8/8/8 w - - 0 1',
      upgraded: ['e4'],
    });
    const r = e.tryMove({ from: 'e4', to: 'e6' });
    assert.equal(r.ok, true);
  });

  it('queen teleport bypasses blocking own piece', () => {
    // Queen on d1, own pawn on d2; teleport to d3 is normally blocked by the pawn.
    const e = setup({
      fen: '4k3/8/8/8/8/8/3P4/3QK3 w - - 0 1',
      upgraded: ['d1'],
    });
    const r = e.tryMove({ from: 'd1', to: 'd3' });
    assert.equal(r.ok, true);
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
    // Black bishop on g4 will capture white knight on f3 (which is upgraded).
    const e = setup({
      fen: '4k3/8/8/8/6b1/5N2/8/4K3 b - - 0 1',
      upgraded: ['f3'],
    });
    const r = e.tryMove({ from: 'g4', to: 'f3' });
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.has('f3'), false);
  });

  it('transfers via castling for the rook', () => {
    // White king-side castle. Rook on h1 is upgraded.
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
  it('upgraded rook delivers check via diagonal step', () => {
    // White rook on c2, black king on b3. Standard rook can't reach b3
    // (different file/rank), but the upgraded diagonal step can.
    const e = setup({
      fen: '8/8/8/8/8/1k6/2R5/4K3 b - - 0 1',
      upgraded: ['c2'],
    });
    assert.equal(e._isInCheck('b'), true);
  });

  it('upgraded knight delivers check via 2,2 jump', () => {
    // White knight on c2 (upgraded) reaches a4 via 2,2 jump.
    const e = setup({
      fen: '8/8/8/8/k7/8/2N5/4K3 b - - 0 1',
      upgraded: ['c2'],
    });
    assert.equal(e._isInCheck('b'), true);
  });

  it('upgraded bishop delivers check via orthogonal step', () => {
    // White bishop on b1 (upgraded) reaches b2 (black king) via the
    // one-step orthogonal upgrade.
    const e = setup({
      fen: '8/8/8/8/8/8/1k6/1B2K3 b - - 0 1',
      upgraded: ['b1'],
    });
    assert.equal(e._isInCheck('b'), true);
  });

  it('king/queen teleport does NOT count as an attack (no capture)', () => {
    // White queen on a1, black king on c3. A black pawn on b2 blocks the
    // queen's a1-h8 diagonal (and a black pawn on b2 attacks a1/c1, not
    // c3). The 2,2 teleport from a1 can "reach" c3, but teleports cannot
    // capture, so they don't count as a threat.
    const e = setup({
      fen: '8/8/8/8/8/2k5/1p6/Q3K3 b - - 0 1',
      upgraded: ['a1'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it('rejects a standard move that would expose the king to upgraded attack', () => {
    // White: king e1, knight on d3 blocks black upgraded rook on a3 from
    // stepping diagonally to e1 only via b2->c1->... actually let's set
    // up a clearer position. White king on e1; black upgraded rook on
    // d2. Standard chess: rook attacks d-file/2-rank. Diagonal step
    // from d2 reaches e1, c1, e3, c3. So white king on e1 is currently
    // attacked by upgraded-rook diagonal step. The position is illegal
    // for white-to-move; instead, place white pawn on e2 — that's fine.
    //
    // Better: white knight on c1 protects... let's just verify directly:
    // black rook on d3 (upgraded). White king on e1. d3 -> e2 (diag) is
    // attack on e2; if white king is on e2 it's in check. If white moves
    // king from e1 to e2, that should be rejected.
    const e = setup({
      fen: '4k3/8/8/8/8/3r4/8/4K3 w - - 0 1',
      upgraded: ['d3'],
    });
    // King e1 -> e2: standard rook on d3 doesn't attack e2 (different
    // file/rank). Upgraded rook diagonal step d3 -> e2 attacks e2.
    const r = e.tryMove({ from: 'e1', to: 'e2' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /check/i);
  });
});

describe('move validation', () => {
  it('rejects moving from an empty square', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'd4', to: 'd5' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid/i);
  });

  it('rejects moving an opponent piece', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'e7', to: 'e5' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid/i);
  });
});

describe('configurable bar max', () => {
  it('respects a custom barMax', () => {
    const e = new RulesEngine({ barMax: 1 });
    play(e, ['e4', 'e5']); // both sides bar = 1
    assert.equal(e.bar.w, 1);
    assert.equal(e.turn(), 'w');
    const r = e.tryUpgrade('e1');
    assert.equal(r.ok, true);
  });
});

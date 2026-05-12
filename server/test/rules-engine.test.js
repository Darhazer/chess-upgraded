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

  it('allows pawns', () => {
    const e = setup({ bar: { w: 3, b: 0 }, barMax: 3 });
    const r = e.tryUpgrade('e2');
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('e2'));
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

  it('cannot capture with the diagonal step (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/1p6/R3K3 w - - 0 1',
      upgraded: ['a1'],
    });
    const r = e.tryMove({ from: 'a1', to: 'b2' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capture/i);
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
    assert.match(r.reason, /capture/i);
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

  it('cannot capture with the 2,2 jump (move-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/5p2/8/4K2N w - - 0 1',
      upgraded: ['h1'],
    });
    const r = e.tryMove({ from: 'h1', to: 'f3' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capture/i);
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

describe('upgraded pawn (replaces moveset: diagonal step, forward capture)', () => {
  it('moves diagonally one square to an empty target', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'd3' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d3'));
    assert.equal(e.upgraded.has('e2'), false);
  });

  it('slides diagonally to an empty square mid-board (both diagonals)', () => {
    for (const to of ['c5', 'e5']) {
      const e = setup({
        fen: '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1',
        upgraded: ['d4'],
      });
      const r = e.tryMove({ from: 'd4', to });
      assert.equal(r.ok, true, `d4-${to}`);
    }
  });

  it('captures the piece directly in front', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'e3' });
    assert.equal(r.ok, true);
    assert.equal(e.chess.get('e3').color, 'w');
    assert.ok(e.upgraded.has('e3'));
  });

  it('loses the forward push (1- and 2-square)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    assert.equal(e.tryMove({ from: 'e2', to: 'e3' }).ok, false);
    assert.equal(e.tryMove({ from: 'e2', to: 'e4' }).ok, false);
  });

  it('loses the diagonal capture', () => {
    // Black piece on d3 — a normal pawn would capture e2xd3, but the
    // upgraded pawn's diagonal is move-only.
    const e = setup({
      fen: '4k3/8/8/8/8/3p4/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'd3' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capture/i);
  });

  it('rejects the forward step onto an empty square (capture-only)', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      upgraded: ['e2'],
    });
    const r = e.tryMove({ from: 'e2', to: 'e3' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capture/i);
  });

  it('upgraded enemy pawn delivers check via its forward capture square', () => {
    // Black pawn on e3 (upgraded). White king on e2 — pawn forward attack.
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/4K3/8 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e._isInCheck('w'), true);
  });

  it('upgraded enemy pawn no longer attacks its old diagonal squares', () => {
    // White king on d3 — a standard black pawn on e4 would check it.
    // Upgraded, the pawn only threatens e3, so the king is safe.
    const e = setup({
      fen: '4k3/8/8/8/4p3/3K4/8/8 w - - 0 1',
      upgraded: ['e4'],
    });
    assert.equal(e._isInCheck('w'), false);
  });

  it('an upgraded enemy pawn still blocks a friendly slider (no false check)', () => {
    // Black rook e8, black upgraded pawn e4 in front of it, white king e1.
    // The pawn blocks the rook, so e1 is not attacked — and the upgraded
    // pawn isn't removed from the board for the check test.
    const e = setup({
      fen: '4r2k/8/8/8/4p3/8/8/4K3 w - - 0 1',
      upgraded: ['e4'],
    });
    assert.equal(e._isInCheck('w'), false);
    // Remove the pawn and the rook now checks — sanity that the position
    // is otherwise wired correctly.
    const e2 = setup({ fen: '4r2k/8/8/8/8/8/8/4K3 w - - 0 1' });
    assert.equal(e2._isInCheck('w'), true);
  });

  it('promotes to a queen via the diagonal step, dropping the upgrade marker', () => {
    // White pawn on a7 (upgraded), b8 empty.
    const e = setup({
      fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
      upgraded: ['a7'],
    });
    const r = e.tryMove({ from: 'a7', to: 'b8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get('b8'), { type: 'q', color: 'w' });
    assert.equal(e.upgraded.has('b8'), false, 'promoted queen is not upgraded');
    assert.equal(e.upgraded.has('a7'), false);
    assert.match(e.history.at(-1).san, /=Q/);
  });

  it('promotes via the forward capture, dropping the upgrade marker', () => {
    // White pawn on e7 (upgraded), black rook on e8.
    const e = setup({
      fen: '4r1k1/4P3/8/8/8/8/8/4K3 w - - 0 1',
      upgraded: ['e7'],
    });
    const r = e.tryMove({ from: 'e7', to: 'e8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get('e8'), { type: 'q', color: 'w' });
    assert.equal(e.upgraded.has('e8'), false);
  });

  it('still refuses a diagonal capture onto the back rank (no diagonal capture, even to promote)', () => {
    // White pawn e7 (upgraded), black rook on f8 — would be axf8=Q for a
    // normal pawn, but the upgraded pawn cannot capture on the diagonal.
    const e = setup({
      fen: '5rk1/4P3/8/8/8/8/8/4K3 w - - 0 1',
      upgraded: ['e7'],
    });
    const r = e.tryMove({ from: 'e7', to: 'f8', promotion: 'q' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capture/i);
  });

  it('a black upgraded pawn promotes on the first rank too', () => {
    const e = setup({
      fen: '4k3/8/8/8/8/8/1p6/4K3 b - - 0 1',
      upgraded: ['b2'],
    });
    const r = e.tryMove({ from: 'b2', to: 'a1', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get('a1'), { type: 'q', color: 'b' });
    assert.equal(e.upgraded.has('a1'), false);
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
  it("an upgraded rook's diagonal step does NOT count as an attack (move-only)", () => {
    // White rook on c2, black king on b3. Standard rook can't reach b3
    // (different file/rank), and the upgraded diagonal step can't capture,
    // so the king is not in check.
    const e = setup({
      fen: '8/8/8/8/8/1k6/2R5/4K3 b - - 0 1',
      upgraded: ['c2'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it("an upgraded knight's 2,2 jump does NOT count as an attack (move-only)", () => {
    const e = setup({
      fen: '8/8/8/8/k7/8/2N5/4K3 b - - 0 1',
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

  it('rejects a standard move that would expose the king to an upgraded enemy pawn', () => {
    // Black upgraded pawn on e3 captures straight ahead onto e2. The white
    // king on e1 may not step to e2 — standard chess.js sees e2 as safe
    // (the pawn's standard diagonals are d2/f2), but the upgrade covers it.
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/8/4K3 w - - 0 1',
      upgraded: ['e3'],
    });
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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RulesEngine } from '../src/rules-engine.js';

// Force a position via FEN, with optional upgraded squares.
function setup({ fen, upgraded = [] } = {}) {
  const e = new RulesEngine();
  if (fen) e.chess.load(fen);
  e.upgraded = new Set(upgraded);
  return e;
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
    // White pawn e7, black rook f8; exf8=Q with capture.
    const e = setup({ fen: '5r1k/4P3/8/8/8/8/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'e7', to: 'f8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get('f8'), { type: 'q', color: 'w' });
    assert.ok(e.upgraded.has('f8'));
  });

  it('does not upgrade a non-capture promotion', () => {
    const e = setup({ fen: '7k/4P3/8/8/8/8/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'e7', to: 'e8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.has('e8'), false);
  });

  it('queen capturing an unupgraded pawn does NOT earn the upgrade', () => {
    // White queen on d1, black pawn on d7. Qxd7 — queen captures a plain
    // pawn, no upgrade granted under the K/Q value-floor rule.
    const e = setup({ fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1' });
    const r = e.tryMove({ from: 'd1', to: 'd7' });
    assert.equal(r.ok, true);
    assert.equal(e.upgraded.has('d7'), false);
  });

  it('queen capturing an UPGRADED pawn does earn the upgrade', () => {
    // The pawn earned its weight — capturing it counts as a real capture.
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
    // White king d4, adjacent black pawn d5. Kxd5 — no upgrade.
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
    // The rule prevents EARNING the upgrade; it never strips an existing one.
    const e = setup({ fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1', upgraded: ['d1'] });
    const r = e.tryMove({ from: 'd1', to: 'd7' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d7'), 'upgrade follows the queen even on a cheap capture');
    assert.equal(e.upgraded.has('d1'), false);
  });

  it('capture-then-recapture swaps the upgrade marker between pieces', () => {
    // White knight on d4 (upgraded), black bishop on g7. Nxe6 doesn't make
    // sense here — set up a clean recapture: white knight d4 (upgraded),
    // black queen on d6. ...Qxd4 — black queen captures the (upgraded) knight
    // and ends up upgraded itself.
    const e = setup({
      fen: '4k3/8/3q4/8/3N4/8/8/4K3 b - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd6', to: 'd4' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('d4'), 'new occupant (black queen) is upgraded');
    assert.equal(e.chess.get('d4').type, 'q');
    assert.equal(e.chess.get('d4').color, 'b');
    // The captured knight's marker on d4 was cleared before the new one
    // was added — only one marker on d4 (sanity).
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
    assert.match(r.reason, /capture/i);
  });

  it('still allows the standard L-jump (no need to be upgraded)', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'g1', to: 'f3' });
    assert.equal(r.ok, true);
  });
});

describe('upgraded king teleport', () => {
  it('teleports 2 squares orthogonally over an own piece', () => {
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
    // Queen on d1, own pawn on d2 blocks the d-file. Knight-jump d1->e3
    // ignores the blocker entirely.
    const e = setup({
      fen: '4k3/8/8/8/8/8/3P4/3QK3 w - - 0 1',
      upgraded: ['d1'],
    });
    const r = e.tryMove({ from: 'd1', to: 'e3' });
    assert.equal(r.ok, true);
  });

  it('cannot capture via the knight-jump (move-only)', () => {
    // Black pawn on e6 — the queen's bonus L-jump cannot capture it.
    const e = setup({
      fen: '4k3/8/4p3/8/3Q4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    const r = e.tryMove({ from: 'd4', to: 'e6' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capture/i);
  });

  it('rejects 2-square teleport patterns (no longer a queen bonus)', () => {
    const e = setup({
      fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1',
      upgraded: ['d4'],
    });
    assert.equal(e.tryMove({ from: 'd4', to: 'd6' }).ok, true, 'normal queen slide unaffected');
    // ...but a queen with the d-file blocked cannot teleport over the blocker.
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
    assert.equal(e.chess.get('d3').color, 'w');
    // Capture also re-applies auto-upgrade (and the pawn was already upgraded).
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
    assert.match(r.reason, /capture/i);
  });

  it('rejects backward step onto own back rank (chess.js disallows pawns there)', () => {
    // White pawn on d2 — backward to d1 would land on rank 1.
    const w = setup({
      fen: '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1',
      upgraded: ['d2'],
    });
    assert.equal(w.tryMove({ from: 'd2', to: 'd1' }).ok, false);

    // Black pawn on d7 — backward to d8 would land on rank 8.
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
    assert.match(r.reason, /capture/i);
  });

  it('upgraded enemy pawn still gives check on the diagonal', () => {
    // Black upgraded pawn on e3 standard-attacks d2/f2. White king on d2.
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/3K4/8 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e._isInCheck('w'), true);
  });

  it('does NOT attack the square directly ahead', () => {
    // Black upgraded pawn on e3. White king on e2 — diagonal-only attack,
    // straight ahead is move territory, not attack territory.
    const e = setup({
      fen: '4k3/8/8/8/8/4p3/4K3/8 w - - 0 1',
      upgraded: ['e3'],
    });
    assert.equal(e._isInCheck('w'), false);
  });

  it('does NOT attack sideways either (bonus move is move-only)', () => {
    // Black upgraded pawn on e4. White king on d4 — sideways adjacent.
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
    assert.deepEqual(e.chess.get('e8'), { type: 'q', color: 'w' });
    assert.equal(e.upgraded.has('e8'), false);
    assert.match(e.history.at(-1).san, /=Q/);
  });

  it('promotes via standard diagonal capture, keeping the upgrade (auto-upgrade on capture)', () => {
    const e = setup({
      fen: '5r1k/4P3/8/8/8/8/8/4K3 w - - 0 1',
      upgraded: ['e7'],
    });
    const r = e.tryMove({ from: 'e7', to: 'f8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.deepEqual(e.chess.get('f8'), { type: 'q', color: 'w' });
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
    // Black bishop on g4 will capture white knight on f3 (which is upgraded).
    // The capturing bishop is auto-upgraded; the previous upgrade on f3 is gone.
    const e = setup({
      fen: '4k3/8/8/8/6b1/5N2/8/4K3 b - - 0 1',
      upgraded: ['f3'],
    });
    const r = e.tryMove({ from: 'g4', to: 'f3' });
    assert.equal(r.ok, true);
    assert.ok(e.upgraded.has('f3')); // auto-upgrade on capture (the bishop)
    assert.equal(e.chess.get('f3').type, 'b');
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

  it("an upgraded knight's orthogonal step does NOT count as an attack (move-only)", () => {
    // White knight on c2, black king on c3 — adjacent on the c-file. The
    // knight's normal L-jumps do not threaten c3, and the bonus orthogonal
    // step is move-only.
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
    // White king on a1 (upgraded). The 2-step orthogonal teleport from a1
    // can "reach" a3, but teleports are move-only, so the black king on a3
    // is not in check. (A pawn on a2 blocks any would-be slide, which the
    // king never had anyway.)
    const e = setup({
      fen: '8/8/8/8/8/k7/P7/K7 b - - 0 1',
      upgraded: ['a1'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it("an upgraded queen's knight-jump does NOT count as an attack (move-only)", () => {
    // White queen on a1, black king on b3 — purely a knight-square from a1
    // (not reachable by any standard queen slide). The bonus L-jump cannot
    // capture, so no check.
    const e = setup({
      fen: '8/8/8/8/8/1k6/8/Q3K3 b - - 0 1',
      upgraded: ['a1'],
    });
    assert.equal(e._isInCheck('b'), false);
  });

  it('an upgraded enemy pawn still threatens its diagonal squares', () => {
    // Black upgraded pawn on e3 attacks d2/f2 (standard pawn attacks).
    // White king on e1 can step to e2 (not attacked) but not d2/f2.
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
    assert.match(r.reason, /invalid/i);
  });

  it('rejects moving an opponent piece', () => {
    const e = new RulesEngine();
    const r = e.tryMove({ from: 'e7', to: 'e5' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid/i);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChessRpgEngine } from '../src/chess-rpg-engine.js';
import { slotId, PIECE_COST } from '../../shared/chess-rpg-rules.js';

describe('chess-rpg: initial state', () => {
  it('starts with kings + the three pawns in front of each king', () => {
    const e = new ChessRpgEngine();
    const fen = e.fen().split(' ')[0]!;
    assert.equal(fen, '4k3/3ppp2/8/8/8/8/3PPP2/4K3');
  });

  it('starts with one material point on each side', () => {
    const e = new ChessRpgEngine();
    assert.equal(e.material.w, 1);
    assert.equal(e.material.b, 1);
  });

  it('exposes 12 off-board slots per side (7 backrank + 5 pawns)', () => {
    const e = new ChessRpgEngine();
    const state = e.publicState();
    assert.equal(state.offBoard.w.length, 12);
    assert.equal(state.offBoard.b.length, 12);
    assert.equal(state.offBoard.w.filter((s) => s.homeType === 'p').length, 5);
    assert.equal(state.offBoard.b.filter((s) => s.homeType === 'p').length, 5);
    // White's seed material (1) makes their pawn slots already buildable.
    const wPawn = state.offBoard.w.find((s) => s.homeType === 'p')!;
    assert.equal(wPawn.enabled, true);
    // Black is not to-move; their slots are still disabled.
    assert.ok(state.offBoard.b.every((s) => !s.enabled));
  });

  it('has no castling rights in the starting FEN', () => {
    const e = new ChessRpgEngine();
    assert.equal(e.fen().split(' ')[2], '-');
  });
});

describe('chess-rpg: material accrual', () => {
  it('awards no material when no piece sits on an advanced rank', () => {
    const e = new ChessRpgEngine();
    // Both sides start with the 1-point seed.
    assert.equal(e.material.w, 1);
    assert.equal(e.material.b, 1);
    // King step keeps every piece on home ranks 1/2 (white) → no bonus.
    e.tryMove({ from: 'e1', to: 'd1' });
    assert.equal(e.material.w, 1);
  });

  it('awards +1 per own piece on the near-advanced rank (3 for white, 6 for black)', () => {
    const e = new ChessRpgEngine();
    e.tryMove({ from: 'e2', to: 'e3' });
    // e2 pawn now on rank 3 → +1.
    assert.equal(e.material.w, 2);
    e.tryMove({ from: 'e7', to: 'e6' });
    // black pawn now on rank 6 → +1.
    assert.equal(e.material.b, 2);
  });

  it('awards +1 per own piece on the deep own-half rank (4 for white, 5 for black)', () => {
    const e = new ChessRpgEngine();
    e.tryMove({ from: 'e2', to: 'e4' });
    // e-pawn now on rank 4 → +1 (still own half under the new rule).
    assert.equal(e.material.w, 2);
    e.tryMove({ from: 'e7', to: 'e5' });
    // black e-pawn now on rank 5 → +1.
    assert.equal(e.material.b, 2);
  });

  it("awards +2 per white piece in the opponent's half (rank 5+)", () => {
    const e = new ChessRpgEngine();
    // White d-pawn marches d2 → d4 → d5; d5 lands in the opponent's half.
    e.tryMove({ from: 'd2', to: 'd4' });          // +1 (d4 = own half)
    assert.equal(e.material.w, 2);
    e.tryMove({ from: 'e8', to: 'd8' });          // black waiting move
    e.tryMove({ from: 'd4', to: 'd5' });          // +2 (d5 = opponent half)
    assert.equal(e.material.w, 4);
  });

  it("awards +2 per black piece in the opponent's half (rank 4-)", () => {
    const e = new ChessRpgEngine();
    e.tryMove({ from: 'e1', to: 'd1' });          // white waiting move
    e.tryMove({ from: 'd7', to: 'd5' });          // +1 (rank 5 = own half)
    assert.equal(e.material.b, 2);
    e.tryMove({ from: 'd1', to: 'e1' });
    e.tryMove({ from: 'd5', to: 'd4' });          // +2 (rank 4 = opponent half)
    assert.equal(e.material.b, 4);
  });

  it('sums the bonus across multiple advanced pieces', () => {
    const e = new ChessRpgEngine();
    // Push two pawns to rank 3 over two white turns, then a move that
    // changes nothing on the advanced ranks: still +2 (both pawns on r3).
    e.tryMove({ from: 'd2', to: 'd3' });           // w: +1 (d3)
    assert.equal(e.material.w, 2);
    e.tryMove({ from: 'd7', to: 'd6' });           // b: +1 (d6)
    e.tryMove({ from: 'f2', to: 'f3' });           // w: +2 (d3, f3)
    assert.equal(e.material.w, 4);
    e.tryMove({ from: 'f7', to: 'f6' });           // b: +2
    e.tryMove({ from: 'e1', to: 'd1' });           // king step; pawns still on r3 → +2
    assert.equal(e.material.w, 6);
  });
});

describe('chess-rpg: pawn midline-crossing XP', () => {
  it('awards +1 XP when a white pawn first lands on rank 5', () => {
    const e = new ChessRpgEngine();
    // d-pawn double-jump to d4, then black plays a waiting king step, then
    // push to d5 — the crossing move. (RPG starts with only d/e/f pawns,
    // so a-pawn moves aren't legal as waiting moves.)
    e.tryMove({ from: 'd2', to: 'd4' });
    e.tryMove({ from: 'e8', to: 'd8' });          // black king waiting move
    e.tryMove({ from: 'd4', to: 'd5' });
    const slot = e.slots.get(slotId('w', 'd2'))!;
    // No captures or check on the crossing move; the +1 is the crossing.
    assert.equal(slot.xp, 1, 'pawn earned +1 XP for crossing the midline');
  });

  it('awards +1 XP when a black pawn first lands on rank 4', () => {
    const e = new ChessRpgEngine();
    e.tryMove({ from: 'e1', to: 'd1' });          // white king waiting move
    e.tryMove({ from: 'd7', to: 'd5' });
    e.tryMove({ from: 'd1', to: 'e1' });
    e.tryMove({ from: 'd5', to: 'd4' });
    const slot = e.slots.get(slotId('b', 'd7'))!;
    assert.equal(slot.xp, 1, 'black pawn earned +1 XP for crossing the midline');
  });

  it('does not re-trigger when a pawn moves again past the midline', () => {
    const e = new ChessRpgEngine();
    e.tryMove({ from: 'd2', to: 'd4' });
    e.tryMove({ from: 'e8', to: 'd8' });
    e.tryMove({ from: 'd4', to: 'd5' });          // crossing → +1
    e.tryMove({ from: 'd8', to: 'e8' });
    e.tryMove({ from: 'd5', to: 'd6' });          // already across → no XP
    const slot = e.slots.get(slotId('w', 'd2'))!;
    assert.equal(slot.xp, 1, 'no second XP award past the midline');
  });

  it('does not trigger on promotion (XP would have been reset anyway)', () => {
    const e = new ChessRpgEngine();
    // White pawn on b7 (b2 slot) promotes to queen on b8.
    e.chess.load('k7/1P6/8/8/8/8/8/4K3 w - - 0 1');
    e.pieceToSlot.clear();
    e.pieceToSlot.set('b7', slotId('w', 'b2'));
    e.pieceToSlot.set('a8', slotId('b', 'e8'));
    const slot = e.slots.get(slotId('w', 'b2'))!;
    slot.onBoard = true; slot.square = 'b7'; slot.currentType = 'p';
    e.tryMove({ from: 'b7', to: 'b8', promotion: 'q' });
    assert.equal(slot.xp, 0, 'promotion zeroed XP — no crossing bonus retained');
  });
});

describe('chess-rpg: tryBuild validation', () => {
  it("rejects when slot color is not the current player's", () => {
    const e = new ChessRpgEngine();
    const r = e.tryBuild(slotId('b', 'b8'));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not your turn');
  });

  it('rejects when player lacks material', () => {
    const e = new ChessRpgEngine();
    const r = e.tryBuild(slotId('w', 'b1')); // knight cost 3, w starts with 1
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'insufficient material');
  });

  it('accepts when player has enough material and home is empty', () => {
    const e = new ChessRpgEngine();
    e.material.w = 3;
    const r = e.tryBuild(slotId('w', 'b1'));
    assert.equal(r.ok, true);
    assert.equal(e.material.w, 0);
    assert.equal(e.chess.get('b1')?.type, 'n');
  });

  it('sets lockedSquare and bans moving the just-built piece this turn', () => {
    const e = new ChessRpgEngine();
    e.material.w = 3;
    e.tryBuild(slotId('w', 'b1'));
    assert.equal(e.lockedSquare, 'b1');
    const blocked = e.tryMove({ from: 'b1', to: 'c3' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'just-built piece cannot move this turn');
  });

  it('rejects a second build on the same turn', () => {
    const e = new ChessRpgEngine();
    e.material.w = 100;
    assert.equal(e.tryBuild(slotId('w', 'b1')).ok, true);
    const r2 = e.tryBuild(slotId('w', 'g1'));
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'already acted this turn');
  });

  it('rejects building when the home square is occupied', () => {
    const e = new ChessRpgEngine();
    // Hand-craft a position with a queen on c1 (the c1 bishop slot's home).
    e.chess.load('4k3/4p3/8/8/8/8/4P3/2Q1K3 w - - 0 1');
    e.material.w = 100;
    const blocked = e.tryBuild(slotId('w', 'c1'));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'home square occupied');
  });

  it('clears actionThisTurn and lockedSquare on turn switch', () => {

    const e = new ChessRpgEngine();
    e.material.w = 3;
    e.tryBuild(slotId('w', 'b1'));
    // White still must move; the e-pawn is an easy non-locked source.
    assert.equal(e.tryMove({ from: 'e2', to: 'e3' }).ok, true);
    assert.equal(e.lockedSquare, null);
    assert.equal(e.actionThisTurn.w, false);
    assert.equal(e.actionThisTurn.b, false);
  });
});

describe('chess-rpg: capture returns slot to pool', () => {
  it("returns a captured piece to its owner's off-board pool", () => {
    const e = new ChessRpgEngine();
    // Hand-place a white knight (the b1 slot) on d5; a black pawn on c6
    // captures it diagonally. Direct FEN avoids a long opening script.
    e.chess.load('4k3/4p3/2p5/3N4/8/8/4P3/4K3 b - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'b1'));
    const slot = e.slots.get(slotId('w', 'b1'))!;
    slot.onBoard = true;
    slot.square = 'd5';
    slot.currentType = 'n';

    const cap = e.tryMove({ from: 'c6', to: 'd5' });
    assert.equal(cap.ok, true);
    assert.equal(slot.onBoard, false, 'captured knight returned to off-board');
    assert.equal(slot.currentType, 'n');
  });

  it('returns a promoted-then-captured pawn as a pawn to its pawn home', () => {
    const e = new ChessRpgEngine();
    // White pawn one step from promoting; black king right next to b8.
    e.chess.load('k7/1P6/8/8/8/8/8/4K3 w - - 0 1');
    e.pieceToSlot.clear();
    e.pieceToSlot.set('b7', slotId('w', 'b2'));
    const bPawn = e.slots.get(slotId('w', 'b2'))!;
    bPawn.square = 'b7';
    bPawn.onBoard = true;
    bPawn.currentType = 'p';

    const promo = e.tryMove({ from: 'b7', to: 'b8', promotion: 'q' });
    assert.equal(promo.ok, true);
    assert.equal(bPawn.currentType, 'q', 'slot now carries the queen on the board');

    const cap = e.tryMove({ from: 'a8', to: 'b8' });
    assert.equal(cap.ok, true);
    assert.equal(bPawn.onBoard, false, 'pawn slot returned to off-board');
    assert.equal(bPawn.currentType, 'p', 'returned as pawn, not queen');
    assert.equal(bPawn.homeType, 'p');
  });
});

describe('chess-rpg: capture enables rebuild', () => {
  it('a captured slot becomes buildable for its owner once they have the material', () => {
    const e = new ChessRpgEngine();
    // White d2-pawn-slot is hand-placed at d5, black e7-pawn-slot at e6.
    // The black pawn captures the white pawn; the d2 slot returns to the
    // off-board pool. White then has the material + empty home to rebuild it.
    e.chess.load('4k3/8/4p3/3P4/8/8/4P3/4K3 b - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'd2'));
    e.pieceToSlot.set('e6', slotId('b', 'e7'));
    const dPawn = e.slots.get(slotId('w', 'd2'))!;
    dPawn.onBoard = true; dPawn.square = 'd5';
    const blackE = e.slots.get(slotId('b', 'e7'))!;
    blackE.square = 'e6';

    assert.equal(e.tryMove({ from: 'e6', to: 'd5' }).ok, true);
    assert.equal(dPawn.onBoard, false, 'd2 slot returned to off-board');
    // The slot has now been captured once — rebuild cost has doubled to 2.
    e.material.w = 1;
    const tooPoor = e.tryBuild(slotId('w', 'd2'));
    assert.equal(tooPoor.ok, false, 'one material no longer enough after a capture');
    e.material.w = 2;
    const built = e.tryBuild(slotId('w', 'd2'));
    assert.equal(built.ok, true);
    assert.equal(e.material.w, 0, 'rebuild consumed the doubled cost');
    assert.equal(e.chess.get('d2')?.type, 'p');
    assert.equal(dPawn.onBoard, true);
  });
});

describe('chess-rpg: rebuild cost doubles per capture', () => {
  it('an uncaptured slot still costs its base price', () => {
    const e = new ChessRpgEngine();
    const knightSlot = e.publicState().offBoard.w.find((s) => s.homeType === 'n')!;
    assert.equal(knightSlot.cost, 3);
  });

  it('once-captured slot now costs 2× its base', () => {
    const e = new ChessRpgEngine();
    // Hand-place the b1 knight slot on the board and have a black pawn take it.
    e.chess.load('4k3/4p3/2p5/3N4/8/8/4P3/4K3 b - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'b1'));
    const slot = e.slots.get(slotId('w', 'b1'))!;
    slot.onBoard = true; slot.square = 'd5'; slot.currentType = 'n';
    assert.equal(e.tryMove({ from: 'c6', to: 'd5' }).ok, true);
    assert.equal(slot.captures, 1);
    const desc = e.publicState().offBoard.w.find((s) => s.slotId === slotId('w', 'b1'))!;
    assert.equal(desc.cost, 6, 'knight (base 3) now costs 6 after one capture');
  });

  it('twice-captured slot costs 4× its base', () => {
    const e = new ChessRpgEngine();
    const slot = e.slots.get(slotId('w', 'b1'))!;
    slot.captures = 2;
    const desc = e.publicState().offBoard.w.find((s) => s.slotId === slotId('w', 'b1'))!;
    assert.equal(desc.cost, 12);
  });

  it('tryBuild rejects below the doubled cost and accepts at it', () => {
    const e = new ChessRpgEngine();
    const slot = e.slots.get(slotId('w', 'b1'))!;
    slot.captures = 1; // doubled: knight now needs 6
    e.material.w = 5;
    const poor = e.tryBuild(slotId('w', 'b1'));
    assert.equal(poor.ok, false);
    assert.equal(poor.reason, 'insufficient material');
    e.material.w = 6;
    const rich = e.tryBuild(slotId('w', 'b1'));
    assert.equal(rich.ok, true);
    assert.equal(e.material.w, 0);
  });

  it('rebuild + recapture stacks the doubling (1 → 2 → 4)', () => {
    const e = new ChessRpgEngine();
    // Pawn captured, then rebuilt, then captured again should leave the slot at captures=2.
    e.chess.load('4k3/4p3/2p5/3P4/8/8/4P3/4K3 b - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'd2'));
    const slot = e.slots.get(slotId('w', 'd2'))!;
    slot.onBoard = true; slot.square = 'd5'; slot.currentType = 'p';
    assert.equal(e.tryMove({ from: 'c6', to: 'd5' }).ok, true);
    assert.equal(slot.captures, 1);
    // Rebuild on d2 (now costs 2). White has 0 — top up.
    e.material.w = 2;
    assert.equal(e.tryBuild(slotId('w', 'd2')).ok, true);
    // Move something so it becomes black's turn, then arrange a recapture.
    assert.equal(e.tryMove({ from: 'e1', to: 'd1' }).ok, true);
    // Black has a c-pawn on c6 (from the load FEN) — push it to threaten,
    // simpler to hand-place a black knight that takes the rebuilt d2 pawn.
    e.chess.put({ type: 'n', color: 'b' }, 'b3');
    e.pieceToSlot.set('b3', slotId('b', 'b8'));
    const bN = e.slots.get(slotId('b', 'b8'))!;
    bN.onBoard = true; bN.square = 'b3'; bN.currentType = 'n';
    // Quick black waiting move was already played; need it to be black's turn.
    // The d1→d1 above was white's move so it's now black's turn.
    assert.equal(e.tryMove({ from: 'b3', to: 'd2' }).ok, true);
    assert.equal(slot.captures, 2, 'second capture stacks captures count');
    const desc = e.publicState().offBoard.w.find((s) => s.slotId === slotId('w', 'd2'))!;
    assert.equal(desc.cost, 4, 'pawn (base 1) now costs 4 after two captures');
  });
});

describe('chess-rpg: status detection', () => {
  it('still detects checkmate via standard chess.js rules', () => {
    const e = new ChessRpgEngine();
    e.chess.load('6rk/5Npp/8/8/8/8/8/4K3 b - - 0 1');
    const s = e.status();
    assert.equal(s.over, true);
    assert.equal(s.reason, 'checkmate');
  });
});

describe('chess-rpg: clone independence', () => {
  it('clone state mutations do not affect the original', () => {
    const e = new ChessRpgEngine();
    e.material.w = 3;
    const c = e.clone();
    c.tryBuild(slotId('w', 'b1'));
    assert.equal(e.material.w, 3, 'original unchanged');
    assert.equal(c.material.w, 0, 'clone spent material');
    assert.equal(e.chess.get('b1'), undefined);
    assert.equal(c.chess.get('b1')?.type, 'n');
  });
});

describe('chess-rpg: offBoard descriptors', () => {
  it('marks affordable, empty-home slots as enabled for the side to move', () => {
    const e = new ChessRpgEngine();
    e.material.w = 3; // knight/bishop affordable, but not rook/queen
    const desc = e.publicState().offBoard;
    const wKnight = desc.w.find((s) => s.homeType === 'n')!;
    const wRook = desc.w.find((s) => s.homeType === 'r')!;
    assert.equal(wKnight.enabled, true);
    assert.equal(wRook.enabled, false, 'rook (cost 5) not affordable at 3 mat');
    // Black is not to-move, so even affordable slots show disabled.
    assert.ok(desc.b.every((s) => !s.enabled));
  });

  it("d/e/f pawn slots in front of the king start on-board rather than buildable", () => {
    const e = new ChessRpgEngine();
    const state = e.publicState();
    for (const home of ['d2', 'e2', 'f2']) {
      assert.ok(!state.offBoard.w.some((s) => s.home === home), `${home} should be on-board`);
    }
    for (const home of ['d7', 'e7', 'f7']) {
      assert.ok(!state.offBoard.b.some((s) => s.home === home));
    }
  });
});

describe('chess-rpg: XP awards', () => {
  it('awards ceil(captured-cost / 2) XP to the capturing piece', () => {
    const e = new ChessRpgEngine();
    // Hand-place a white knight (b1 slot) on d5 and a black queen (d8 slot)
    // on e7 so the knight can capture the queen.
    e.chess.load('4k3/4q3/8/3N4/8/8/4P3/4K3 w - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'b1'));
    e.pieceToSlot.set('e7', slotId('b', 'd8'));
    const wKnight = e.slots.get(slotId('w', 'b1'))!;
    wKnight.onBoard = true; wKnight.square = 'd5'; wKnight.currentType = 'n';
    const bQueen = e.slots.get(slotId('b', 'd8'))!;
    bQueen.onBoard = true; bQueen.square = 'e7'; bQueen.currentType = 'q';

    const cap = e.tryMove({ from: 'd5', to: 'e7' });
    assert.equal(cap.ok, true);
    // captureXp(q) = ceil(9/2) = 5
    assert.equal(wKnight.xp, 5);
  });

  it('awards +1 XP to the moving piece when the move delivers check', () => {
    const e = new ChessRpgEngine();
    // White rook on h1 (rook slot a1, hand-placed elsewhere) moves to h8 to
    // check the black king on e8 — wait, h8 doesn't check e8. Use a queen.
    e.chess.load('4k3/8/8/8/8/8/4P3/Q3K3 w - - 0 1');
    e.pieceToSlot.set('a1', slotId('w', 'a1'));
    const slot = e.slots.get(slotId('w', 'a1'))!;
    slot.onBoard = true; slot.square = 'a1'; slot.currentType = 'q';

    const r = e.tryMove({ from: 'a1', to: 'e5' }); // queen to e5, attacks e8
    assert.equal(r.ok, true);
    assert.equal(slot.xp, 1, 'check awarded +1 XP');
  });

  it('combines capture and check XP on the same move', () => {
    const e = new ChessRpgEngine();
    // White queen on a8 (hand-placed) captures black pawn on e7 — the move
    // is from a8 to e8? Let's pick a clearer geometry. Use: white queen on
    // h5 takes a knight on f7 and checks the e8 king on the same move.
    e.chess.load('4k3/5n2/8/7Q/8/8/4P3/4K3 w - - 0 1');
    e.pieceToSlot.set('h5', slotId('w', 'd1'));
    e.pieceToSlot.set('f7', slotId('b', 'b8'));
    const wQueen = e.slots.get(slotId('w', 'd1'))!;
    wQueen.onBoard = true; wQueen.square = 'h5'; wQueen.currentType = 'q';
    const bKnight = e.slots.get(slotId('b', 'b8'))!;
    bKnight.onBoard = true; bKnight.square = 'f7'; bKnight.currentType = 'n';

    const r = e.tryMove({ from: 'h5', to: 'f7' });
    assert.equal(r.ok, true);
    // captureXp(n) = ceil(3/2) = 2, plus +1 for check = 3
    assert.equal(wQueen.xp, 3);
  });

  it('promotion resets the moving slot XP to 0', () => {
    const e = new ChessRpgEngine();
    // White pawn on b7 (b2 slot) promotes to queen.
    e.chess.load('k7/1P6/8/8/8/8/8/4K3 w - - 0 1');
    e.pieceToSlot.clear();
    e.pieceToSlot.set('b7', slotId('w', 'b2'));
    e.pieceToSlot.set('a8', slotId('b', 'e8')); // king, doesn't really matter
    const pawn = e.slots.get(slotId('w', 'b2'))!;
    pawn.onBoard = true; pawn.square = 'b7'; pawn.currentType = 'p'; pawn.xp = 4;

    const r = e.tryMove({ from: 'b7', to: 'b8', promotion: 'q' });
    assert.equal(r.ok, true);
    assert.equal(pawn.currentType, 'q');
    assert.equal(pawn.xp, 0, 'XP reset on promotion');
  });

  it('resets a captured slot XP to 0 (and currentType to homeType)', () => {
    const e = new ChessRpgEngine();
    // Black queen on a5 takes white knight on d5 (horizontal capture).
    e.chess.load('4k3/8/8/q2N4/8/8/4P3/4K3 b - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'b1'));
    e.pieceToSlot.set('a5', slotId('b', 'd8'));
    const wKnight = e.slots.get(slotId('w', 'b1'))!;
    wKnight.onBoard = true; wKnight.square = 'd5'; wKnight.currentType = 'n'; wKnight.xp = 7;
    const bQueen = e.slots.get(slotId('b', 'd8'))!;
    bQueen.onBoard = true; bQueen.square = 'a5'; bQueen.currentType = 'q';

    const cap = e.tryMove({ from: 'a5', to: 'd5' });
    assert.equal(cap.ok, true);
    assert.equal(wKnight.onBoard, false);
    assert.equal(wKnight.xp, 0, 'captured slot XP reset');
    assert.equal(wKnight.currentType, 'n', 'returned to homeType (knight)');
  });
});

describe('chess-rpg: upgrade action', () => {
  it('lets a pawn with enough XP become a knight or bishop', () => {
    const e = new ChessRpgEngine();
    const pawn = e.slots.get(slotId('w', 'e2'))!;
    pawn.xp = 3;
    const r = e.tryUpgrade(slotId('w', 'e2'), 'n');
    assert.equal(r.ok, true);
    assert.equal(e.chess.get('e2')?.type, 'n');
    assert.equal(pawn.currentType, 'n');
    assert.equal(pawn.xp, 0, 'XP cost subtracted');
    assert.equal(e.lockedSquare, 'e2');
  });

  it('rejects an upgrade to equal-cost type (knight to bishop)', () => {
    const e = new ChessRpgEngine();
    // Hand-place a white knight on the board, set XP high.
    e.chess.load('4k3/8/8/3N4/8/8/4P3/4K3 w - - 0 1');
    e.pieceToSlot.set('d5', slotId('w', 'b1'));
    const knight = e.slots.get(slotId('w', 'b1'))!;
    knight.onBoard = true; knight.square = 'd5'; knight.currentType = 'n'; knight.xp = 99;
    const r = e.tryUpgrade(slotId('w', 'b1'), 'b');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'upgrade not allowed');
  });

  it('rejects an upgrade with insufficient XP', () => {
    const e = new ChessRpgEngine();
    const pawn = e.slots.get(slotId('w', 'e2'))!;
    pawn.xp = 2; // needs 3 for knight
    const r = e.tryUpgrade(slotId('w', 'e2'), 'n');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'insufficient experience');
  });

  it('rejects upgrading the king', () => {
    const e = new ChessRpgEngine();
    const king = e.slots.get(slotId('w', 'e1'))!;
    king.xp = 99;
    const r = e.tryUpgrade(slotId('w', 'e1'), 'q');
    assert.equal(r.ok, false);
  });

  it('rejects upgrade after a build this turn (one action per turn)', () => {
    const e = new ChessRpgEngine();
    e.material.w = 3;
    const pawn = e.slots.get(slotId('w', 'e2'))!;
    pawn.xp = 3;
    assert.equal(e.tryBuild(slotId('w', 'b1')).ok, true);
    const r = e.tryUpgrade(slotId('w', 'e2'), 'n');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'already acted this turn');
  });

  it('locks the upgraded square against moves this turn', () => {
    const e = new ChessRpgEngine();
    const pawn = e.slots.get(slotId('w', 'e2'))!;
    pawn.xp = 3;
    assert.equal(e.tryUpgrade(slotId('w', 'e2'), 'n').ok, true);
    // Try to move the new knight; should be blocked.
    const m = e.tryMove({ from: 'e2', to: 'd4' });
    assert.equal(m.ok, false);
    assert.equal(m.reason, 'just-built piece cannot move this turn');
  });

  it('an upgraded-then-captured piece returns to the pool as its original type', () => {
    const e = new ChessRpgEngine();
    // Upgrade white e2 pawn → knight (XP 3, cost 3).
    const eSlot = e.slots.get(slotId('w', 'e2'))!;
    eSlot.xp = 3;
    assert.equal(e.tryUpgrade(slotId('w', 'e2'), 'n').ok, true);
    assert.equal(eSlot.currentType, 'n');
    // White still must move; push e-file is illegal (knight is locked there).
    // Use the king to complete the turn.
    assert.equal(e.tryMove({ from: 'e1', to: 'd1' }).ok, true);
    // Black hand-placed queen captures the knight on e2.
    e.chess.put({ type: 'q', color: 'b' }, 'e3');
    e.pieceToSlot.set('e3', slotId('b', 'd8'));
    const bQueen = e.slots.get(slotId('b', 'd8'))!;
    bQueen.onBoard = true; bQueen.square = 'e3'; bQueen.currentType = 'q';

    const cap = e.tryMove({ from: 'e3', to: 'e2' });
    assert.equal(cap.ok, true);
    assert.equal(eSlot.onBoard, false, 'e2 slot returned to off-board');
    assert.equal(eSlot.currentType, 'p', 'returns as the original pawn, not as a knight');
    assert.equal(eSlot.homeType, 'p');
    // And it shows up in the off-board pool as a pawn.
    const desc = e.publicState().offBoard.w.find((s) => s.slotId === slotId('w', 'e2'));
    assert.ok(desc);
    assert.equal(desc.homeType, 'p');
  });

  it('exposes per-square piece info with XP and affordable upgrades', () => {
    const e = new ChessRpgEngine();
    const pawn = e.slots.get(slotId('w', 'e2'))!;
    pawn.xp = 5;
    const info = e.publicState().pieces['e2'];
    assert.ok(info);
    assert.equal(info.xp, 5);
    assert.equal(info.currentType, 'p');
    // Knight + bishop cost 3 each — affordable; rook (5) just affordable;
    // queen (9) not.
    const upgrades = Object.fromEntries(info.upgrades.map((u) => [u.type, u]));
    assert.equal(upgrades.n.affordable, true);
    assert.equal(upgrades.b.affordable, true);
    assert.equal(upgrades.r.affordable, true);
    assert.equal(upgrades.q.affordable, false);
  });
});

describe('chess-rpg: cost lookup', () => {
  it('matches expected piece costs', () => {
    assert.equal(PIECE_COST.p, 1);
    assert.equal(PIECE_COST.n, 3);
    assert.equal(PIECE_COST.b, 3);
    assert.equal(PIECE_COST.r, 5);
    assert.equal(PIECE_COST.q, 9);
  });
});

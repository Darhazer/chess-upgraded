import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { RulesEngine } from '../src/rules-engine.js';
import { listVariantActions } from '../src/engine/index.js';
import { chooseAction } from '../src/bot.js';
import { searchPool } from '../src/engine/search-pool.js';
import Board from '../src/engine/vendor/board.js';
import { buildConfig } from '../src/engine/variant.js';

// Force a position, mirroring the helper in rules-engine.test.js.
function setup({ fen, upgraded = [] } = {}) {
  const e = new RulesEngine();
  if (fen) e.chess.load(fen);
  e.upgraded = new Set(upgraded);
  return e;
}

// Normalize an action to a comparable token. The bot only ever auto-queens,
// so the referee's under-promotions (n/b/r) collapse to the same (from,to)
// token as its queen-promotion. The move-vs-custom kind is plumbing and
// doesn't change (from,to) either.
function token(a) {
  return `${a.from}${a.to}`;
}
function actionSet(actions) {
  return new Set(actions.map(token));
}

// The engine must see exactly the moves the authoritative referee allows — if
// it ever proposes more, the bot can stall (the referee rejects it); if fewer,
// the bot just plays worse. Compare as sets across a battery of positions,
// and as a stronger check, apply every engine-proposed action against a clone
// of the referee — divergence in *executable* shape (e.g. a missing promotion
// field) doesn't always show up as a missing token.
function assertParity(label, engine) {
  const refActions = engine.listActions();
  const forkActions = listVariantActions(engine.publicState());
  const ref = actionSet(refActions);
  const fork = actionSet(forkActions);
  const missing = [...ref].filter((t) => !fork.has(t)).sort();
  const extra = [...fork].filter((t) => !ref.has(t)).sort();
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${label}: engine action set diverges from RulesEngine`,
  );
  for (const a of forkActions) {
    assert.equal(
      engine.clone().applyAction(a).ok, true,
      `${label}: engine action ${JSON.stringify(a)} rejected by referee`,
    );
  }
}

describe('engine ↔ RulesEngine action parity', () => {
  const cases = [
    ['initial position', { fen: new RulesEngine().fen() }],
    ['midgame, no upgrades', { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4' }],
    ['black to move', { fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2' }],
    ['castling available', { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' }],
    ['castling blocked by an attacked path', { fen: 'r3k2r/8/8/8/8/5n2/8/R3K2R w KQkq - 0 1' }],
    ['en passant available', { fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1' }],
    ['promotion (incl. under-promotions for the referee)', { fen: '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1' }],
    ['upgraded rook — gains a 1-step diagonal', { fen: '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded rook, diagonal target blocked', { fen: '8/8/8/8/3R4/3P4/8/k6K w - - 0 1', upgraded: ['d4'] }],
    ['upgraded bishop — gains a 1-step orthogonal', { fen: '4k3/8/8/8/3B4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded knight — gains a 1-step orthogonal', { fen: '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded knight near a corner', { fen: '4k3/8/8/8/8/8/8/N3K3 w - - 0 1', upgraded: ['a1'] }],
    ['upgraded queen — gains the knight L-jump', { fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded queen with a knight-square blocked by an own pawn', { fen: '4k3/8/8/8/3Q4/4P3/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded king, free-standing', { fen: '4k3/8/8/8/4K3/8/8/8 w - - 0 1', upgraded: ['e4'] }],
    ['upgraded king on its home square, teleport over a piece, no rooks', { fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', upgraded: ['e1'] }],
    ['upgraded king on home square with castling rights + rooks', { fen: '4k3/8/8/8/8/8/4P3/R3K2R w KQ - 0 1', upgraded: ['e1'] }],
    ['upgraded king, castling rights but rooks gone', { fen: '4k3/8/8/8/8/8/8/4K3 w KQ - 0 1', upgraded: ['e1'] }],
    ['upgraded pawn — standard moves + sideways/backward bonus', { fen: '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded pawn with the backward square blocked by an own piece', { fen: '4k3/8/8/8/3P4/3R4/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded pawn about to promote', { fen: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1', upgraded: ['e7'] }],
    ['upgraded pawn next to an enemy: sideways move blocked, diagonal capture available', { fen: '4k3/8/8/8/3Pp3/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded black pawn', { fen: '4k3/8/8/8/4p3/8/8/4K3 b - - 0 1', upgraded: ['e4'] }],
    ['upgraded enemy pawn gives check on the diagonal', { fen: '4k3/8/8/8/8/4p3/3K4/8 w - - 0 1', upgraded: ['e3'] }],
    ['king beside an upgraded enemy pawn — diagonal squares off-limits', { fen: '4k3/8/8/8/8/3p4/8/4K3 w - - 0 1', upgraded: ['d3'] }],
    ['midgame with two upgraded pieces', { fen: 'r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b kq - 0 6', upgraded: ['c5', 'f6'] }],
    ['stalemate', { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }],
    ['checkmate', { fen: 'Q6k/6pp/8/8/8/8/8/7K b - - 0 1' }],
  ];
  for (const [label, state] of cases) {
    it(label, () => assertParity(label, setup(state)));
  }

  it('holds at every ply of a short game including an auto-upgrade via capture', () => {
    const e = new RulesEngine();
    const steps = [
      () => e.tryMove('e4'),
      () => e.tryMove('d5'),
      () => e.tryMove({ from: 'e4', to: 'd5' }), // white pawn captures -> upgraded
      () => e.tryMove('Nf6'),
      () => e.tryMove({ from: 'd5', to: 'e5' }), // upgraded pawn sideways step
      () => e.tryMove('Nc6'),
    ];
    for (let i = 0; i < steps.length; i++) {
      const r = steps[i]();
      assert.equal(r.ok, true, `step ${i} should succeed: ${r.reason}`);
      assertParity(`after step ${i}`, e);
    }
  });
});

// After applying a move on both the referee and the bot's internal board, the
// two upgrade-tracking views must agree — otherwise the bot scores positions
// the referee will never produce. The K/Q value-floor rule is the easiest place
// for this to drift (it lives in two separate code paths), so cover it directly.
function refUpgradedAfter(engine, action) {
  const e = engine.clone();
  const r = e.applyAction(action);
  assert.equal(r.ok, true, `referee rejected ${JSON.stringify(action)}: ${r.reason}`);
  return new Set([...e.upgraded]);
}

function botUpgradedAfter(engine, from, to) {
  const cfg = buildConfig(engine.publicState());
  const board = new Board(cfg);
  board.move(from.toUpperCase(), to.toUpperCase());
  return new Set(Object.keys(board.configuration.upgraded).map((s) => s.toLowerCase()));
}

describe('engine ↔ RulesEngine upgrade-state parity (post-move)', () => {
  const cases = [
    ['queen captures unupgraded pawn (no upgrade earned)',
      { fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1' }, 'd1', 'd7'],
    ['queen captures upgraded pawn (upgrade earned)',
      { fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1', upgraded: ['d7'] }, 'd1', 'd7'],
    ['queen captures knight (non-pawn capture upgrades)',
      { fen: '4k3/3n4/8/8/8/8/8/3QK3 w - - 0 1' }, 'd1', 'd7'],
    ['king captures unupgraded pawn (no upgrade)',
      { fen: '4k3/8/8/3p4/3K4/8/8/8 w - - 0 1' }, 'd4', 'd5'],
    ['king captures upgraded pawn (upgrade earned)',
      { fen: '4k3/8/8/3p4/3K4/8/8/8 w - - 0 1', upgraded: ['d5'] }, 'd4', 'd5'],
    ['already-upgraded queen captures unupgraded pawn (existing marker preserved, not stripped)',
      { fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1', upgraded: ['d1'] }, 'd1', 'd7'],
    ['knight captures unupgraded pawn (rule applies only to K/Q)',
      { fen: '4k3/8/8/8/3p4/5N2/8/4K3 w - - 0 1' }, 'f3', 'd4'],
  ];
  for (const [label, state, from, to] of cases) {
    it(label, () => {
      const e = setup(state);
      assert.deepEqual(
        botUpgradedAfter(e, from, to),
        refUpgradedAfter(e, { kind: 'move', from, to }),
        `${label}: bot and referee disagree on upgraded set after the move`,
      );
    });
  }
});

describe('chooseAction (bot adapter)', () => {
  // chooseAction runs the search in a worker pool; shut it down when done so
  // the test process doesn't linger on the (unref'd) workers.
  after(() => searchPool.destroy());

  it('returns an action the referee accepts, for a range of positions', async () => {
    const fens = [
      new RulesEngine().fen(),
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4',
      '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1',
    ];
    for (const fen of fens) {
      const e = new RulesEngine();
      e.chess.load(fen);
      const a = await chooseAction(e, { botColor: e.turn() });
      assert.ok(a, `should produce an action for ${fen}`);
      assert.equal(e.clone().applyAction(a).ok, true, `referee must accept ${JSON.stringify(a)} for ${fen}`);
    }
  });

  it('finds a mate in one', async () => {
    const e = new RulesEngine();
    e.chess.load('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'); // Ra8#
    const a = await chooseAction(e, { botColor: 'w' });
    assert.equal(e.applyAction(a).ok, true);
    assert.equal(e.status().reason, 'checkmate', `expected mate, chose ${JSON.stringify(a)}`);
  });

  it('returns null when it is not the bot’s turn or the game is over', async () => {
    const e = new RulesEngine();
    assert.equal(await chooseAction(e, { botColor: 'b' }), null); // white to move
    e.setOver({ result: 'draw', reason: 'agreement' });
    assert.equal(await chooseAction(e, { botColor: 'w' }), null);
  });
});

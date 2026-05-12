import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { RulesEngine } from '../src/rules-engine.js';
import { listVariantActions } from '../src/engine/index.js';
import { chooseAction } from '../src/bot.js';
import { searchPool } from '../src/engine/search-pool.js';

// Force a position, mirroring the helper in rules-engine.test.js.
function setup({ fen, upgraded = [], bar = { w: 0, b: 0 }, barMax = 3 } = {}) {
  const e = new RulesEngine({ barMax });
  if (fen) e.chess.load(fen);
  e.upgraded = new Set(upgraded);
  e.bar = { ...bar };
  return e;
}

// Normalize an action to a comparable token. The bot only ever auto-queens, so
// promotion-piece differences are ignored; the move-vs-custom kind is plumbing
// and doesn't change the (from,to), so it's ignored too.
function token(a) {
  return a.kind === 'upgrade' ? `@${a.square}` : `${a.from}${a.to}`;
}
function actionSet(actions) {
  return new Set(actions.map(token));
}

// The engine must see exactly the moves the authoritative referee allows — if
// it ever proposes more, the bot can stall (the referee rejects it); if fewer,
// the bot just plays worse. Compare as sets across a battery of positions.
function assertParity(label, engine) {
  const ref = actionSet(engine.listActions());
  const fork = actionSet(listVariantActions(engine.publicState()));
  const missing = [...ref].filter((t) => !fork.has(t)).sort();
  const extra = [...fork].filter((t) => !ref.has(t)).sort();
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${label}: engine action set diverges from RulesEngine`,
  );
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
    ['upgraded knight — gains the (2,2) jump', { fen: '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded knight near a corner', { fen: '4k3/8/8/8/8/8/8/N3K3 w - - 0 1', upgraded: ['a1'] }],
    ['upgraded queen — gains the 2-square teleport', { fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', upgraded: ['d4'] }],
    ['upgraded king, free-standing', { fen: '4k3/8/8/8/4K3/8/8/8 w - - 0 1', upgraded: ['e4'] }],
    ['upgraded king on its home square, teleport over a piece, no rooks', { fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', upgraded: ['e1'] }],
    ['upgraded king on home square with castling rights + rooks', { fen: '4k3/8/8/8/8/8/4P3/R3K2R w KQ - 0 1', upgraded: ['e1'] }],
    ['upgraded king, castling rights but rooks gone', { fen: '4k3/8/8/8/8/8/8/4K3 w KQ - 0 1', upgraded: ['e1'] }],
    ['upgraded pawn — diagonal step (move) + forward capture', { fen: '4k3/8/3P1n2/4P3/8/8/8/4K3 w - - 0 1', upgraded: ['e5'] }],
    ['upgraded pawn about to promote via a forward capture', { fen: 'k3r3/4P3/8/8/8/8/8/4K3 w - - 0 1', upgraded: ['e7'] }],
    ['upgraded pawn with forward + diagonals partly blocked', { fen: '4k3/8/8/3PnP2/4P3/8/8/4K3 w - - 0 1', upgraded: ['e4'] }],
    ['upgraded black pawn captures forward', { fen: '4k3/8/8/8/4p3/4P3/8/4K3 b - - 0 1', upgraded: ['e4'] }],
    ['bar full, not in check — upgrade picks available', { fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', bar: { w: 3, b: 3 } }],
    ['bar full, but in check — no upgrade picks', { fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', bar: { w: 3, b: 3 } }],
    ['upgraded enemy pawn gives check (straight ahead)', { fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1', upgraded: ['e2'] }],
    ['king beside an upgraded enemy pawn — diagonal squares still off-limits (chess.js quirk the referee inherits)', { fen: '4k3/8/8/8/8/3p4/8/4K3 w - - 0 1', upgraded: ['d3'] }],
    ['midgame with two upgraded pieces', { fen: 'r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b kq - 0 6', upgraded: ['c5', 'f6'] }],
    ['stalemate', { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }],
    ['checkmate', { fen: 'Q6k/6pp/8/8/8/8/8/7K b - - 0 1' }],
  ];
  for (const [label, state] of cases) {
    it(label, () => assertParity(label, setup(state)));
  }

  it('holds at every ply of a short game including an upgrade', () => {
    const e = new RulesEngine({ barMax: 1 });
    const steps = [
      () => e.tryMove('e4'),
      () => e.tryMove('e5'),
      () => e.tryUpgrade('e4'), // white spends its full (barMax 1) bar
      () => e.tryMove('Nc6'),
      () => e.tryMove({ from: 'e4', to: 'e5' }), // upgraded pawn captures straight ahead
      () => e.tryMove('Nf6'),
    ];
    for (let i = 0; i < steps.length; i++) {
      const r = steps[i]();
      assert.equal(r.ok, true, `step ${i} should succeed: ${r.reason}`);
      assertParity(`after step ${i}`, e);
    }
  });
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

  it('never spends the turn upgrading while in check', async () => {
    const e = setup({ fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', bar: { w: 3, b: 3 } });
    const a = await chooseAction(e, { botColor: 'w' });
    assert.ok(a);
    assert.notEqual(a.kind, 'upgrade');
    assert.equal(e.clone().applyAction(a).ok, true);
  });

  it('returns null when it is not the bot’s turn or the game is over', async () => {
    const e = new RulesEngine();
    assert.equal(await chooseAction(e, { botColor: 'b' }), null); // white to move
    e.setOver({ result: 'draw', reason: 'agreement' });
    assert.equal(await chooseAction(e, { botColor: 'w' }), null);
  });
});

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { CannibalEngine } from '../src/cannibal-engine.js';
import CannibalBoard from '../src/engine/cannibal-board.js';
import { getJSONfromFEN } from '../src/engine/vendor/utils.js';
import { listVariantActions } from '../src/engine/index.js';
import { chooseAction } from '../src/bot.js';
import { searchPool } from '../src/engine/search-pool.js';
import type { KingTypeMap, MovementType } from '../src/engine/vendor/const.js';

interface SetupArgs {
  fen?: string;
  kingType?: Partial<KingTypeMap>;
}

// Force a Cannibal Chess position. `kingType` overrides a king's movement
// (e.g. { white: 'n' } for a king that has cannibalised a knight).
function setup({ fen, kingType }: SetupArgs = {}): CannibalEngine {
  if (!fen) return new CannibalEngine();
  const cfg = getJSONfromFEN(fen) as unknown as {
    pieces: Record<string, string>;
    kingType?: KingTypeMap;
    [k: string]: unknown;
  };
  if (kingType) cfg.kingType = { white: 'k', black: 'k', ...kingType } as KingTypeMap;
  return new CannibalEngine(new CannibalBoard(cfg));
}

const tokens = (actions: Array<{ from: string; to: string }>): Set<string> =>
  new Set(actions.map((a) => `${a.from}${a.to}`));

describe('cannibal: non-king capture-transform', () => {
  it('a rook that captures a knight becomes a knight', () => {
    const e = setup({ fen: 'n3k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
    const r = e.tryMove({ from: 'a1', to: 'a8' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('A8'), 'N', 'rook took the knight\'s identity');
  });

  it('a pawn capturing onto the back rank becomes the captured piece, not a queen', () => {
    const e = setup({ fen: '2n1k3/1P6/8/8/8/8/8/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'b7', to: 'c8' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('C8'), 'N', 'cannibalised the knight (no promotion)');
  });

  it('the transformed piece then moves with its new moveset', () => {
    const e = setup({ fen: 'n3k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
    e.tryMove({ from: 'a1', to: 'a8' }); // rook -> knight on a8
    e.tryMove({ from: 'e8', to: 'd7' }); // black king steps aside
    const fromA8 = e.listActions().filter((a) => a.from === 'a8');
    // Knight on a8 has exactly the two L-jumps b6 and c7.
    assert.deepEqual(tokens(fromA8), new Set(['a8b6', 'a8c7']));
  });
});

describe('cannibal: king capture-transform', () => {
  it('a king that captures keeps its crown but changes movement-type', () => {
    const e = setup({ fen: '4k3/8/8/8/8/8/4n3/4K3 w - - 0 1' });
    const r = e.tryMove({ from: 'e1', to: 'e2' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('E2'), 'K', 'still a king on the board');
    assert.equal(e.board.configuration.kingType!.white, 'n', 'now moves as a knight');
    assert.deepEqual(e.publicState().kingOverrides, { e2: 'n' });
  });

  it('a cannibalised king moves as the piece it became', () => {
    // White king moving as a knight on e1; it is white to move.
    const e = setup({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', kingType: { white: 'n' } });
    const fromE1 = e.listActions().filter((a) => a.from === 'e1');
    assert.deepEqual(tokens(fromE1), new Set(['e1c2', 'e1d3', 'e1f3', 'e1g2']));
  });

  it('a king moving as a knight delivers check', () => {
    // White king-knight on f6 attacks the black king on e8.
    const e = setup({ fen: '4k3/8/5K2/8/8/8/8/8 b - - 0 1', kingType: { white: 'n' } });
    assert.equal((e.status() as { check?: boolean }).check, true);
  });

  it('a royal king-pawn that reaches the last rank gains queen movement', () => {
    const e = setup({ fen: 'k7/4K3/8/8/8/8/8/8 w - - 0 1', kingType: { white: 'p' } });
    const r = e.tryMove({ from: 'e7', to: 'e8' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('E8'), 'K', 'still royal');
    assert.equal(e.board.configuration.kingType!.white, 'q', 'now moves as a queen');
  });

  it('a king-pawn capturing on the last rank cannibalises instead of promoting', () => {
    // White king-pawn on b7 captures the black knight on c8.
    const e = setup({ fen: '2n1k3/1K6/8/8/8/8/8/8 w - - 0 1', kingType: { white: 'p' } });
    const r = e.tryMove({ from: 'b7', to: 'c8' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('C8'), 'K', 'still royal');
    assert.equal(e.board.configuration.kingType!.white, 'n', 'cannibalised the knight, not promoted');
  });
});

describe('cannibal: castling', () => {
  it('a normal king may still castle', () => {
    const e = setup({ fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1' });
    const r = e.tryMove({ from: 'e1', to: 'g1' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('G1'), 'K');
    assert.equal(e.board.getPiece('F1'), 'R', 'the rook castled too');
  });

  it('a cannibalised king cannot castle', () => {
    const e = setup({ fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', kingType: { white: 'n' } });
    const fromE1 = e.listActions().filter((a) => a.from === 'e1');
    assert.ok(!tokens(fromE1).has('e1g1'), 'no castling move offered');
  });

  it('a king moving as a rook slides through the castle square (no rook drag)', () => {
    const e = setup({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', kingType: { white: 'r' } });
    const r = e.tryMove({ from: 'e1', to: 'c1' });
    assert.equal(r.ok, true);
    assert.equal(e.board.getPiece('C1'), 'K', 'king slid to c1');
    assert.equal(e.board.getPiece('A1'), 'R', 'the rook did not move');
  });
});

describe('cannibal: terminal states', () => {
  it('detects checkmate', () => {
    const e = setup({ fen: 'R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1' });
    const s = e.status() as { over: boolean; reason?: string; result?: string };
    assert.equal(s.over, true);
    assert.equal(s.reason, 'checkmate');
    assert.equal(s.result, 'white');
  });

  it('detects stalemate', () => {
    const e = setup({ fen: '7k/8/6Q1/8/8/8/8/K7 b - - 0 1' });
    const s = e.status() as { over: boolean; reason?: string; result?: string };
    assert.equal(s.over, true);
    assert.equal(s.reason, 'stalemate');
    assert.equal(s.result, 'draw');
  });

  it('detects insufficient material (both sides reduced to a lone king)', () => {
    const e = setup({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
    const s = e.status() as { over: boolean; reason?: string };
    assert.equal(s.over, true);
    assert.equal(s.reason, 'insufficient material');
  });

  it('detects threefold repetition', () => {
    const e = new CannibalEngine();
    // Knight shuffle: the start position recurs after moves 4 and 8.
    const shuffle: Array<[string, string]> = [
      ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
      ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ];
    for (const [from, to] of shuffle) {
      assert.equal(e.tryMove({ from, to }).ok, true);
    }
    const s = e.status() as { over: boolean; reason?: string };
    assert.equal(s.over, true);
    assert.equal(s.reason, 'threefold repetition');
  });
});

describe('cannibal: move notation', () => {
  const lastSan = (e: CannibalEngine): string => e.history[e.history.length - 1]!.san;

  it('marks a non-capture promotion with =Q', () => {
    const e = setup({ fen: '8/1P6/4k3/8/8/8/8/4K3 w - - 0 1' });
    e.tryMove({ from: 'b7', to: 'b8' });
    assert.equal(lastSan(e), 'b8=Q');
  });

  it('marks a checking move with +', () => {
    const e = setup({ fen: '6k1/5pp1/8/8/8/8/8/R5K1 w - - 0 1' });
    e.tryMove({ from: 'a1', to: 'a8' });
    assert.equal(lastSan(e), 'Ra8+');
  });

  it('marks a mating move with #', () => {
    const e = setup({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' });
    e.tryMove({ from: 'a1', to: 'a8' });
    assert.equal(lastSan(e), 'Ra8#');
  });
});

describe('cannibal: evaluation', () => {
  // Same material; only the white king's movement-type differs.
  const score = (kingType: Partial<KingTypeMap>): number => {
    const cfg = getJSONfromFEN('4k3/8/8/8/8/8/8/4K3 w - - 0 1') as unknown as {
      pieces: Record<string, string>;
      kingType?: KingTypeMap;
      [k: string]: unknown;
    };
    cfg.kingType = { white: 'k' as MovementType, black: 'k' as MovementType, ...kingType } as KingTypeMap;
    return new CannibalBoard(cfg).calculateScore('white');
  };

  it('values a more capable royal piece higher', () => {
    assert.ok(score({ white: 'q' }) > score({}), 'queen-king beats a normal king');
    assert.ok(score({}) > score({ white: 'p' }), 'normal king beats a pawn-king');
  });
});

describe('cannibal: bot / referee parity', () => {
  after(() => searchPool.destroy());

  it('the bot engine sees exactly the moves the referee allows', () => {
    const e = setup({ fen: '4k3/8/8/8/8/5K2/8/7R w - - 0 1', kingType: { white: 'n' } });
    const ref = tokens(e.listActions());
    const fork = tokens(listVariantActions(e.publicState()));
    assert.deepEqual(fork, ref);
  });

  it('chooseAction returns a referee-legal move in a cannibal position', async () => {
    const e = setup({
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    });
    const action = await chooseAction(e);
    assert.ok(action, 'bot proposed an action');
    assert.equal(e.clone().applyAction(action!).ok, true);
  });
});

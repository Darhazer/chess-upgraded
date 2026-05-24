import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGameState, type ServerRoomState } from '../src/features/game/derive-game-state.js';
import type { SavedRoom } from '../src/services/player-id.js';

const baseState: ServerRoomState = {
  fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  status: 'playing',
  turn: 'w',
  upgraded: [],
  players: [
    { color: 'w', name: 'Alice' },
    { color: 'b', name: 'Bob' },
  ],
  history: [],
  result: null,
};

describe('deriveGameState', () => {
  it('handles a missing state (waiting for first broadcast)', () => {
    const g = deriveGameState({ code: 'XYZ', color: 'w' }, null);
    assert.equal(g.fen, 'start');
    assert.equal(g.myTurn, false);
    assert.deepEqual([...g.upgradedSet], []);
    assert.deepEqual(g.history, []);
  });

  it('orientation follows my color', () => {
    assert.equal(deriveGameState({ color: 'w' } as SavedRoom, baseState).orientation, 'white');
    assert.equal(deriveGameState({ color: 'b' } as SavedRoom, baseState).orientation, 'black');
  });

  it('opponentColor is the other side', () => {
    assert.equal(deriveGameState({ color: 'w' } as SavedRoom, baseState).opponentColor, 'b');
    assert.equal(deriveGameState({ color: 'b' } as SavedRoom, baseState).opponentColor, 'w');
  });

  it('myTurn requires status=playing AND turn matches', () => {
    assert.equal(deriveGameState({ color: 'w' } as SavedRoom, baseState).myTurn, true);
    assert.equal(
      deriveGameState({ color: 'w' } as SavedRoom, { ...baseState, turn: 'b' }).myTurn,
      false,
    );
    assert.equal(
      deriveGameState({ color: 'w' } as SavedRoom, { ...baseState, status: 'over' }).myTurn,
      false,
    );
  });

  it('upgradedSet is a Set built from state.upgraded', () => {
    const g = deriveGameState({ color: 'w' } as SavedRoom, { ...baseState, upgraded: ['a1', 'h8'] });
    assert.ok(g.upgradedSet instanceof Set);
    assert.ok(g.upgradedSet.has('a1'));
    assert.ok(g.upgradedSet.has('h8'));
    assert.equal(g.upgradedSet.size, 2);
  });

  it('me and opponent are picked from players[]', () => {
    const g = deriveGameState({ color: 'w' } as SavedRoom, baseState);
    assert.equal(g.me!.name, 'Alice');
    assert.equal(g.opponent!.name, 'Bob');
  });

  it('defaults to the upgraded variant; glow follows the upgraded set', () => {
    const g = deriveGameState({ color: 'w' } as SavedRoom, { ...baseState, upgraded: ['a1'] });
    assert.equal(g.variant, 'upgraded');
    assert.deepEqual([...g.glowSquares], ['a1']);
    assert.deepEqual(g.kingOverrides, {});
  });

  it('cannibal: glow + kingOverrides come from state.kingOverrides', () => {
    const g = deriveGameState(
      { color: 'w' } as SavedRoom,
      { ...baseState, variant: 'cannibal', kingOverrides: { e1: 'n' } },
    );
    assert.equal(g.variant, 'cannibal');
    assert.deepEqual(g.kingOverrides, { e1: 'n' });
    assert.deepEqual([...g.glowSquares], ['e1']);
  });

  it('rpg: glow marks squares whose piece has at least one affordable upgrade', () => {
    const g = deriveGameState(
      { color: 'w' } as SavedRoom,
      {
        ...baseState,
        variant: 'rpg',
        pieces: {
          e1: { slotId: 'w-e1', color: 'w', currentType: 'k', xp: 0, upgrades: [] },
          d2: {
            slotId: 'w-d2', color: 'w', currentType: 'p', xp: 3,
            upgrades: [
              { type: 'n', cost: 3, affordable: true },
              { type: 'q', cost: 9, affordable: false },
            ],
          },
          e2: {
            slotId: 'w-e2', color: 'w', currentType: 'p', xp: 0,
            upgrades: [{ type: 'n', cost: 3, affordable: false }],
          },
        },
      },
    );
    assert.equal(g.variant, 'rpg');
    assert.ok(g.glowSquares.has('d2'));
    assert.ok(!g.glowSquares.has('e1'));
    assert.ok(!g.glowSquares.has('e2'));
  });

  it('passes status, result, history through', () => {
    const result = { result: 'white', reason: 'resignation' };
    const history = [{ kind: 'move', san: 'e4' }];
    const g = deriveGameState(
      { color: 'w' } as SavedRoom,
      { ...baseState, status: 'over', result, history },
    );
    assert.equal(g.status, 'over');
    assert.equal(g.result, result);
    assert.equal(g.history, history);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGameState } from '../src/features/game/derive-game-state.js';

const baseState = {
  fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  status: 'playing',
  turn: 'w',
  upgraded: [],
  bar: { w: 0, b: 0 },
  barMax: 3,
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
    assert.equal(g.canUpgrade, false);
    assert.equal(g.barMax, 3);
    assert.equal(g.myBar, 0);
    assert.deepEqual([...g.upgradedSet], []);
    assert.deepEqual(g.history, []);
  });

  it('orientation follows my color', () => {
    assert.equal(deriveGameState({ color: 'w' }, baseState).orientation, 'white');
    assert.equal(deriveGameState({ color: 'b' }, baseState).orientation, 'black');
  });

  it('opponentColor is the other side', () => {
    assert.equal(deriveGameState({ color: 'w' }, baseState).opponentColor, 'b');
    assert.equal(deriveGameState({ color: 'b' }, baseState).opponentColor, 'w');
  });

  it('myTurn requires status=playing AND turn matches', () => {
    assert.equal(deriveGameState({ color: 'w' }, baseState).myTurn, true);
    assert.equal(
      deriveGameState({ color: 'w' }, { ...baseState, turn: 'b' }).myTurn,
      false
    );
    assert.equal(
      deriveGameState({ color: 'w' }, { ...baseState, status: 'over' }).myTurn,
      false
    );
  });

  it('reads bars per side from state.bar', () => {
    const s = { ...baseState, bar: { w: 2, b: 3 } };
    const g = deriveGameState({ color: 'w' }, s);
    assert.equal(g.myBar, 2);
    assert.equal(g.oppBar, 3);
  });

  it('canUpgrade requires myTurn AND bar >= barMax', () => {
    assert.equal(
      deriveGameState({ color: 'w' }, { ...baseState, bar: { w: 3, b: 0 } }).canUpgrade,
      true
    );
    assert.equal(
      deriveGameState({ color: 'w' }, { ...baseState, bar: { w: 2, b: 0 } }).canUpgrade,
      false
    );
    assert.equal(
      // bar full but not my turn
      deriveGameState({ color: 'w' }, { ...baseState, turn: 'b', bar: { w: 3, b: 0 } })
        .canUpgrade,
      false
    );
  });

  it('upgradedSet is a Set built from state.upgraded', () => {
    const g = deriveGameState({ color: 'w' }, { ...baseState, upgraded: ['a1', 'h8'] });
    assert.ok(g.upgradedSet instanceof Set);
    assert.ok(g.upgradedSet.has('a1'));
    assert.ok(g.upgradedSet.has('h8'));
    assert.equal(g.upgradedSet.size, 2);
  });

  it('me and opponent are picked from players[]', () => {
    const g = deriveGameState({ color: 'w' }, baseState);
    assert.equal(g.me.name, 'Alice');
    assert.equal(g.opponent.name, 'Bob');
  });

  it('falls back to default barMax when missing', () => {
    const { barMax: _omit, ...noBarMax } = baseState;
    assert.equal(deriveGameState({ color: 'w' }, noBarMax).barMax, 3);
  });

  it('passes status, result, history through', () => {
    const result = { result: 'white', reason: 'resignation' };
    const history = [{ kind: 'move', san: 'e4' }];
    const g = deriveGameState(
      { color: 'w' },
      { ...baseState, status: 'over', result, history }
    );
    assert.equal(g.status, 'over');
    assert.equal(g.result, result);
    assert.equal(g.history, history);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SearchPool } from '../src/engine/search-pool.js';
import { RulesEngine } from '../src/rules-engine.js';
import { listVariantActions } from '../src/engine/index.js';

const startState = () => new RulesEngine().publicState();

function isLegal(publicState, action) {
  const key = (a) => (a.kind === 'upgrade' ? `@${a.square}` : `${a.from}${a.to}`);
  const legal = new Set(listVariantActions(publicState).map(key));
  return legal.has(key(action));
}

describe('SearchPool', () => {
  it('returns a legal action from a worker', async () => {
    const pool = new SearchPool(1);
    try {
      const ps = startState();
      const action = await pool.run(ps, 1);
      assert.ok(action, 'should produce an action');
      assert.ok(isLegal(ps, action), `action ${JSON.stringify(action)} should be legal`);
    } finally {
      await pool.destroy();
    }
  });

  it('runs in-process when size is 0', async () => {
    const pool = new SearchPool(0);
    const ps = startState();
    const action = await pool.run(ps, 1);
    assert.ok(action && isLegal(ps, action));
    assert.equal(pool.workers.length, 0, 'no workers should be spawned');
    await pool.destroy();
  });

  it('serves more concurrent searches than it has workers', async () => {
    const pool = new SearchPool(1);
    try {
      const ps = startState();
      const actions = await Promise.all([pool.run(ps, 1), pool.run(ps, 1), pool.run(ps, 1)]);
      for (const a of actions) assert.ok(a && isLegal(ps, a));
    } finally {
      await pool.destroy();
    }
  });

  it('rejects pending searches when destroyed', async () => {
    const pool = new SearchPool(1);
    const inFlight = pool.run(startState(), 1); // dispatched to the lone worker
    const queued = pool.run(startState(), 1);   // waits in the queue behind it
    const settled = Promise.allSettled([inFlight, queued]); // attach handlers before tearing down
    await pool.destroy();
    const [a, b] = await settled;
    assert.equal(b.status, 'rejected');
    assert.match(b.reason.message, /destroyed/);
    // The in-flight search is rejected too, unless the worker happened to answer first.
    if (a.status === 'rejected') assert.match(a.reason.message, /destroyed/);
  });
});

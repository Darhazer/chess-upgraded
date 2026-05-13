import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { server, io } from '../src/index.js';

// These tests exercise the socket edge: every field arriving from a client is
// hostile. Before the validation hardening, a non-string `code` reached
// `code.toUpperCase()` and the resulting TypeError escaped to
// `uncaughtException`, taking the whole process (every room) down — Socket.IO
// does not wrap handlers in try/catch. The key assertion in each case is not
// just "got a graceful error" but "the server is still alive afterwards",
// which we prove by making a follow-up call that succeeds.

let url;
const clients = [];

function connect() {
  const c = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return c;
}

// Wait for a socket to finish connecting so emits aren't buffered past a
// crash we're trying to observe.
function ready(c) {
  return new Promise((resolve, reject) => {
    c.on('connect', resolve);
    c.on('connect_error', reject);
  });
}

function emit(c, event, payload) {
  return c.timeout(1000).emitWithAck(event, payload);
}

// Resolve with the next room:state this client receives.
function nextRoomState(c) {
  return new Promise((resolve) => c.once('room:state', resolve));
}

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  while (clients.length) clients.pop().disconnect();
});

after(() => new Promise((resolve) => io.close(resolve)));

describe('socket payload validation', () => {
  it('rejects a numeric room code without crashing the server', async () => {
    const c = connect();
    await ready(c);

    const res = await emit(c, 'lobby:join', { code: 123, playerId: 'p1' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'code required');

    // Server still up: a well-formed call on the same connection works.
    const ok = await emit(c, 'lobby:public', { playerId: 'p1' });
    assert.equal(ok.ok, true);
    assert.ok(typeof ok.code === 'string');
  });

  it('rejects an object room code without crashing the server', async () => {
    const c = connect();
    await ready(c);

    const res = await emit(c, 'lobby:rejoin', { code: {}, playerId: 'p1' });
    assert.equal(res.ok, false);

    const ok = await emit(c, 'lobby:public', { playerId: 'p1' });
    assert.equal(ok.ok, true);
  });

  it('handles a null payload (destructuring a default would have thrown)', async () => {
    const c = connect();
    await ready(c);

    const res = await emit(c, 'lobby:join', null);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'code required');

    const ok = await emit(c, 'lobby:public', { playerId: 'p1' });
    assert.equal(ok.ok, true);
  });

  it('rejects a missing / non-string playerId', async () => {
    const c = connect();
    await ready(c);

    assert.equal((await emit(c, 'lobby:public', {})).ok, false);
    assert.equal((await emit(c, 'lobby:public', { playerId: 42 })).ok, false);
    assert.equal((await emit(c, 'lobby:public', { playerId: '' })).ok, false);

    const ok = await emit(c, 'lobby:public', { playerId: 'p1' });
    assert.equal(ok.ok, true);
  });

  it('rejects a non-object, non-string move and a missing room code on game:move', async () => {
    const c = connect();
    await ready(c);

    // No room: should be a clean rejection, not a throw.
    assert.equal((await emit(c, 'game:move', { code: 'AAAAAA', move: ['e2', 'e4'] })).error, 'invalid move');
    assert.equal((await emit(c, 'game:move', { code: 42, move: 'e4' })).error, 'room not found');
    assert.equal((await emit(c, 'game:move', { move: 'e4' })).error, 'room not found');

    const ok = await emit(c, 'lobby:public', { playerId: 'p1' });
    assert.equal(ok.ok, true);
  });

  it('drops a non-string name and truncates an oversized one', async () => {
    // Non-string name -> falls back to the default seat name.
    const c1 = connect();
    await ready(c1);
    const state1 = nextRoomState(c1);
    const created = await emit(c1, 'lobby:create', { playerId: 'p1', name: { evil: true } });
    assert.equal(created.ok, true);
    assert.equal((await state1).players[0].name, 'White');

    // Oversized name -> truncated to 40 chars.
    const c2 = connect();
    await ready(c2);
    const state2 = nextRoomState(c2);
    const long = 'x'.repeat(500);
    const created2 = await emit(c2, 'lobby:create', { playerId: 'p2', name: long });
    assert.equal(created2.ok, true);
    assert.equal((await state2).players[0].name, 'x'.repeat(40));
  });

  it('rate-limits a flood of lobby:* events per socket', async () => {
    const c = connect();
    await ready(c);

    // Burst well past the default bucket capacity (10). The refill rate is
    // one token per 3s, so within this loop essentially nothing refills.
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(await emit(c, 'lobby:create', { playerId: `p${i}` }));
    }
    const accepted = results.filter((r) => r.ok).length;
    const limited = results.filter((r) => !r.ok && r.error === 'rate limited').length;
    assert.ok(accepted <= 11, `expected ~10 accepted, got ${accepted}`);
    assert.ok(limited >= 9, `expected the rest to be rate limited, got ${limited}`);

    // A different socket has its own bucket and is unaffected.
    const fresh = connect();
    await ready(fresh);
    assert.equal((await emit(fresh, 'lobby:public', { playerId: 'p1' })).ok, true);
  });

  it('ignores a non-function ack argument instead of throwing on ack?.()', async () => {
    const c = connect();
    await ready(c);

    // socket.io-client peels the trailing function off as the ack, so the
    // string lands in the handler's `ack` slot. `ack?.()` would throw on a
    // string; the `on()` wrapper normalizes it to undefined. The real ack
    // callback below is therefore never invoked — we just need the server to
    // survive, which the follow-up call proves.
    c.emit('lobby:public', { playerId: 'p1' }, 'not-a-function', () => {});

    const ok = await emit(c, 'lobby:public', { playerId: 'p1' });
    assert.equal(ok.ok, true);
  });
});

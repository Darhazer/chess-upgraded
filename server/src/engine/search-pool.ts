// Off-thread bot search. `Board.calculateAiMove` is a synchronous minimax —
// at higher levels it can block the event loop for tens to hundreds of ms,
// which on a single-process server stalls *every* room (PvP games included)
// and Socket.IO heartbeats. This module runs each search in a worker_threads
// pool so the main thread only does cheap work (referee validation, the
// game loop, the socket layer).
//
// Sizing: BOT_WORKERS workers (default = cores − 1, leaving one for the main
// thread). BOT_WORKERS=0 disables the pool and runs the search in-process —
// an explicit opt-out, and the fallback when worker_threads is unavailable.
//
// Each search is one message round-trip: { id, publicState, level } in,
// { id, action } | { id, error } out. publicState is RulesEngine's plain
// snapshot, so it structured-clones cleanly. The pool is lazily started on
// first use, workers are unref()'d (they never keep the process alive), and
// a crashed or timed-out worker is failed-over and respawned.

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { chooseVariantAction } from './index.js';
import type { MoveAction, PublicState } from './variant.js';

// The worker entry point. When the process is started with `tsx` (dev/test)
// the .ts source exists and tsx-aware workers can load it directly. When run
// through `tsc` and compiled .js exists, the same URL resolves to that. The
// pool falls back to `.ts` if `.js` is missing.
const WORKER_URL = new URL('./search-worker.js', import.meta.url);

// A search that runs longer than this is treated as a hung worker: the task
// is rejected (the bot adapter then falls back to a random legal move) and
// the worker is replaced. Generous — level-4 endgames are the slow case.
const SEARCH_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.BOT_SEARCH_TIMEOUT_MS ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : 10_000;
})();

function defaultWorkerCount(): number {
  const raw = parseInt(process.env.BOT_WORKERS ?? '', 10);
  if (Number.isInteger(raw)) return Math.max(0, raw);
  return Math.max(1, availableParallelism() - 1);
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

interface Job {
  publicState: PublicState;
  level: number;
  excludeFrom?: string;
  resolve: (value: MoveAction | null) => void;
  reject: (reason: Error) => void;
}

interface PendingEntry {
  resolve: (value: MoveAction | null) => void;
  reject: (reason: Error) => void;
  slot: Slot;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerResultMessage {
  id: number;
  action?: MoveAction | null;
  error?: string;
}

export class SearchPool {
  size: number;
  workers: Slot[];
  queue: Job[];
  pending: Map<number, PendingEntry>;
  nextId: number;
  started: boolean;

  constructor(size: number = defaultWorkerCount()) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.started = false;
  }

  // Pick the bot's action for `publicState` at `level`. Resolves with a
  // RulesEngine action ({kind:'move',...}) or null. `excludeFrom` forbids
  // any move whose source square matches (used by Chess RPG to skip the
  // turn's locked square).
  run(publicState: PublicState, level: number, excludeFrom?: string): Promise<MoveAction | null> {
    if (this.size === 0) {
      try { return Promise.resolve(chooseVariantAction(publicState, { level, excludeFrom }) ?? null); }
      catch (err) { return Promise.reject(err as Error); }
    }
    this._ensureStarted();
    return new Promise<MoveAction | null>((resolve, reject) => {
      const job: Job = { publicState, level, excludeFrom, resolve, reject };
      const slot = this.workers.find((s) => !s.busy);
      if (slot) this._dispatch(slot, job);
      else this.queue.push(job);
    });
  }

  // Terminate every worker and reject anything outstanding. Mainly for tests
  // — a long-running server just lets the unref()'d workers die at exit.
  async destroy(): Promise<void> {
    const slots = this.workers.splice(0);
    for (const job of this.queue.splice(0)) job.reject(new Error('search pool destroyed'));
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('search pool destroyed'));
    }
    this.pending.clear();
    this.started = false;
    await Promise.all(slots.map((s) => s.worker.terminate().catch(() => {})));
  }

  _ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i++) this._spawn();
  }

  _spawn(): Slot {
    const slot: Slot = { worker: new Worker(WORKER_URL), busy: false };
    slot.worker.on('message', (msg: WorkerResultMessage) => this._onMessage(slot, msg));
    slot.worker.on('error', (err: Error) => this._onWorkerGone(slot, err));
    slot.worker.on('exit', (code) => {
      if (code !== 0) this._onWorkerGone(slot, new Error(`search worker exited with code ${code}`));
    });
    // Idle workers are unref'd so the pool never keeps the process alive on its
    // own; we ref() while a search is in flight (see _dispatch) so the awaited
    // result actually keeps the event loop running. Without that, a caller that
    // only awaits pool.run() — e.g. the test process — can see the loop drain
    // and node:test cancels the pending test with "Promise resolution is still
    // pending but the event loop has already resolved."
    slot.worker.unref();
    this.workers.push(slot);
    return slot;
  }

  _dispatch(slot: Slot, job: Job): void {
    const id = this.nextId++;
    slot.busy = true;
    slot.worker.ref();
    const timer = setTimeout(() => {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      entry.reject(new Error(`search timed out after ${SEARCH_TIMEOUT_MS}ms`));
      this._onWorkerGone(slot, new Error('search worker timed out'));
    }, SEARCH_TIMEOUT_MS);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this.pending.set(id, { resolve: job.resolve, reject: job.reject, slot, timer });
    slot.worker.postMessage({ id, publicState: job.publicState, level: job.level, excludeFrom: job.excludeFrom });
  }

  _onMessage(slot: Slot, msg: WorkerResultMessage): void {
    const entry = this.pending.get(msg.id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.action ?? null);
    }
    slot.busy = false;
    slot.worker.unref();
    this._drain();
  }

  // A worker died (crash, nonzero exit, or timeout): fail everything it was
  // running, drop it, and — if the pool is still live — bring up a replacement
  // so capacity is restored.
  _onWorkerGone(slot: Slot, err: Error): void {
    for (const [id, entry] of this.pending) {
      if (entry.slot !== slot) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(err);
    }
    const idx = this.workers.indexOf(slot);
    if (idx === -1) return; // already handled (error + exit can both fire)
    this.workers.splice(idx, 1);
    slot.worker.terminate().catch(() => {});
    if (this.started) this._spawn();
    this._drain();
  }

  _drain(): void {
    while (this.queue.length) {
      const slot = this.workers.find((s) => !s.busy);
      if (!slot) return;
      this._dispatch(slot, this.queue.shift()!);
    }
  }
}

// One pool per process. The bot adapter (../bot.js) is the only caller.
export const searchPool = new SearchPool();

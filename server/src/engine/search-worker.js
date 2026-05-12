// Worker-thread entry point for the bot search (see ./search-pool.js).
// Receives { id, publicState, level }, runs the variant engine's minimax,
// and posts back { id, action } (action may be null) or { id, error }.
// Nothing here is server-specific — it's a pure function of the message.

import { parentPort } from 'node:worker_threads';
import { chooseVariantAction } from './index.js';

if (!parentPort) throw new Error('search-worker.js must be run as a worker thread');

parentPort.on('message', ({ id, publicState, level }) => {
  try {
    parentPort.postMessage({ id, action: chooseVariantAction(publicState, { level }) ?? null });
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || String(err) });
  }
});

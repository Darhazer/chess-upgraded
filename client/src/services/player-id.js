const KEY = 'chess.playerId';

// Stable per-browser identity. Lets the server reattach us to a room slot
// across socket reconnects, page reloads, and the disconnect grace window.
export function getPlayerId() {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* localStorage unavailable */ }
  if (id) return id;
  id = crypto.randomUUID();
  try { localStorage.setItem(KEY, id); } catch { /* localStorage unavailable */ }
  return id;
}

const ROOM_KEY = 'chess.room';

export function saveRoom(room) {
  try { localStorage.setItem(ROOM_KEY, JSON.stringify(room)); } catch { /* localStorage unavailable */ }
}

export function loadRoom() {
  try {
    const raw = localStorage.getItem(ROOM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; /* localStorage unavailable or bad JSON */ }
}

export function clearRoom() {
  try { localStorage.removeItem(ROOM_KEY); } catch { /* localStorage unavailable */ }
}

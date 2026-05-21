const KEY = 'chess.playerId';

export interface SavedRoom {
  code: string;
  color: 'w' | 'b';
}

// Stable per-browser identity. Lets the server reattach us to a room slot
// across socket reconnects, page reloads, and the disconnect grace window.
export function getPlayerId(): string {
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* localStorage unavailable */ }
  if (id) return id;
  id = crypto.randomUUID();
  try { localStorage.setItem(KEY, id); } catch { /* localStorage unavailable */ }
  return id;
}

const ROOM_KEY = 'chess.room';

export function saveRoom(room: SavedRoom): void {
  try { localStorage.setItem(ROOM_KEY, JSON.stringify(room)); } catch { /* localStorage unavailable */ }
}

export function loadRoom(): SavedRoom | null {
  try {
    const raw = localStorage.getItem(ROOM_KEY);
    return raw ? (JSON.parse(raw) as SavedRoom) : null;
  } catch { return null; /* localStorage unavailable or bad JSON */ }
}

export function clearRoom(): void {
  try { localStorage.removeItem(ROOM_KEY); } catch { /* localStorage unavailable */ }
}

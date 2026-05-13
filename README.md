# Chess

Multiplayer chess with extended rules. Two players, real-time, browser-based. Built on a Node.js + Socket.IO server and a React (Vite) client.

Play at https://chess-upgraded.com

## Rules

Standard chess rules apply (chess.js handles validation). On top of that, **capturing a piece automatically upgrades the capturing piece** (with one exception: a king or queen capturing an unupgraded pawn doesn't earn the upgrade — the strongest pieces don't ramp up on free pawn-snacks). The upgrade follows the piece across moves and is lost when the piece is captured.

Every upgraded piece gains an extra move *on top of* its normal ones. Every bonus move is **move-only** — the destination square must be empty, none of them can capture:

- **Rook** — also moves 1 square diagonally (one-step only, no capture).
- **Bishop** — also moves 1 square orthogonally (one-step only, no capture).
- **Knight** — also steps 1 square orthogonally (no capture). Fills in the four squares the knight normally cannot touch.
- **King** — gains a **teleport**: exactly 2 squares orthogonally (4 directions), may pass over a single intermediate piece, **target square must be empty** (no capture by teleport).
- **Queen** — gains the **knight's L-jump** (move-only): may leap to any of her 8 knight squares, but only to an empty square. She still cannot capture via the bonus.
- **Pawn** — also steps **one square sideways or one square backward** to an empty square (move-only). It keeps every standard pawn move, including the diagonal capture.

**Pawn promotion:** any pawn that reaches the last rank promotes (auto-queens). A no-capture promotion produces a plain queen — the upgrade marker doesn't carry over. A capture-promotion (diagonal capture into the back rank) leaves the resulting queen upgraded, via the same auto-upgrade-on-capture rule that applies everywhere else.

Game-over detection takes the upgraded moves into account: an upgraded king can escape what would otherwise be checkmate, an upgraded rook's diagonal step can block a check, etc.

Visual cues:

- Upgraded pieces are rendered with a gold drop-shadow + hue shift, so the figure itself looks visually distinct.
- Hovering over an upgraded piece (or any of yours) on drag-start shows the legal target squares as inset blue shadows.

## Layout

- `server/` — Express + Socket.IO. In-memory rooms, chess.js move validation wrapped in a `RulesEngine` so further rule extensions plug in cleanly.
- `client/` — React (Vite) + react-chessboard. Standard pieces inlined in `src/piece-svgs.js`; regenerate with `pnpm extract-pieces`.

## Run

```bash
cd server && pnpm install && pnpm dev      # :3001
cd client && pnpm install && pnpm dev      # :5173
```

Open http://localhost:5173.

## Game flow

- **Play public** — joins an open public room or creates one; first player is white.
- **Play vs computer** — creates a room against the built-in bot (you play white). The bot is a fork of [js-chess-engine](https://github.com/josefjadrny/js-chess-engine) (`server/src/engine/`) taught the variant — it searches bonus moves and teleports as first-class moves, not just standard chess, and values upgraded pieces in its evaluation. Strength tracks the engine's level (0–4); default 2, override with `BOT_LEVEL` on the server. The search runs in a `worker_threads` pool (`server/src/engine/search-pool.js`) so it never blocks the game loop — `BOT_WORKERS` sets the pool size (default: CPU count − 1; `0` runs the search in-process), `BOT_SEARCH_TIMEOUT_MS` caps a single search before the worker is recycled.
- **Create private room** — server returns a 6-character code. Share the invite link (`?room=CODE`) or paste the code in another browser.
- **Join** — paste the code to join an existing private room.

Server is authoritative for moves; the client mirrors state via chess.js for snappier UI. `RulesEngine` is the referee; the bot's choices are always re-validated against it before being applied.

## Extending rules

`server/src/rules-engine.js` wraps chess.js. New rules (custom pieces, modified moves, board variants) plug in here without touching the socket layer.

## Credits

- [**chess.js**](https://github.com/jhlywa/chess.js) — move generation and validation for standard chess.
- [**js-chess-engine**](https://github.com/josefjadrny/js-chess-engine) by Josef Jádrný — the computer opponent's search/evaluation, vendored under `server/src/engine/vendor/` (MIT — see the `LICENSE` there) and forked to understand the upgrade variant.
- [**react-chessboard**](https://github.com/Clariity/react-chessboard) — interactive board component for the React client.
- **Chess piece artwork** — Cburnett's standard SVG set, public-domain via [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces). The same set is bundled with react-chessboard; we re-extract it as inline SVG to enable per-piece styling for upgrades.

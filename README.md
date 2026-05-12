# Chess

Multiplayer chess with extended rules. Two players, real-time, browser-based. Built on a Node.js + Socket.IO server and a React (Vite) client.

Play at https://chess-upgraded.com

## Rules

Standard chess rules apply (chess.js handles validation). On top of that, each player has an **upgrade bar** that fuels a piece-upgrade ability:

- **Upgrade bar** — fills 1 unit per move. Once full, the player can spend a turn to upgrade one of their pieces. The bar caps at full and stays there until used; using it ends the turn (no move that turn) and resets the bar to 0.
- **Configurable threshold** — defaults to 3 moves to fill. Override with `UPGRADE_BAR_MAX=10` (or any value) on the server.
- **Restrictions** — an already-upgraded piece cannot be re-upgraded; you cannot upgrade while in check (must address check first). The upgrade follows the piece across moves and is lost when the piece is captured.

Most upgraded pieces gain extra moves *on top of* their normal ones. Every one of these bonus moves is **move-only** — the destination square must be empty, they can never capture:

- **Rook** — also moves 1 square diagonally (one-step only, no capture).
- **Bishop** — also moves 1 square orthogonally (one-step only, no capture).
- **Knight** — also makes a 2,2 jump in addition to its normal L-shape (4 new target squares, no capture).
- **King** and **Queen** — gain a **teleport**: exactly 2 squares in any of the 8 directions, may pass over a single intermediate piece, **target square must be empty** (no capture by teleport).

The **pawn** is the exception — upgrading it *replaces* its moveset rather than extending it:

- It moves **one square diagonally forward** to an **empty** square (the diagonal is now a move, not a capture).
- It captures **only the piece directly in front of it** — one square straight ahead (forward is now a capture, not a move).
- It no longer pushes forward 1–2 squares and no longer captures on the diagonal.
- It also no longer threatens its old diagonal-capture squares for check purposes — only the square directly ahead.

**Pawn promotion:** any pawn that reaches the last rank promotes (auto-queens). A normal pawn gets there the usual way — a standard push or diagonal capture. An **upgraded** pawn gets there via its replaced moveset: a diagonal step onto an empty back-rank square, or a forward capture of a piece on the back rank. On promotion the piece becomes a regular queen and **loses its upgrade marker** — it's a fresh queen, not an upgraded one. (As everywhere else, an upgraded pawn cannot capture on the diagonal, so it can't promote by a diagonal capture the way a normal pawn does.)

Game-over detection takes the upgraded moves into account: an upgraded king can escape what would otherwise be checkmate, an upgraded rook's diagonal step can block a check, an upgraded pawn's forward capture can deliver check, etc.

Visual cues:

- Each side's upgrade bar is shown in the sidebar; the bar glows gold when full.
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

Open http://localhost:5173. Set `UPGRADE_BAR_MAX=10` (etc.) on the server to change the upgrade threshold.

## Game flow

- **Play public** — joins an open public room or creates one; first player is white.
- **Create private room** — server returns a 6-character code. Share the invite link (`?room=CODE`) or paste the code in another browser.
- **Join** — paste the code to join an existing private room.

Server is authoritative for moves; the client mirrors state via chess.js for snappier UI.

## Extending rules

`server/src/rules-engine.js` wraps chess.js. New rules (custom pieces, modified moves, board variants) plug in here without touching the socket layer.

## Credits

- [**chess.js**](https://github.com/jhlywa/chess.js) — move generation and validation for standard chess.
- [**react-chessboard**](https://github.com/Clariity/react-chessboard) — interactive board component for the React client.
- **Chess piece artwork** — Cburnett's standard SVG set, public-domain via [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces). The same set is bundled with react-chessboard; we re-extract it as inline SVG to enable per-piece styling for upgrades.

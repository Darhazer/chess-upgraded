# Chess

Multiplayer chess with extended rules. Two players, real-time, browser-based. Built on a Node.js + Socket.IO server and a React (Vite) client.

The app hosts **multiple chess variants** — pick one in the lobby before you start a game. Two are available today: **Chess Upgraded** and **Cannibal Chess**.

Play at https://chess-upgraded.com

## Variants

Standard chess rules apply in every variant (move generation, check, checkmate, castling, en passant, promotion). Each variant layers one twist on top. You choose the variant when you create or join a game; public matchmaking only pairs players who picked the same one.

### Chess Upgraded

**Capturing a piece automatically upgrades the capturing piece** (with one exception: a king or queen capturing an unupgraded pawn doesn't earn the upgrade — the strongest pieces don't ramp up on free pawn-snacks). The upgrade follows the piece across moves and is lost when the piece is captured.

Every upgraded piece gains an extra move *on top of* its normal ones. Every bonus move is **move-only** — the destination square must be empty, none of them can capture:

- **Rook** — also moves 1 square diagonally (one-step only, no capture).
- **Bishop** — also moves 1 square orthogonally (one-step only, no capture).
- **Knight** — also steps 1 square orthogonally (no capture). Fills in the four squares the knight normally cannot touch.
- **King** — gains a **teleport**: exactly 2 squares orthogonally (4 directions), may pass over a single intermediate piece, **target square must be empty** (no capture by teleport).
- **Queen** — gains the **knight's L-jump** (move-only): may leap to any of her 8 knight squares, but only to an empty square. She still cannot capture via the bonus.
- **Pawn** — also steps **one square sideways or one square backward** to an empty square (move-only). It keeps every standard pawn move, including the diagonal capture.

**Pawn promotion:** any pawn that reaches the last rank promotes (auto-queens). A no-capture promotion produces a plain queen — the upgrade marker doesn't carry over. A capture-promotion (diagonal capture into the back rank) leaves the resulting queen upgraded, via the same auto-upgrade-on-capture rule that applies everywhere else.

Game-over detection takes the upgraded moves into account: an upgraded king can escape what would otherwise be checkmate, an upgraded rook's diagonal step can block a check, etc.

### Cannibal Chess

**When a piece captures another piece, it takes on the movement of the piece it captured.** A white rook that captures a black knight *becomes* a knight — from then on it moves as a knight. The board shows it as the new piece.

The king is special:

- **When the king captures, it also takes the captured piece's movement — but it stays royal.** A king that captures a pawn moves only as a pawn, yet it is still the piece that must be checkmated. The king keeps its crown; only how it moves changes.
- A royal piece moving as a **pawn** that reaches the last rank is **promoted**: it gains queen movement (and stays royal). Now the opponent must mate a piece that moves like a queen — until that queen, too, cannibalises something else.
- The royal king-pawn uses **minimal pawn rules**: one step forward, diagonal capture only — no initial two-square step, no en passant.

Other rules:

- **Castling** is only allowed with the **original rooks** under normal castling rules, and only while the king still moves as a king — once the king has cannibalised something else, it can no longer castle.
- A pawn that reaches the last rank by a **non-capturing** push promotes to a queen as usual; a pawn that reaches it by **capturing** cannibalises the captured piece instead.

Visual cues (both variants):

- A piece is redrawn as its current identity, and a piece with changed abilities — an upgraded piece in Chess Upgraded, or a king that has cannibalised something in Cannibal Chess — is rendered with a gold drop-shadow + hue shift so it stands out.
- Picking up a piece (drag-start or tap) shows its legal target squares as inset blue shadows.

## Layout

- `server/` — Express + Socket.IO. In-memory rooms; each room runs the referee engine for its variant (`RulesEngine` for Chess Upgraded, `CannibalEngine` for Cannibal Chess).
- `client/` — React (Vite) + react-chessboard. Standard pieces inlined in `src/piece-svgs.js`; regenerate with `pnpm extract-pieces`.
- `shared/` — variant move-geometry shared by server and client so move hints can never disagree with the referee.

## Run

```bash
cd server && pnpm install && pnpm dev      # :3001
cd client && pnpm install && pnpm dev      # :5173
```

Open http://localhost:5173.

## Game flow

- **Pick a variant** — choose Chess Upgraded or Cannibal Chess in the lobby; it applies to the public/private/computer game you start.
- **Play public** — joins an open public room for your variant or creates one; first player is white.
- **Play vs computer** — creates a room against the built-in bot (you play white). The bot is a fork of [js-chess-engine](https://github.com/josefjadrny/js-chess-engine) (`server/src/engine/`) taught the variants — it searches the bonus moves and transformed pieces as first-class moves, not just standard chess. Strength tracks the engine's level (0–4); default 2, override with `BOT_LEVEL` on the server. The search runs in a `worker_threads` pool (`server/src/engine/search-pool.js`) so it never blocks the game loop — `BOT_WORKERS` sets the pool size (default: CPU count − 1; `0` runs the search in-process), `BOT_SEARCH_TIMEOUT_MS` caps a single search before the worker is recycled.
- **Create private room** — server returns a 6-character code. Share the invite link (`?room=CODE`) or paste the code in another browser.
- **Join** — paste the code to join an existing private room (you get the variant the room was created with).

Server is authoritative for moves; the client mirrors state via chess.js for snappier UI. The room's referee engine validates every move, and the bot's choices are always re-validated against it before being applied.

## Extending rules

The variant engines live server-side:

- `server/src/rules-engine.js` — Chess Upgraded, wrapping chess.js.
- `server/src/cannibal-engine.js` — Cannibal Chess, wrapping the search engine fork.
- `server/src/engine/vendor/board.js` — the vendored js-chess-engine, kept as a generic base with variant extension points; `server/src/engine/cannibal-board.js` subclasses it for Cannibal Chess.

A new variant adds its referee engine, registers it in `server/src/rooms.js`, and (if the bot should play it) a `Board` subclass. The socket layer and lobby are variant-agnostic.

## Credits

- [**chess.js**](https://github.com/jhlywa/chess.js) — move generation and validation for standard chess.
- [**js-chess-engine**](https://github.com/josefjadrny/js-chess-engine) by Josef Jádrný — the computer opponent's search/evaluation, vendored under `server/src/engine/vendor/` (MIT — see the `LICENSE` there) and forked to understand the variants.
- [**react-chessboard**](https://github.com/Clariity/react-chessboard) — interactive board component for the React client.
- **Chess piece artwork** — Cburnett's standard SVG set, public-domain via [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces). The same set is bundled with react-chessboard; we re-extract it as inline SVG to enable per-piece styling.

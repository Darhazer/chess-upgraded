import { useEffect, useRef, useState } from 'react';
import { useSocket, useSocketEvent } from './services/socket-context.jsx';
import { lobbyApi } from './services/lobby-api.js';
import { saveRoom, loadRoom, clearRoom } from './services/player-id.js';
import Lobby from './components/Lobby.jsx';
import Game from './components/Game.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function App() {
  const { socket, connected, reset } = useSocket();
  const [room, setRoom] = useState(() => loadRoom()); // { code, color }
  const [state, setState] = useState(null); // server-broadcast room state
  // False until we've either successfully rejoined a saved room or decided
  // there isn't one. Gates rendering so a saved-but-dead code doesn't flash
  // Game-then-Lobby on cold load.
  const [bootstrapped, setBootstrapped] = useState(() => !loadRoom());

  useSocketEvent('room:state', setState);

  const joinRoom = (next) => {
    setRoom(next);
    saveRoom(next);
  };

  // On every (re)connect, if we have a saved room, try to reattach. Covers
  // network blips, page reloads, and laptop-sleep-induced heartbeat timeouts.
  // Has to run on every connect (not just first) so reconnects re-rejoin.
  useEffect(() => {
    if (!connected) return;
    const saved = loadRoom();
    if (!saved) { setBootstrapped(true); return; }
    lobbyApi.rejoin(socket, saved.code).then((res) => {
      if (res.ok) setRoom({ code: res.code, color: res.color });
      else { clearRoom(); setRoom(null); setState(null); }
      setBootstrapped(true);
    });
  }, [connected, socket]);

  // Auto-join via ?room=CODE in the URL. Only fires when we don't already
  // have a saved room (otherwise the rejoin effect above handles it).
  const urlJoinAttempted = useRef(false);
  useEffect(() => {
    if (urlJoinAttempted.current || !connected) return;
    if (loadRoom()) return;
    const code = new URLSearchParams(window.location.search).get('room');
    if (!code) return;
    urlJoinAttempted.current = true;
    lobbyApi.join(socket, code).then((res) => {
      if (res.ok) joinRoom({ code: res.code, color: res.color });
    });
  }, [connected, socket]);

  const leave = async () => {
    // Await so the server drops our seat before we cycle the socket;
    // otherwise the leave packet can be dropped by the disconnect and
    // the room lingers for the full grace window.
    if (room) await lobbyApi.leave(socket, room.code);
    clearRoom();
    setRoom(null);
    setState(null);
    reset();
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chess</h1>
        <span className={`conn ${connected ? 'on' : 'off'}`}>
          {connected ? 'connected' : 'disconnected'}
        </span>
      </header>
      {!bootstrapped ? (
        <p className="reconnecting">Reconnecting…</p>
      ) : !room ? (
        <Lobby onJoined={joinRoom} />
      ) : (
        <ErrorBoundary key={room.code} onReset={leave}>
          <Game room={room} state={state} onLeave={leave} />
        </ErrorBoundary>
      )}
    </div>
  );
}

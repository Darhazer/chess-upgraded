import { useEffect, useRef, useState } from 'react';
import { useSocket, useSocketEvent } from './services/socket-context.jsx';
import { lobbyApi } from './services/lobby-api.js';
import Lobby from './components/Lobby.jsx';
import Game from './components/Game.jsx';

export default function App() {
  const { socket, connected, reset } = useSocket();
  const [room, setRoom] = useState(null); // { code, color }
  const [state, setState] = useState(null); // server-broadcast room state

  useSocketEvent('room:state', setState);

  // Auto-join via ?room=CODE in the URL. Fire once per session — we don't
  // want this re-running every time `room` flips back to null on Leave.
  const urlJoinAttempted = useRef(false);
  useEffect(() => {
    if (urlJoinAttempted.current || !connected) return;
    const code = new URLSearchParams(window.location.search).get('room');
    if (!code) return;
    urlJoinAttempted.current = true;
    lobbyApi.join(socket, code).then((res) => {
      if (res.ok) setRoom({ code: res.code, color: res.color });
    });
  }, [connected, socket]);

  const leave = () => {
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
      {!room ? (
        <Lobby onJoined={setRoom} />
      ) : (
        <Game room={room} state={state} onLeave={leave} />
      )}
    </div>
  );
}

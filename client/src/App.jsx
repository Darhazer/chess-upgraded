import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import Lobby from './components/Lobby.jsx';
import Game from './components/Game.jsx';

export default function App() {
  const [room, setRoom] = useState(null); // { code, color }
  const [state, setState] = useState(null); // server-broadcast room state
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoomState = (s) => setState(s);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onRoomState);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onRoomState);
    };
  }, []);

  // Auto-join via ?room=CODE in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code && !room && connected) {
      socket.emit('lobby:join', { code }, (res) => {
        if (res?.ok) setRoom({ code: res.code, color: res.color });
      });
    }
  }, [connected, room]);

  const leave = () => {
    setRoom(null);
    setState(null);
    // simplest reset: reconnect socket so server forgets us
    socket.disconnect();
    socket.connect();
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
        <Lobby onJoined={(r) => setRoom(r)} />
      ) : (
        <Game room={room} state={state} onLeave={leave} />
      )}
    </div>
  );
}

import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useLatest } from '../hooks/useLatest.js';

const URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// One module-level socket instance. Components don't import it directly —
// they go through `useSocket()` so the transport stays swappable (auth,
// reconnection policy, alternate provider) without touching call sites.
let socket = io(URL, { autoConnect: true });

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // `reset` cycles the connection so the server forgets our session —
  // used on "Leave" to drop the room cleanly.
  const reset = () => {
    socket.disconnect();
    socket.connect();
  };

  return (
    <SocketContext.Provider value={{ socket, connected, reset }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
  return ctx;
}

// Subscribe to a socket event for the lifetime of the component. The
// handler can change between renders without re-subscribing — we route
// through a ref so deps stay [event].
export function useSocketEvent(event, handler) {
  const { socket } = useSocket();
  const handlerRef = useLatest(handler);
  useEffect(() => {
    const fn = (...args) => handlerRef.current(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event, handlerRef]);
}

// Promise wrapper for emit-with-ack. Always resolves; failures arrive as
// `{ ok: false, error }` so call sites don't need try/catch. The timeout
// matters when the socket is disconnected — without it, emits buffer
// silently and `await emitWithAck(...)` hangs forever.
export function emitWithAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      if (err) return resolve({ ok: false, error: 'timeout' });
      resolve(res || { ok: false, error: 'no response' });
    });
  });
}

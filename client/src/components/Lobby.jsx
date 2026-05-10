import { useState } from 'react';
import { useSocket } from '../services/socket-context.jsx';
import { lobbyApi } from '../services/lobby-api.js';

export default function Lobby({ onJoined }) {
  const { socket } = useSocket();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const run = async (action) => {
    setError('');
    const res = await action();
    if (res.ok) onJoined({ code: res.code, color: res.color });
    else setError(res.error || 'failed');
  };

  const playPublic = () => run(() => lobbyApi.public(socket, name));
  const createPrivate = () => run(() => lobbyApi.create(socket, name));
  const joinPrivate = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return setError('enter a code');
    return run(() => lobbyApi.join(socket, trimmed, name));
  };

  return (
    <div className="lobby">
      <label className="field">
        <span>Display name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anonymous" />
      </label>

      <div className="lobby-actions">
        <button className="primary" onClick={playPublic}>Play public</button>
        <button onClick={createPrivate}>Create private room</button>
      </div>

      <div className="join-row">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Room code"
          maxLength={6}
        />
        <button onClick={joinPrivate}>Join</button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

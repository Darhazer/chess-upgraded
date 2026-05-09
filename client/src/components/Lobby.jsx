import { useState } from 'react';
import { socket } from '../socket.js';

export default function Lobby({ onJoined }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const playPublic = () => {
    setError('');
    socket.emit('lobby:public', { name }, (res) => {
      if (res?.ok) onJoined({ code: res.code, color: res.color });
      else setError(res?.error || 'failed');
    });
  };

  const createPrivate = () => {
    setError('');
    socket.emit('lobby:create', { name }, (res) => {
      if (res?.ok) onJoined({ code: res.code, color: res.color });
      else setError(res?.error || 'failed');
    });
  };

  const joinPrivate = () => {
    setError('');
    if (!code.trim()) return setError('enter a code');
    socket.emit('lobby:join', { code: code.trim().toUpperCase(), name }, (res) => {
      if (res?.ok) onJoined({ code: res.code, color: res.color });
      else setError(res?.error || 'failed');
    });
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

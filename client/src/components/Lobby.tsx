import { useState } from 'react';
import { useSocket } from '../services/socket-context.js';
import { lobbyApi, type LobbyResponse } from '../services/lobby-api.js';
import type { SavedRoom } from '../services/player-id.js';

interface LobbyProps {
  onJoined: (room: SavedRoom) => void;
}

export default function Lobby({ onJoined }: LobbyProps) {
  const { socket } = useSocket();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [variant, setVariant] = useState('upgraded');
  const [error, setError] = useState('');

  const run = async (action: () => Promise<LobbyResponse>): Promise<void> => {
    setError('');
    const res = await action();
    if (res.ok && res.code && res.color) onJoined({ code: res.code, color: res.color });
    else setError(res.error || 'failed');
  };

  const playPublic = (): void => { void run(() => lobbyApi.public(socket, name, variant)); };
  const playBot = (): void => { void run(() => lobbyApi.bot(socket, name, variant)); };
  const createPrivate = (): void => { void run(() => lobbyApi.create(socket, name, variant)); };
  const joinPrivate = (): void => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError('enter a code'); return; }
    void run(() => lobbyApi.join(socket, trimmed, name));
  };

  return (
    <div className="lobby">
      <label className="field">
        <span>Display name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anonymous" />
      </label>

      <label className="field">
        <span>Variant</span>
        <select value={variant} onChange={(e) => setVariant(e.target.value)}>
          <option value="upgraded">Chess Upgraded</option>
          <option value="cannibal">Cannibal Chess</option>
        </select>
      </label>

      <div className="lobby-actions">
        <button className="primary" onClick={playPublic}>Play public</button>
        <button onClick={playBot}>Play vs computer</button>
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

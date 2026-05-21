import { PIECE_SVGS, type PieceCode } from '../piece-svgs.js';
import type { PieceInfo } from '../../../shared/chess-rpg-rules.js';

interface SelectedPiecePanelProps {
  square: string | null;
  info: PieceInfo | undefined;
  myColor: 'w' | 'b';
  myTurn: boolean;
  canAct: boolean;
  onUpgrade: (slotId: string, to: string) => void;
}

// Shown when a piece is selected on the board. Displays the piece's XP and
// any available upgrades. Upgrades are clickable only when it's your turn,
// the piece is yours, and you haven't already acted this turn.
export default function SelectedPiecePanel({
  square, info, myColor, myTurn, canAct, onUpgrade,
}: SelectedPiecePanelProps) {
  if (!square || !info) return null;
  const isMine = info.color === myColor;
  const code = (info.color + info.currentType.toUpperCase()) as PieceCode;
  const svg = PIECE_SVGS[code];

  return (
    <div className="selected-piece">
      <div className="selected-piece-head">
        <span className="selected-piece-icon" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="selected-piece-meta">
          <span className="selected-piece-square">{square.toUpperCase()}</span>
          <span className="selected-piece-xp" title="Experience points">
            XP {info.xp}
          </span>
        </div>
      </div>
      {info.upgrades.length > 0 ? (
        <div className="selected-piece-upgrades">
          {info.upgrades.map((u) => {
            const upgradeCode = (info.color + u.type.toUpperCase()) as PieceCode;
            const upgradeSvg = PIECE_SVGS[upgradeCode];
            const enabled = isMine && myTurn && canAct && u.affordable;
            return (
              <button
                key={u.type}
                type="button"
                disabled={!enabled}
                className={`upgrade-btn${enabled ? '' : ' disabled'}`}
                onClick={() => onUpgrade(info.slotId, u.type)}
                title={`Upgrade to ${u.type.toUpperCase()} — costs ${u.cost} XP`}
              >
                <span className="upgrade-icon" dangerouslySetInnerHTML={{ __html: upgradeSvg }} />
                <span className="upgrade-cost">{u.cost}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="selected-piece-note">No upgrades available.</p>
      )}
    </div>
  );
}

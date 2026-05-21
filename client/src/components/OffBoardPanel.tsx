import { PIECE_SVGS, type PieceCode } from '../piece-svgs.js';
import type { SlotDescriptor } from '../../../shared/chess-rpg-rules.js';

interface OffBoardPanelProps {
  myColor: 'w' | 'b';
  myTurn: boolean;
  material: { w: number; b: number };
  offBoard: { w: SlotDescriptor[]; b: SlotDescriptor[] };
  onBuild: (slotId: string) => void;
}

// Off-board pool for the player's side only — the opponent's queue would
// just clutter the view. Slots are arranged in two file-aligned rows
// (backrank on top, pawns below) so they visually map to the board.
export default function OffBoardPanel({
  myColor, myTurn, material, offBoard, onBuild,
}: OffBoardPanelProps) {
  const slots = offBoard[myColor] || [];
  return (
    <div className="off-board">
      <div className={`off-board-strip ${myColor === 'w' ? 'white' : 'black'}`}>
        <div className="off-board-header">
          <span className="off-board-label">Your pool</span>
          <span className="off-board-material" title="Material points">
            ★ {material[myColor]}
          </span>
        </div>
        {slots.length === 0
          ? <span className="off-board-empty">army complete</span>
          : (
              <SlotGrid
                slots={slots}
                myColor={myColor}
                clickable={myTurn}
                onBuild={onBuild}
              />
            )}
      </div>
    </div>
  );
}

// Backrank pieces in one row, pawns in the other, both indexed by file so
// the columns line up with the board files. Files run a→h for white and
// h→a for black to match each player's board orientation.
function SlotGrid({
  slots, myColor, clickable, onBuild,
}: {
  slots: SlotDescriptor[];
  myColor: 'w' | 'b';
  clickable: boolean;
  onBuild: (slotId: string) => void;
}) {
  const files = myColor === 'w'
    ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  const byFile = (predicate: (s: SlotDescriptor) => boolean) => {
    const out: Record<string, SlotDescriptor> = {};
    for (const s of slots) if (predicate(s)) out[s.home[0]!] = s;
    return out;
  };
  const backrank = byFile((s) => s.homeType !== 'p');
  const pawns = byFile((s) => s.homeType === 'p');

  const row = (map: Record<string, SlotDescriptor>) => (
    <div className="off-board-row">
      {files.map((f) => {
        const slot = map[f];
        if (!slot) return <span key={f} className="off-board-cell empty" aria-hidden />;
        return (
          <SlotButton
            key={slot.slotId}
            slot={slot}
            clickable={clickable}
            onBuild={onBuild}
          />
        );
      })}
    </div>
  );

  return (
    <div className="off-board-grid">
      {row(backrank)}
      {row(pawns)}
    </div>
  );
}

interface SlotButtonProps {
  slot: SlotDescriptor;
  clickable: boolean;
  onBuild: (slotId: string) => void;
}

function SlotButton({ slot, clickable, onBuild }: SlotButtonProps) {
  const code = (slot.color === 'w' ? 'w' : 'b') + slot.homeType.toUpperCase() as PieceCode;
  const active = clickable && slot.enabled;
  const svg = PIECE_SVGS[code];
  return (
    <button
      type="button"
      className={`off-board-cell off-board-slot${active ? ' enabled' : ' disabled'}`}
      disabled={!active}
      onClick={() => onBuild(slot.slotId)}
      title={`Build ${slot.homeType.toUpperCase()} at ${slot.home} (cost ${slot.cost})`}
    >
      <span className="off-board-piece" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="off-board-cost">{slot.cost}</span>
    </button>
  );
}

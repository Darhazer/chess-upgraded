export default function MoveHistory({ history }) {
  return (
    <div className="history">
      <h4>Moves</h4>
      <ol>
        {history.map((m, i) => (
          <li
            key={i}
            className={m.kind === 'custom' ? 'custom-entry' : ''}
          >
            {m.san}
          </li>
        ))}
      </ol>
    </div>
  );
}

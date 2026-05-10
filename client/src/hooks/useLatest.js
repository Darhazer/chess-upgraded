import { useRef } from 'react';

// Mirror of `value` accessible from inside callbacks that have been
// memoized against stale deps. react-chessboard memoizes its internal
// useDrag on [piece, square, currentPosition, id] and does NOT include
// our handler refs in those deps — so the closures it captures at first
// render see the original `value`. Reading via this ref's `.current`
// always sees the latest.
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

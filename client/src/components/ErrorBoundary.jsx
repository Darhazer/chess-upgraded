import { Component } from 'react';

// Class component because hooks still can't catch render errors.
// Used to wrap <Game> so a malformed FEN or a render bug in
// react-chessboard / a custom piece renderer doesn't take the whole app
// down — the user can always Leave back to the lobby.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught render error', error, info);
  }

  // `onReset` unmounts this boundary (returns to lobby), so no setState
  // here — if you ever add an in-place recover-and-retry path, that one
  // should clear `error` itself.
  reset = () => {
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h3>Something went wrong.</h3>
          <p className="error">{this.state.error.message || String(this.state.error)}</p>
          <button onClick={this.reset}>Back to lobby</button>
        </div>
      );
    }
    return this.props.children;
  }
}

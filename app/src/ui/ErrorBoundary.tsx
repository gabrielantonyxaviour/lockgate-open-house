import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="loading-state" role="alert"><h1>The screen could not load.</h1>
      <p>Reload to restore the interface. Check any submitted transaction in your wallet or explorer before trying again.</p>
      <button className="button" onClick={() => location.reload()}>Reload app</button>
    </main>;
  }
}

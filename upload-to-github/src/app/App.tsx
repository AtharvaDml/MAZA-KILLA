import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { createEngine } from './engine';
import { Inspector } from './ui/Inspector';
import { LibraryModal, NewKillaModal } from './ui/Library';
import { FirstHint, HelpModal, Loading, RadialMenu, StatusBar, Toasts } from './ui/Overlays';
import { ToolPanel } from './ui/ToolPanel';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';

export function App() {
  const viewport = useRef<HTMLDivElement>(null);
  const ready = useEditor((s) => s.ready);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewport.current) return;
    const engine = createEngine(viewport.current);
    engine.init().catch((err: unknown) => {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  return (
    <div className={`app ${ready ? 'is-ready' : ''}`}>
      <div className="viewport" ref={viewport} />
      {ready && (
        <div className="ui">
          <TopBar />
          <ToolPanel />
          <Inspector />
          <Toolbar />
          <StatusBar />
          <FirstHint />
          <Toasts />
          <RadialMenu />
          <LibraryModal />
          <NewKillaModal />
          <HelpModal />
        </div>
      )}
      <Loading />
      {error && (
        <div className="fatal">
          <h2>The soil wouldn’t settle</h2>
          <p>{error}</p>
          <p>Majha Killa needs a browser with WebGL2 — the latest Chrome works best.</p>
        </div>
      )}
    </div>
  );
}

import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

// No StrictMode: the engine owns a WebGL context and must be created exactly once.
createRoot(document.getElementById('root')!).render(<App />);

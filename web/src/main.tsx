import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initPwa } from './lib/pwa';

initPwa();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

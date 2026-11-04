import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { enablePrintStylesheet } from './lib/font-media';
import { installPreloadRecovery } from './lib/preload-recovery';
import './index.css';

// ANA-41 → CSP: инлайновый `onload` у неблокирующего font-`<link media="print">` блокируется
// CSP прода (script-src без 'unsafe-inline') — см. enablePrintStylesheet.
enablePrintStylesheet();

// REG-15 × lazy-чанки: после деплоя старая вкладка не может догрузить чанки прошлых билдов —
// одна авторазагрузка на сессию забирает новый index.html (см. lib/preload-recovery.ts).
installPreloadRecovery();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

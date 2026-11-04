import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { enablePrintStylesheet } from './lib/font-media';
import './index.css';

// ANA-41 → CSP: инлайновый `onload` у неблокирующего font-`<link media="print">` блокируется
// CSP прода (script-src без 'unsafe-inline') — см. enablePrintStylesheet.
enablePrintStylesheet();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

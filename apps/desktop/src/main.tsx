import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import './styles.css';

// Registra o service worker para habilitar "Adicionar à tela inicial" (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {/* silencioso */});
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

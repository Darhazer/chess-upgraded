import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { SocketProvider } from './services/socket-context.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('root container not found');
createRoot(container).render(
  <React.StrictMode>
    <SocketProvider>
      <App />
    </SocketProvider>
  </React.StrictMode>,
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { SocketProvider } from './services/socket-context.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SocketProvider>
      <App />
    </SocketProvider>
  </React.StrictMode>
);

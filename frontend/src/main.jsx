import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import './styles.css';

// Rota simples por caminho: /admin → interface de operador (desktop); resto → app.
const ehAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{ehAdmin ? <Admin /> : <App />}</React.StrictMode>,
);

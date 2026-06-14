import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppV2 from './v2/AppV2.jsx';
import Admin from './Admin.jsx';
import Explorar from './Explorar.jsx';
import DiagScanner from './DiagScanner.jsx';
import './styles.css';

// Rota simples por caminho: /admin → operador; /explorar → comprador; /diag →
// diagnóstico do scanner (temporário); /v1 → app ANTIGO congelado (chat/escuro);
// /v2 = alias do default. RAIZ → app v2 (design cartoon, agora o DEFAULT).
const caminho = window.location.pathname.replace(/\/+$/, '');
const Pagina = caminho === '/admin' ? Admin
  : caminho === '/explorar' ? Explorar
  : caminho === '/diag' ? DiagScanner
  : caminho === '/v1' ? App
  : AppV2;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Pagina />
  </React.StrictMode>,
);

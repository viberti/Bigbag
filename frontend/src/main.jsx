import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppV2, { RemediosApp } from './v2/AppV2.jsx';
import Admin from './Admin.jsx';
import Dashboard from './Dashboard.jsx';
import Explorar from './Explorar.jsx';
import DiagScanner from './DiagScanner.jsx';
import './styles.css';

// Rota simples por caminho: /admin → operador; /explorar → comprador; /diag → diagnóstico;
// /v1 → app ANTIGO congelado; /v2 = alias do default. RAIZ → app v2 (design cartoon, DEFAULT).
// /callback é legado do antigo login OIDC (Zitadel removido) → só redireciona p/ a raiz.
const caminho = window.location.pathname.replace(/\/+$/, '');
const root = createRoot(document.getElementById('root'));

if (caminho === '/callback') {
  window.location.replace('/');
} else {
  const Pagina = caminho === '/admin' ? Admin
    : caminho === '/dash' ? Dashboard
    : caminho === '/explorar' ? Explorar
    : caminho === '/remedios' ? RemediosApp // utilidade pública, sem login
    : caminho === '/diag' ? DiagScanner
    : caminho === '/v1' ? App
    : AppV2;
  root.render(
    <React.StrictMode>
      <Pagina />
    </React.StrictMode>,
  );
}

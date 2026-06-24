import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppV2, { RemediosApp } from './v2/AppV2.jsx';
import Admin from './Admin.jsx';
import Dashboard from './Dashboard.jsx';
import Explorar from './Explorar.jsx';
import DiagScanner from './DiagScanner.jsx';
import './styles.css';

// Rota simples por caminho: /callback → retorno do login OIDC (troca código→tokens);
// /admin → operador; /explorar → comprador; /diag → diagnóstico; /v1 → app ANTIGO
// congelado; /v2 = alias do default. RAIZ → app v2 (design cartoon, DEFAULT).
const caminho = window.location.pathname.replace(/\/+$/, '');
const root = createRoot(document.getElementById('root'));

if (caminho === '/callback') {
  // Volta do Zitadel: finaliza o login e regressa à origem do login. Sem React app aqui.
  // DEFAULT byte-idêntico ao anterior: sem `bigbag_post_login` gravado → volta a '/'.
  // Surfaces que iniciam login fora da raiz (ex.: /remedios) gravam o caminho antes do
  // redirect; só um valor que comece por '/' é honrado (evita open-redirect).
  root.render(<div style={{ font: '600 16px system-ui', padding: 40, textAlign: 'center', color: '#3b4a30' }}>A entrar…</div>);
  let destino = '/';
  try {
    const guardado = sessionStorage.getItem('bigbag_post_login');
    sessionStorage.removeItem('bigbag_post_login');
    if (guardado && /^\/(?!\/)/.test(guardado)) destino = guardado; // só caminho relativo interno
  } catch { /* sessionStorage indisponível → default '/' */ }
  import('./auth/oidc.js')
    .then(({ oidcCallback }) => oidcCallback())
    .catch(() => {})
    .finally(() => window.location.replace(destino));
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

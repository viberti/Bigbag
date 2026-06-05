import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import Explorar from './Explorar.jsx';
import './styles.css';

// Rota simples por caminho: /admin → operador; /explorar → comprador; resto → app.
const caminho = window.location.pathname.replace(/\/+$/, '');
const Pagina = caminho === '/admin' ? Admin : caminho === '/explorar' ? Explorar : App;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Pagina />
  </React.StrictMode>,
);

// <img> para rotas da NOSSA API que exigem login (ex.: /api/produto/foto-catalogo/:id). Um <img src>
// normal não envia o token (Bearer no localStorage) → 401 e imagem partida (code-review 2026-10-16:
// miniaturas do "Buscar por foto" na v1 e do separador "Elos foto" do admin). Para /api/… pede a
// imagem com o token e mostra-a por object URL; qualquer outro endereço (CDN de loja) vai direto.
import React, { useEffect, useState } from 'react';
import { call } from './api.js';

export default function ImgAuth({ src, ...props }) {
  const daApi = typeof src === 'string' && src.startsWith('/api/');
  const [url, setUrl] = useState(daApi ? null : src);
  useEffect(() => {
    if (!daApi) { setUrl(src); return undefined; }
    let vivo = true; let obj = null;
    call(src).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!vivo || !b) return;
      obj = URL.createObjectURL(b); setUrl(obj);
    }).catch(() => {});
    return () => { vivo = false; if (obj) URL.revokeObjectURL(obj); };
  }, [src, daApi]);
  return url ? <img src={url} {...props} /> : <span className="img-auth-vazia" aria-hidden="true" />;
}

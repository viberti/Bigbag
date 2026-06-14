/* Bigbag — icon set coeso (linha, 24px, stroke 1.8, currentColor).
   ICON(name, {size, stroke, color, fill}) -> string SVG.
   Estilo: geométrico, cantos arredondados, traço uniforme — moderno e familiar. */
(function () {
  // cada entrada é o conteúdo interno do <svg> (paths com currentColor)
  const P = {
    // sincronizar / nova pergunta
    sync: `<path d="M20 11a8 8 0 0 0-13.7-4.5L4 9"/><path d="M4 5v4h4"/>
           <path d="M4 13a8 8 0 0 0 13.7 4.5L20 15"/><path d="M20 19v-4h-4"/>`,
    // carrinho
    cart: `<circle cx="9.5" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>
           <path d="M3 4h2.2l1.6 11.2a1.5 1.5 0 0 0 1.5 1.3h9.1a1.5 1.5 0 0 0 1.47-1.2L21 8H6.2"/>`,
    // sair / logout
    logout: `<path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"/>
             <path d="M16 16l4-4-4-4"/><path d="M20 12H10"/>`,
    // câmara (foto/scan de produto)
    camera: `<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H7l1.2-1.7A1.5 1.5 0 0 1 9.4 4.6h5.2a1.5 1.5 0 0 1 1.2.7L17 7h1.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z"/>
             <circle cx="12" cy="12.5" r="3.2"/>`,
    // mais opções
    more: `<circle cx="5.5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18.5" cy="12" r="1.5"/>`,
    // enviar (avião de papel)
    send: `<path d="M5.5 12L20 5l-4.2 14.5a.7.7 0 0 1-1.3.1l-3-6.2-6.2-3a.7.7 0 0 1 .2-1.4z"/>
           <path d="M11.5 13.5L20 5"/>`,
    // saco (marca pequena, contorno)
    bag: `<path d="M6 8h12l-1 11.2a2 2 0 0 1-2 1.8H9a2 2 0 0 1-2-1.8z"/>
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>`,
    // pesquisar
    search: `<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>`,
    // recibo / talão
    receipt: `<path d="M6 3h12v18l-2.2-1.4L13.6 21 11 19.6 8.4 21 6 19.6z"/>
              <path d="M9.5 8h5M9.5 12h5"/>`,
    // gráfico de preço
    chart: `<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>`,
    // alerta / sino
    bell: `<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/>
           <path d="M10.5 19a1.8 1.8 0 0 0 3 0"/>`,
    // spark (toque tech / IA)
    spark: `<path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z"/>`,
    // lanterna (flash)
    torch: `<path d="M9 2h6l-.5 4.5a2 2 0 0 1-.6 1.2l-1 1a2 2 0 0 0-.6 1.4V21a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-9.9a2 2 0 0 0-.6-1.4l-1-1a2 2 0 0 1-.6-1.2z"/><path d="M9 5h6"/>`,
    // upload / ficheiro
    upload: `<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>`,
    // microfone
    mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>`,
    // localização/loja
    store: `<path d="M4 9l1.3-4.2A1.5 1.5 0 0 1 6.7 3.7h10.6a1.5 1.5 0 0 1 1.4 1.1L20 9"/>
            <path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9"/><path d="M4 9h16"/>`,
    // lista de habituais (checklist + spark) — montar a lista de compras
    usual: `<path d="M3.4 8.5l1.2 1.2 2.5-2.7"/><path d="M9.4 8.3H15.5"/>
            <path d="M3.4 13.3l1.2 1.2 2.5-2.7"/><path d="M9.4 13.1H17.5"/>
            <path d="M3.4 18.1l1.2 1.2 2.5-2.7"/><path d="M9.4 17.9H14"/>
            <path d="M19.7 3.6l.62 1.78 1.78.62-1.78.62-.62 1.78-.62-1.78-1.78-.62 1.78-.62z"/>`,
    // adicionar
    plus: `<path d="M12 5.5v13M5.5 12h13"/>`,
    // lista de compras (clipboard com itens marcados)
    list: `<path d="M9 4.2H7.4A2.4 2.4 0 0 0 5 6.6V18.6A2.4 2.4 0 0 0 7.4 21h9.2A2.4 2.4 0 0 0 19 18.6V6.6A2.4 2.4 0 0 0 16.6 4.2H15"/>
           <rect x="9" y="2.6" width="6" height="3.4" rx="1.2"/>
           <path d="M8.4 10.6l1.2 1.2 2.1-2.2"/><path d="M14 10.6h2.4"/>
           <path d="M8.4 15.4l1.2 1.2 2.1-2.2"/><path d="M14 15.4h2.4"/>`,
    // scanner (visor + código de barras)
    scan: `<path d="M4 8V6.6A2.6 2.6 0 0 1 6.6 4H8"/><path d="M16 4h1.4A2.6 2.6 0 0 1 20 6.6V8"/>
           <path d="M20 16v1.4A2.6 2.6 0 0 1 17.4 20H16"/><path d="M8 20H6.6A2.6 2.6 0 0 1 4 17.4V16"/>
           <path d="M7.6 8.6v6.8M10.4 8.6v6.8M13.6 8.6v6.8M16.4 8.6v6.8"/>`,
    // foto de produto (maçã na moldura)
    photoprod: `<path d="M4 8V6.6A2.6 2.6 0 0 1 6.6 4H8"/><path d="M16 4h1.4A2.6 2.6 0 0 1 20 6.6V8"/>
           <path d="M20 16v1.4A2.6 2.6 0 0 1 17.4 20H16"/><path d="M8 20H6.6A2.6 2.6 0 0 1 4 17.4V16"/>
           <path d="M14.7 12.6c0 2.3-1.4 4.2-2.7 4.2s-2.7-1.9-2.7-4.2c0-1.6 1.2-2.6 2.7-2.6s2.7 1 2.7 2.6z"/>
           <path d="M12 10c.2-1.1 1-1.9 2.1-2"/>`,
    // comparar produtos (balança)
    compare: `<path d="M12 4.2v15.6"/><path d="M5 7h14"/>
              <path d="M5 7l-3 6.2h6z"/><path d="M19 7l-3 6.2h6z"/>
              <path d="M2 13.2a3 3 0 0 0 6 0"/><path d="M16 13.2a3 3 0 0 0 6 0"/>
              <path d="M8.5 20h7"/><circle cx="12" cy="4.4" r="1.3"/>`,
    // utilizador / conta
    user: `<circle cx="12" cy="8.4" r="4"/><path d="M4.6 20a7.4 7.4 0 0 1 14.8 0"/>`,
    // folha (saúde / natural)
    leaf: `<path d="M5 19C4 12 8.5 5.5 19 5c.6 6.6-2.2 14.4-12 14-1.8-.07-2 0-2 0z"/><path d="M9 15c2.5-3 4.8-4.6 8-6"/>`,
    // troca / alternativa (setas opostas)
    swap: `<path d="M4 8h13"/><path d="M14 5l3 3-3 3"/><path d="M20 16H7"/><path d="M10 13l-3 3 3 3"/>`,
    // prato (refeição)
    plate: `<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/>`,
    // coração (bem-estar)
    heart: `<path d="M12 20s-7-4.5-9.2-9C1.3 8 3 4.7 6.2 4.7c2 0 3.1 1.1 3.8 2.3.7-1.2 1.8-2.3 3.8-2.3 3.2 0 4.9 3.3 3.4 6.3C19 15.5 12 20 12 20z"/>`,
    // início (casa)
    home: `<path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/><path d="M9.5 20v-6h5v6"/>`,
    // receitas (chapéu de chef)
    recipe: `<path d="M7 14a4 4 0 0 1-1-7.9 4 4 0 0 1 7.7-1.4A4 4 0 0 1 18 6.1 4 4 0 0 1 17 14"/><path d="M7 14v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5"/><path d="M7.5 17h9"/>`,
    // histórico (relógio + seta)
    history: `<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V9h4.5"/><path d="M12 8v4.3l2.8 1.7"/>`,
    // mais opções (vertical / kebab)
    kebab: `<circle cx="12" cy="5" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.9" fill="currentColor" stroke="none"/>`,
    // lista de talões (documentos empilhados)
    talao: `<rect x="7.6" y="6" width="11.4" height="14" rx="2.2"/>
            <path d="M5.2 16.6V5.4A2 2 0 0 1 7.2 3.4h7.4"/>
            <path d="M10.4 10.8h5.6M10.4 13.8h5.6M10.4 16.8h3.4"/>`,
    // confirmado
    check: `<path d="M5 12.5l4.2 4.2L19 7"/>`,
    // fechar
    close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  };

  function ICON(name, o) {
    o = o || {};
    const size = o.size || 24;
    const stroke = o.stroke != null ? o.stroke : 1.8;
    const color = o.color || "currentColor";
    const fill = o.fill || "none";
    const inner = P[name] || "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}"
      stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg" style="display:block" aria-hidden="true">${inner}</svg>`;
  }
  window.ICON = ICON;
  window.ICON_NAMES = Object.keys(P);
})();

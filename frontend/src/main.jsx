// Ponto de entrada. Separa as DUAS apps servidas pelo mesmo build:
//   /lista → app "Lista" (só a lista de compras; pacote próprio e leve — não carrega o BigBag)
//   tudo o resto → BigBag (v2, v1, admin, explorar, remédios…), em bigbag.jsx.
// Import DINÂMICO: o Vite gera um chunk por app, por isso cada uma só descarrega o seu código.
const caminho = window.location.pathname.replace(/\/+$/, '');

if (caminho === '/lista') import('./lista/main.jsx');
else import('./bigbag.jsx');

// Ponto de entrada. Separa as DUAS apps servidas pelo mesmo build:
//   /lista → app "Lista" (só a lista de compras; pacote próprio e leve — não carrega o BigBag)
//   tudo o resto → BigBag (v2, v1, admin, explorar, remédios…), em bigbag.jsx.
// Import DINÂMICO: o Vite gera um chunk por app, por isso cada uma só descarrega o seu código.
// ATENÇÃO: NÃO escrever `if (…) import(a); else import(b);` — o minificador funde as duas
// chamadas em `preload(cond ? a : b, deps)` e o Vite preenche UMA só lista de dependências
// (a do BigBag) → o /lista descarregava o JS e o CSS do BigBag inteiro. Um carregador por
// app, em propriedades separadas, mantém as dependências de cada uma.
const caminho = window.location.pathname.replace(/\/+$/, '');
const APPS = {
  lista: () => import('./lista/main.jsx'),
  bigbag: () => import('./bigbag.jsx'),
};
APPS[caminho === '/lista' ? 'lista' : 'bigbag']();

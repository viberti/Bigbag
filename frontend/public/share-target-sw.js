/* eslint-disable */
// Share Target do Bigbag (Android) — importado no topo do SW gerado pelo workbox.
// Intercepta o POST que o sistema faz quando o utilizador partilha um talão (ex.:
// do app do LIDL) para o Bigbag, guarda o ficheiro numa cache efémera e reencaminha
// para a app em /?compartilhado=1. A app (App.jsx) lê o ficheiro dessa cache e
// mete-o no fluxo de talões que já existe. Este listener corre ANTES do routing do
// workbox e só chama respondWith() para o /share-target — tudo o resto passa.
const BIGBAG_PARTILHA_CACHE = 'bigbag-partilha';
const BIGBAG_PARTILHA_KEY = '/__talao_partilhado';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.get('talao');
        if (file && file.size) {
          const cache = await caches.open(BIGBAG_PARTILHA_CACHE);
          await cache.put(
            BIGBAG_PARTILHA_KEY,
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'image/jpeg',
                'X-Nome': encodeURIComponent(file.name || 'talao'),
              },
            }),
          );
          return Response.redirect('/?compartilhado=1', 303);
        }
        // partilha de LINK (página de receita) → extrai o 1.º http(s) do url/text/title
        const partilhado = String(form.get('url') || form.get('text') || form.get('title') || '');
        const m = partilhado.match(/https?:\/\/\S+/);
        if (m) return Response.redirect('/?compartilhado=receita&link=' + encodeURIComponent(m[0]), 303);
      } catch (e) {
        // se a partilha falhar, abre a app na mesma (sem nada pendente)
      }
      // 303 → a navegação seguinte é GET (não repete o POST ao recarregar)
      return Response.redirect('/?compartilhado=1', 303);
    })(),
  );
});

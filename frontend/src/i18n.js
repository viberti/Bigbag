// Localização (i18n). Sem textos hardcoded nos componentes: usam t('chave').
// Adicionar um idioma = acrescentar um dicionário a STRINGS. Interpolação com
// {var}; plural simples com {n|singular|plural}.
const STRINGS = {
  'pt-BR': {
    'app.loading': 'carregando…',
    'login.subtitle': 'Histórico de preços de compras',
    'login.user': 'usuário',
    'login.pass': 'senha',
    'login.invalid': 'Credenciais inválidas.',
    'login.enter': 'Entrar',
    'chat.intro': 'Olá {nome}, o que posso fazer por você?',
    'chat.logout': 'sair',
    'chat.placeholder': 'Escreva uma pergunta…',
    'chat.thinking': '…',
    'chat.newConv': 'Nova conversa',
    'cap.scan': 'Digitalizar documento',
    'cap.photo': '📷 Foto normal',
    'cap.gallery': 'Galeria (várias)',
    'cap.file': 'Arquivo / PDF',
    'cap.lote': 'enviando {i}/{n}…',
    'cam.hint': 'Enquadre a nota preenchendo a moldura. Boa luz, sem dobras.',
    'cam.capture': 'Capturar',
    'cam.file': 'Galeria / PDF',
    'cam.error': 'Sem acesso à câmera. Use um arquivo.',
    'cam.processando': 'ajeitando a nota…',
    'cam.repetir': 'Repetir',
    'cam.enviar': 'Enviar',
    'scan.title': 'Digitalizar talão',
    'scan.subtitle': '1 foto · enviamos pelo BigBag',
    'scan.status.searching': 'A procurar o talão…',
    'scan.status.near': 'Aproxime e centre a nota',
    'scan.status.locked': 'Talão detetado — pode capturar',
    'scan.hint': 'Encha a moldura com a nota.',
    'scan.hintSub': 'Boa luz, sem dobras · fundo liso ajuda a apanhar.',
    'scan.gallery': 'Galeria / PDF',
    'preview.ok': 'Talão ajeitado e recortado',
    'preview.imported': 'Foto importada',
    'preview.foto': 'Foto pronta',
    'preview.meta': 'Confere se o total e as linhas estão legíveis.',
    'error.title': 'Sem acesso à câmara',
    'error.body': 'Não conseguimos abrir a câmara. Podes escolher uma foto ou PDF do talão a partir do telemóvel.',
    'error.choose': 'Escolher ficheiro',
    'cam.ajeitado': '📐 ajeitada (cobertura {c}%)',
    'cam.recortado': '✂️ recortada (sem ajuste de perspetiva · {c}%)',
    'cam.original': 'foto original — {motivo}',
    'nota.enviada': 'Nota',
    'nota.enviadaN': 'Nota {i}/{n}',
    'nota.scanning': 'digitalizando…',
    'nota.reading': 'lendo a nota…',
    'nota.duplicate': 'Você já me enviou essa nota ({loja}, {data}).',
    'nota.added': 'Compra adicionada',
    'nota.summary': '{n|item|itens} · {loja} · {data} · total {total}',
    'nota.more': '+ {n|item|itens}',
    'nota.less': 'menos',
    'habituais.title': 'Produtos habituais',
    'habituais.empty': 'Ainda não há produtos recorrentes suficientes.',
    'habituais.times': '{n|compra|compras}',
    'habituais.offline': '📴 Offline · mostrando a lista salva em {data}',
    'habituais.footer': 'A tua lista tem {n|item|itens}',
    'habituais.footerHint': '· toque para adicionar ou remover',
    'cart.title': 'Lista de compras',
    'cart.sheetTitle': 'Lista',
    'cart.empty': 'A tua lista está vazia. Abre “produtos que compro sempre” e toca para adicionar.',
    'cart.clear': 'Esvaziar lista',
    'cart.left': '{n|item|itens}',
    'cart.total': 'Total estimado',
    'cart.addHint': 'Toque num produto para adicionar/remover do carrinho.',
    'cart.hist': 'histórico de compras',
    'cart.histLoad': 'carregando…',
    'cart.histEmpty': 'Sem preço por unidade (€/kg) registrado para comparar.',
    'sugg.trend': 'Tendência de preços',
    'sugg.trendQ': 'Que produtos ficaram mais caros ou mais baratos ultimamente?',
    'sugg.cheap': 'Onde está mais barato',
    'sugg.cheapQ': 'Onde costumo comprar mais barato?',
    'sugg.receipt': 'O meu talão',
    'sugg.receiptQ': 'Mostra a minha última compra.',
    'voz.listening': 'ouvindo…',
    'voz.audio': '🎤 (áudio)',
    'err.query': 'Falha na consulta.',
    'err.upload': 'Falha ao enviar a nota.',
    'err.voice': 'Falha na consulta por voz.',
    'err.mic': 'Sem acesso ao microfone.',
  },
  // Para adicionar inglês: 'en': { 'app.loading': 'loading…', ... }
};

const FALLBACK = 'pt-BR';
let locale = FALLBACK;

export const idiomasDisponiveis = () => Object.keys(STRINGS);

export function setLocale(l) {
  if (STRINGS[l]) locale = l;
}

// Escolhe o melhor idioma a partir do browser (ex.: navigator.language).
export function detetarLocale(preferido) {
  const cand = [preferido, ...(navigator.languages || [navigator.language || ''])];
  for (const c of cand) {
    if (!c) continue;
    if (STRINGS[c]) return setLocale(c);
    const base = String(c).split('-')[0];
    const match = Object.keys(STRINGS).find((k) => k.split('-')[0] === base);
    if (match) return setLocale(match);
  }
}

export function t(chave, vars) {
  const dic = STRINGS[locale] || STRINGS[FALLBACK];
  let s = dic[chave] ?? STRINGS[FALLBACK][chave] ?? chave;
  // plural: {n|singular|plural}
  s = s.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, k, sing, plur) => {
    const n = Number(vars?.[k]);
    return `${vars?.[k] ?? ''} ${n === 1 ? sing : plur}`.trim();
  });
  // interpolação simples {var}
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

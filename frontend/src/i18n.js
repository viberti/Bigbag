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
    'nota.reading': 'lendo a nota…',
    'nota.duplicate': 'Esta nota já estava registrada ({loja}, {data}). Não foi duplicada.',
    'nota.added': 'Compra adicionada',
    'nota.summary': '{n|item|itens} · {loja} · {data} · total {total}',
    'nota.more': '+ {n|item|itens}',
    'nota.less': 'menos',
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

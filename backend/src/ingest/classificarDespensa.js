// Classifica + traduz itens de despensa por LLM e PERSISTE para MELHORAR A BASE: secção canónica em
// `ean_classificacao`, e — quando o original não era PT — o nome PT em `produto_ean.nome` e na própria
// `despensa`. Idempotente; um lote barato por chamada. Usado em fundo pelo GET /despensa.
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';

// Lista FECHADA de secções (mesma da despensa/lista no frontend).
const SECCOES = ['frutas', 'carne', 'charcutaria', 'peixe', 'padaria', 'laticinios', 'congelados', 'mercearia', 'condimentos', 'cafe_cha', 'bebidas', 'doces', 'higiene', 'outros'];
const SECCOES_SET = new Set(SECCOES);

const PROMPT = `Você organiza uma DESPENSA de cozinha. Para CADA produto devolva:
- "nome": o nome em PORTUGUÊS (PT-PT). Traduza de espanhol/inglês/francês. MANTENHA marcas e nomes próprios; não invente nem acrescente informação.
- "seccao": UMA destas secções de arrumação em casa: ${SECCOES.join(', ')}.
  Guia: condimentos = azeites, óleos, molhos, sal, vinagre, ESPECIARIAS e temperos (pimenta, cominho, orégãos, páprica, caril, canela, cravo). cafe_cha = café, chá, infusões. mercearia = arroz, massa, farinha, cereais, conservas, leguminosas, açúcar. doces = bolachas, chocolate, snacks doces. laticinios = leite, iogurte, queijo, manteiga, ovos. padaria = pão, tostas, wraps, tortilhas. peixe = peixe/marisco. carne = carne fresca. charcutaria = fiambre, presunto, salsichas. frutas = fruta E legumes/vegetais frescos. higiene = limpeza e higiene.
- "traduzido": true se o nome ORIGINAL não estava já em português correto; senão false.
Responda SÓ JSON: {"itens":[{"ean":"...","nome":"...","seccao":"...","traduzido":true|false}]}`;

export async function enriquecerDespensaLLM(pool, rows, { limite = 60 } = {}) {
  const lote = (rows || []).filter((r) => r.ean && r.nome).slice(0, limite);
  if (!lote.length) return { n: 0 };
  const lista = lote.map((r) => `- ean=${r.ean} nome="${String(r.nome).replace(/"/g, "'")}"`).join('\n');
  let out;
  try {
    const txt = await chatCompletion({
      messages: [{ role: 'user', content: `${PROMPT}\n\nPRODUTOS:\n${lista}` }],
      model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, contexto: 'despensa',
    });
    out = JSON.parse(txt);
  } catch (e) { console.error('[despensa LLM] erro:', e.message); return { n: 0, erro: true }; }
  const itens = Array.isArray(out?.itens) ? out.itens : [];
  let n = 0;
  for (const it of itens) {
    const ean = String(it.ean || '').replace(/\D/g, '');
    if (!ean) continue;
    const seccao = SECCOES_SET.has(it.seccao) ? it.seccao : 'outros';
    const nome = (typeof it.nome === 'string' && it.nome.trim()) ? it.nome.trim().slice(0, 200) : null;
    // CLASSIFICAÇÃO canónica — sempre (melhora a base p/ toda a app)
    await pool.query(
      `INSERT INTO ean_classificacao (ean, seccao, nome_pt, via) VALUES (?,?,?, 'llm')
       ON DUPLICATE KEY UPDATE seccao = VALUES(seccao), nome_pt = VALUES(nome_pt), via = 'llm'`,
      [ean, seccao, nome]).catch(() => {});
    // NOME PT — só quando o LLM diz que TRADUZIU (original não-PT): corrige a identidade canónica + a despensa
    if (nome && it.traduzido === true) {
      await pool.query('UPDATE produto_ean SET nome = ? WHERE ean = ?', [nome, ean]).catch(() => {});
      await pool.query('UPDATE despensa SET nome = ? WHERE ean = ?', [nome, ean]).catch(() => {});
    }
    n += 1;
  }
  return { n };
}

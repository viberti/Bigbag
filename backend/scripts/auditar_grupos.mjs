// AUDITORIA DE QUALIDADE da classificação (sku.grupo) — duas camadas:
//
//   1. GRÁTIS/determinística: concordância com os food_groups do Open Food Facts
//      (fonte independente, via EAN). Discordância ≠ erro: diz ONDE OLHAR.
//   2. LLM-JUIZ (outra família que o pipeline, p/ erros não correlacionados):
//      lotes pequenos (40), instrução linha-a-linha, e SEMPRE calibrado primeiro
//      com CANÁRIOS (5 erros plantados — se o juiz não os apanha, não vale nada;
//      aprendido 2026-06-11: um bug de parse deu 3 rondas de "0 erros" falsos).
//
// O juiz é triagem, não veredicto: os flags vão para revisão humana (operador).
// Resultado da 1.ª auditoria real: 36 flags em 324 → 10 erros reais (~3%), quase
// todos do mesmo padrão (palavra forte de outro grupo no nome: "Croissant de
// MANTEIGA"→lacticinios, "Batata DOCE"→doces, "MILKa"~milk). Custo: cêntimos.
//
// Uso:  node scripts/auditar_grupos.mjs            (OFF + canários + juiz)
//       MODELO=openai/gpt-4o-mini node scripts/auditar_grupos.mjs
import { getPool } from '../src/db.js';
import { chatCompletion } from '../src/openrouter.js';
import { grupoDe, grupoDeNome } from '../src/normaliza/categoria.js';

const MODELO = process.env.MODELO || 'openai/gpt-4o-mini';
const LOTE = 40;

const PROMPT = (lista) => `Auditoria de classificação de produtos de supermercado (PT).
Grupos (fechados): frutas (e legumes) · carne · peixe · lacticinios (e ovos) · padaria (SÓ pão e pastelaria fresca) · bebidas · doces (bolachas, snacks, gelados, chocolate) · congelados · higiene (e limpeza) · mercearia (SECOS: massas, arroz, farinha, cereais + conservas, azeite, molhos, sal, açúcar, leguminosas, tofu) · outros.
Verifique LINHA A LINHA (id|nome|grupo_atual): o grupo está certo para esse nome?
Liste os ERRADOS em JSON: {"suspeitos":[{"id":N,"sugerido":"...","motivo":"max 6 palavras"}]}.

${lista}`;

async function julgar(lote) {
  const lista = lote.map((s) => `${s.id}|${s.nome_canonico}|${s.grupo}`).join('\n');
  const r = await chatCompletion({
    messages: [{ role: 'user', content: PROMPT(lista) }],
    model: MODELO, responseFormat: { type: 'json_object' }, timeoutMs: 90000, contexto: 'qualidade-judge',
  });
  // chatCompletion devolve a STRING do content diretamente
  return (JSON.parse(r || '{}').suspeitos || []).map((x) => ({ ...x, id: Number(x.id) }));
}

// --scan (revisão 3.4, 2026-06-13): audita os NOMES vindos do SCAN (lista+despensa
// vivos) — o fluxo novo que não passa por auditoria nenhuma. Classifica com
// grupoDeNome (o caminho que a lista usa sem SKU) e manda ao MESMO juiz calibrado.
// Cadência sugerida: MENSAL, ou após sessão grande de scans (regra no CLAUDE.md).
const MODO_SCAN = process.argv.includes('--scan');

async function main() {
  const pool = getPool();
  let skus;
  if (MODO_SCAN) {
    const [nomes] = await pool.query(`
      SELECT DISTINCT nome FROM lista_item WHERE nome IS NOT NULL AND estado IN ('ativo','carrinho')
      UNION SELECT DISTINCT nome FROM despensa WHERE nome IS NOT NULL`);
    skus = nomes.map((r, i) => ({ id: i + 1, nome_canonico: r.nome, grupo: grupoDeNome(r.nome) }));
    console.log(`[--scan] ${skus.length} nomes de lista/despensa (classificados por grupoDeNome)`);
  } else {
    [skus] = await pool.query("SELECT id, nome_canonico, grupo FROM sku_normalizado WHERE grupo IS NOT NULL ORDER BY id");
  }

  // ── 1. concordância com o OFF (grátis; só no modo SKUs) ─────────────────────
  if (!MODO_SCAN) {
  const [comOff] = await pool.query(`
    SELECT s.id, s.nome_canonico nome, s.grupo, MAX(o.grupos_alimento) fg
      FROM sku_normalizado s
      JOIN item i ON i.sku_id = s.id AND i.ean IS NOT NULL
      JOIN off_produto o ON o.ean = i.ean COLLATE utf8mb4_unicode_ci AND o.grupos_alimento IS NOT NULL
     WHERE s.grupo IS NOT NULL GROUP BY s.id, s.nome_canonico, s.grupo`);
  let conc = 0; const discOff = [];
  for (const r of comOff) {
    let fg; try { fg = typeof r.fg === 'string' ? JSON.parse(r.fg) : r.fg; } catch { fg = null; }
    const esp = grupoDe({ foodGroups: fg });
    if (!esp || esp === 'outros') continue;
    if (esp === r.grupo) conc++; else discOff.push(`${r.nome}: nosso=${r.grupo} off=${esp}`);
  }
  console.log(`[OFF] concordância: ${conc}/${conc + discOff.length} (${Math.round(100 * conc / Math.max(1, conc + discOff.length))}%)`);
  for (const d of discOff) console.log('   ⚠', d);
  }

  // ── 2. calibrar o juiz com CANÁRIOS ─────────────────────────────────────────
  const ABS = { lacticinios: 'peixe', carne: 'bebidas', frutas: 'higiene', padaria: 'peixe', mercearia: 'carne', bebidas: 'carne', doces: 'peixe', peixe: 'doces', congelados: 'higiene', higiene: 'doces', outros: 'peixe' };
  const amostra = [...skus].sort(() => Math.random() - 0.5).slice(0, 30).map((s) => ({ ...s }));
  const canarios = new Set();
  for (let k = 0; k < 5; k++) { canarios.add(amostra[k].id); amostra[k].grupo = ABS[amostra[k].grupo] || 'higiene'; }
  const flagsCal = await julgar(amostra);
  const apanhou = flagsCal.filter((f) => canarios.has(f.id)).length;
  console.log(`\n[CANÁRIOS] apanhados: ${apanhou}/5 (falsos alarmes na amostra: ${flagsCal.length - apanhou})`);
  if (apanhou < 4) { console.log('⛔ juiz não passa na calibração — resultados abaixo não são fiáveis.'); }

  // ── 3. juiz sobre tudo, em lotes ────────────────────────────────────────────
  const flags = [];
  for (let i = 0; i < skus.length; i += LOTE) {
    try { flags.push(...await julgar(skus.slice(i, i + LOTE))); }
    catch (e) { console.log(`lote ${i}: erro ${e.message.slice(0, 60)}`); }
  }
  const porId = new Map(skus.map((s) => [s.id, s]));
  console.log(`\n[JUIZ ${MODELO}] suspeitos: ${flags.length}/${skus.length} — REVISÃO HUMANA decide:`);
  for (const f of flags) {
    const s = porId.get(f.id);
    if (s) console.log(`   ${String(s.id).padStart(5)} ${s.nome_canonico.slice(0, 42).padEnd(44)} ${s.grupo} → ${f.sugerido} · ${(f.motivo || '').slice(0, 40)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

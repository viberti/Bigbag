// Smoke-test e2e da vertical de medicamentos contra a PRODUÇÃO (endpoints públicos).
// Caso-padrão = OZEMPIC (decisão do dono, 2026-06-23: "fazer todos os testes de remédio
// com ozempic" — caro, biológico, caneta injetável, com equivalentes/genéricos → exercita
// dedup, outras-embalagens, equivalentes, PMC, imagem, explicação LLM e preço+frete+estoque).
// Só leitura (a explicação cacheia por substância e o ao-vivo alimenta o histórico — idempotente).
//
//   node scripts/smoke_remedio.mjs [busca] [cep]
//   node scripts/smoke_remedio.mjs ozempic 22241040   (default)
//   node scripts/smoke_remedio.mjs "dipirona" 01310100
const BASE = process.env.SMOKE_BASE || 'https://bigbag.hal9klabs.com/api/medicamento';
const q = process.argv[2] || 'ozempic';
const cep = process.argv[3] || '22241040';
const get = async (p) => { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(55000) }); return r.json(); };

console.log(`\n══════ SMOKE remédio: "${q}" (CEP ${cep}) ══════`);

const b = await get(`/buscar?q=${encodeURIComponent(q)}`);
console.log(`\n[1] BUSCA → ${(b.resultados || []).length} resultado(s)`);
const m0 = (b.resultados || [])[0];
if (!m0) { console.log('  (nada encontrado) — FIM'); process.exit(1); }
console.log(`  • ${m0.produto}${m0.generico ? ' (gen)' : ''} — ${m0.substancia} — a partir de R$${m0.menor_preco} — ${m0.n_farmacias} farm. — ${m0.n_apresentacoes} apres.`);
for (const a of (m0.apresentacoes || [])) console.log(`      ${a.forma || '?'} ${a.dosagem || ''} · ${a.qtd_embalagem || '?'}un · R$${a.menor_preco} · ${a.preco_por_dose != null ? a.preco_por_dose.toFixed(2) + '/un' : ''} · ean ${a.ean}`);

const ean = m0.apresentacoes[0].ean;
const j = await get(`/info?ean=${ean}`);
const id = j.identidade;
console.log(`\n[2] FICHA (ean ${ean})`);
console.log(`  ${id.produto} | ${id.forma} ${id.dosagem} | ${id.laboratorio}`);
console.log(`  tipo=${id.tipo} · anvisa=${id.categoria_anvisa} · tarja=${id.tarja || '-'} · registro=${id.registro_fmt}`);
console.log(`  imagem: ${j.imagem ? j.imagem.slice(0, 72) : '(NENHUMA)'}`);
console.log(`  + barato (cache): R$${j.melhor ? j.melhor.preco + ' @' + j.melhor.fonte : '-'} · PMC: ${j.comparacao ? j.comparacao.pct_vs_pmc + '% abaixo (teto R$' + j.comparacao.pmc + ')' : '-'}`);
console.log(`  outras_embalagens=${(j.outras_embalagens || []).length} · equivalentes(outras marcas)=${(j.equivalentes || []).length}`);
for (const e of (j.outras_embalagens || [])) console.log(`      embalagem ${e.referencia ? '»ESTE ' : ''}${e.qtd_embalagem}un · R$${e.menor_preco} · ${e.preco_por_dose != null ? e.preco_por_dose.toFixed(2) + '/un' : ''}`);
for (const e of (j.equivalentes || [])) console.log(`      equiv ${e.produto}${e.generico ? ' (gen)' : ''} · R$${e.menor_preco} · ${e.preco_por_dose != null ? e.preco_por_dose.toFixed(2) + '/un' : ''}`);

const ex = await get(`/explicacao?ean=${ean}`);
console.log(`\n[3] PARA QUE SERVE`);
console.log(`  serve: ${ex.para_que_serve || '-'}`);
console.log(`  usar: ${ex.como_usar || '-'}`);
console.log(`  cuidados: ${ex.cuidados || '-'}`);

const v = await get(`/precos-ao-vivo?ean=${ean}&cep=${cep}`);
const ent = (v.fontes || []).filter((f) => f.entrega || f.frete_gratis_maiores);
console.log(`\n[4] AO VIVO (preço+frete+estoque) → ${(v.fontes || []).length} c/ oferta+estoque · ${ent.length} entregam ao CEP`);
for (const f of ent.sort((a, b) => (a.total ?? a.preco) - (b.total ?? b.preco)).slice(0, 8))
  console.log(`  ${f.fonte.padEnd(17)}R$${String(f.preco).padEnd(10)}${f.entrega ? ('+frete R$' + f.frete + ' = R$' + f.total) : '(pedido maior)'}${f.prazo ? ' · ' + f.prazo : ''}`);
console.log('\n══════ FIM ══════');

// Auditoria dos Produtos Mestre com os VALIDADORES: aprende a afinidade
// marca→categoria do histórico e sinaliza membros IMPLAUSÍVEIS (unidade
// incompatível, €/base anómalo, marca não faz a categoria). Mostra quantos
// misreads (tipo b) os guardas apanham SEM admin. Read-only (só relata).
import { getPool } from '../src/db.js';
import { marcaCompativel, precoPlausivel } from '../src/normaliza/validadores.js';
import { ln } from '../src/normaliza/mestre.js';

const db = getPool();
const [rows] = await db.query(
  `SELECT s.id, s.marca, s.unidade_base AS un, s.mestre_id, m.categoria, m.chave,
          (SELECT AVG(i.preco_por_base) FROM item i WHERE i.sku_id = s.id AND i.preco_por_base IS NOT NULL) AS ppb
     FROM sku_normalizado s JOIN produto_mestre m ON m.id = s.mestre_id`,
);

// afinidade marca→categoria (aprendida de TODAS as atribuições)
const afin = new Map(); // marca(norm) -> {categoria: count}
for (const r of rows) {
  const mk = ln(r.marca);
  if (!mk || !r.categoria) continue;
  const a = afin.get(mk) || afin.set(mk, {}).get(mk);
  a[r.categoria] = (a[r.categoria] || 0) + 1;
}
// especialistas (≤4 categorias, ≥3 obs)
const especialistas = [...afin.entries()].filter(([, a]) => { const t = Object.values(a).reduce((s, n) => s + n, 0); return t >= 3 && Object.keys(a).length <= 4; });
console.log('marcas com afinidade aprendida:', afin.size, '| especialistas:', especialistas.length);

// agrupa por mestre
const porMestre = new Map();
for (const r of rows) (porMestre.get(r.mestre_id) || porMestre.set(r.mestre_id, []).get(r.mestre_id)).push(r);

const suspeitos = [];
for (const [, membros] of porMestre) {
  if (membros.length < 2) continue;
  const cat = membros[0].categoria;
  const unidades = new Set(membros.map((m) => m.un).filter(Boolean));
  const ppbs = membros.map((m) => Number(m.ppb)).filter((x) => Number.isFinite(x) && x > 0);
  for (const m of membros) {
    const motivos = [];
    if (unidades.size > 1) motivos.push('unidade inconsistente no Mestre {' + [...unidades].join(',') + '}');
    if (!precoPlausivel(Number(m.ppb), ppbs.filter((_, i) => true))) motivos.push('€/base anómalo');
    if (!marcaCompativel(cat, afin.get(ln(m.marca)))) motivos.push('marca "' + m.marca + '" não faz "' + cat + '"');
    if (motivos.length) suspeitos.push({ id: m.id, cat, marca: m.marca, un: m.un, motivos });
  }
}

console.log('\n=== SUSPEITOS sinalizados pelos validadores (' + suspeitos.length + ') ===');
for (const s of suspeitos) console.log('  #' + s.id + ' [' + s.cat + ' · ' + (s.marca || '—') + ' · ' + (s.un || '?') + '] → ' + s.motivos.join(' ; '));
console.log('\n(Estes são os que iriam para admin; os guardas apanham-nos automaticamente.)');
await db.end();

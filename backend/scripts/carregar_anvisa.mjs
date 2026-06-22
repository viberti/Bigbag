// Carrega o Dados Abertos da ANVISA (DADOS_ABERTOS_MEDICAMENTOS.csv) → tabela
// anvisa_registro (por registro-produto de 9 dígitos) e enriquece `medicamento` com a
// CATEGORIA REGULATÓRIA oficial (Genérico/Similar/Novo/...) e o PRINCÍPIO ATIVO. A ponte
// com o nosso CMED é LEFT(medicamento.registro, 9) = NUMERO_REGISTRO_PRODUTO.
//
// O servidor NÃO alcança dados.anvisa.gov.br → baixar no PC e enviar:
//   curl -L -o anvisa_med.csv https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv
//   scp anvisa_med.csv pitacos-prod:/tmp/
// Uso (no SERVIDOR):
//   sudo -u dev node --env-file=.env scripts/carregar_anvisa.mjs [/tmp/anvisa_med.csv]
// CSV: separador ';', valores entre aspas, codificação LATIN1 (ISO-8859-1).
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';

const arg = process.argv[2] || '/tmp/anvisa_med.csv';

// Parser de linha CSV que respeita aspas (campos podem conter ';' dentro de "...").
function parseLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const txt = readFileSync(arg, 'latin1'); // ISO-8859-1 → string JS (utf8)
  const lines = txt.split(/\r?\n/);
  const H = parseLine(lines[0]);
  const idx = (n) => H.indexOf(n);
  const iReg = idx('NUMERO_REGISTRO_PRODUTO'), iCat = idx('CATEGORIA_REGULATORIA'),
    iPA = idx('PRINCIPIO_ATIVO'), iCl = idx('CLASSE_TERAPEUTICA'), iNome = idx('NOME_PRODUTO'), iSit = idx('SITUACAO_REGISTRO');
  if (iReg < 0 || iCat < 0) throw new Error('colunas esperadas não encontradas (cabeçalho mudou?)');

  // 1 linha por registro-produto (9 díg.); preferir situação Ativo + princípio preenchido.
  const reg = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = parseLine(lines[i]);
    const r = (c[iReg] || '').replace(/\D/g, '');
    if (r.length < 9) continue;
    const k = r.slice(0, 9);
    const row = {
      categoria: (c[iCat] || '').trim() || null, pa: (c[iPA] || '').trim() || null,
      classe: (c[iCl] || '').trim() || null, nome: (c[iNome] || '').trim() || null, sit: (c[iSit] || '').trim() || null,
    };
    const ex = reg.get(k);
    if (!ex || (row.sit === 'Ativo' && ex.sit !== 'Ativo') || (!ex.pa && row.pa)) reg.set(k, row);
  }
  console.log(`[anvisa] ${lines.length - 1} linhas · ${reg.size} registros-produto distintos.`);

  const pool = getPool();
  const vals = [...reg.entries()].map(([k, v]) => [k, v.categoria, v.pa ? v.pa.slice(0, 400) : null, v.classe ? v.classe.slice(0, 255) : null, v.nome ? v.nome.slice(0, 300) : null, v.sit]);
  for (let i = 0; i < vals.length; i += 500) {
    const lote = vals.slice(i, i + 500);
    await pool.query(
      `INSERT INTO anvisa_registro (registro9, categoria, principio_ativo, classe_terapeutica, nome_produto, situacao)
       VALUES ${lote.map(() => '(?,?,?,?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE categoria=VALUES(categoria), principio_ativo=VALUES(principio_ativo),
         classe_terapeutica=VALUES(classe_terapeutica), nome_produto=VALUES(nome_produto), situacao=VALUES(situacao)`,
      lote.flat(),
    );
  }

  // Enriquecer `medicamento` por LEFT(registro,9). A categoria/genérico ANVISA é
  // AUTORITATIVA → sobrepõe-se ao tipo da CMED nos EANs que casam.
  const [upd] = await pool.query(
    `UPDATE medicamento m JOIN anvisa_registro a ON LEFT(m.registro, 9) = a.registro9
        SET m.categoria_anvisa = a.categoria,
            m.principio_ativo  = COALESCE(NULLIF(a.principio_ativo, ''), m.substancia),
            m.generico         = CASE WHEN a.categoria = 'Genérico' THEN 1 ELSE 0 END
      WHERE LENGTH(m.registro) = 13`,
  );
  const [[c]] = await pool.query(
    "SELECT COUNT(*) n, SUM(categoria_anvisa IS NOT NULL) com, SUM(generico) gen FROM medicamento",
  );
  console.log(`✅ [anvisa] medicamento enriquecidos: ${upd.affectedRows} · com categoria ANVISA: ${c.com}/${c.n} · genéricos (ANVISA): ${c.gen}`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

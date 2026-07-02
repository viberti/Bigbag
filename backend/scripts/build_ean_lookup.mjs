// Materializa `ean_lookup`: 1 linha por EAN para consulta rápida EAN→(nome, marca,
// categoria) — consumida por outros projetos (ex.: Noteca/lerqrcode) pela vista
// `v_ean_lookup`. Campos: ean (PK) · nome · marca · cat_n1 (categoria CRUA grossa do
// retalhista) · grupo (o nosso corredor, via grupoDeNome(nome)) · categoria_anvisa · tarja
// (só farmácia) · fonte ('catalogo' | 'medicamento').
//
// Fontes: `catalogo_produto` deduplicado (supermercado, melhor linha por EAN) +
// `medicamento` (farmácia — TEM PRECEDÊNCIA: identidade CMED/ANVISA é mais limpa).
// O `grupo` só se calcula aqui (é JS puro, não SQL) — por isso tabela materializada e não
// vista viva. Cache 100% REGENERÁVEL (deriva de catalogo_produto+medicamento) → rebuild
// por TRUNCATE+INSERT é seguro (não é fonte; a regra "nunca DELETE" é para dados de origem).
//
// Uso (no servidor): sudo -u dev node --env-file=.env scripts/build_ean_lookup.mjs
import { getPool, closePool } from '../src/db.js';
import { grupoDeNome } from '../src/normaliza/categoria.js';

const grupoDe = (nome) => { try { return nome ? (grupoDeNome(nome) || null) : null; } catch { return null; } };

async function inserir(pool, linhas) {
  for (let i = 0; i < linhas.length; i += 1000) {
    const chunk = linhas.slice(i, i + 1000);
    await pool.query(
      'INSERT INTO ean_lookup (ean,nome,marca,cat_n1,grupo,categoria_anvisa,tarja,fonte) VALUES '
      + chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')
      + ' ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), cat_n1=VALUES(cat_n1),'
      + ' grupo=VALUES(grupo), categoria_anvisa=VALUES(categoria_anvisa), tarja=VALUES(tarja), fonte=VALUES(fonte)',
      chunk.flat(),
    );
  }
}

async function main() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS ean_lookup (
    ean VARCHAR(20) NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NULL,
    marca VARCHAR(140) NULL,
    cat_n1 VARCHAR(120) NULL,
    grupo VARCHAR(40) NULL,
    categoria_anvisa VARCHAR(60) NULL,
    tarja VARCHAR(80) NULL,
    fonte VARCHAR(16) NOT NULL,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY (fonte)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query('TRUNCATE TABLE ean_lookup');

  // 1) SUPERMERCADO: melhor linha por EAN do catalogo_produto (prefere marca+cat_n1+nome; recente)
  const [cat] = await pool.query(`
    SELECT ean, nome, marca, cat_n1 FROM (
      SELECT ean, nome, marca, cat_n1,
        ROW_NUMBER() OVER (PARTITION BY ean ORDER BY
          (marca  IS NOT NULL AND marca  <> '') DESC,
          (cat_n1 IS NOT NULL AND cat_n1 <> '') DESC,
          (nome   IS NOT NULL AND nome   <> '') DESC,
          scraped_at DESC) rn
      FROM catalogo_produto WHERE ean IS NOT NULL AND ean <> ''
    ) t WHERE rn = 1`);
  await inserir(pool, cat.map((r) => [
    String(r.ean), r.nome || null, r.marca || null, r.cat_n1 || null, grupoDe(r.nome), null, null, 'catalogo',
  ]));
  console.log(`[ean_lookup] supermercado (catalogo): ${cat.length} EANs`);

  // 2) FARMÁCIA: medicamento sobrepõe (identidade oficial). grupo=null (têm categoria_anvisa).
  const [med] = await pool.query(
    "SELECT ean, produto, laboratorio, categoria_anvisa, tarja FROM medicamento WHERE ean IS NOT NULL AND ean <> ''");
  await inserir(pool, med.map((r) => [
    String(r.ean), r.produto || null, r.laboratorio || null, null, null, r.categoria_anvisa || null, r.tarja || null, 'medicamento',
  ]));
  console.log(`[ean_lookup] farmácia (medicamento): ${med.length} EANs`);

  const [[c]] = await pool.query(
    "SELECT COUNT(*) n, SUM(fonte='medicamento') med, SUM(marca IS NOT NULL) cm, SUM(cat_n1 IS NOT NULL) cc, SUM(grupo IS NOT NULL) cg FROM ean_lookup");
  console.log(`✅ ean_lookup: ${c.n} EANs | farmácia ${c.med} | c/marca ${c.cm} | c/cat_n1 ${c.cc} | c/grupo ${c.cg}`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

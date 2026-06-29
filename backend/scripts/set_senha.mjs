// Define/atualiza a senha de um utilizador do BigBag (hash scrypt na tabela `usuario`).
// A senha NUNCA é commitada nem registada — só o hash vai à BD.
//
// Uso (NO SERVIDOR, como o user do projeto):
//   cd /home/dev/bigbag/backend
//   sudo -u dev node --env-file=.env scripts/set_senha.mjs <email> "<Nome>" '<senha>'
// Exemplos:
//   sudo -u dev node --env-file=.env scripts/set_senha.mjs gviberti3@gmail.com "Gustavo" 'a-tua-senha'
//   sudo -u dev node --env-file=.env scripts/set_senha.mjs suerocha@gmail.com "Sue" 'senha-da-sue'
// Cria a linha se não existir (país default). Reexecutar troca a senha.
import { getPool, closePool } from '../src/db.js';
import { hashSenha } from '../src/auth.js';
import { config } from '../src/config.js';

const [emailArg, nomeArg, senha] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
if (!email || !email.includes('@') || !senha) {
  console.error('uso: node scripts/set_senha.mjs <email> "<Nome>" \'<senha>\'');
  process.exit(1);
}
if (String(senha).length < 6) { console.error('senha muito curta (mín. 6).'); process.exit(1); }

const pool = getPool();
try {
  await pool.query(
    `INSERT INTO usuario (email, nome, senha_hash, pais) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nome = VALUES(nome), senha_hash = VALUES(senha_hash)`,
    [email, nomeArg || null, hashSenha(senha), config.paisDefault]);
  console.log(`✓ senha definida para ${email}${nomeArg ? ` (${nomeArg})` : ''}`);
} finally {
  await closePool();
}

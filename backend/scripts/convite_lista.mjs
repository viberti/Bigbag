// Gera o LINK DE ACESSO DA CASA à app Lista (sem conta; abre direto em "Quem está usando?").
// Abrir o link UMA vez em cada telemóvel; fica guardado lá. O token vai no #fragmento (não chega aos
// logs do servidor) e só dá acesso às rotas da lista (ver ROTAS_LISTA em src/auth.js).
// Corre-o o DONO (como o set_senha): o link é uma credencial — não o partilhes fora de casa.
// ANULAR todos os links (ex.: um perdeu-se): subir LISTA_CONVITE_VERSAO no .env, restart, e
// gerar um novo com este script.
//   sudo -u dev node --env-file=.env scripts/convite_lista.mjs [https://lista.hal9klabs.com]
import { assinarConviteLista } from '../src/auth.js';
import { config } from '../src/config.js';

const base = (process.argv[2] || 'https://lista.hal9klabs.com').replace(/\/+$/, '');
const token = await assinarConviteLista();
console.log(`Link de acesso da casa (versão ${config.auth.listaConviteVersao}):\n\n${base}/#casa=${token}\n`);

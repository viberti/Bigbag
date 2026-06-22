// Roteamento de saída por proxy (PROXY_URL) — usado SÓ pelos scripts de colheita,
// e SÓ para fontes GEO-BLOQUEADAS (ex.: DPSP Pacheco/Drogaria São Paulo, cujo
// CloudFront bloqueia IPs fora do Brasil). Importante: isto NÃO contorna
// bot-detection/CAPTCHA — é aceder a um site PÚBLICO a partir do país onde ele é
// servido (o que qualquer utilizador brasileiro faz). Seletivo por desenho: só o
// processo que chama aplicarProxy() roteia pelo proxy; o servidor da app nunca
// importa este módulo, por isso a rede do host (e dos projetos vizinhos) fica intacta.
//
// PROXY_URL vive no .env (600, dono dev) — endpoint HTTP/HTTPS com saída BR. Nunca
// no repo nem em log (a password é mascarada abaixo).
import { ProxyAgent, setGlobalDispatcher } from 'undici';

export function aplicarProxy(url = process.env.PROXY_URL) {
  if (!url) { console.log('[rede] --proxy pedido mas PROXY_URL não está no .env — a sair DIRETO.'); return false; }
  setGlobalDispatcher(new ProxyAgent(url));
  const masc = String(url).replace(/(\/\/[^:@/]+:)[^@/]*@/, '$1***@'); // não revela a password
  console.log('[rede] saída via proxy:', masc);
  return true;
}

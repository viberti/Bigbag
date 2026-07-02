// Classificador de VERTICAL de uma fonte (farmácia vs mercearia). Mecanismo A (dono,
// 2026-06-23): derivado dos dois manifestos, SEM coluna nova. DEFAULT para fonte
// DESCONHECIDA = 'outro' (NUNCA 'farmacia') — uma fonte futura não declarada não pode
// re-poluir o escopo de remédio em silêncio.
import { readFileSync } from 'node:fs';
const ler = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')).map((f) => f.fonte);
const FARMACIAS = new Set(ler('../../scripts/fontes_farmacia.json'));
// supermercados: o manifesto VTEX de mercearia + os 4 órfãos (têm dados BRL mas ficam fora
// dos manifestos — paodeacucar/condor/extra/superprix; ingestão não-declarada, ver backlog).
const MERCEARIAS = new Set([...ler('../../scripts/fontes_vtex.json'), 'condor', 'extra', 'paodeacucar', 'superprix']);
// pet shops (ração/higiene/acessórios de animais) — vertical PRÓPRIA p/ não poluir a mercearia.
const PETSHOPS = new Set(ler('../../scripts/fontes_pet.json'));

export function verticalDaFonte(fonte) {
  if (FARMACIAS.has(fonte)) return 'farmacia';
  if (PETSHOPS.has(fonte)) return 'pet';
  if (MERCEARIAS.has(fonte)) return 'mercearia';
  return 'outro';
}
export const ehFarmacia = (fonte) => verticalDaFonte(fonte) === 'farmacia';

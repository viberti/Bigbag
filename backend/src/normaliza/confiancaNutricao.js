// CONFIANÇA da nutrição por EAN (qualidade de dados camada F, 2026-06-30).
// Funde os sinais das camadas A/C num nível único que a UI usa para mostrar a nota
// COM RESSALVA quando os dados não são de fiar (princípio §5 da metodologia: saída
// derivada de dados que podem faltar/errar EXPÕE a sua completude/validade).
//
// Sinais (todos já existentes):
//   • completude — quantos campos relevantes para a nota estão presentes.
//   • corroboração — `confirmada` (nutrição de catálogo/OFF=fiável; só-VLM=por confirmar).
//   • suspeita de família (C2, envelopeNutricao) — algum nutriente improvável p/ a família.
// A nota universal NÃO se esconde (é factual); mostra-se com ressalva. (O impossível já
// foi anulado na camada A, logo aqui a nutrição presente já passou na plausibilidade.)
import { nutricaoSuspeita } from './envelopeNutricao.js';

// Campos que pesam na nota (universal + Atwater). Os 4 primeiros são os OBRIGATÓRIOS.
const CAMPOS = ['energia_kcal', 'gordura_saturada', 'acucares', 'sal', 'gordura', 'proteina', 'fibra', 'hidratos'];

// Devolve { nivel: 'alto'|'medio'|'baixo'|'nenhum', completude:{presentes,total}, suspeitos:[...],
//           confirmada:bool, motivos:[...] }. opts: { familia, confirmada, envelopes }.
export function confiancaNutricao(n, { familia, confirmada, envelopes } = {}) {
  const total = CAMPOS.length;
  if (!n || typeof n !== 'object') {
    return { nivel: 'nenhum', completude: { presentes: 0, total }, suspeitos: [], confirmada: false, motivos: ['sem nutrição'] };
  }
  const presentes = CAMPOS.filter((c) => n[c] != null).length;
  const suspeitos = (familia && envelopes) ? nutricaoSuspeita(n, familia, envelopes) : [];
  const motivos = [];
  let nivel = 'alto';
  // (1) suspeita de família = o sinal mais forte de "errado" → baixo.
  if (suspeitos.length) {
    nivel = 'baixo';
    motivos.push(`valor improvável para ${familia} (${suspeitos.map((s) => s.nutriente).join(', ')})`);
  } else {
    // (2) não corroborado (só leitura por imagem) → médio.
    if (!confirmada) { nivel = 'medio'; motivos.push('só leitura por imagem (não corroborado por catálogo/OFF)'); }
    // (3) poucos campos → médio (não desce a baixo só por incompletude; é honesto, não "errado").
    if (presentes < 5) { if (nivel === 'alto') nivel = 'medio'; motivos.push(`nutrição parcial (${presentes}/${total} campos)`); }
  }
  return { nivel, completude: { presentes, total }, suspeitos, confirmada: !!confirmada, motivos };
}

export const _interno = { CAMPOS };

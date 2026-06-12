// Testes do voto de categoria por catálogo (Fase 1 da estratégia 2026-06-13).
// O fixture "polpa de tomate" é REAL — medido no servidor: 20× Continente raso,
// 19× Auchan 4 níveis, 16× Pingo Doce 3 níveis, 3× mercadona-off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { niveisDePath, exibirFolha, votarCategoria } from '../src/normaliza/classificarCatalogo.js';

test('niveisDePath: raiz administrativa fora; ES e tags marcados', () => {
  const a = niveisDePath('auchan', 'alimentacao/mercearia/polpas-caldos-e-temperos/polpa-tomate');
  assert.equal(a.profundidade, 3); // 'alimentacao' não conta
  assert.equal(a.folha, 'polpa-tomate');
  assert.equal(a.es, false);
  const m = niveisDePath('mercadona', 'Aceite, especias y salsas/Aceite, vinagre y sal/Aceite de oliva');
  assert.equal(m.es, true);
  assert.equal(niveisDePath('mercadona-off', 'en:Tomato pulps').es, true);
  assert.equal(niveisDePath('continente', null), null);
});

test('exibirFolha: kebab→legível, conectores minúsculos', () => {
  assert.equal(exibirFolha('polpa-tomate'), 'Polpa Tomate');
  assert.equal(exibirFolha('polpas-e-concentrados'), 'Polpas e Concentrados');
  assert.equal(exibirFolha('en:Tomato pulps'), 'Tomato Pulps');
  assert.equal(exibirFolha('Conservas'), 'Conservas');
});

test('votarCategoria: caso real "polpa de tomate" — vota a FAMÍLIA (2.º nível), não a folha', () => {
  const cands = [
    ...Array.from({ length: 20 }, () => ({ fonte: 'continente', path: 'Mercearia/Conservas' })),
    ...Array.from({ length: 19 }, () => ({ fonte: 'auchan', path: 'alimentacao/mercearia/polpas-caldos-e-temperos/polpa-tomate' })),
    ...Array.from({ length: 16 }, () => ({ fonte: 'pingodoce', path: 'mercearia/temperos-e-molhos/polpas-e-concentrados' })),
    ...Array.from({ length: 2 }, () => ({ fonte: 'mercadona-off', path: 'Polpas de tomate' })),
  ];
  const v = votarCategoria(cands);
  // famílias: Auchan 'polpas-caldos-e-temperos' 19×3=57 > PD 'temperos-e-molhos' 48 > Cont 'Conservas' 40
  assert.equal(v.folha, 'Polpas Caldos e Temperos');
  assert.equal(v.fonte, 'auchan');
  assert.ok(v.votos.length >= 3);
});

test('votarCategoria: as 5 folhas de massa COLAPSAM na família (caso real da 3.ª iteração)', () => {
  const v = votarCategoria([
    { fonte: 'auchan', path: 'alimentacao/mercearia/arroz-e-massa/massas-especialidades' },
    { fonte: 'auchan', path: 'alimentacao/mercearia/arroz-e-massa/esparguete-aletria-e-meadas' },
    { fonte: 'auchan', path: 'alimentacao/mercearia/arroz-e-massa/cotovelos-espiral-e-massinhas' },
    { fonte: 'auchan', path: 'alimentacao/mercearia/arroz-e-massa/massa' },
  ]);
  assert.equal(v.folha, 'Arroz e Massa'); // uma família, não 4 folhas
  assert.equal(v.confianca, 1);
});

test('votarCategoria: ES vale metade; raso (1 nível) não vota; vazio dá null', () => {
  const v = votarCategoria([
    { fonte: 'mercadona', path: 'Aceite, especias y salsas/Salsas/Tomate frito' }, // família Salsas, 3×0.5=1.5
    { fonte: 'pingodoce', path: 'mercearia/molhos' },                              // família molhos, 2×1=2
  ]);
  assert.equal(v.folha, 'Molhos');
  assert.equal(votarCategoria([]), null);
  assert.equal(votarCategoria([{ fonte: 'x', path: null }]), null);
  assert.equal(votarCategoria([{ fonte: 'continente', path: 'Mercearia' }]), null); // raso → sem voto
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonLoose } from '../src/ingest/extract.js';

test('JSON normal', () => {
  assert.deepEqual(parseJsonLoose('{"nome":"Sauerkraut","marca":"All Seasons"}'), { nome: 'Sauerkraut', marca: 'All Seasons' });
});

test('remove cercas de código', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
});

test('tolera vírgulas finais (erro comum de LLM)', () => {
  assert.deepEqual(parseJsonLoose('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
});

test('JSON irrecuperável re-lança (→ o chamador faz retry)', () => {
  assert.throws(() => parseJsonLoose('{"a": "valor sem fecho'));
});

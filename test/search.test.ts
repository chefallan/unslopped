import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, rank, snippet } from '../src/search.ts';

test('tokenize lowercases, keeps paths, drops stop words', () => {
  assert.deepEqual(tokenize('Add the /health endpoint to src/server.js'), ['add', 'health', 'endpoint', 'src/server.js']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('A an I'), []);
});

test('rank orders by relevance, reports coverage', () => {
  const docs = [
    { id: 'a', text: 'add health endpoint returning git sha' },
    { id: 'b', text: 'fix login timeout in auth service' },
    { id: 'c', text: 'health check for the login page' },
  ];
  const r = rank('health endpoint', docs);
  assert.equal(r[0].id, 'a');
  assert.equal(r[0].coverage, 1);
  assert.equal(r.length, 2);
  assert.equal(rank('nothing here', docs).length, 0);
  assert.equal(rank('health', []).length, 0);
});

test('snippet returns the first line that mentions a query word', () => {
  assert.equal(snippet('first line\nthe login broke\nlast', 'login'), 'the login broke');
  assert.equal(snippet('only line', 'zzz'), 'only line');
});

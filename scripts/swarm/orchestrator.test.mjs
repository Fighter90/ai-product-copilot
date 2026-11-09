// parsePickOutput — the swarm orchestrator's Linear-pick parser and its identifier
// validator. Regression from the career-ops-ui first live run: the clerk echoed the
// FORMAT TEMPLATE (SWARM_PICK::<issueId>::<identifier>::<title> with literal angle-bracket
// placeholders); the old parser happily returned `<identifier>` as the issue, the branch
// checkout failed, and an executor started on `main`. The validator must refuse anything
// that is not a real Linear identifier (e.g. ANA-123).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePickOutput } from './orchestrator.mjs';

test('parses a real pick line', () => {
  const issue = parsePickOutput('blah\nSWARM_PICK::uuid-1::ANA-123::Фикс воронки: агрегация URL\ntrailer');
  assert.deepEqual(issue, { id: 'uuid-1', identifier: 'ANA-123', title: 'Фикс воронки: агрегация URL' });
});

test('NONE means an empty queue', () => {
  assert.equal(parsePickOutput('SWARM_PICK::NONE'), null);
});

test('REFUSES the literal placeholder echo (the first-run regression)', () => {
  assert.throws(
    () => parsePickOutput('SWARM_PICK::<issueId>::<identifier>::<title>'),
    /placeholder characters/,
  );
});

test('REFUSES placeholder characters anywhere in the payload', () => {
  assert.throws(() => parsePickOutput('SWARM_PICK::uuid::<ANA-1>::title'), /placeholder characters/);
  assert.throws(() => parsePickOutput('SWARM_PICK::uuid::ANA-1::<title>'), /placeholder characters/);
});

test('REFUSES garbage that does not name an issue', () => {
  assert.throws(() => parsePickOutput('SWARM_PICK::uuid::hello world::title'), /non-issue identifier/);
  assert.throws(() => parsePickOutput('no marker at all'), /cannot parse/);
});

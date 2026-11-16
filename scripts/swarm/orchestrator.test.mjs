// parsePickOutput — the swarm orchestrator's Linear-pick parser and its identifier
// validator. Regression from the career-ops-ui first live run: the clerk echoed the
// FORMAT TEMPLATE (SWARM_PICK::<issueId>::<identifier>::<title> with literal angle-bracket
// placeholders); the old parser happily returned `<identifier>` as the issue, the branch
// checkout failed, and an executor started on `main`. The validator must refuse anything
// that is not a real Linear identifier (e.g. ANA-123).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePickOutput, verifyProdHealth, reviewDiffBlock, applyVars } from './orchestrator.mjs';

test('parses a real pick line', () => {
  const issue = parsePickOutput(
    'blah\nSWARM_PICK::uuid-1::ANA-123::Фикс воронки: агрегация URL\ntrailer',
  );
  assert.deepEqual(issue, {
    id: 'uuid-1',
    identifier: 'ANA-123',
    title: 'Фикс воронки: агрегация URL',
  });
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
  assert.throws(
    () => parsePickOutput('SWARM_PICK::uuid::<ANA-1>::title'),
    /placeholder characters/,
  );
  assert.throws(
    () => parsePickOutput('SWARM_PICK::uuid::ANA-1::<title>'),
    /placeholder characters/,
  );
});

test('REFUSES garbage that does not name an issue', () => {
  assert.throws(
    () => parsePickOutput('SWARM_PICK::uuid::hello world::title'),
    /non-issue identifier/,
  );
  assert.throws(() => parsePickOutput('no marker at all'), /cannot parse/);
});

// ANA-130: the post-deploy prod gate — after deploy.sh finishes, dashboardcamp.ru
// /api/health must report EXACTLY the version the swarm just released. A mismatch means
// the wrong build (or a stale backend) is on prod and the cycle must fail the issue.
test('verifyProdHealth accepts the released version', () => {
  const payload = JSON.stringify({ status: 'ok', version: '3.4.7', build: 'abc1234' });
  assert.equal(verifyProdHealth(payload, '3.4.7'), '3.4.7');
});

test('verifyProdHealth tolerates noise around the JSON payload', () => {
  const payload = 'warning line\n{"status":"ok","version":"3.5.0"}\n\n';
  assert.equal(verifyProdHealth(payload, '3.5.0'), '3.5.0');
});

test('verifyProdHealth rejects a version mismatch (stale backend on prod)', () => {
  assert.throws(
    () => verifyProdHealth('{"status":"ok","version":"3.4.6"}', '3.4.7'),
    /deployed 3\.4\.6 != released 3\.4\.7/,
  );
});

test('verifyProdHealth rejects non-JSON, unhealthy and versionless payloads', () => {
  assert.throws(() => verifyProdHealth('<html>502 Bad Gateway</html>', '3.4.7'), /not JSON/);
  assert.throws(
    () => verifyProdHealth('{"status":"error","version":"3.4.7"}', '3.4.7'),
    /status=error/,
  );
  assert.throws(() => verifyProdHealth('{"status":"ok"}', '3.4.7'), /no version field/);
});

// ANA-194: the reviewer judges ONLY the inline diff (its prompt forbids reading the
// repository), so a silently sliced diff is indistinguishable from a complete one — large
// changes were reviewed on their first 60k characters and falsely RETURNed as
// "insufficient context" across the whole backlog. reviewDiffBlock must pass normal diffs
// through whole and mark any remaining cut with an explicit, self-describing marker.
test('reviewDiffBlock passes a diff that fits whole', () => {
  const diff = 'diff --git a/x.ts b/x.ts\n+++ b/x.ts\n+const ok = true;\n';
  const d = reviewDiffBlock(diff);
  assert.equal(d.truncated, false);
  assert.equal(d.totalChars, diff.length);
  assert.equal(d.shownChars, diff.length);
  assert.ok(d.block.startsWith('<DIFF>\n'));
  assert.ok(d.block.endsWith('\n</DIFF>'));
  assert.ok(!d.block.includes('TRUNCATED'));
});

test('reviewDiffBlock marks an oversized diff instead of cutting it silently', () => {
  const big = `${'a'.repeat(500)}TAIL_BEYOND_CAP`;
  const d = reviewDiffBlock(big, 500);
  assert.equal(d.truncated, true);
  assert.equal(d.totalChars, big.length);
  assert.equal(d.shownChars, 500);
  assert.ok(d.block.includes('a'.repeat(500))); // the visible prefix is intact
  assert.ok(!d.block.includes('TAIL_BEYOND_CAP')); // content past the cap stays out
  assert.ok(d.block.includes('[DIFF TRUNCATED by the swarm: showing first 500 of 515 characters]'));
  assert.ok(d.block.endsWith('\n</DIFF>'));
});

// The worker substitutes role-template placeholders via String.replaceAll; a STRING
// replacement interprets `$&`, `` $` ``, `$'` and `$$` inside the VALUE as replacement
// patterns — a diff containing e.g. a sed snippet with `$&` was silently corrupted before
// reaching the reviewer. applyVars must insert values literally.
test('applyVars inserts $-patterns literally (no replacement-pattern corruption)', () => {
  const out = applyVars('before {{DIFF}} after', { DIFF: "sed 's/a/$&/' && echo $$1" });
  assert.equal(out, "before sed 's/a/$&/' && echo $$1 after");
});

test('applyVars substitutes every placeholder, an undefined value becomes empty', () => {
  assert.equal(
    applyVars('A={{A}} B={{B}} C={{C}}', { A: 'x', B: undefined, C: 'z' }),
    'A=x B= C=z',
  );
});

#!/usr/bin/env node
// ANA-69: release code review with claude-opus-5-5 (Anthropic API). Reads the high-risk areas of
// the release diff, sends them in chunks, prints findings as JSON. Read-only — no repo changes.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', `file://${process.cwd()}/`).pathname;
const KEY = (process.env.ANTHROPIC_API_KEY ?? readKey()).trim();
const MODEL = 'claude-opus-5-5';

function readKey() {
  const env = readFileSync(join(ROOT, '.env'), 'utf8');
  const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (!m) throw new Error('ANTHROPIC_API_KEY not found');
  return m[1];
}

const CHUNKS = [
  {
    area: 'backend: auth/security/settings + new marketing & coverage',
    files: [
      'code/backend/src/auth/auth.ts',
      'code/backend/src/auth/users-repo.ts',
      'code/backend/src/security/crypto.ts',
      'code/backend/src/marketing/routes.ts',
      'code/backend/src/marketing/sync.ts',
      'code/backend/src/db/repositories/marketing-repo.ts',
      'code/backend/src/data/coverage.ts',
      'code/backend/src/routes/b2b.ts',
      'code/backend/src/routes/payments.ts',
    ],
  },
  {
    area: 'backend: metrika sync + frontend api/auth + marketing page',
    files: [
      'code/backend/src/metrika/sync-service.ts',
      'code/backend/src/metrika/production-sync.ts',
      'code/frontend/src/lib/api.ts',
      'code/frontend/src/auth/AuthContext.tsx',
      'code/frontend/src/routes/marketing.tsx',
    ],
  },
  {
    area: 'deploy + CI workflows (secrets, injection, rsync)',
    files: [
      'deploy/deploy.sh',
      '.github/workflows/deploy.yml',
      '.github/workflows/release.yml',
      '.github/workflows/packages.yml',
      'scripts/reconcile-lib.mjs',
    ],
  },
];

const PROMPT = `Ты — строгий код-ревьюер релиза веб-приложения (Fastify + SQLite + React, кабинет аналитики с ролями admin/analyst).
Найди ТОЛЬКО реальные дефекты в этом коде: уязвимости (инъекции, authz-bypass, утечки секретов), гонки, потерю данных, неправильную обработку ошибок, логические ошибки.
Оцени по уровням: CRITICAL / HIGH / MEDIUM / LOW. Не выдумывай проблем из стиля — только то, что может сломать прод или безопасность.
Формат ответа — СТРОГО JSON (без markdown-обёртки):
{"findings":[{"level":"HIGH","file":"path","line":42,"title":"...","fix":"..."}]}
Если всё чисто — {"findings":[]}.
Файлы чанка (${'{files}'} replace) ниже.`;

async function review(area, files) {
  let body = '';
  for (const f of files) {
    const p = join(ROOT, f);
    let src;
    try {
      statSync(p);
      src = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    body += `\n\n===== FILE: ${f} =====\n${src.slice(0, 60_000)}`;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `${PROMPT.replace('{files}', files.join(', '))}\n${body}\n\nAREA: ${area}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '{}';
  const jsonText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(jsonText).findings ?? [];
  } catch {
    return [{ level: 'REVIEW_RAW', file: area, title: text.slice(0, 1500), fix: '' }];
  }
}

const all = [];
for (const c of CHUNKS) {
  process.stderr.write(`[review] ${c.area}…\n`);
  try {
    const findings = await review(c.area, c.files);
    all.push(...findings);
    process.stderr.write(`[review]   ${findings.length} findings\n`);
  } catch (e) {
    process.stderr.write(`[review] ERROR: ${e.message}\n`);
  }
}
console.log(JSON.stringify(all, null, 2));

// B9: poll recent snapshots for generatedHypotheses (БАГ-21 verdict), 5 min budget.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const log = (k, v) => {
  console.log('§', k, JSON.stringify(v).slice(0, 800));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
  });
  const page = await ctx.newPage();
  const list = await (await page.request.get(`${BASE}/api/report/snapshots`)).json();
  const recent = list
    .slice(0, 6)
    .map((s) => ({ id: s.id, at: s.generatedAt, from: s.dateFrom, to: s.dateTo }));
  log('recent_snapshots', recent);
  const ids = recent.map((s) => s.id);
  const deadline = Date.now() + 5 * 60 * 1000;
  const result = {};
  while (Date.now() < deadline) {
    for (const id of ids) {
      if (result[id]?.done) continue;
      const r = await page.request.get(`${BASE}/api/report/snapshot/${id}`);
      if (r.status() !== 200) {
        result[id] = { status: r.status() };
        continue;
      }
      const snap = await r.json();
      const g = snap.generatedHypotheses;
      result[id] = {
        done: !!g,
        hypCount: g ? (g.hypotheses?.length ?? g.items?.length ?? 'unknown-shape') : 0,
        keys: Object.keys(snap).filter(
          (k) => k.startsWith('generated') || k === 'aiNarrative' || k === 'aiGeneratedBy',
        ),
        narrative: !!snap.aiNarrative,
        generatedBy: snap.aiGeneratedBy ?? null,
      };
    }
    const allDone = ids.every((id) => result[id]?.done);
    log('poll', {
      at: new Date().toISOString(),
      result: Object.fromEntries(
        ids.map((id) => [
          id.slice(0, 8),
          { done: result[id]?.done, hyp: result[id]?.hypCount, keys: result[id]?.keys },
        ]),
      ),
    });
    if (allDone) break;
    await new Promise((res) => setTimeout(res, 30000));
  }
  fs.writeFileSync(path.join(DIR, 'result-b9.json'), JSON.stringify({ recent, result }, null, 2));
  await browser.close();
  console.log('DONE B9');
})().catch((e) => {
  console.error('FAIL B9', e);
  process.exit(1);
});

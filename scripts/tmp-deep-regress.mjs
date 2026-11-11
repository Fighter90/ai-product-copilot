import { chromium } from 'playwright';
import { mkdirSync, appendFileSync } from 'node:fs';
const OUT = '/tmp/deep-regress';
mkdirSync(OUT, { recursive: true });
const log = (s) => { console.log(s); appendFileSync(OUT + '/findings.log', s + '\n'); };
const bugs = [];
const bug = (id, title, steps) => { bugs.push({ id, title, steps }); log(`BUG ${id}: ${title}`); };
const ok = (id, msg) => log(`OK ${id}: ${msg}`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 150)); });
async function login(email, password) {
  await page.goto('https://dashboardcamp.ru/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30000 });
  await page.waitForTimeout(2500);
}
const cs = (label) => { const real = consoleErrors.filter(e => !/409|401|Failed to load resource/.test(e)); log(label + ': консоль-ошибки: ' + (real.length === 0 ? 'нет' : real.length + ' — ' + real.slice(0, 2).join(' | '))); consoleErrors.length = 0; };
log('=== ADMIN ===');
await login('admin@dashboardcamp.ru', 'DemoAdmin-c8ea7234!');
cs('логин');
await page.goto('https://dashboardcamp.ru/app', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
try {
  const t7 = (await page.locator('main, body').first().textContent()).slice(0, 2000);
  await page.getByRole('button', { name: /30 д|30д|30 дней/i }).first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const t30 = (await page.locator('main, body').first().textContent()).slice(0, 2000);
  t7 === t30 ? bug('periods', 'контент не изменился при смене 7д→30д') : ok('periods', 'пересчёт при смене периода ✓');
} catch (e) { bug('periods', 'ошибка смены периода: ' + String(e).slice(0, 90)); }
cs('/app');
await page.goto('https://dashboardcamp.ru/app/b2b', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
try {
  await page.getByRole('button', { name: /Добавить сделку|Добавить|Новая сделка/i }).first().click({ timeout: 5000 });
  await page.fill('input[name="company"], input[placeholder*="компани"], input[type="text"] >> nth=0', 'QA-DELETE-ME');
  await page.locator('input[type="number"], input[name*="ticket"], input[placeholder*="илет"]').first().fill('-5');
  await page.locator('button[type="submit"], button:has-text("Сохранить"), button:has-text("Создать")').last().click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  const errV = await page.locator('text=/билет|минимум|неверн/i').count();
  const qaRow = await page.locator('text=QA-DELETE-ME').count();
  qaRow > 0 && errV === 0 ? bug('b2b-negative', 'отрицательные билеты сохранились') : ok('b2b-negative', errV > 0 ? 'отклонены ✓' : 'не создана ✓');
  if (qaRow > 0) {
    await page.locator('tr', { hasText: 'QA-DELETE-ME' }).first().getByRole('button', { name: /Удалить/i }).first().click({ timeout: 5000 });
    const dlg = await page.locator('[role="dialog"], [role="alertdialog"]').count();
    dlg > 0 ? ok('b2b-dialog', 'ConfirmDialog ✓') : bug('b2b-dialog', 'удаление без диалога');
    if (dlg > 0) { await page.getByRole('button', { name: /Удалить|Подтвердить|Да/i }).last().click({ timeout: 5000 }); await page.waitForTimeout(1000); }
  }
} catch (e) { log('b2b skip: ' + String(e).slice(0, 80)); }
cs('/app/b2b');
await page.goto('https://dashboardcamp.ru/app/hypotheses', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
try {
  await page.getByRole('button', { name: /Новая гипотеза|Добавить гипотезу/i }).first().click({ timeout: 5000 });
  await page.locator('input[name*="title"], input[placeholder*="азвани"], input[id*="title"]').first().fill('QA-DRAFT-DELETE-ME');
  await page.locator('button[type="submit"], button:has-text("Сохранить")').last().click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const vis = await page.locator('text=QA-DRAFT-DELETE-ME').count();
  vis > 0 ? ok('draft-hypothesis', 'черновик с одним названием сохранился ✓') : bug('draft-hypothesis', 'черновик НЕ сохранился');
  const work = page.getByRole('button', { name: /В работу|Взять в работу/i }).first();
  if (await work.count()) {
    await work.click({ timeout: 4000 }); await page.waitForTimeout(800);
    const cl = await page.locator('text=/допущени|метод|чеклист/i').count();
    cl > 0 ? ok('draft-checklist', 'чеклист блокирует перевод ✓') : log('draft-checklist: не найден');
  }
} catch (e) { log('hypotheses skip: ' + String(e).slice(0, 80)); }
cs('/app/hypotheses');
await page.goto('https://dashboardcamp.ru/app/admin/users', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
try {
  await page.getByRole('button', { name: /Добавить|Новый пользователь|Создать/i }).first().click({ timeout: 5000 });
  await page.fill('input[type="email"] >> nth=-1', 'qa-del@dashboardcamp.ru');
  const pwd = page.locator('input[type="password"]').last();
  if (await pwd.count()) await pwd.fill('QaDel-12345678!');
  const nm = page.locator('input[name="name"], input[placeholder*="имя"] >> nth=-1');
  if (await nm.count()) await nm.fill('QA Delete');
  await page.locator('button[type="submit"], button:has-text("Создать"), button:has-text("Сохранить")').last().click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const row = page.locator('tr, [data-testid*="user"]', { hasText: 'qa-del@dashboardcamp.ru' }).first();
  await row.getByRole('button', { name: /Удалить/i }).first().click({ timeout: 5000 });
  const dlg = await page.locator('[role="dialog"], [role="alertdialog"]').count();
  dlg > 0 ? ok('user-delete-dialog', 'ConfirmDialog ✓') : bug('user-delete-dialog', 'без диалога');
  if (dlg > 0) { await page.getByRole('button', { name: /Удалить|Подтвердить|Да/i }).last().click({ timeout: 5000 }); await page.waitForTimeout(1200); }
  const still = await page.locator('text=qa-del@dashboardcamp.ru').count();
  still === 0 ? ok('user-deleted', 'удалён ✓') : bug('user-deleted', 'остался после удаления');
} catch (e) { log('admin/users skip: ' + String(e).slice(0, 80)); }
cs('/app/admin/users');
await page.goto('https://dashboardcamp.ru/app/history', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
try {
  await page.getByRole('button', { name: /Сравнить/i }).first().click({ timeout: 5000 });
  await page.waitForTimeout(2500);
  const oldL = await page.locator('text=/Старый|старее/i').count();
  oldL > 0 ? ok('history-compare', 'сравнение рендерится ✓') : bug('history-compare', 'блок сравнения не найден');
} catch (e) { log('history skip: ' + String(e).slice(0, 80)); }
cs('/app/history');
await page.goto('https://dashboardcamp.ru/app/funnel', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
await page.screenshot({ path: OUT + '/funnel.png', fullPage: false });
cs('/app/funnel');
log('=== MOBILE 390x844 (БАГ-16) ===');
await page.setViewportSize({ width: 390, height: 844 });
const hs = [];
for (const p of ['/app', '/app/goals', '/app/kpi', '/app/traffic', '/app/behavior', '/app/funnel', '/app/report', '/app/b2b', '/app/marketing', '/app/explore', '/app/history', '/app/hypotheses']) {
  await page.goto('https://dashboardcamp.ru' + p, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1800);
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  if (m.s > m.c + 2) hs.push(p.replace('/app/', '') + ': ' + m.s + '>' + m.c);
}
hs.length === 0 ? ok('mobile-hscroll', 'скролла нет на 12 страницах ✓') : bug('mobile-hscroll', 'скролл: ' + hs.join(', '));
await page.screenshot({ path: OUT + '/mobile-overview.png', fullPage: false });
cs('мобильный проход');
log('=== ANALYST ===');
await login('analyst@dashboardcamp.ru', 'DemoAnalyst-bf449de4!');
await page.goto('https://dashboardcamp.ru/app', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
const av = await page.locator('a[href*="/app/admin"], text=Администрирование').count();
av === 0 ? ok('analyst-no-admin', 'админ-разделы скрыты ✓') : bug('analyst-no-admin', 'админ-разделы видны аналитику');
cs('/app analyst');
log('=== ИТОГ: багов/недоработок: ' + bugs.length + ' ===');
bugs.forEach((b, i) => log((i + 1) + '. [' + b.id + '] ' + b.title + ' | ' + b.steps));
await browser.close();
log('=== конец ===');

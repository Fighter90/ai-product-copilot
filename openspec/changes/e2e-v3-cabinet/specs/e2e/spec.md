# e2e-v3-cabinet — дельта: возможность «E2E-сьют»

## ADDED Requirements

### Requirement: Сьют проверяет кабинет v3 за авторизацией

E2E-сьют SHALL проверять кабинет за `RequireAuth` (роуты `/app/*`): общая фикстура
(`e2e/fixtures.ts`) мокает `/api/auth/me` (роль — параметр, по умолчанию аналитик;
`null` — гость), уведомления, AI-провайдеров (`/ai/available`), live-funnel, payments,
marketing, sync/demo статусы; локаль закреплена `ru`, онбординг и тур — выключены. Ни одна
спека не ссылается на маршруты/тексты v2 (`/settings`, «Сформировать срез данных»).

#### Scenario: Спека видит кабинет без реального бэкенда

- **WHEN** спека вызывает `installMocks(page)` и переходит на `/app/marketing`
- **THEN** страница рендерится под аналитиком с RU-интерфейсом, сетевые вызовы уходят в моки,
  а не в прокси

### Requirement: Мобильный проект выполняется в WebKit

Проект `mobile-iphone-14` (устройство iPhone 14 → WebKit) SHALL выполняться и в CI: workflow
E2E устанавливает `chromium webkit`; мобильные тесты проверяют каждый кабинет-роут на
отсутствие горизонтального скролла при 390px и навигацию через drawer.

#### Scenario: Funnel на 390px без скролла

- **WHEN** открыт `/app/funnel` на iPhone 14
- **THEN** `document.documentElement.scrollWidth - clientWidth ≤ 1` (таблица платежей не
  раздувает страницу — `min-w` только от `sm:`)

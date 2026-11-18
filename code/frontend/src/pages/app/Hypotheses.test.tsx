import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Hypothesis } from '@pca/shared';
import { renderWithProviders } from '../../test/utils';
import { setTestLocale } from '../../test/i18n-utils';

/** Mutable auth state — the ANA-157 tests flip it to admin to verify the PM override in the UI. */
const authMock = vi.hoisted(() => ({
  state: { user: { name: 'Analyst' } as { name: string } | null, isAdmin: false },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => authMock.state }));
vi.mock('../../lib/hypotheses-api', async (importOriginal) => {
  // The real module stays for `dedupeById` (ANA-181): the page dedupes the query cache itself,
  // only the HTTP calls are replaced.
  const actual = await importOriginal<typeof import('../../lib/hypotheses-api')>();
  return {
    ...actual,
    hypothesesApi: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setStatus: vi.fn(),
      importAi: vi.fn(),
    },
    decisionsApi: { list: vi.fn(), create: vi.fn() },
  };
});
vi.mock('../../lib/api', () => ({
  api: { listSnapshots: vi.fn(), getSnapshot: vi.fn() },
}));

import { hypothesesApi } from '../../lib/hypotheses-api';
import { api } from '../../lib/api';
import { Hypotheses } from './Hypotheses';

const h = (over: Partial<Hypothesis>): Hypothesis =>
  ({
    id: 1,
    diamondPhase: 'develop',
    kind: 'solution',
    subject: 'Подкаст',
    action: 'сократим форму',
    solution: 'один шаг',
    condition: 'CR вырастет',
    title: 'Гипотеза A',
    hiddenAssumptions: [
      { category: 'behavior', text: 'a' },
      { category: 'market', text: 'b' },
      { category: 'tech', text: 'c' },
    ],
    validationMethods: [
      { type: 'quantitative', plan: 'A/B' },
      { type: 'synthetic', plan: 'интервью' },
    ],
    impact: 5,
    confidence: 5,
    ease: 5,
    impactRationale: 'i',
    confidenceRationale: 'c',
    easeRationale: 'e',
    greenCriteria: 'g',
    yellowCriteria: 'y',
    redCriteria: 'r',
    deadlineDays: 14,
    iceScore: 125,
    status: 'draft',
    deadlineAt: '2026-11-10T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }) as Hypothesis;

const SEEDED: Hypothesis[] = [
  h({ id: 1, title: 'AAA низкий', impact: 1, confidence: 1, ease: 1, iceScore: 1 }),
  h({
    id: 2,
    title: 'BBB высокий',
    impact: 9,
    confidence: 9,
    ease: 9,
    iceScore: 729,
    status: 'in_progress',
    source: 'ai',
    aiProvider: 'openrouter',
    aiModel: 'claude-sonnet-4-6',
    unverifiedNumbers: ['5123'],
  }),
];

/** ANA-129: a light draft — only the title, everything else blank. */
const LIGHT_DRAFT: Partial<Hypothesis> = {
  subject: '',
  action: '',
  solution: '',
  condition: '',
  hiddenAssumptions: [],
  validationMethods: [],
  impactRationale: '',
  confidenceRationale: '',
  easeRationale: '',
  greenCriteria: '',
  yellowCriteria: '',
  redCriteria: '',
};

function mockData({ list = SEEDED, snapshot }: { list?: Hypothesis[]; snapshot?: unknown } = {}) {
  vi.mocked(hypothesesApi.list).mockResolvedValue(list);
  vi.mocked(api.listSnapshots).mockResolvedValue(
    snapshot ? [{ id: 'snap-1', generatedAt: '', dateFrom: '', dateTo: '' }] : [],
  );
  vi.mocked(api.getSnapshot).mockResolvedValue(snapshot as never);
}

describe('Hypotheses page', () => {
  beforeEach(() => {
    mockData();
    authMock.state = { user: { name: 'Analyst' }, isAdmin: false };
  });
  afterEach(() => setTestLocale('ru'));

  it('renders the kanban columns with ICE, the AI badge and the unverified-numbers warning', async () => {
    const { container } = renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-kanban')).toBeInTheDocument();
    for (const col of [
      'Черновики',
      'В проверке',
      'Подтверждена',
      'Частично',
      'Отклонена',
      'Просрочена',
    ]) {
      expect(screen.getByRole('region', { name: col })).toBeInTheDocument();
    }
    expect(screen.getByTestId('hyp-card-2')).toHaveTextContent('BBB высокий');
    expect(screen.getByTestId('hyp-card-2')).toHaveTextContent('729');
    expect(screen.getAllByText('AI').length).toBeGreaterThan(0); // source badges on kanban cards
    expect(screen.getAllByText(/цифры не из среза/).length).toBeGreaterThan(0); // ANA-38 warning badges
    expect(container).toBeTruthy();
  });

  it('ANA-184: at 1280px the kanban lanes keep a min width and the strip scrolls inside', async () => {
    // Регресс 15.11: six lanes in a 1152px main squeezed to ~136px and titles wrapped
    // one word per line. The wrapper scrolls horizontally and the lg grid gives each
    // lane a minmax floor instead of a bare 1fr.
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const kanban = await screen.findByTestId('hyp-kanban');
    expect(kanban.className).toContain('overflow-x-auto');
    const grid = kanban.querySelector('.grid');
    expect(grid?.className).toContain('lg:grid-cols-[repeat(6,minmax(190px,1fr))]');
  });

  it('ANA-187: card titles hyphenate long words instead of breaking them mid-word', async () => {
    // Регресс 16.11 (тёмная тема): длинные RU-слова рвались посреди слова без переноса.
    // hyphens-auto переносит по слогам; break-words остаётся страховкой от переполнения.
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-2');
    const title = card.querySelector('span.break-words');
    expect(title).not.toBeNull();
    expect(title?.className).toContain('hyphens-auto');
  });

  it('sorts the ICE table descending by default and flips on header click; drafts stay out (ANA-129)', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const table = await screen.findByTestId('hyp-ice-table');
    // AAA is a draft (status draft) — it never enters the ICE prioritisation table.
    expect(table.textContent).toContain('BBB высокий');
    expect(table.textContent).not.toContain('AAA низкий');
    expect(table.querySelector('th[aria-sort="descending"]')).not.toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'ICE' })[0]!);
    await waitFor(() => expect(table.querySelector('th[aria-sort="ascending"]')).not.toBeNull());
  });

  it('ANA-24: opens the editor prefilled from the ?segment&evidence deep link', async () => {
    renderWithProviders(
      <Hypotheses />,
      '/app/hypotheses?segment=%D0%9F%D0%BE%D0%B4%D0%BA%D0%B0%D1%81%D1%82&evidence=CR+0%2C7%25',
    );
    const editor = await screen.findByTestId('hypothesis-editor');
    expect((screen.getByLabelText('Целевая аудитория') as HTMLInputElement).value).toBe('Подкаст');
    expect(editor).toHaveTextContent('Доказательства');
    expect(editor).toHaveTextContent('CR 0,7%');
  });

  it('ANA-129: creates a light draft in two clicks — only the title is required', async () => {
    vi.mocked(hypothesesApi.create).mockResolvedValue(SEEDED[0]!);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new')); // click 1 — open the editor
    const save = await screen.findByTestId('hyp-save');
    // Blank title still blocks the save; format errors are not shown for a draft.
    expect(save).toBeDisabled();
    expect(screen.getByTestId('hypothesis-editor')).toHaveTextContent('Черновик: достаточно');
    expect(screen.queryByText('Нужно минимум 3 допущения')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Быстрая идея' } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save); // click 2 — save the draft
    await waitFor(() =>
      expect(hypothesesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Быстрая идея',
          subject: '',
          hiddenAssumptions: [],
          validationMethods: [],
        }),
      ),
    );
  }, 45_000);

  it('ANA-129: taking an incomplete draft into work shows the format checklist and blocks the move', async () => {
    vi.mocked(hypothesesApi.setStatus).mockResolvedValue(SEEDED[0]!);
    mockData({ list: [h({ id: 7, title: 'DDD черновик', ...LIGHT_DRAFT })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const select = await screen.findByRole('combobox', { name: 'Изменить статус' });
    fireEvent.change(select, { target: { value: 'in_progress' } });

    const dialog = await screen.findByTestId('hyp-work-checklist');
    expect(screen.getByRole('heading', { name: 'Чеклист формата' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('≥3 скрытых допущения');
    expect(dialog).toHaveTextContent('≥2 метода проверки');
    // The transition is blocked while the checklist is open — no API call.
    expect(hypothesesApi.setStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(screen.queryByTestId('hyp-work-checklist')).not.toBeInTheDocument();
    expect(hypothesesApi.setStatus).not.toHaveBeenCalled();
  });

  it('ANA-129: a complete draft moves to «В проверке» without the checklist', async () => {
    vi.mocked(hypothesesApi.setStatus).mockResolvedValue(SEEDED[0]!);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const select = (await screen.findAllByRole('combobox', { name: 'Изменить статус' }))[0]!;
    fireEvent.change(select, { target: { value: 'in_progress' } });
    await waitFor(() => expect(hypothesesApi.setStatus).toHaveBeenCalledWith(1, 'in_progress'));
  });

  it('БАГ-15: shows «Просрочена» as its own kanban column, separate from «Отклонена»', async () => {
    mockData({ list: [h({ id: 3, title: 'CCC просроченная', status: 'expired' })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-kanban')).toBeInTheDocument();
    const expired = screen.getByRole('region', { name: 'Просрочена' });
    const rejected = screen.getByRole('region', { name: 'Отклонена' });
    expect(expired).toHaveTextContent('CCC просроченная');
    expect(rejected).toHaveTextContent('— пусто —');
  });

  it('ANA-157: an AI card caps the status select at «В проверке» — verdict options disabled with the PM tooltip', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-2'); // SEEDED[1] — source: 'ai'
    const select = within(card).getByRole('combobox', { name: 'Изменить статус' });
    // Allowed at A1: draft and «В проверке».
    expect(within(select).getByRole('option', { name: 'Черновик' })).toBeEnabled();
    expect(within(select).getByRole('option', { name: 'В проверке' })).toBeEnabled();
    // PM-only: the verification verdicts + «Просрочена», each with the autonomy tooltip.
    for (const label of ['Подтверждена', 'Частично', 'Отклонена', 'Просрочена']) {
      const option = within(select).getByRole('option', { name: label });
      expect(option).toBeDisabled();
      expect(option).toHaveAttribute('title', 'Требуется подтверждение PM — уровень автономии A1');
    }
    // The autonomy badges next to the AI badge: the level + the escalation marker.
    expect(within(card).getByText('A1')).toBeInTheDocument();
    expect(within(card).getByText('⚠️ Эскалация к PM')).toBeInTheDocument();
  });

  it('ANA-157 review: the PM (admin) sees the verdict options enabled on an AI card — the cap is a gate, not a dead end', async () => {
    authMock.state = { user: { name: 'PM' }, isAdmin: true };
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-2'); // SEEDED[1] — source: 'ai'
    const select = within(card).getByRole('combobox', { name: 'Изменить статус' });
    // The PM may give every светофор verdict directly (the backend lets the admin role through).
    for (const label of [
      'Черновик',
      'В проверке',
      'Подтверждена',
      'Частично',
      'Отклонена',
      'Просрочена',
    ]) {
      expect(within(select).getByRole('option', { name: label })).toBeEnabled();
    }
    // The autonomy badges still mark the AI provenance and the escalation path.
    expect(within(card).getByText('A1')).toBeInTheDocument();
    expect(within(card).getByText('⚠️ Эскалация к PM')).toBeInTheDocument();
  });

  it('ANA-157 review: without a signed-in user (legacy single-user mode) the verdict options stay enabled', async () => {
    authMock.state = { user: null, isAdmin: false };
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-2'); // SEEDED[1] — source: 'ai'
    const select = within(card).getByRole('combobox', { name: 'Изменить статус' });
    // No PM role exists — the single human owner owns the светофор verdict.
    for (const label of ['Подтверждена', 'Частично', 'Отклонена', 'Просрочена']) {
      expect(within(select).getByRole('option', { name: label })).toBeEnabled();
    }
  });

  it('ANA-157 review 3: a non-PM cannot clear a PM verdict from the UI — leaving «Подтверждена» is blocked', async () => {
    mockData({ list: [h({ id: 7, title: 'AI зелёная', status: 'green', source: 'ai' })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-7');
    const select = within(card).getByRole('combobox', { name: 'Изменить статус' });
    // Staying on the PM verdict stays selectable.
    expect(within(select).getByRole('option', { name: 'Подтверждена' })).toBeEnabled();
    // Every other option — including «Черновик» — is blocked with the PM tooltip:
    // erasing the светофор decision is itself a PM decision.
    for (const label of ['Черновик', 'В проверке', 'Частично', 'Отклонена', 'Просрочена']) {
      const option = within(select).getByRole('option', { name: label });
      expect(option).toBeDisabled();
      expect(option).toHaveAttribute('title', 'Требуется подтверждение PM — уровень автономии A1');
    }
  });

  it('ANA-157: a manual card keeps every status option enabled and shows no autonomy badges', async () => {
    mockData({ list: [h({ id: 5, title: 'Ручная гипотеза', status: 'in_progress' })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-5');
    const select = within(card).getByRole('combobox', { name: 'Изменить статус' });
    for (const label of [
      'Черновик',
      'В проверке',
      'Подтверждена',
      'Частично',
      'Отклонена',
      'Просрочена',
    ]) {
      expect(within(select).getByRole('option', { name: label })).toBeEnabled();
    }
    expect(within(card).queryByText('A1')).not.toBeInTheDocument();
    expect(within(card).queryByText('⚠️ Эскалация к PM')).not.toBeInTheDocument();
  });

  it('БАГ-14: the editor hides «Заполните поле» until a field is touched (draft: title only)', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new'));
    await waitFor(() => expect(screen.getByTestId('hyp-save')).toBeDisabled());
    expect(screen.queryByText('Заполните поле')).not.toBeInTheDocument();

    // Touching an OPTIONAL field reveals only the title error — no format-error wall (ANA-129).
    fireEvent.change(screen.getByLabelText('Целевая аудитория'), { target: { value: 'x' } });
    expect(screen.getByText('Заполните поле')).toBeInTheDocument(); // exactly one — the title
    expect(screen.queryByText('Нужно минимум 3 допущения')).not.toBeInTheDocument();
  });

  // ---- ANA-181 (регресс прод 15.11): a disabled «Сохранить» must explain itself ----------------

  it('ANA-181: the empty form lists the unmet requirements under the disabled Save — before any input', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new'));
    const save = await screen.findByTestId('hyp-save');
    expect(save).toBeDisabled();
    // The light draft needs only the title — exactly that requirement is listed.
    const blockers = screen.getByTestId('hyp-save-blockers');
    expect(blockers).toHaveTextContent('Название');
    // БАГ-14 stays intact: the per-field «Заполните поле» errors are still hidden until input.
    expect(screen.queryByText('Заполните поле')).not.toBeInTheDocument();

    // Filling the title unblocks the save and removes the explanation.
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Быстрая идея' } });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByTestId('hyp-save-blockers')).not.toBeInTheDocument();
  });

  it('ANA-181: editing a work-status hypothesis with gaps lists the format requirements (met ones stay out)', async () => {
    mockData({ list: [h({ id: 8, title: 'Частичная', status: 'in_progress', ...LIGHT_DRAFT })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-8');
    fireEvent.click(within(card).getByRole('button', { name: 'Редактировать' }));

    const blockers = await screen.findByTestId('hyp-save-blockers');
    for (const line of [
      'Формат: ЦА + действие + решение + условие',
      '≥3 скрытых допущения',
      '≥2 метода проверки',
      'Обоснования ICE',
      'Светофор',
    ]) {
      expect(blockers).toHaveTextContent(line);
    }
    // The deadline keeps its valid default (14) — it is met, so it is not listed.
    expect(blockers).not.toHaveTextContent('Дедлайн: целое число дней');
  });

  // ---- ANA-181: the ICE panel must not show a stale «Пока нет гипотез» while cards exist -------

  it('ANA-181: drafts-only board — the ICE panel explains the drafts state instead of «Пока нет гипотез»', async () => {
    mockData({ list: [h({ id: 9, title: 'Только черновик', ...LIGHT_DRAFT })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-card-9')).toBeInTheDocument();
    expect(
      screen.queryByText('Пока нет гипотез — создайте первую или импортируйте AI-варианты'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('hyp-ice-all-drafts')).toHaveTextContent('черновиках');
  });

  // ---- ANA-181: defensive same-id dedupe — one card per id, counter matches the DOM -----------

  it('ANA-181: a duplicated refetch payload renders one card per id — the lane counter matches the DOM', async () => {
    // The prod regression: between visits «Черновики» grew 20 → 60 cards without any creates.
    // The duplication mechanism in prod is NOT verified — this test only pins the defensive
    // UI guarantee: same-id duplicates (whatever their source) render once per id, so the
    // lane counter and the card count agree for this payload shape. Distinct-id duplicates
    // are out of scope here (the guard keeps them, and reports read SQLite, not this cache).
    mockData({ list: [...SEEDED, ...SEEDED, ...SEEDED] }); // 2 unique rows served 3×
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-kanban')).toBeInTheDocument();

    expect(screen.getAllByTestId(/^hyp-card-/)).toHaveLength(2);
    const drafts = screen.getByRole('region', { name: 'Черновики' });
    expect(within(drafts).getAllByTestId(/^hyp-card-/)).toHaveLength(1);
    expect(within(drafts).getByRole('heading')).toHaveTextContent('1');
    const inProgress = screen.getByRole('region', { name: 'В проверке' });
    expect(within(inProgress).getAllByTestId(/^hyp-card-/)).toHaveLength(1);
    expect(within(inProgress).getByRole('heading')).toHaveTextContent('1');
  });

  it('БАГ-15 removal-UX: delete asks via the styled ConfirmDialog (not window.confirm)', async () => {
    vi.mocked(hypothesesApi.remove).mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Удалить' }))[0]!);
    // The styled dialog names the hypothesis; the native confirm is never called.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('confirm-body')).toHaveTextContent(
      'Удалить гипотезу «AAA низкий»?',
    );
    // Cancel keeps the card.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(hypothesesApi.remove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-body')).not.toBeInTheDocument();
    // Accept deletes.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Удалить' }))[0]!);
    fireEvent.click(await screen.findByTestId('confirm-accept'));
    await waitFor(() => expect(hypothesesApi.remove).toHaveBeenCalledWith(1));
    confirmSpy.mockRestore();
  });

  it('ANA-145: the deep-link draft save lands the card in the «Черновики» kanban lane (e2e mirror)', async () => {
    // Mirror of e2e/hypotheses.spec.ts:178 (ANA-24 → kanban). The e2e fixtures answer POST
    // /hypotheses with a stateful record shaped like the real repo: id 100, status 'draft',
    // computed iceScore and the provenance label `source: 'manual'` (ANA-145 contract fix).
    // No `as` cast — shape drift must surface at compile time.
    let stored: Hypothesis | null = null;
    vi.mocked(hypothesesApi.create).mockImplementation(async (body) => {
      stored = {
        id: 100,
        ...body,
        iceScore: 125,
        status: 'draft',
        source: 'manual',
        deadlineAt: '2026-11-26T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      return stored;
    });
    // The stateful list: empty before create, the created record after (POST → list re-fetch).
    vi.mocked(hypothesesApi.list).mockImplementation(async () => (stored === null ? [] : [stored]));

    renderWithProviders(
      <Hypotheses />,
      '/app/hypotheses?segment=podcast&trouble=%D0%BD%D0%B8%D0%B7%D0%BA%D0%B0%D1%8F+%D0%BA%D0%BE%D0%BD%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F&evidence=CR+2%2C9%25',
    );
    const editor = await screen.findByTestId('hypothesis-editor');
    // Segment and evidence from the weak spot are prefilled…
    expect((screen.getByLabelText('Целевая аудитория') as HTMLInputElement).value).toBe('podcast');
    expect((screen.getByLabelText('Название') as HTMLInputElement).value).not.toBe('');
    expect(editor).toHaveTextContent('Доказательства');

    // Fill the remaining required fields (same fields as the e2e).
    fireEvent.change(screen.getByLabelText('Действие'), {
      target: { value: 'сократим форму до одного шага' },
    });
    fireEvent.change(screen.getByLabelText('Решение'), {
      target: { value: 'одноэкранная регистрация' },
    });
    fireEvent.change(screen.getByLabelText('Условие'), { target: { value: 'CR вырастет до 5%' } });
    // Assumptions: one prefilled (Поведение) — add Рынок + Технологии.
    const addBtns = screen.getAllByRole('button', { name: 'Добавить' });
    fireEvent.click(addBtns[0]!);
    fireEvent.click(addBtns[0]!);
    const catSelects = screen.getAllByLabelText('Категория допущения');
    fireEvent.change(catSelects[1]!, { target: { value: 'market' } });
    fireEvent.change(catSelects[2]!, { target: { value: 'tech' } });
    const assumptionInputs = screen.getAllByLabelText('Текст допущения');
    fireEvent.change(assumptionInputs[1]!, { target: { value: 'конкуренты уже упростили форму' } });
    fireEvent.change(assumptionInputs[2]!, {
      target: { value: 'форма переиспользуется с лендинга' },
    });
    // Validation methods: two distinct types.
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[1]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[1]!);
    const typeSelects = screen.getAllByLabelText('Тип метода');
    fireEvent.change(typeSelects[1]!, { target: { value: 'synthetic' } });
    const planInputs = screen.getAllByLabelText('План проверки');
    fireEvent.change(planInputs[0]!, { target: { value: 'A/B-тест формы' } });
    fireEvent.change(planInputs[1]!, { target: { value: '5 интервью с пользователями' } });
    // ICE rationales + traffic light.
    fireEvent.change(screen.getAllByLabelText('Обоснование')[0]!, {
      target: { value: 'много визитов с низкой конверсией' },
    });
    fireEvent.change(screen.getAllByLabelText('Обоснование')[1]!, {
      target: { value: 'данные Метрики подтверждают' },
    });
    fireEvent.change(screen.getAllByLabelText('Обоснование')[2]!, {
      target: { value: 'готовый компонент формы' },
    });
    fireEvent.change(screen.getByLabelText('🟢 Зелёный'), {
      target: { value: 'CR ≥ 5% за 2 недели' },
    });
    fireEvent.change(screen.getByLabelText('🟡 Жёлтый'), { target: { value: 'CR 3–5%' } });
    fireEvent.change(screen.getByLabelText('🔴 Красный'), { target: { value: 'CR < 3%' } });

    await waitFor(() => expect(screen.getByTestId('hyp-save')).toBeEnabled());
    fireEvent.click(screen.getByTestId('hyp-save'));

    // The saved light draft lands in the «Черновики» lane; the ICE table stays without drafts.
    // The lane node is re-queried INSIDE the wait — the list re-fetch may remount the region,
    // and a captured node would go detached (ANA-145 round-2 review note).
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Черновики' })).getByTestId('hyp-card-100'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('hyp-ice-table')).not.toBeInTheDocument();
    // ANA-172 (round-2 gate): ~30 controlled interactions plus two mocked API round-trips
    // make this the heaviest test of the file — under `pnpm coverage` (backend and frontend
    // suites run concurrently) it overran the 20 s global budget. Same headroom as the
    // ANA-129 sibling below.
  }, 45_000);

  it('ANA-38: imports an AI hypothesis from the latest snapshot with provenance', async () => {
    vi.mocked(hypothesesApi.importAi).mockResolvedValue(SEEDED[0]!);
    mockData({
      snapshot: {
        id: 'snap-1',
        generatedHypotheses: {
          problems: [
            {
              id: 'P01',
              segment: 'слушатель',
              trouble: 'не понимает цену',
              action: 'оставить заявку',
              barrier: 'длинная форма',
              evidence: 'CR 0,7%',
              unverifiedNumbers: [],
            },
          ],
          solutions: [
            {
              id: 'S01',
              problemId: 'P01',
              action: 'короткая форма',
              userBenefit: 'регистрация за 1 шаг',
              businessResult: 'CR +30%',
              successCriteria: 'CR ≥ 5%',
              risks: [{ kind: 'value', note: 'r' }],
              validation: {
                whatToVerify: 'спрос',
                methods: ['интервью', 'клик-тест'],
                audience: 'слушатели',
                channel: 'email',
                successCriteria: '≥10%',
              },
              ice: {
                impact: 7,
                confidence: 5,
                ease: 8,
                impactRationale: 'i',
                confidenceRationale: 'c',
                easeRationale: 'e',
                score: 280,
              },
              trafficLight: { green: 'g', yellow: 'y', red: 'r' },
              deadline: '2026-12-01',
              unverifiedNumbers: ['5123'],
            },
          ],
          meta: { provider: 'openrouter', model: 'claude-sonnet-4-6' },
        },
      },
    });

    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const list = await screen.findByTestId('hyp-ai-list');
    expect(list).toHaveTextContent('короткая форма');
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));
    await waitFor(() =>
      expect(hypothesesApi.importAi).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openrouter',
          model: 'claude-sonnet-4-6',
          snapshotId: 'snap-1',
          solution: expect.objectContaining({ id: 'S01' }),
          problem: expect.objectContaining({ id: 'P01' }),
        }),
      ),
    );
  });

  // ---- ANA-152: «Посмотреть» on the card opens a read-only popup with the full description ----

  it('ANA-152: «Посмотреть» opens a read-only popup with the full hypothesis; «Редактировать» hands over to the editor', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-2');
    fireEvent.click(within(card).getByTestId('hyp-view-btn'));

    const modal = await screen.findByTestId('hyp-view-modal');
    expect(modal).toHaveTextContent('BBB высокий'); // the full title, not a truncated card one
    expect(modal).toHaveTextContent('Решение'); // kind pill
    expect(modal).toHaveTextContent('В проверке'); // status pill
    expect(modal).toHaveTextContent('Подкаст'); // subject
    expect(modal).toHaveTextContent('сократим форму'); // action
    expect(modal).toHaveTextContent('один шаг'); // solution
    expect(modal).toHaveTextContent('CR вырастет'); // condition = критерий
    expect(modal).toHaveTextContent('ICE = 729');
    expect(modal).toHaveTextContent('Зелёный'); // traffic light expanded, not tooltip-only
    expect(within(modal).getAllByText('Обоснование').length).toBeGreaterThanOrEqual(3);
    expect(within(modal).getByRole('button', { name: 'Редактировать' })).toBeInTheDocument();

    // «Редактировать» opens the existing editor — the view popup closes, nothing is duplicated.
    fireEvent.click(within(modal).getByRole('button', { name: 'Редактировать' }));
    expect(await screen.findByTestId('hypothesis-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('hyp-view-modal')).not.toBeInTheDocument();
  });

  it('ANA-152: a problem hypothesis shows the trouble formula and evidence quotes; Esc closes', async () => {
    mockData({
      list: [
        h({
          id: 9,
          kind: 'problem',
          title: 'Подкаст: низкая конверсия',
          description: 'Подкаст испытывает низкую конверсию при записи, потому что форма длинная.',
          impactRationale: 'много визитов',
          confidenceRationale: 'данные Метрики',
          easeRationale: 'готовый блок',
          greenCriteria: 'CR ≥ 5% за 2 недели',
          evidence: [{ type: 'ai', note: 'CR 0,7%', slice: 'snapshot:snap-1' }],
          status: 'draft',
        }),
      ],
    });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-view-btn'));

    const modal = await screen.findByTestId('hyp-view-modal');
    expect(modal).toHaveTextContent('Проблема'); // kind
    expect(modal).toHaveTextContent('испытывает низкую конверсию'); // the trouble (description)
    expect(modal).toHaveTextContent('много визитов'); // ICE rationales expanded in the popup
    expect(modal).toHaveTextContent('CR ≥ 5% за 2 недели'); // green criterion
    expect(modal).toHaveTextContent('CR 0,7%'); // evidence quote from the analysis

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('hyp-view-modal')).not.toBeInTheDocument();
  });

  it('ANA-158: narrow card — the footer row wraps and «Посмотреть» never overflows the card (styling contract)', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const card = await screen.findByTestId('hyp-card-2');
    // jsdom computes no layout, so the narrow-card fit is asserted as a styling contract here;
    // the real pixel containment checks live in e2e (1440px desktop lanes + 390px mobile).
    const footer = within(card).getByRole('combobox', { name: 'Изменить статус' })
      .parentElement as HTMLElement;
    expect(footer).toHaveClass('flex-wrap'); // the row wraps instead of pushing buttons past the edge
    const view = within(card).getByTestId('hyp-view-btn');
    expect(view).toHaveClass('min-w-0', 'max-w-full'); // the button shrinks, never exceeds the card
    const svg = view.querySelector('svg');
    expect(svg).toHaveClass('shrink-0'); // the eye icon stays whole while the label truncates
    expect(view.querySelector('span.truncate')).toHaveTextContent('Посмотреть');
  });

  it('ANA-152: mobile 390px — the popup keeps the fit contract (bottom sheet + inner scroll)', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click((await screen.findAllByTestId('hyp-view-btn'))[0]!);
    await screen.findByTestId('hyp-view-modal');
    // jsdom computes no layout, so the 390px fit is asserted as a styling contract here;
    // the real layout check lives in e2e/mobile.spec.ts (390×844, no horizontal overflow).
    expect(screen.getByRole('dialog')).toHaveClass('w-full', 'min-w-0', 'max-w-lg');
    expect(screen.getByRole('dialog').parentElement).toHaveClass('items-end', 'sm:items-center');
    expect(screen.getByTestId('hyp-view-modal')).toHaveClass(
      'max-h-[70vh]',
      'overflow-y-auto',
      'overflow-x-hidden',
    );
  });
});

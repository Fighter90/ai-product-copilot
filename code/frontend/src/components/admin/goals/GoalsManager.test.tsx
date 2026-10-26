import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';

vi.mock('../../../lib/api-v3', () => ({
  goalsApi: {
    audit: vi.fn(),
    preview: vi.fn(),
    create: vi.fn(),
    archiveBulk: vi.fn(),
    restore: vi.fn(),
  },
}));
import { goalsApi, type GoalsAuditView } from '../../../lib/api-v3';
import { ApiError } from '../../../lib/api';
import { GoalsManager } from './GoalsManager';

const spec = (event: string) => ({
  name: `G ${event}`,
  type: 'action' as const,
  conditions: [{ type: 'exact' as const, url: event }],
});

const AUDIT: GoalsAuditView = {
  expected: [
    {
      ref: {
        code: 'G-01',
        event: 'price_view',
        ru: 'Увидел блок билетов',
        en: 'Saw ticket block',
        group: 'funnel',
        name: 'G-01 Увидел блок билетов (price_view)',
      },
      status: 'present',
      goalId: 1,
      goalName: 'Price',
      spec: spec('price_view'),
    },
    {
      ref: {
        code: 'G-05',
        event: 'reg_step1',
        ru: 'Оставил контакты (заказ)',
        en: 'Left contacts (order)',
        group: 'funnel',
        name: 'G-05 Оставил контакты (заказ) (reg_step1)',
      },
      status: 'missing',
      spec: spec('reg_step1'),
    },
  ],
  dead: [{ id: 3, name: 'Старая форма', type: 'form', reference: null, reaches: 0 }],
  duplicates: [
    {
      reason: 'conditions',
      key: 'url|contain:/cart',
      goals: [
        { id: 4, name: 'Корзина', type: 'url', reference: null },
        { id: 5, name: 'Корзина 2', type: 'url', reference: null },
      ],
    },
  ],
  goals: [
    { id: 1, name: 'Price', type: 'action', reference: 'G-01', archived: false, conditions: [] },
    { id: 3, name: 'Старая форма', type: 'form', reference: null, archived: false, conditions: [] },
    { id: 4, name: 'Корзина', type: 'url', reference: null, archived: false, conditions: [] },
    { id: 5, name: 'Корзина 2', type: 'url', reference: null, archived: false, conditions: [] },
    { id: 9, name: 'Архивная', type: 'url', reference: null, archived: true, conditions: [] },
  ],
  days: 90,
  permission: 'edit',
  canWrite: true,
  warnings: [],
};

describe('GoalsManager («Цели счётчика»)', () => {
  beforeEach(() => {
    vi.mocked(goalsApi.audit).mockResolvedValue(AUDIT);
    vi.mocked(goalsApi.preview).mockReset();
    vi.mocked(goalsApi.create).mockReset();
    vi.mocked(goalsApi.archiveBulk).mockReset();
    vi.mocked(goalsApi.restore).mockReset();
  });

  it('renders the audit: expected statuses, dead goals, duplicates and archived goals', async () => {
    renderWithProviders(<GoalsManager />);
    expect(await screen.findByText('price_view')).toBeInTheDocument();
    expect(screen.getByText('reg_step1')).toBeInTheDocument();
    expect(screen.getByText('есть')).toBeInTheDocument();
    expect(screen.getByText('нет')).toBeInTheDocument();
    expect(screen.getByText('Мёртвые цели — 0 достижений за 90 дн.')).toBeInTheDocument();
    expect(screen.getByText('Старая форма')).toBeInTheDocument();
    expect(screen.getByText('url|contain:/cart')).toBeInTheDocument();
    expect(screen.getByText('Архивная')).toBeInTheDocument();
    // only missing references get a «Создать» button
    expect(screen.getAllByRole('button', { name: /^Создать/ })).toHaveLength(1);
  });

  it('«Создать» shows the preview JSON and writes only after confirmation', async () => {
    vi.mocked(goalsApi.preview).mockResolvedValue({
      method: 'POST',
      path: '/management/v1/counter/123/goals',
      body: { goal: spec('reg_step1') },
    });
    vi.mocked(goalsApi.create).mockResolvedValue({
      goal: { id: 77, name: 'G reg_step1', type: 'action' },
    });
    renderWithProviders(<GoalsManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать G-05' }));
    await waitFor(() => expect(goalsApi.preview).toHaveBeenCalledWith({ ref: 'G-05' }));
    const json = await screen.findByTestId('goal-preview-json');
    expect(json.textContent).toContain('"url": "reg_step1"');
    expect(goalsApi.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и создать' }));
    await waitFor(() => expect(goalsApi.create).toHaveBeenCalledWith({ ref: 'G-05' }));
    expect(await screen.findByText('Цель создана: G reg_step1 (ID 77)')).toBeInTheDocument();
  });

  it('bulk archive modal stays locked until АРХИВ is typed', async () => {
    vi.mocked(goalsApi.archiveBulk).mockResolvedValue({
      archived: [3, 5],
      failed: [],
      skipped: [],
    });
    renderWithProviders(<GoalsManager />);
    const archiveBtn = await screen.findByRole('button', { name: 'Архивировать выбранные (0)' });
    expect(archiveBtn).toBeDisabled();
    fireEvent.click(screen.getByLabelText('#3 Старая форма'));
    fireEvent.click(screen.getByLabelText('#5 Корзина 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Архивировать выбранные (2)' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Архивировать' });
    expect(confirm).toBeDisabled();
    const input = within(dialog).getByLabelText('АРХИВ');
    fireEvent.change(input, { target: { value: 'архив' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'ARCHIVE' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(goalsApi.archiveBulk).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'АРХИВ' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(goalsApi.archiveBulk).toHaveBeenCalledWith([3, 5], 'АРХИВ'));
    expect(await screen.findByText('В архиве: 2, ошибок: 0, пропущено: 0')).toBeInTheDocument();
  });

  it('custom goal form previews the typed spec (url / contain)', async () => {
    vi.mocked(goalsApi.preview).mockResolvedValue({
      method: 'POST',
      path: '/management/v1/counter/123/goals',
      body: { goal: { name: 'Cart', type: 'url', conditions: [{ type: 'start', url: '/cart' }] } },
    });
    renderWithProviders(<GoalsManager />);
    await screen.findByText('Своя цель');
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Cart' } });
    fireEvent.change(screen.getByLabelText('Условие'), { target: { value: 'start' } });
    fireEvent.change(screen.getByLabelText('Значение'), { target: { value: '/cart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    await waitFor(() =>
      expect(goalsApi.preview).toHaveBeenCalledWith({
        name: 'Cart',
        type: 'url',
        conditions: [{ type: 'start', url: '/cart' }],
      }),
    );
    expect(await screen.findByTestId('goal-preview-json')).toBeInTheDocument();
    expect(goalsApi.create).not.toHaveBeenCalled();
  });

  it('restore asks for confirmation; read-only token shows the metrika:write warning', async () => {
    vi.mocked(goalsApi.audit).mockResolvedValue({ ...AUDIT, canWrite: false, permission: 'view' });
    vi.mocked(goalsApi.restore).mockRejectedValue(
      new ApiError(403, JSON.stringify({ error: 'токену нужен доступ metrika:write' })),
    );
    renderWithProviders(<GoalsManager />);
    expect(await screen.findByText(/токену нужен доступ metrika:write/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Восстановить' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(goalsApi.restore).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Восстановить' }));
    await waitFor(() => expect(goalsApi.restore).toHaveBeenCalledWith(9));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'токену нужен доступ metrika:write',
    );
  });
});

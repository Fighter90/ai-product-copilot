import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api-v3', () => ({
  v3: {
    users: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetPassword: vi.fn(),
    deleteUser: vi.fn(),
    adminCounters: vi.fn(),
    adminUserCounters: vi.fn(),
    setUserCounters: vi.fn(),
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      email: 'admin@x.ru',
      name: 'Admin',
      role: 'admin',
      locale: 'ru',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      lastLoginAt: null,
    },
  }),
}));
import { v3 } from '../../lib/api-v3';
import { Users } from './Users';

const COUNTER = 54280963;
const counters = {
  configured: COUNTER,
  counters: [
    {
      id: COUNTER,
      name: 'ProductCamp',
      site: 'productcamp.ru',
      configured: true,
      source: 'settings' as const,
    },
    { id: 7, name: 'Second', site: 'b.ru', configured: false, source: 'metrika' as const },
  ],
};
const users = [
  {
    id: 1,
    email: 'admin@x.ru',
    name: 'Admin',
    role: 'admin' as const,
    locale: 'ru' as const,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: null,
  },
  {
    id: 2,
    email: 'an@x.ru',
    name: 'Ana',
    role: 'analyst' as const,
    locale: 'ru' as const,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: null,
  },
];

/** Select exactly `ids` in a multi-select and fire change (jsdom-safe: no target.value array). */
const pick = (select: HTMLSelectElement, ids: number[]) => {
  for (const opt of select.options) opt.selected = ids.includes(Number(opt.value));
  fireEvent.change(select);
};

const selected = (select: HTMLSelectElement) =>
  [...select.options].filter((o) => o.selected).map((o) => Number(o.value));

describe('Users → counter access (ANA-29)', () => {
  beforeEach(() => {
    vi.mocked(v3.users).mockResolvedValue(users);
    vi.mocked(v3.adminCounters).mockResolvedValue(counters);
    vi.mocked(v3.adminUserCounters).mockResolvedValue({ 2: [COUNTER] });
    vi.mocked(v3.setUserCounters).mockResolvedValue({ userId: 2, counterIds: [COUNTER] });
    vi.mocked(v3.createUser).mockResolvedValue({
      user: users[1]!,
      temporaryPassword: 'temp-pass-123',
    });
  });

  it('analyst row gets a multi-select with the assigned counters; admin row shows «все»', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    const analystRow = screen.getByText('an@x.ru').closest('tr')!;
    const adminRow = screen.getByText('admin@x.ru').closest('tr')!;
    expect(within(adminRow).getByText('все')).toBeInTheDocument();
    expect(within(adminRow).queryByRole('listbox')).toBeNull();
    const sel = within(analystRow).getByRole('listbox') as HTMLSelectElement;
    expect(selected(sel)).toEqual([COUNTER]);
  });

  it('changing the selection PUTs the new counter list and confirms with «Доступ к счётчикам обновлён»', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    const sel = within(screen.getByText('an@x.ru').closest('tr')!).getByRole(
      'listbox',
    ) as HTMLSelectElement;
    pick(sel, [COUNTER, 7]);
    await waitFor(() => expect(v3.setUserCounters).toHaveBeenCalledWith(2, [COUNTER, 7]));
    expect(await screen.findByRole('status')).toHaveTextContent('Доступ к счётчикам обновлён');
  });

  it('clearing the selection revokes access (empty list)', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    const sel = within(screen.getByText('an@x.ru').closest('tr')!).getByRole(
      'listbox',
    ) as HTMLSelectElement;
    pick(sel, []);
    await waitFor(() => expect(v3.setUserCounters).toHaveBeenCalledWith(2, []));
  });

  it('reports when the Metrika management list is unavailable', async () => {
    vi.mocked(v3.adminCounters).mockResolvedValue({ ...counters, metrikaError: 'HTTP 403' });
    renderWithProviders(<Users />);
    expect(await screen.findByText('Список из API Метрики недоступен')).toBeInTheDocument();
  });

  it('invite: analyst default = configured counter, sent as counterIds', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пользователя' }));
    const dialog = screen.getByRole('dialog');
    const sel = within(dialog).getByRole('listbox') as HTMLSelectElement;
    expect(selected(sel)).toEqual([COUNTER]); // «•»-marked configured counter preselected
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Н' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'n@x.ru' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(v3.createUser).toHaveBeenCalledWith({
        email: 'n@x.ru',
        name: 'Н',
        role: 'analyst',
        counterIds: [COUNTER],
      }),
    );
  });

  it('invite: cleared selection sends an explicit empty list (no default grant)', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пользователя' }));
    const dialog = screen.getByRole('dialog');
    pick(within(dialog).getByRole('listbox') as HTMLSelectElement, []);
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Н' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'n@x.ru' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(v3.createUser).toHaveBeenCalledWith({
        email: 'n@x.ru',
        name: 'Н',
        role: 'analyst',
        counterIds: [],
      }),
    );
  });

  it('invite: admins do not get a counter field and the payload has no counterIds', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пользователя' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Роль'), { target: { value: 'admin' } });
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Н' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'n@x.ru' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(v3.createUser).toHaveBeenCalledWith({ email: 'n@x.ru', name: 'Н', role: 'admin' }),
    );
  });
});

describe('Users → delete a user (ANA-123)', () => {
  beforeEach(() => {
    vi.mocked(v3.users).mockResolvedValue(users);
    vi.mocked(v3.adminCounters).mockResolvedValue(counters);
    vi.mocked(v3.adminUserCounters).mockResolvedValue({ 2: [COUNTER] });
    vi.mocked(v3.deleteUser).mockResolvedValue({ ok: true });
  });

  it('own row has no delete button; other rows do', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    const ownRow = screen.getByText('admin@x.ru').closest('tr')!;
    const otherRow = screen.getByText('an@x.ru').closest('tr')!;
    expect(within(ownRow).queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(within(otherRow).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('delete opens a confirmation dialog; only confirming calls v3.deleteUser', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    fireEvent.click(within(screen.getByText('an@x.ru').closest('tr')!).getByRole('button', {
      name: 'Удалить',
    }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Ana');
    expect(dialog).toHaveTextContent('an@x.ru');
    expect(v3.deleteUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(v3.deleteUser).toHaveBeenCalledWith(2));
  });

  it('cancelling the dialog deletes nothing', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    fireEvent.click(within(screen.getByText('an@x.ru').closest('tr')!).getByRole('button', {
      name: 'Удалить',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(v3.deleteUser).not.toHaveBeenCalled();
  });

  it('successful deletion shows a notice with the user name', async () => {
    renderWithProviders(<Users />);
    await screen.findByText('an@x.ru');
    fireEvent.click(within(screen.getByText('an@x.ru').closest('tr')!).getByRole('button', {
      name: 'Удалить',
    }));
    fireEvent.click(screen.getByTestId('confirm-accept'));
    expect(await screen.findByRole('status')).toHaveTextContent('Ana');
  });
});

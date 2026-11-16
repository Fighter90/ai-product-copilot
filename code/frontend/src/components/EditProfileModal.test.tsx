import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { v3, type CabinetUser } from '../lib/api-v3';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { EditProfileModal } from './EditProfileModal';

vi.mock('../lib/api-v3', () => ({ v3: { updateMe: vi.fn() } }));

const updateMe = vi.mocked(v3.updateMe);

const user: CabinetUser = {
  id: 1,
  email: 'analyst@pca.io',
  name: 'Тест Аналитик',
  role: 'analyst',
  locale: 'ru',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
};

/**
 * Рендер с собственным QueryClient, засеянным сессией (`['auth','me']` → CabinetUser —
 * так же, как пишет AuthContext), чтобы проверить обновление кеша после сохранения.
 * `MeProbe` — наблюдатель запроса (иначе запись с gcTime:0 собирается GC до проверки).
 */
function MeProbe(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['auth', 'me'],
    enabled: false,
    queryFn: async () => null,
  });
  return <span data-testid="me-probe">{data ? (data as CabinetUser).name : ''}</span>;
}

function renderModal({ closed = false, onClose = vi.fn() } = {}) {
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: () => {} }),
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  client.setQueryData(['auth', 'me'], user);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EditProfileModal open={!closed} onClose={onClose} user={user} />
        <MeProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, onClose };
}

const nameInput = () => screen.getByLabelText(/^(Имя|Name)/);
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

describe('EditProfileModal', () => {
  beforeEach(() => updateMe.mockReset());
  afterEach(() => setTestLocale('ru'));

  it('renders nothing when closed', () => {
    renderModal({ closed: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prefills name and locale from the user', () => {
    renderModal();
    expect(nameInput()).toHaveValue('Тест Аналитик');
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeChecked();
  });

  it('blocks an empty or over-long name before calling the API', () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('от 1 до 80 символов');
    fireEvent.change(nameInput(), { target: { value: 'a'.repeat(85) } });
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('от 1 до 80 символов');
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('saves via PATCH /auth/me, updates the session cache and applies the locale', async () => {
    const updated: CabinetUser = { ...user, name: 'Новый Аналитик', locale: 'en' };
    updateMe.mockResolvedValue({ user: updated });
    const { client } = renderModal();
    fireEvent.change(nameInput(), { target: { value: '  Новый Аналитик  ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    submit();
    // Успех виден сразу на НОВОМ языке (setLocale применён мгновенно, без перезагрузки)…
    expect(await screen.findByRole('status')).toHaveTextContent('Profile updated.');
    // …trim перед отправкой: бэкенд zod min(1)/max(80) получает чистое имя…
    expect(updateMe).toHaveBeenCalledWith({ name: 'Новый Аналитик', locale: 'en' });
    // …и кеш сессии обновлён → шапка (имя/аватар) меняется без повторного GET /auth/me.
    expect(client.getQueryData(['auth', 'me'])).toEqual(updated);
    expect(screen.getByTestId('me-probe')).toHaveTextContent('Новый Аналитик');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a generic error when the API fails', async () => {
    updateMe.mockRejectedValueOnce(new Error('500'));
    renderModal();
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить профиль.'),
    );
  });

  it('cancel closes the dialog', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('is fully translated in English', async () => {
    setTestLocale('en');
    renderModal();
    expect(screen.getByText('1 to 80 characters.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Russian' })).toBeChecked();
    expectNoCyrillic(document.body, { ignore: [`[data-testid="me-probe"]`] });
    // Ошибка API локализована (имя предзаполнено валидным — форма отправляется).
    updateMe.mockRejectedValueOnce(new Error('500'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the profile.');
    expectNoCyrillic(document.body, { ignore: [`[data-testid="me-probe"]`] });
  });
});

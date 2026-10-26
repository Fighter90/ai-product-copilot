import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

vi.mock('../lib/api-v3', () => ({ v3: { changePassword: vi.fn() } }));
import { v3 } from '../lib/api-v3';
import { ChangePasswordModal } from './ChangePasswordModal';

const change = vi.mocked(v3.changePassword);

function fill(current: string, next: string, confirm = next): void {
  fireEvent.change(screen.getByLabelText(/Текущий пароль|Current password/), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText(/^(Новый пароль|New password)/), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText(/Повторите новый пароль|Repeat the new password/), {
    target: { value: confirm },
  });
}
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /^(Сменить пароль|Change password)$/ }));

describe('ChangePasswordModal', () => {
  beforeEach(() => change.mockReset());
  afterEach(() => setTestLocale('ru'));

  it('renders nothing when closed', () => {
    renderWithProviders(<ChangePasswordModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('validates against the backend policy before calling the API', () => {
    renderWithProviders(<ChangePasswordModal open onClose={() => {}} />);
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Введите текущий пароль.');
    fill('old-password', 'short');
    expect(screen.getByRole('alert')).toHaveTextContent('не короче 10 символов');
    fill('old-password', 'a'.repeat(201));
    expect(screen.getByRole('alert')).toHaveTextContent('не длиннее 200 символов');
    fill('old-password', 'new-password-1', 'new-password-2');
    expect(screen.getByRole('alert')).toHaveTextContent('Пароли не совпадают.');
    expect(change).not.toHaveBeenCalled();
  });

  it('submits and shows the success state; close resets the form', async () => {
    change.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    renderWithProviders(<ChangePasswordModal open onClose={onClose} />);
    fill('old-password', 'new-password-1');
    submit();
    expect(await screen.findByRole('status')).toHaveTextContent('Пароль изменён.');
    expect(change).toHaveBeenCalledWith('old-password', 'new-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('maps a wrong current password and a generic failure', async () => {
    change.mockRejectedValueOnce(new Error('{"error":"wrong password","code":"BAD_CREDENTIALS"}'));
    renderWithProviders(<ChangePasswordModal open onClose={() => {}} />);
    fill('bad', 'new-password-1');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Текущий пароль неверен.');
    change.mockRejectedValueOnce(new Error('500'));
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сменить пароль.'),
    );
  });

  it('cancel closes the dialog', () => {
    const onClose = vi.fn();
    renderWithProviders(<ChangePasswordModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('is fully translated in English', async () => {
    setTestLocale('en');
    change.mockRejectedValueOnce(new Error('{"code":"WEAK_PASSWORD"}'));
    renderWithProviders(<ChangePasswordModal open onClose={() => {}} />);
    expect(screen.getByText('10 to 200 characters.')).toBeInTheDocument();
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your current password.');
    expectNoCyrillic(document.body);
    fill('old-password', 'new-password-1');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 10 characters');
    expectNoCyrillic(document.body);
  });
});

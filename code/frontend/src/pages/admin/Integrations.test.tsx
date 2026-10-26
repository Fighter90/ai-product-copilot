import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api-v3', () => ({
  v3: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
    checkDatalens: vi.fn(),
    datalensAdmin: vi.fn(),
    rotateDatalensToken: vi.fn(),
  },
}));
import { v3 } from '../../lib/api-v3';
import { ApiError } from '../../lib/api';
import { Integrations } from './Integrations';

const settings = {
  DATALENS_ORG_ID: { value: 'org-42', isSecret: false, source: 'db' as const },
  DATALENS_WORKBOOK_ID: { value: 'wb-7', isSecret: false, source: 'db' as const },
  DATALENS_IAM_TOKEN: { value: '••••9876', isSecret: true, source: 'db' as const },
  DATALENS_LINKS: { value: '', isSecret: false, source: 'unset' as const },
};

describe('Integrations → «Подключение DataLens»', () => {
  beforeEach(() => {
    vi.mocked(v3.settings).mockResolvedValue(settings);
    vi.mocked(v3.datalensAdmin).mockResolvedValue({
      hasToken: true,
      token: 'webhook-token-123456',
      events: [],
      lastCode: null,
    });
    vi.mocked(v3.saveSettings).mockResolvedValue({ ok: true, changed: ['DATALENS_ORG_ID'] });
    vi.mocked(v3.checkDatalens).mockReset();
  });

  it('renders the card with current values, masked IAM token, hints and the webhook URL', async () => {
    renderWithProviders(<Integrations />);
    expect(await screen.findByText('Подключение DataLens')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue('org-42')).toBeInTheDocument());
    expect(screen.getByDisplayValue('wb-7')).toBeInTheDocument();
    const iam = screen.getByPlaceholderText('••••9876') as HTMLInputElement;
    expect(iam.type).toBe('password');
    expect(iam.value).toBe('');
    expect(screen.getByText(/yc iam create-token/)).toBeInTheDocument();
    expect(screen.getByText(/Настройки организации/)).toBeInTheDocument();
    expect(
      await screen.findByText(/\/api\/integrations\/datalens\/webhook\/webhook-token-123456/),
    ).toBeInTheDocument();
  });

  it('save without a new IAM token does not send DATALENS_IAM_TOKEN', async () => {
    renderWithProviders(<Integrations />);
    await waitFor(() => expect(screen.getByDisplayValue('org-42')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('org-42'), { target: { value: 'org-43' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]!);
    await waitFor(() =>
      expect(v3.saveSettings).toHaveBeenCalledWith({
        DATALENS_ORG_ID: 'org-43',
        DATALENS_WORKBOOK_ID: 'wb-7',
      }),
    );
  });

  it('save with a new IAM token sends it', async () => {
    renderWithProviders(<Integrations />);
    await waitFor(() => expect(screen.getByDisplayValue('org-42')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('••••9876'), { target: { value: 't1.new' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]!);
    await waitFor(() =>
      expect(v3.saveSettings).toHaveBeenCalledWith({
        DATALENS_ORG_ID: 'org-42',
        DATALENS_WORKBOOK_ID: 'wb-7',
        DATALENS_IAM_TOKEN: 't1.new',
      }),
    );
  });

  it('«Проверить подключение» shows success with the workbook title', async () => {
    vi.mocked(v3.checkDatalens).mockResolvedValue({
      ok: true,
      message: 'Подключение к DataLens работает',
      workbookTitle: 'ProductCamp Analytics',
    });
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole('button', { name: /Проверить подключение/ }));
    expect(await screen.findByText(/Подключение к DataLens работает/)).toBeInTheDocument();
    expect(screen.getByText(/Воркбук: ProductCamp Analytics/)).toBeInTheDocument();
  });

  it('shows the backend message when config is missing (400)', async () => {
    vi.mocked(v3.checkDatalens).mockRejectedValue(
      new ApiError(400, JSON.stringify({ ok: false, message: 'Не заполнено: DATALENS_IAM_TOKEN' })),
    );
    renderWithProviders(<Integrations />);
    fireEvent.click(await screen.findByRole('button', { name: /Проверить подключение/ }));
    expect(await screen.findByText('Не заполнено: DATALENS_IAM_TOKEN')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    b2cPayments: vi.fn(),
    paymentsSummary: vi.fn(),
    saveB2cPayment: vi.fn(),
    removeB2cPayment: vi.fn(),
    importB2cPayments: vi.fn(),
  },
}));
import { api } from '../../lib/api';
import { B2cPaymentsCard } from './B2cPaymentsCard';

const mocked = vi.mocked(api);

function mockData(): void {
  mocked.b2cPayments.mockResolvedValue([
    {
      date: '2026-10-19',
      tickets: 4,
      amountRub: 56000,
      source: 'manual',
      updatedAt: '2026-10-19T10:00:00Z',
    },
    {
      date: '2026-10-20',
      tickets: 6,
      source: 'csv',
      note: 'CSV import',
      updatedAt: '2026-10-20T10:00:00Z',
    },
  ]);
  mocked.paymentsSummary.mockResolvedValue({ b2cPaid: 10, b2bPaid: 20, paid: 30, days: 2 });
}

afterEach(() => {
  setTestLocale('ru');
  vi.clearAllMocks();
});

describe('B2cPaymentsCard (ANA-19)', () => {
  it('shows the entered days and the «Оплачено» split (B2C + B2B)', async () => {
    mockData();
    renderWithProviders(<B2cPaymentsCard />);
    expect(await screen.findByTestId('b2c-row-2026-10-19')).toBeInTheDocument();
    expect(screen.getByTestId('b2c-row-2026-10-20')).toBeInTheDocument();
    expect(screen.getByTestId('b2c-days-count')).toHaveTextContent('Оплачено: 30');
    expect(screen.getByTestId('b2c-days-count')).toHaveTextContent('B2C — 10, B2B — 20');
  });

  it('saves one day (PUT upsert) with parsed numbers', async () => {
    mockData();
    mocked.saveB2cPayment.mockResolvedValue({
      date: '2026-10-21',
      tickets: 7,
      source: 'manual',
      updatedAt: 'T',
    });
    renderWithProviders(<B2cPaymentsCard />);
    await screen.findByTestId('b2c-row-2026-10-19');
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-21' } });
    fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Сумма, ₽'), { target: { value: '98000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить день' }));
    await screen.findByText('Оплаты за 2026-10-21 сохранены.');
    expect(mocked.saveB2cPayment).toHaveBeenCalledWith({
      date: '2026-10-21',
      tickets: 7,
      amountRub: 98000,
    });
  });

  it('imports a CSV and reports imported/skipped counts', async () => {
    mockData();
    mocked.importB2cPayments.mockResolvedValue({
      imported: 2,
      skipped: 1,
      errors: [{ line: 3, message: 'bad date' }],
    });
    renderWithProviders(<B2cPaymentsCard />);
    await screen.findByTestId('b2c-row-2026-10-19');
    fireEvent.change(screen.getByLabelText('CSV (дата,билеты[,сумма])'), {
      target: { value: '2026-10-21,5\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Импортировано дней: 2');
    expect(mocked.importB2cPayments).toHaveBeenCalledWith('2026-10-21,5\n');
  });

  it('renders without Cyrillic in the EN locale', async () => {
    setTestLocale('en');
    mockData();
    const { container } = renderWithProviders(<B2cPaymentsCard />);
    expect(await screen.findByTestId('b2c-row-2026-10-19')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../lib/api-v3', () => ({
  v3: {
    datasets: vi.fn(),
    settings: vi.fn(),
    requestDatalens: vi.fn(),
  },
}));
import { v3 } from '../../lib/api-v3';
import { DataLens } from './DataLens';

describe('DataLens page', () => {
  beforeEach(() => {
    vi.mocked(v3.datasets).mockResolvedValue([
      {
        id: 'traffic',
        ru: 'Трафик по дням',
        en: 'Traffic by day',
        ranged: true,
        columns: [{ name: 'visits', type: 'integer', ru: 'Визиты', en: 'Visits' }],
      },
    ]);
    vi.mocked(v3.settings).mockResolvedValue({
      DATALENS_LINKS: { value: 'https://datalens.yandex/abc' },
    } as unknown as Awaited<ReturnType<typeof v3.settings>>);
  });
  afterEach(() => setTestLocale('ru'));

  it('renders RU copy', async () => {
    renderWithProviders(<DataLens />);
    expect(await screen.findByText('Трафик по дням')).toBeInTheDocument();
    expect(screen.getByText('Наборы данных (CSV)')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Что нужно: какой дашборд, какие данные…'),
    ).toBeInTheDocument();
  });

  it('renders without Cyrillic in EN', async () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<DataLens />);
    expect(await screen.findByText('Traffic by day')).toBeInTheDocument();
    expect(await screen.findByText('https://datalens.yandex/abc')).toBeInTheDocument();
    expect(screen.getByText('Raw Metrika data directly')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

vi.mock('../../lib/api-v3', () => ({
  v3: {
    providers: vi.fn(),
    updateProvider: vi.fn(),
    testProvider: vi.fn(),
    aiUsage: vi.fn(),
  },
}));
import { v3, type ProviderView } from '../../lib/api-v3';
import { AiProviders } from './AiProviders';

/** Mirrors the backend `PROVIDER_META`: labels arrive from the API in Russian only (REG-13). */
const openrouter: ProviderView = {
  id: 'openrouter',
  name: 'OpenRouter',
  enabled: true,
  priority: 1,
  model: 'anthropic/claude-sonnet-4.5',
  models: ['anthropic/claude-sonnet-4.5'],
  secretLabel: 'API key',
  secretMask: '•••1234',
  hasSecret: true,
  extras: [],
  docs: 'https://openrouter.ai/docs',
  lastTest: null,
  updatedAt: '2026-10-25T10:00:00Z',
  updatedBy: null,
};

const yandexgpt: ProviderView = {
  id: 'yandexgpt',
  name: 'YandexGPT (AI Studio)',
  enabled: false,
  priority: 2,
  model: 'yandexgpt/latest',
  models: ['yandexgpt/latest'],
  secretLabel: 'API-ключ (секретная часть)',
  secretMask: '',
  hasSecret: false,
  extras: [{ key: 'folderId', label: 'ID каталога (folder ID)', value: 'b1gfa3f0' }],
  docs: 'https://aistudio.yandex.ru',
  lastTest: null,
  updatedAt: '2026-10-25T10:00:00Z',
  updatedBy: null,
};

describe('AiProviders', () => {
  beforeEach(() => {
    vi.mocked(v3.providers).mockResolvedValue([openrouter, yandexgpt]);
    vi.mocked(v3.aiUsage).mockResolvedValue([
      { provider: 'openrouter', calls: 3, failures: 0, outputChars: 100 },
    ]);
    vi.mocked(v3.updateProvider).mockResolvedValue(openrouter);
    vi.mocked(v3.testProvider).mockResolvedValue({ ok: true, message: 'ok', ms: 42 });
  });
  afterEach(() => setTestLocale('ru'));

  it('renders the provider cards with the backend labels in Russian', async () => {
    renderWithProviders(<AiProviders />);
    expect(await screen.findByText('YandexGPT (AI Studio)')).toBeInTheDocument();
    expect(screen.getByText(/API-ключ \(секретная часть\)/)).toBeInTheDocument();
    expect(screen.getByText('ID каталога (folder ID)')).toBeInTheDocument();
    expect(screen.getByText(/API key/)).toBeInTheDocument(); // OpenRouter keeps its own label
  });

  it('REG-13: re-maps the ru-only backend labels in English (ru+en parity)', async () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<AiProviders />);
    await screen.findByText('YandexGPT (AI Studio)');
    await waitFor(() => expect(screen.getByText(/API key \(secret part\)/)).toBeInTheDocument());
    expect(screen.getByText('Folder ID')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

vi.mock('../../lib/api-v3', () => ({
  v3: {
    providers: vi.fn(),
    updateProvider: vi.fn(),
    testProvider: vi.fn(),
    aiUsage: vi.fn(),
    providerModels: vi.fn(),
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
    // ANA-151: live catalog for openrouter, static set for yandexgpt.
    vi.mocked(v3.providerModels).mockImplementation(async (id) =>
      id === 'openrouter'
        ? {
            source: 'live' as const,
            models: [
              {
                id: 'anthropic/claude-opus-4.5',
                name: 'Claude Opus 4.5',
                contextLength: 200_000,
                promptPricePerM: 5,
                completionPricePerM: 25,
              },
              {
                id: 'vendor/nova-9',
                name: 'Nova 9',
                promptPricePerM: 0.5,
                completionPricePerM: 1.5,
              },
              { id: 'vendor/free-model', name: 'Free Model' },
            ],
          }
        : {
            source: 'static' as const,
            models: [{ id: 'yandexgpt-5.1' }, { id: 'yandexgpt/latest' }],
          },
    );
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

/** ANA-151: the model field is a combobox over the provider's FULL live catalog, free text stays. */
describe('AiProviders model catalog (ANA-151)', () => {
  beforeEach(() => {
    vi.mocked(v3.providers).mockResolvedValue([openrouter, yandexgpt]);
    vi.mocked(v3.aiUsage).mockResolvedValue([]);
    vi.mocked(v3.updateProvider).mockResolvedValue(openrouter);
    vi.mocked(v3.testProvider).mockResolvedValue({ ok: true, message: 'ok', ms: 42 });
    vi.mocked(v3.providerModels).mockImplementation(async (id) =>
      id === 'openrouter'
        ? {
            source: 'live' as const,
            models: [
              {
                id: 'anthropic/claude-opus-4.5',
                name: 'Claude Opus 4.5',
                contextLength: 200_000,
                promptPricePerM: 5,
                completionPricePerM: 25,
              },
              {
                id: 'vendor/nova-9',
                name: 'Nova 9',
                promptPricePerM: 0.5,
                completionPricePerM: 1.5,
              },
              { id: 'vendor/free-model', name: 'Free Model' },
            ],
          }
        : {
            source: 'static' as const,
            models: [{ id: 'yandexgpt-5.1' }, { id: 'yandexgpt/latest' }],
          },
    );
  });
  afterEach(() => setTestLocale('ru'));

  const datalistValues = (listId: string): Array<string | null> =>
    Array.from(document.getElementById(listId)?.querySelectorAll('option') ?? []).map((o) =>
      o.getAttribute('value'),
    );

  it('fills the datalist from the LIVE catalog (models beyond the 5 hardcoded)', async () => {
    const { container } = renderWithProviders(<AiProviders />);
    await screen.findByText('OpenRouter');
    await waitFor(() =>
      expect(datalistValues('models-openrouter')).toEqual([
        'anthropic/claude-opus-4.5',
        'vendor/nova-9',
        'vendor/free-model',
      ]),
    );
    // name and per-1M price ride along in the option label
    const nova = container.querySelector(
      '#models-openrouter option[value="vendor/nova-9"]',
    )?.textContent;
    expect(nova).toBe('Nova 9 · $0.5/$1.5');
  });

  it('falls back to the shortlist when the catalog request fails', async () => {
    vi.mocked(v3.providerModels).mockRejectedValue(new Error('offline'));
    renderWithProviders(<AiProviders />);
    await screen.findByText('OpenRouter');
    await waitFor(() =>
      expect(datalistValues('models-openrouter')).toEqual(['anthropic/claude-sonnet-4.5']),
    );
  });

  it('shows the per-1M price hint for the selected model', async () => {
    vi.mocked(v3.providers).mockResolvedValue([
      { ...openrouter, model: 'anthropic/claude-opus-4.5' },
    ]);
    const { container } = renderWithProviders(<AiProviders />);
    await screen.findByText('OpenRouter');
    await waitFor(() => {
      const hint = container.querySelector('label span.mt-1');
      expect(hint?.textContent).toMatch(/\$5\/\$25 · цена за 1M токенов/);
    });
  });

  it('keeps free text: a custom model saves without catalog help', async () => {
    renderWithProviders(<AiProviders />);
    const input = await screen.findByDisplayValue('anthropic/claude-sonnet-4.5');
    fireEvent.change(input, { target: { value: 'my-custom/fine-tune-42' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(vi.mocked(v3.updateProvider)).toHaveBeenCalledWith(
        'openrouter',
        expect.objectContaining({ model: 'my-custom/fine-tune-42' }),
      ),
    );
  });
});

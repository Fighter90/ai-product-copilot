import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
  BuildMismatchBadge,
  BuildMismatchBanner,
  resetBuildMismatchWarning,
} from './BuildMismatchBadge';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

const front = { version: '3.1.0', sha: 'abc1234', date: '2026-10-25' };

function mockHealth(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetBuildMismatchWarning();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
  setTestLocale('ru');
});

describe('BuildMismatchBadge', () => {
  it('shows a badge and warns once when the backend runs another commit', async () => {
    mockHealth({ status: 'ok', version: '3.1.0', build: 'fff0000111122223333' });
    const { rerender } = renderWithProviders(<BuildMismatchBadge frontend={front} />);
    const badge = await screen.findByTestId('build-mismatch');
    expect(badge).toHaveTextContent('Устаревшая сборка');
    expect(badge).toHaveAttribute('title', expect.stringContaining('abc1234'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('fff0000'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('abc1234');
    rerender(<BuildMismatchBadge frontend={front} />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when frontend and backend builds match', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: '3.1.0', build: 'abc1234ffff' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<BuildMismatchBadge frontend={front} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('build-mismatch')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('renders nothing when /api/health fails', async () => {
    mockHealth({ error: 'down' }, 503);
    renderWithProviders(<BuildMismatchBadge frontend={front} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('build-mismatch')).toBeNull();
  });

  it('flags a version mismatch in English', async () => {
    setTestLocale('en');
    mockHealth({ version: '3.2.0', build: null });
    const { container } = renderWithProviders(<BuildMismatchBadge frontend={front} />);
    const badge = await screen.findByTestId('build-mismatch');
    expect(badge).toHaveTextContent('Outdated build');
    expectNoCyrillic(container);
  });
});

describe('BuildMismatchBanner (REG-15)', () => {
  it('shows a non-blocking banner with a hint to reload when the backend runs a newer build', async () => {
    mockHealth({ status: 'ok', version: '3.1.0', build: 'fff0000111122223333' });
    renderWithProviders(<BuildMismatchBanner frontend={front} />);
    const banner = await screen.findByTestId('build-mismatch-banner');
    expect(banner).toHaveTextContent('Доступна новая версия');
    expect(banner).toHaveAttribute('role', 'status');
    // the console warning belongs to the badge; no auto-reload happens
    expect(warn).not.toHaveBeenCalled();
  });

  it('renders nothing when the builds match', async () => {
    mockHealth({ version: '3.1.0', build: 'abc1234ffff' });
    renderWithProviders(<BuildMismatchBanner frontend={front} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('build-mismatch-banner')).toBeNull();
  });

  it('is translated in English', async () => {
    setTestLocale('en');
    mockHealth({ version: '3.2.0', build: null });
    const { container } = renderWithProviders(<BuildMismatchBanner frontend={front} />);
    const banner = await screen.findByTestId('build-mismatch-banner');
    expect(banner).toHaveTextContent('A new version is available');
    expectNoCyrillic(container);
  });

  it('polls /api/health every 5 minutes so an open tab notices a deploy', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ version: '3.1.0', build: 'fff0000111122223333' }), {
            status: 200,
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderWithProviders(<BuildMismatchBanner frontend={front} />);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

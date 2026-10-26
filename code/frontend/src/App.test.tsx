import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The v3 shell mounts the public landing at `/`; the cabinet lives behind /app auth.
vi.mock('./lib/api', () => ({
  api: {
    me: vi.fn().mockResolvedValue(null),
    channels: vi.fn().mockResolvedValue([]),
    primaryGoal: vi.fn().mockResolvedValue(null),
    geoDevice: vi.fn().mockResolvedValue([]),
  },
}));
import { App } from './App';
import { queryClient } from './lib/query';

afterEach(() => queryClient.clear());

describe('<App>', () => {
  it('renders the public landing shell with headline and login entry', async () => {
    render(<App />);
    // Landing hero headline (locale defaults by navigator language: ru/en)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /(От Метрики|From Metrika)/i,
    );
    // Public header links into the cabinet / login
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

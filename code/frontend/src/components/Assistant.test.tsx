import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

vi.mock('../lib/api-v3', () => ({ v3: { ask: vi.fn() } }));
import { v3 } from '../lib/api-v3';
import { Assistant } from './Assistant';

describe('Assistant (EN locale)', () => {
  beforeEach(() => {
    setTestLocale('en');
    // jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => setTestLocale('ru'));

  it('renders the panel, examples, an answer and an error without Cyrillic', async () => {
    vi.mocked(v3.ask)
      .mockResolvedValueOnce({
        answer: 'Open **Admin → Users**.',
        mode: 'search',
        sources: [{ slug: 'admin', title: 'Admin', heading: 'Users' }],
      } as unknown as Awaited<ReturnType<typeof v3.ask>>)
      .mockRejectedValueOnce(new Error('boom'));
    const { container } = renderWithProviders(<Assistant />);
    fireEvent.click(screen.getByRole('button', { name: 'Help assistant' }));
    expect(screen.getByText('For example')).toBeInTheDocument();
    expectNoCyrillic(container);

    fireEvent.click(screen.getByRole('button', { name: 'How do I add an analyst?' }));
    expect(await screen.findByText(/Sources/)).toBeInTheDocument();
    expect(v3.ask).toHaveBeenCalledWith('How do I add an analyst?', 'en');

    fireEvent.change(screen.getByLabelText('Ask how to do something…'), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(
      await screen.findByText('Could not get an answer. Please try again.'),
    ).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});

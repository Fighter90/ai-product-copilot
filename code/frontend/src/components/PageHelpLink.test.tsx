import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { HELP_SLUGS, PageHelpLink, helpSlugForPath } from './PageHelpLink';
import { NAV } from './CabinetLayout';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

describe('helpSlugForPath', () => {
  it.each([
    ['/app', 'overview'],
    ['/app/', 'overview'],
    ['/app/live', 'live'],
    ['/app/goals', 'goals'],
    ['/app/goals/123', 'goals'],
    ['/app/funnel-live', 'live'],
    ['/app/funnel', 'funnel'],
    ['/app/traffic', 'traffic-behavior'],
    ['/app/behavior', 'traffic-behavior'],
    ['/app/kpi', 'goals'],
    ['/app/explore/sources', 'explore'],
    ['/app/report', 'report'],
    ['/app/history', 'history-b2b'],
    ['/app/b2b', 'history-b2b'],
    ['/app/datalens', 'datalens'],
    ['/app/admin/users', 'roles'],
    ['/app/admin/ai', 'llm-keys'],
    ['/app/admin/metrika', 'admin'],
    ['/app/admin/integrations', 'datalens'],
    ['/app/admin/audit', 'admin'],
    ['/app/unknown', 'start'],
    ['/elsewhere', 'start'],
  ])('%s → %s', (path, slug) => {
    expect(helpSlugForPath(path)).toBe(slug);
  });

  it('does not confuse /app/funnel with /app/funnel-live', () => {
    expect(helpSlugForPath('/app/funnel-livex')).toBe('start');
  });

  it('maps every cabinet nav section to an existing article', () => {
    for (const s of NAV)
      for (const it of s.items)
        expect(HELP_SLUGS).toContain(helpSlugForPath(it.to) as (typeof HELP_SLUGS)[number]);
  });
});

describe('PageHelpLink', () => {
  afterEach(() => setTestLocale('ru'));

  it('links to the article of the current section', () => {
    renderWithProviders(<PageHelpLink />, '/app/traffic');
    const link = screen.getByRole('link', { name: 'Справка по этому разделу' });
    expect(link).toHaveAttribute('href', '/help/traffic-behavior');
  });

  it('accepts an explicit slug', () => {
    renderWithProviders(<PageHelpLink slug="metrics" />, '/app');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/help/metrics');
  });

  it('is labelled in English', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<PageHelpLink />, '/app/live');
    expect(screen.getByRole('link', { name: 'Help for this section' })).toHaveAttribute(
      'href',
      '/help/live',
    );
    expectNoCyrillic(container);
  });
});

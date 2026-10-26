import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightBadge } from './InsightBadge';

describe('InsightBadge', () => {
  it('renders the default icon per type and an icon override', () => {
    const { rerender } = render(<InsightBadge type="good" text="ok" />);
    expect(screen.getByText('✅')).toBeInTheDocument();
    rerender(<InsightBadge type="warning" text="bad" />);
    expect(screen.getByText('⚠️')).toBeInTheDocument();
    rerender(<InsightBadge type="info" text="fyi" />);
    expect(screen.getByText('ℹ️')).toBeInTheDocument();
    rerender(<InsightBadge type="warning" icon="🔴" text="bad" />);
    expect(screen.getByText('🔴')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });
});

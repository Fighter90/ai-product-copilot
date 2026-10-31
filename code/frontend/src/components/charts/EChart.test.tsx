import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EChart } from './EChart';

// EChart грузит echarts за React.lazy (ANA-41): чарт появляется асинхронно, а реальная
// цепочка echarts-theme → echarts в jsdom импортируется дольше секунды — ждём с таймаутом.
describe('EChart', () => {
  it('renders the (mocked) chart with default and explicit height', async () => {
    render(<EChart option={{}} />);
    render(<EChart option={{ series: [] }} height={200} />);
    // findAllByTestId разрешился бы на первом же чарте — ждём ОБА (второй root может
    // догрузить lazy-модуль чуть позже первого).
    await waitFor(() => expect(screen.getAllByTestId('echart')).toHaveLength(2), { timeout: 15000 });
  });
});

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// ECharts renders to a canvas, which jsdom does not implement — mock the wrapper.
vi.mock('echarts-for-react', () => ({
  default: () => React.createElement('div', { 'data-testid': 'echart' }),
}));

// Компоненты читают prefs из localStorage; в тестах фиксируем русский язык,
// чтобы ассерты на RU-строки были детерминированы. ВАЖНО: top-level, не beforeAll —
// zustand-стор prefs инициализируется при импорте модуля компонентами.
window.localStorage.setItem('pca.locale', 'ru');
window.localStorage.setItem('pca.theme', 'dark');

afterEach(() => {
  cleanup();
});

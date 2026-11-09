import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy* waits: 5s instead of the 1s default. Under parallel coverage (3 packages ×
// threads racing) lazy-loaded routes render slower than 1s on a loaded box and App.test
// flaked (ANA-125 cycle 2: «guest hitting /app is redirected»). 5s keeps the suite
// load-resilient without masking real bugs — asserts still run immediately.
configure({ asyncUtilTimeout: 5_000 });

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

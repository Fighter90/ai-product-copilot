import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { CapturingResizeObserver, resetObservedResizes } from './resize-observer';

// findBy* waits: 5s instead of the 1s default. Under parallel coverage (3 packages ×
// threads racing) lazy-loaded routes render slower than 1s on a loaded box and App.test
// flaked (ANA-125 cycle 2: «guest hitting /app is redirected»). 5s keeps the suite
// load-resilient without masking real bugs — asserts still run immediately.
configure({ asyncUtilTimeout: 5_000 });

// ECharts renders to a canvas, which jsdom does not implement — mock the wrapper.
vi.mock('echarts-for-react', () => ({
  default: () => React.createElement('div', { 'data-testid': 'echart' }),
}));

// jsdom does not implement ResizeObserver either; the funnel chart measures its container
// with it to make the pixel-based label decision (ANA-177 round 2). Capturing stub (ANA-177
// round 3 review): still passive by default — callbacks register but never auto-fire, so
// tests stay deterministic — but it RECORDS them, so tests can drive the measured-width hook
// explicitly (fireObservedResize in routes/funnel.test.tsx).
window.ResizeObserver ??= CapturingResizeObserver;

// Компоненты читают prefs из localStorage; в тестах фиксируем русский язык,
// чтобы ассерты на RU-строки были детерминированы. ВАЖНО: top-level, не beforeAll —
// zustand-стор prefs инициализируется при импорте модуля компонентами.
window.localStorage.setItem('pca.locale', 'ru');
window.localStorage.setItem('pca.theme', 'dark');

afterEach(() => {
  cleanup();
  // Captured ResizeObserver callbacks belong to already-unmounted UI — drop them so a later
  // fire never reaches a dead component.
  resetObservedResizes();
});

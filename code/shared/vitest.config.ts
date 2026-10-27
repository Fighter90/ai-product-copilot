import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/types/**',
        '**/*.test.ts',
        'src/report-sections.ts',
        'src/test-fixtures/**',
      ],
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
  },
});

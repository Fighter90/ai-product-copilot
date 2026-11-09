import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // scrypt-backed suites (secrets, passwords) are CPU-bound and blow the 5 s default on a
    // loaded box; vitest 4 fails them even when the overrun comes from a blocked event loop.
    testTimeout: 20_000,
    // Same hazard in hooks: vitest 4 caps beforeEach at its own 10 s default regardless of
    // testTimeout. build()-style beforeEach (scrypt users + SQLite migrations + Fastify ready)
    // blow it under parallel --coverage load; the hook then never assigns the test ctx and
    // afterEach crashes with «Cannot read properties of undefined (reading 'app')», failing
    // every test in the file (ANA-125 review round 3 gate failure).
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Bootstrap/entry files (listen/exit, CLI) are excluded from coverage by design.
      exclude: [
        'src/server.ts',
        'src/db/cli-migrate.ts',
        'src/db/cli-seed.ts',
        'src/metrika/cli-sync.ts',
        'src/metrika/cli-auth.ts',
        'src/setup/cli-init.ts',
        'src/metrika/production-sync.ts',
        'src/report/production-report.ts',
        'src/report/pdf/renderer.ts',
        // Server-side chart rendering (Puppeteer + ECharts) — launches a real browser, e2e/manual only.
        'src/report/chart-renderer.ts',
        // AI integration files — require external API, tested via e2e:
        'src/report/ai-insights.ts',
        'src/report/ai-hypotheses.ts',
        'src/utils/logger.ts',
        '**/*.test.ts',
      ],
      // ANA-26: 75% вместо 100% (см. docs/decisions/014-coverage-threshold-75.md).
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
  },
});

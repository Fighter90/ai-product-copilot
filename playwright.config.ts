import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;

// E2E runs against the real frontend; backend calls are mocked at the network
// layer per-test so the suite is deterministic and needs no OAuth token.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop runs every spec except the mobile-only one.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    // Mobile: iPhone 14 profile (390×844, touch, mobile UA) on chromium.
    // ANA-146: the project used to inherit webkit from devices['iPhone 14'], which made the spec
    // unrunnable without a locally installed webkit build («Executable webkit-2370 not found»)
    // and browser-dependent at exactly 390px (the /app overflow reproduced only under webkit;
    // the same page is clean in the chromium prod build). browserName overrides the device's
    // defaultBrowserType so the whole spec is deterministic on chromium everywhere.
    {
      name: 'mobile-iphone-14',
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm --filter @pca/frontend dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

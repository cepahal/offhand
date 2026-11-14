import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'pnpm --filter @offhand/web dev',
    url: 'http://127.0.0.1:5173/demo',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

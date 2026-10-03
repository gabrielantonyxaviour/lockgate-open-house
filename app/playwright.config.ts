import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test', testMatch: '**/*.spec.ts',
  fullyParallel: true, workers: 2, retries: 0,
  timeout: 30_000, expect: { timeout: 8_000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5197', screenshot: 'off', video: 'off', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5197', reuseExistingServer: true },
});

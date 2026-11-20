import { defineConfig, devices } from '@playwright/test'

const PORT = 4180
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 6,
  retries: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}/`, trace: 'retain-on-failure', locale: 'pl-PL', timezoneId: 'Europe/Warsaw' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' }, grep: /@mobile/ },
  ],
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
})

import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: '.', timeout: 60_000, use: { baseURL: process.env.LIVE_URL ?? 'https://michaelkuchno.github.io/kapital/', locale: 'pl-PL' }, projects: [{ name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } }, { name: 'android', use: { ...devices['Pixel 7'] } }] })

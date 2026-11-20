import { test, expect } from '@playwright/test'
/** Smoke test of the published app: npx playwright test -c tests/live/pw.config.ts */
test('published app works on a phone', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  await expect(page.getByTestId('quick-start')).toBeVisible()
  await expect(page.getByTestId('data-date')).toContainText('Dane z')
  await page.getByTestId('nav-market').click()
  await expect(page.getByTestId('sector-table').locator('tbody tr')).toHaveCount(14)
  await page.getByTestId('nav-bonds').click()
  await expect(page.getByTestId('offer').locator('[data-testid^="offer-"]')).toHaveCount(8)
  await page.getByTestId('nav-learn').click()
  await expect(page.getByTestId('lesson-trend').locator('path').first()).toBeVisible()
  expect(errors).toEqual([])
})

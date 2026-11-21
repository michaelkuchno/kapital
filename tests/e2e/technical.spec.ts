import { test, expect, type Page } from '@playwright/test'
import { addBond, addStock, iso } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('dashboard')).toBeVisible()
})

/** The shared analysis panel shows every part, with real numbers and explanations. */
async function expectFullAnalysis(page: Page, root = page.getByTestId('tech-analysis')) {
  await expect(root).toBeVisible()
  await expect(root.getByTestId('ta-rating')).toHaveAttribute('data-rating', /strong-buy|buy|neutral|sell|strong-sell/)
  const score = Number(await root.getByTestId('ta-score').getAttribute('data-value'))
  expect(score).toBeGreaterThanOrEqual(-100)
  expect(score).toBeLessThanOrEqual(100)
  expect(await root.getByTestId('ta-reasons').locator('li').count()).toBeGreaterThanOrEqual(2)
  await expect(root.getByTestId('ta-phase-chip')).toHaveAttribute('data-phase', /bull|bear|correction|rebound|unknown/)
  await expect(root.getByTestId('ta-phasebar')).toBeVisible()
  await expect(root.getByTestId('ta-rsi').locator('path').first()).toBeVisible()
  await expect(root.getByTestId('ta-macd').locator('path').first()).toBeVisible()
  // 10 moving averages + 5 oscillators vote
  await expect(root.locator('[data-testid^="ta-vote-"]')).toHaveCount(15)
  await expect(root.getByTestId('ta-patterns')).toBeVisible()
  await expect(root.getByTestId('ta-levels')).toBeVisible()
  await expect(root.getByTestId('ta-stats')).toBeVisible()
  await expect(root.getByTestId('ta-disclaimer')).toBeVisible()
  await expect(root).not.toContainText(/NaN|undefined|Infinity|ta\.[a-z]/)
}

test('sector analysis: verdict, phase, charts, votes, patterns, levels; periods switch @mobile', async ({ page }) => {
  await page.getByTestId('nav-market').click()
  // every sector gets a phase and a technical rating in the table
  await expect(page.getByTestId('rating-WIG-BANKI')).toBeVisible()
  await expect(page.getByTestId('phase-WIG-ENERG')).toBeVisible()
  await expect(page.locator('[data-testid^="rating-"]')).toHaveCount(15 + 7)
  await page.getByTestId('row-WIG-BANKI').click()
  await expect(page.getByTestId('index-chart')).toBeVisible()
  await expectFullAnalysis(page)
  const pathsBefore = await page.getByTestId('index-line').locator('path').first().getAttribute('d')
  await page.getByTestId('ta-period-6m').click()
  await expect(page.getByTestId('ta-period-6m')).toHaveAttribute('aria-checked', 'true')
  expect(await page.getByTestId('index-line').locator('path').first().getAttribute('d')).not.toBe(pathsBefore)
  await page.getByTestId('ta-period-max').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('index-chart')).toBeHidden()
})

test('biotech basket: in the sector table, explained, with a full analysis', async ({ page }) => {
  await page.getByTestId('nav-market').click()
  await expect(page.getByTestId('row-KAP-BIOTECH')).toContainText('Biotechnologia')
  await expect(page.getByTestId('sectors')).toContainText('Mabion')
  await page.getByTestId('row-KAP-BIOTECH').click()
  await expectFullAnalysis(page)
})

test('search any instrument: a share (with analyst reports), an ETF, gold @mobile', async ({ page }) => {
  await page.getByTestId('nav-market').click()
  await page.getByTestId('ta-search-input').fill('selvita')
  await page.getByTestId('ta-search-results').getByRole('button').first().click()
  await expect(page.getByTestId('tech-modal')).toBeVisible()
  await expectFullAnalysis(page)
  // Selvita is covered by the GPW analytical programme
  await expect(page.getByTestId('ta-analysts')).toBeVisible()
  await expect(page.getByTestId('ta-analysts').locator('a').first()).toHaveAttribute('href', /^https:\/\/www\.gpw\.pl\/pub\/pwpa\/.+\.pdf$/)
  await page.keyboard.press('Escape')
  await page.getByTestId('ta-search-input').fill('ETFBW20')
  await page.getByTestId('ta-search-results').getByRole('button').first().click()
  await expectFullAnalysis(page)
  await page.keyboard.press('Escape')
  await page.getByTestId('ta-search-input').fill('złoto')
  await page.getByTestId('ta-search-results').getByRole('button').first().click()
  await expectFullAnalysis(page)
  await page.keyboard.press('Escape')
  await page.getByTestId('ta-search-input').fill('zzzzqq')
  await expect(page.getByTestId('ta-search-results')).toContainText('Nie znaleziono')
})

test('proposals and the institutions panel: NBP, GUS, MF, GPW analysts, KNF check @mobile', async ({ page }) => {
  await page.getByTestId('nav-market').click()
  for (const g of ['strong', 'turn', 'weak']) await expect(page.getByTestId(`picks-${g}`)).toBeVisible()
  await expect(page.getByTestId('picks')).toContainText('nie rekomendacja')
  const inst = page.getByTestId('institutions')
  await expect(inst.getByTestId('inst-nbp')).toContainText('Stopa referencyjna')
  await expect(inst.getByTestId('inst-nbp')).toContainText('Realna stopa')
  await expect(inst.getByTestId('inst-gus-mf')).toContainText('EDO')
  await expect(inst.getByTestId('gpwpa-summary')).toContainText(/Ostatnie 90 dni: \d+ rekomendacji/)
  expect(await inst.getByTestId('gpwpa-table').locator('tbody tr').count()).toBeGreaterThan(3)
  await inst.getByTestId('gpwpa-filter').fill('Trigon')
  expect(await inst.getByTestId('gpwpa-table').locator('tbody tr').count()).toBeGreaterThan(0)
  for (const row of await inst.getByTestId('gpwpa-table').locator('tbody tr').allTextContents()) expect(row).toContain('Trigon')
  // KNF: a platform on the warning list is found, a made-up name is not
  await inst.getByTestId('knf-input').fill('GrandTrade')
  await expect(inst.getByTestId('knf-result')).toContainText('Uwaga')
  await inst.getByTestId('knf-input').fill('Zzyzx Qwerty Capital')
  await expect(inst.getByTestId('knf-result')).toHaveAttribute('data-hits', '0')
  await expect(inst.getByTestId('knf-result')).toContainText('To nie gwarancja')
})

test('every chosen instrument: shares and gold in Assets have an analysis, bonds explain why not', async ({ page }) => {
  await addStock(page, 'PKOBP', '10', '45')
  await page.getByTestId('ta-open-asset').first().click()
  await expectFullAnalysis(page)
  await page.keyboard.press('Escape')
  await addBond(page, '1 000', iso(-30))
  await expect(page.getByTestId('ta-na-bond')).toContainText('nie dotyczy')
})

test('adviser: each proposed ETF opens its technical analysis', async ({ page }) => {
  await page.getByTestId('nav-advisor').click()
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-income').fill('15000')
  await page.getByTestId('adv-expenses').fill('8000')
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-cash').fill('300000')
  await page.getByTestId('adv-next').click()
  for (let q = 1; q <= 5; q++) await page.getByTestId(`adv-q${q}-4`).click()
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-horizon').fill('15')
  await page.getByTestId('adv-next').click()
  await page.getByTestId('ta-open-etf-world').click()
  await expectFullAnalysis(page)
})

test('technical analysis in English and German', async ({ page }) => {
  for (const [lang, word] of [
    ['en', 'Technical verdict'],
    ['de', 'Technisches Urteil'],
  ] as const) {
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('s-lang').selectOption(lang)
    await page.getByTestId('nav-market').click()
    await page.getByTestId('row-WIG-ENERG').click()
    await expect(page.getByTestId('ta-verdict')).toContainText(word)
    await expectFullAnalysis(page)
    await page.keyboard.press('Escape')
  }
})

import { test, expect, type Page } from '@playwright/test'
import { addDeposit, num } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('dashboard')).toBeVisible()
})

/** Walk through the 5 steps of the planner. */
async function fillPlanner(page: Page, o: { country: 'PL' | 'CH'; currency: 'PLN' | 'CHF'; income: string; expenses: string; cash: string; cashCur: 'PLN' | 'CHF'; risk: number; child?: string; planned?: boolean }) {
  await page.getByTestId('nav-advisor').click()
  await expect(page.getByTestId('adv-progress')).toBeVisible()
  // 1 family
  await page.getByTestId(`adv-residence-${o.country}`).click()
  await page.getByTestId('adv-adults').fill('2')
  await page.getByTestId('adv-earners').fill('1')
  await page.getByTestId('adv-job-stable').click()
  if (o.child) {
    await page.getByTestId('adv-add-child').click()
    await expect(page.getByTestId('adv-next')).toBeDisabled() // a child without a birth date is not valid
    await page.getByTestId('adv-child-0').fill(o.child)
  }
  await page.getByTestId('adv-next').click()
  // 2 money
  await page.getByTestId(`adv-currency-${o.currency}`).click()
  await page.getByTestId('adv-income').fill(o.income)
  await page.getByTestId('adv-expenses').fill(o.expenses)
  await expect(page.getByTestId('adv-surplus')).toBeVisible()
  await page.getByTestId('adv-expenses').fill('abc')
  await expect(page.getByTestId('adv-next')).toBeDisabled()
  await page.getByTestId('adv-expenses').fill(o.expenses)
  await page.getByTestId('adv-next').click()
  // 3 now
  await page.getByTestId('adv-cash').fill(o.cash)
  await page.getByTestId(`adv-cash-currency-${o.cashCur}`).click()
  if (o.planned) {
    await page.getByTestId('adv-add-planned').click()
    await expect(page.getByTestId('adv-next')).toBeDisabled()
    await page.getByTestId('adv-planned-name-0').fill('auto')
    await page.getByTestId('adv-planned-amount-0').fill('20000')
    await page.getByTestId('adv-planned-months-0').fill('10')
  }
  await page.getByTestId('adv-next').click()
  // 4 risk
  for (let q = 1; q <= 5; q++) await page.getByTestId(`adv-q${q}-${o.risk}`).click()
  await page.getByTestId('adv-next').click()
  // 5 goals
  await page.getByTestId('adv-horizon').fill('15')
  if (o.child) await page.getByTestId('adv-child-goal').fill('100000')
  await page.getByTestId('adv-back').click()
  await expect(page.getByTestId('adv-q1-' + o.risk)).toHaveAttribute('aria-checked', 'true') // answers kept when going back
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-next').click()
}

test('planner (Poland): a family plan with buckets, indicator cards, market context, projection, stress test, checklist @mobile', async ({ page }) => {
  await fillPlanner(page, { country: 'PL', currency: 'PLN', income: '20000', expenses: '9000', cash: '600000', cashCur: 'PLN', risk: 4, child: '2023-03-15', planned: true })
  await expect(page.getByTestId('plan-hero')).toBeVisible()
  // the three buckets add up to the cash (no existing assets)
  await expect.poll(async () => (await num(page, 'bucket-safe')) + (await num(page, 'bucket-balanced')) + (await num(page, 'bucket-growth'))).toBeCloseTo(600_000, -1)
  for (const id of ['reserve', 'planned-auto', 'edo', 'etf-world', 'etf-poland', 'gold']) await expect(page.getByTestId(`plan-item-${id}`)).toBeVisible()
  // every card shows its indicators; equity ETFs also show live market numbers and a trend signal
  for (const id of ['reserve', 'edo', 'etf-world']) await expect(page.getByTestId(`ind-${id}`)).toBeVisible()
  await expect(page.getByTestId('ind-risk-edo')).toHaveAttribute('data-value', '1')
  await expect(page.getByTestId('ind-risk-etf-poland')).toHaveAttribute('data-value', '5')
  await expect(page.getByTestId('ind-signal-etf-world')).toHaveText(/KUPNO|SPRZEDAŻ|NEUTRALNIE/)
  await expect(page.getByTestId('plan-item-etf-world').locator('path').first()).toBeVisible()
  await expect(page.getByTestId('flow').locator('path')).toHaveCount(3)
  await expect(page.getByTestId('radar').locator('polygon')).toHaveCount(5)
  await expect(page.getByTestId('plan-entry')).toContainText(/Od razu|Stopniowo/)
  await expect(page.getByTestId('plan-projection').locator('path').first()).toBeVisible()
  await expect(page.getByTestId('plan-prob')).toContainText('%')
  await expect(page.getByTestId('stress-bar')).toBeVisible()
  await expect(page.getByTestId('plan-child')).toContainText('miesięcznie')
  await expect(page.getByTestId('warn-plan.warn.oneEarner')).toBeVisible()
  // checklist: tick an item, it survives a reload together with the plan
  const first = page.locator('[data-testid^="check-box-"]').first()
  await first.check()
  await page.reload()
  await page.getByTestId('nav-advisor').click()
  await expect(page.getByTestId('plan-hero')).toBeVisible()
  await expect(page.locator('[data-testid^="check-box-"]').first()).toBeChecked()
  await expect(page.getByTestId('adv-disclaimer')).toContainText('nie gwarancja zysku')
})

test('planner (Switzerland, CHF): reserve in CHF, pillar 3a, Swiss products, no Polish bonds, amounts in CHF', async ({ page }) => {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-country').selectOption('CH')
  await expect(page.getByTestId('s-currency')).toHaveValue('CHF')
  await fillPlanner(page, { country: 'CH', currency: 'CHF', income: '10000', expenses: '6500', cash: '150000', cashCur: 'CHF', risk: 4, child: '2023-03-15' })
  await expect(page.getByTestId('plan-hero')).toContainText('CHF')
  for (const id of ['reserve', 'chf-bonds', 'pillar3a', 'etf-world', 'etf-swiss', 'gold']) await expect(page.getByTestId(`plan-item-${id}`)).toBeVisible()
  for (const id of ['edo', 'rod', 'coi', 'etf-poland', 'safe-tos']) await expect(page.getByTestId(`plan-item-${id}`)).toHaveCount(0)
  await expect(page.getByTestId('plan-item-reserve')).toContainText('CHF')
  await expect(page.getByTestId('plan-item-pillar3a')).toContainText('do emerytury')
  await expect(page.getByTestId('warn-plan.warn.fx')).toBeVisible()
  await expect(page.getByTestId('check-c-3a')).toBeVisible()
  await expect(page.getByTestId('check-c-broker')).toContainText('szwajcarskim')
})

test('Swiss mode across the app: CHF on the dashboard, Swiss inflation, pillar 3a insight, bonds note, 3a lesson', async ({ page }) => {
  await addDeposit(page)
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('total-value')).toContainText('zł')
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-country').selectOption('CH')
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('total-value')).toContainText('CHF')
  const chf = await page.getByTestId('total-value').textContent()
  await expect(page.getByTestId('stat-cpi')).toContainText('Szwajcarii')
  await expect(page.getByTestId('stat-cpi')).toContainText('SNB')
  await page.getByTestId('nav-insights').click()
  await expect(page.getByTestId('insight-pillar3a')).toBeVisible()
  await expect(page.getByTestId('insight-ike')).toHaveCount(0)
  await page.getByTestId('nav-bonds').click()
  await expect(page.getByTestId('bonds-ch-note')).toBeVisible()
  await page.getByTestId('nav-learn').click()
  await expect(page.getByTestId('lesson-ike')).toContainText('Filar 3a')
  // switching the display currency back to PLN keeps the country
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-currency').selectOption('PLN')
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('total-value')).toContainText('zł')
  expect(chf).not.toEqual(await page.getByTestId('total-value').textContent())
})

test('market: Fear & Greed for Poland and the world, VIX, buy/sell signals with back-test @mobile', async ({ page }) => {
  await page.getByTestId('nav-market').click()
  for (const k of ['pl', 'world']) {
    const g = page.getByTestId(`gauge-${k}`)
    await expect(g).toBeVisible()
    const v = Number(await g.getAttribute('data-value'))
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(100)
    await expect(page.getByTestId(`fg-${k}`)).toContainText(/strach|chciwość|neutralnie/)
  }
  await expect(page.getByTestId('fg-comp-world-vix')).toBeVisible()
  await expect(page.getByTestId('fg-comp-pl-momentum')).toBeVisible()
  await expect(page.getByTestId('vix')).toContainText('VIX')
  const rows = page.getByTestId('signal-table').locator('tbody tr')
  expect(await rows.count()).toBeGreaterThanOrEqual(15)
  await expect(page.getByTestId('sig-WIG20')).toHaveAttribute('data-signal', /buy|sell|neutral/)
  await expect(page.getByTestId('sig-WIG')).toContainText(/KUPNO|SPRZEDAŻ|NEUTRALNIE/)
  // the dashboard shows both gauges too
  await page.getByTestId('nav-dashboard').click()
  await addDeposit(page)
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('dash-gauge-pl')).toBeVisible()
  await expect(page.getByTestId('dash-gauge-world')).toBeVisible()
})

test('planner in English and German', async ({ page }) => {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-lang').selectOption('en')
  await page.getByTestId('nav-advisor').click()
  await expect(page.getByTestId('advisor')).toContainText('Your family')
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-lang').selectOption('de')
  await page.getByTestId('nav-advisor').click()
  await expect(page.getByTestId('advisor')).toContainText('Deine Familie')
})

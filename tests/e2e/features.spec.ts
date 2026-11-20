import { test, expect } from '@playwright/test'
import { addBond, addDeposit, addStock, iso, num } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('dashboard')).toBeVisible()
})

test('several people: own assets each, the family view adds everybody up, deleting a person removes their data', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await expect(page.getByTestId('person-switch').locator('option')).toHaveCount(1) // no family view with one person
  await addDeposit(page)
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('person-new-name').fill('Ewelina')
  await page.getByTestId('person-add').click()
  // the new person is active and starts empty
  await expect(page.getByTestId('person-switch').locator('option:checked')).toHaveText('Ewelina')
  await page.getByTestId('nav-assets').click()
  await expect(page.locator('[data-testid^="asset-"]')).toHaveCount(0)
  await addStock(page, 'SKARBIEC', '100', '3000')
  await expect(page.locator('[data-testid^="asset-"]')).toHaveCount(1)
  // back to the first person: only the deposit
  await page.getByTestId('person-switch').selectOption({ index: 0 })
  await expect(page.locator('[data-testid^="asset-"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="asset-"]')).toContainText('BankX')
  // family: both, each with its owner
  await page.getByTestId('person-switch').selectOption('family')
  await expect(page.locator('[data-testid^="asset-"]')).toHaveCount(2)
  await expect(page.getByTestId('owner-badge')).toHaveCount(2)
  await expect(page.getByTestId('owner-badge').filter({ hasText: 'Ewelina' })).toHaveCount(1)
  await page.getByTestId('nav-dashboard').click()
  const family = await num(page, 'total-value')
  await page.getByTestId('person-switch').selectOption({ label: 'Ewelina' })
  await expect.poll(() => num(page, 'total-value')).toBeLessThan(family)
  const ewelina = await num(page, 'total-value')
  expect(family).toBeGreaterThan(ewelina + 60_000)
  // the choice survives a reload
  await page.reload()
  await expect(page.getByTestId('person-switch').locator('option:checked')).toHaveText('Ewelina')
  // delete Ewelina → her shares are gone, the first person is active again
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('person-remove-Ewelina').click()
  await expect(page.getByTestId('person-Ewelina')).toHaveCount(0)
  await page.getByTestId('nav-assets').click()
  await expect(page.locator('[data-testid^="asset-"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="asset-"]')).toContainText('BankX')
})

test('gold and foreign currency are valued at the NBP prices', async ({ page, request }) => {
  const macro = await (await request.get('./data/macro.json')).json()
  const gold = macro.gold.at(-1).price
  const eur = macro.fx.rates.EUR
  await page.getByTestId('nav-assets').click()
  await page.getByTestId('add-asset').click()
  await page.getByTestId('kind-gold').click()
  await page.getByTestId('f-grams').fill('31,1')
  await page.getByTestId('f-cost').fill('12000')
  await page.getByTestId('f-save').click()
  await page.getByTestId('add-asset').click()
  await page.getByTestId('kind-fx').click()
  await page.getByTestId('f-currency').selectOption('EUR')
  await page.getByTestId('f-amount').fill('1000')
  await page.getByTestId('f-save').click()
  const cards = page.locator('[data-testid^="asset-"]')
  await expect(cards).toHaveCount(2)
  const goldCard = cards.filter({ hasText: 'Złoto' })
  expect(await num(page, (await goldCard.locator('[data-testid^="value-"]').getAttribute('data-testid'))!)).toBeCloseTo(31.1 * gold, 1)
  const fxCard = cards.filter({ hasText: 'EUR' })
  expect(await num(page, (await fxCard.locator('[data-testid^="value-"]').getAttribute('data-testid'))!)).toBeCloseTo(1000 * eur, 1)
})

test('ETFs from the GPW can be added and are priced', async ({ page, request }) => {
  const idx = (await (await request.get('./data/shares/index.json')).json()) as { name: string; type?: string; last: number }[]
  const etf = idx.find((s) => s.type === 'etf')
  test.skip(!etf, 'ETF data not fetched yet')
  await addStock(page, etf!.name, '10', String(Math.round(etf!.last * 10)))
  await expect(page.getByText('Brak kursu')).toHaveCount(0)
  await expect(page.getByTestId('price-chart').locator('path').first()).toBeVisible()
})

test('charts: share price with the purchase price, bond value until maturity, wealth over time', async ({ page }) => {
  await addStock(page, 'SKARBIEC', '100', '3000')
  await addBond(page, '10 000', iso(-30))
  await expect(page.getByTestId('price-chart').locator('path').first()).toBeVisible()
  await expect(page.getByTestId('bond-chart').locator('path').first()).toBeVisible()
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('history-empty')).toBeVisible()
  // two earlier days in the history → the chart is drawn
  await page.evaluate(async () => {
    const pid = localStorage.getItem('kapital-active') || 'p1'
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('kapital')
      q.onsuccess = () => r(q.result)
    })
    const tx = db.transaction('history', 'readwrite')
    tx.objectStore('history').put({ profileId: pid, date: '2026-01-02', total: 9000, netNow: 9000, cost: 9000 })
    tx.objectStore('history').put({ profileId: pid, date: '2026-06-01', total: 11000, netNow: 11000, cost: 10000 })
    await new Promise((r) => (tx.oncomplete = r))
    db.close()
  })
  await page.reload()
  await expect(page.getByTestId('history').locator('path').first()).toBeVisible()
})

test('learn: six animated explanations react to play and to the sliders @mobile', async ({ page }) => {
  await page.getByTestId('nav-learn').click()
  for (const id of ['compound', 'inflation', 'edo', 'ike', 'diversify', 'trend']) await expect(page.getByTestId(`lesson-${id}`)).toBeVisible()
  // compound: play animates from 0 up to 30 years
  await page.getByTestId('play-compound').click()
  await expect.poll(async () => Number(await page.getByTestId('bar-compound').getAttribute('data-value'))).toBeLessThan(30_000)
  await expect.poll(async () => Number(await page.getByTestId('bar-compound').getAttribute('data-value')), { timeout: 8000 }).toBe(Math.round(10_000 * 1.06 ** 30))
  // inflation: more years → smaller coin
  const r1 = Number(await page.getByTestId('coin').getAttribute('r'))
  await page.getByTestId('slider-inflation').fill('30')
  await expect.poll(async () => Number(await page.getByTestId('coin').getAttribute('r'))).toBeLessThan(r1)
  // IKE beats no IKE
  expect(Number(await page.getByTestId('ike-with').getAttribute('data-value'))).toBeGreaterThan(Number(await page.getByTestId('ike-without').getAttribute('data-value')))
  // the trend lesson draws the real WIG
  await expect(page.getByTestId('lesson-trend').locator('path').first()).toBeVisible()
})

test('data from the first version is moved to the first person on update', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(baseURL + 'icons/icon.svg') // same origin, app not started
  await p.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const q = indexedDB.open('kapital', 10)
        q.onupgradeneeded = () => {
          const a = q.result.createObjectStore('assets', { keyPath: 'id' })
          a.createIndex('kind', 'kind')
          q.result.createObjectStore('settings', { keyPath: 'id' })
        }
        q.onsuccess = () => {
          const tx = q.result.transaction(['assets', 'settings'], 'readwrite')
          tx.objectStore('assets').put({ id: 'old1', kind: 'cash', amount: 4321 })
          tx.objectStore('settings').put({ id: 'me', monthlyExpenses: 7777, lang: 'pl' })
          tx.oncomplete = () => (q.result.close(), resolve())
        }
      }),
  )
  await p.goto(baseURL + '#assets')
  await expect(p.getByTestId('value-old1')).toHaveAttribute('data-value', '4321')
  await p.getByTestId('nav-settings').click()
  await expect(p.getByTestId('s-expenses')).toHaveValue('7777')
  await ctx.close()
})

test('backup with several people restores everybody', async ({ page, browser, baseURL }) => {
  await addDeposit(page)
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('person-new-name').fill('Ewelina')
  await page.getByTestId('person-add').click()
  await addStock(page, 'SKARBIEC', '100', '3000')
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-password').fill('rodzinna-kopia-2026')
  const dl = page.waitForEvent('download')
  await page.getByTestId('s-export').click()
  const file = await (await dl).path()
  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await p2.goto(baseURL + '#settings')
  await p2.getByTestId('s-password').fill('rodzinna-kopia-2026')
  await p2.getByTestId('s-import').setInputFiles(file!)
  await expect(p2.getByTestId('s-msg')).toContainText('2')
  await expect(p2.getByTestId('person-switch').locator('option')).toHaveCount(3) // two people + family
  await p2.getByTestId('person-switch').selectOption('family')
  await p2.getByTestId('nav-assets').click()
  await expect(p2.locator('[data-testid^="asset-"]')).toHaveCount(2)
  await ctx.close()
})

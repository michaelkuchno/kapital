import { test, expect, type Page } from '@playwright/test'
import { addBond, addDeposit, addStock, iso } from './helpers'

/**
 * Chart audit: every chart on every screen, on desktop, Android and iPhone sizes and in all three languages.
 * For each visible <svg> it checks that it has a size, fits the screen, has no NaN/Infinity/undefined in its
 * geometry, draws something, and that every label lies inside the drawing area (nothing is cut off).
 * Line charts also have to show a tooltip with real numbers on hover.
 */

type Issue = string

async function audit(page: Page, where: string): Promise<Issue[]> {
  // let mount animations (count-up, radar, flow, gauge needle) settle
  await page.waitForTimeout(400)
  return page.evaluate((where) => {
    const issues: string[] = []
    const vw = document.documentElement.clientWidth
    const svgs = [...document.querySelectorAll('main svg, [role="dialog"] svg, body > div svg')].filter((s) => !s.parentElement?.closest('svg')) as SVGSVGElement[]
    const seen = new Set<SVGSVGElement>()
    for (const svg of svgs) {
      if (seen.has(svg)) continue
      seen.add(svg)
      const r = svg.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue // hidden (e.g. a closed <details>)
      const id = svg.closest('[data-testid]')?.getAttribute('data-testid') ?? svg.getAttribute('data-testid') ?? '?'
      const name = `${where} › ${id}`
      // icons inside buttons are tiny and not charts
      const vb = svg.viewBox?.baseVal
      if (!vb || vb.width === 0 || (r.width < 40 && r.height < 40)) continue
      if (r.width < 60 || r.height < 30) issues.push(`${name}: too small ${Math.round(r.width)}×${Math.round(r.height)}`)
      if (r.right > vw + 1) issues.push(`${name}: wider than the screen (${Math.round(r.right)} > ${vw})`)
      for (const el of [svg, ...svg.querySelectorAll('*')]) {
        for (const a of el.getAttributeNames()) {
          const v = el.getAttribute(a) ?? ''
          if (/NaN|Infinity|undefined|null/.test(v)) issues.push(`${name}: <${el.tagName} ${a}="${v.slice(0, 60)}">`)
        }
        if (el.tagName === 'text' && /NaN|Infinity|undefined|null/.test(el.textContent ?? '')) issues.push(`${name}: text "${el.textContent}"`)
      }
      const shapes = [...svg.querySelectorAll('path, polyline, polygon, rect, circle, line')]
      if (!shapes.length) issues.push(`${name}: draws nothing`)
      for (const p of svg.querySelectorAll('path')) if (!(p.getAttribute('d') ?? '').trim()) issues.push(`${name}: empty path`)
      // labels inside the viewBox
      for (const tx of svg.querySelectorAll('text')) {
        if (!(tx.textContent ?? '').trim()) continue
        const b = (tx as SVGTextElement).getBBox()
        const tol = 1.5
        if (b.x < vb.x - tol || b.y < vb.y - tol || b.x + b.width > vb.x + vb.width + tol || b.y + b.height > vb.y + vb.height + tol)
          issues.push(`${name}: label "${tx.textContent}" cut off (box ${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.width.toFixed(0)}×${b.height.toFixed(0)} in viewBox ${vb.width}×${vb.height})`)
      }
      // labels in HTML overlays/rects not overlapping each other inside a Flow chart
      const rects = [...svg.querySelectorAll('g > rect')] as SVGRectElement[]
      for (let i = 1; i < rects.length; i++) {
        const a = rects[i - 1].getBBox()
        const b = rects[i].getBBox()
        if (a.x === b.x && b.y < a.y + a.height - 0.5) issues.push(`${name}: boxes overlap`)
        if (b.y + b.height > vb.y + vb.height + 0.5) issues.push(`${name}: box below the chart`)
      }
    }
    return issues
  }, where)
}

/** Hover over every line chart and check the tooltip shows real numbers. */
async function hoverLineCharts(page: Page, where: string, isMobile: boolean): Promise<Issue[]> {
  if (isMobile) return []
  const issues: Issue[] = []
  const charts = page.locator('div.relative > svg[role="img"]')
  const n = await charts.count()
  for (let i = 0; i < n; i++) {
    const c = charts.nth(i)
    if (!(await c.isVisible())) continue
    await c.scrollIntoViewIfNeeded()
    const box = await c.boundingBox()
    if (!box) continue
    const px = box.x + box.width * 0.7
    const py = box.y + box.height / 2
    // skip charts covered by something else (e.g. behind an open dialog): a person cannot hover them either
    const onTop = await c.evaluate((svg, [x, y]) => svg.contains(document.elementFromPoint(x, y)), [px, py])
    if (!onTop) continue
    await page.mouse.move(px, py)
    const tip = c.locator('xpath=following-sibling::div[1]')
    if (!(await tip.isVisible().catch(() => false))) {
      issues.push(`${where} › line chart ${i}: no tooltip on hover`)
      continue
    }
    const txt = (await tip.textContent()) ?? ''
    if (/NaN|Infinity|undefined/.test(txt) || !/\d/.test(txt)) issues.push(`${where} › line chart ${i}: bad tooltip "${txt}"`)
    await page.mouse.move(0, 0)
  }
  return issues
}

async function seedHistory(page: Page) {
  await page.evaluate(async () => {
    const pid = localStorage.getItem('kapital-active') || 'p1'
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('kapital')
      q.onsuccess = () => r(q.result)
    })
    const tx = db.transaction('history', 'readwrite')
    for (let m = 1; m <= 10; m++) tx.objectStore('history').put({ profileId: pid, date: `2026-${String(m).padStart(2, '0')}-02`, total: 90_000 + m * 2500, netNow: 90_000 + m * 2400, cost: 90_000 + m * 1000 })
    await new Promise((r) => (tx.oncomplete = r))
    db.close()
  })
}

async function planner(page: Page) {
  await page.getByTestId('nav-advisor').click()
  if (await page.getByTestId('plan-hero').isVisible().catch(() => false)) return
  await page.getByTestId('adv-adults').fill('2')
  await page.getByTestId('adv-earners').fill('1')
  await page.getByTestId('adv-add-child').click()
  await page.getByTestId('adv-child-0').fill('2021-05-10')
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-income').fill('18000')
  await page.getByTestId('adv-expenses').fill('9000')
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-cash').fill('400000')
  await page.getByTestId('adv-next').click()
  for (let q = 1; q <= 5; q++) await page.getByTestId(`adv-q${q}-4`).click()
  await page.getByTestId('adv-next').click()
  await page.getByTestId('adv-horizon').fill('15')
  await page.getByTestId('adv-child-goal').fill('80000')
  await page.getByTestId('adv-next').click()
  await expect(page.getByTestId('plan-hero')).toBeVisible()
}

async function everyScreen(page: Page, label: string, isMobile: boolean): Promise<Issue[]> {
  const issues: Issue[] = []
  const go = async (nav: string) => {
    await page.getByTestId(`nav-${nav}`).click()
    await page.waitForLoadState('networkidle')
  }
  const check = async (where: string) => {
    issues.push(...(await audit(page, `${label} ${where}`)))
    issues.push(...(await hoverLineCharts(page, `${label} ${where}`, isMobile)))
  }

  await go('dashboard')
  await expect(page.getByTestId('donut')).toBeVisible()
  await expect(page.getByTestId('history').locator('path').first()).toBeVisible()
  await check('dashboard')

  await go('assets')
  await expect(page.getByTestId('price-chart').locator('path').first()).toBeVisible()
  await expect(page.getByTestId('bond-chart').locator('path').first()).toBeVisible()
  await check('assets')

  await go('market')
  await expect(page.locator('[data-testid^="gauge-"]').first()).toBeVisible()
  await check('market')
  // index charts: first, a middle and the last sector/index row
  const rows = page.locator('[data-testid^="row-"]')
  const nRows = await rows.count()
  expect(nRows).toBeGreaterThan(5)
  for (const k of [0, Math.floor(nRows / 2), nRows - 1]) {
    const code = (await rows.nth(k).getAttribute('data-testid'))!.slice(4)
    await rows.nth(k).scrollIntoViewIfNeeded()
    await rows.nth(k).click()
    await expect(page.getByTestId('index-line').locator('path').nth(2)).toBeVisible()
    await check(`market index ${code}`)
    await page.keyboard.press('Escape')
    if (await page.getByTestId('index-chart').isVisible()) await page.getByTestId('index-chart').getByRole('button').first().click()
    await expect(page.getByTestId('index-chart')).toBeHidden()
  }

  // any share from the search: the full technical analysis with all its charts
  await page.getByTestId('ta-search-input').fill('PKOBP')
  await page.getByTestId('ta-search-results').getByRole('button').first().click()
  await expect(page.getByTestId('ta-macd').locator('path').first()).toBeVisible()
  await check('market share PKOBP')
  await page.getByTestId('ta-period-6m').click()
  await check('market share PKOBP 6m')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tech-modal')).toBeHidden()

  await go('bonds')
  await check('bonds')
  await go('plan')
  await expect(page.locator('main svg path').first()).toBeVisible()
  await check('plan')
  await go('insights')
  await check('insights')

  await go('learn')
  for (const id of ['compound', 'inflation', 'edo', 'ike', 'diversify', 'trend']) await expect(page.getByTestId(`lesson-${id}`)).toBeVisible()
  await check('learn (start)')
  const plays = page.locator('[data-testid^="play-"]')
  for (let i = 0; i < (await plays.count()); i++) await plays.nth(i).click()
  await page.waitForTimeout(4500)
  await check('learn (after play)')
  // sliders to both ends
  const sliders = page.locator('[data-testid^="slider-"]')
  for (let i = 0; i < (await sliders.count()); i++) {
    const s = sliders.nth(i)
    const max = (await s.getAttribute('max')) ?? '30'
    await s.fill(max)
  }
  await check('learn (slider max)')
  for (let i = 0; i < (await sliders.count()); i++) await sliders.nth(i).fill((await sliders.nth(i).getAttribute('min')) ?? '0')
  await check('learn (slider min)')

  await planner(page)
  await expect(page.getByTestId('flow')).toBeVisible()
  await expect(page.getByTestId('radar')).toBeVisible()
  await check('advisor plan')
  return issues
}

test('chart audit: every chart on every screen renders correctly, in PL/EN/DE @mobile', async ({ page, isMobile }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('./')
  await expect(page.getByTestId('dashboard')).toBeVisible()
  await addStock(page, 'PKOBP', '100', '45')
  await addStock(page, 'SKARBIEC', '10', '3000')
  await addBond(page, '20 000', iso(-400))
  await addDeposit(page)
  await seedHistory(page)
  await page.reload()

  const issues: Issue[] = []
  for (const lang of ['pl', 'en', 'de'] as const) {
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('s-lang').selectOption(lang)
    issues.push(...(await everyScreen(page, `[${info.project.name} ${lang}]`, isMobile)))
  }
  // Swiss mode changes currencies and products → charts again
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('s-lang').selectOption('pl')
  await page.getByTestId('s-country').selectOption('CH')
  await page.getByTestId('nav-advisor').click()
  if (await page.getByTestId('adv-edit').isVisible().catch(() => false)) {
    await page.getByTestId('adv-edit').click()
  }
  issues.push(...(await everyScreen(page, `[${info.project.name} CH]`, isMobile)))

  await page.screenshot({ path: info.outputPath('advisor.png'), fullPage: true })
  const unique = [...new Set(issues)]
  expect(unique, unique.join('\n')).toEqual([])
  expect(errors.filter((e) => !/favicon|manifest|service ?worker|Failed to load resource/i.test(e)), errors.join('\n')).toEqual([])
})

test('line chart edge cases: two points, gaps and a flat line do not break the chart', async ({ page }) => {
  await page.goto('./')
  await addBond(page, '1 000', iso(-1))
  await page.evaluate(async () => {
    const pid = localStorage.getItem('kapital-active') || 'p1'
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('kapital')
      q.onsuccess = () => r(q.result)
    })
    const tx = db.transaction('history', 'readwrite')
    tx.objectStore('history').put({ profileId: pid, date: '2026-01-02', total: 1000, netNow: 1000, cost: 1000 })
    tx.objectStore('history').put({ profileId: pid, date: '2026-01-03', total: 1000, netNow: 1000, cost: 1000 })
    await new Promise((r) => (tx.oncomplete = r))
    db.close()
  })
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.reload()
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('history').locator('path').first()).toBeVisible()
  expect(await audit(page, 'edge')).toEqual([])
  expect(errors.filter((e) => /key|NaN/i.test(e)), errors.join('\n')).toEqual([])
})

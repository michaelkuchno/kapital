/** Render public/icons/icon.svg to the PNG sizes the PWA manifest needs (uses the Playwright browser). */
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const svg = readFileSync('public/icons/icon.svg', 'utf8')
const b = await chromium.launch()
for (const size of [192, 512]) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await p.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true })
}
await b.close()

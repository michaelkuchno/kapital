/**
 * Network access to the free, official sources (no API keys). Used by scripts/fetch-data.ts (GitHub Actions, daily)
 * and by the Docker server. Polite: one request at a time with a pause; GUS allows 100 requests / 15 min anonymously.
 */
import { BOND_PAGES, GUS, gusPeriod, gusSection, isXls, parseBondPage, parseGpwXls, parseGusCpi, parseNbpArchive, parseNbpFx, parseNbpGold, parseNbpRates, type GpwRow, type GusRow } from './parse'
import type { BondCode } from '../core/bonds'
import type { CpiPoint } from '../core/inflation'

const UA = 'kapital-data/1.0 (+https://github.com/michaelkuchno/kapital)'
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string, accept = '*/*', tries = 3): Promise<Response> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      // the GPW firewall rejects browser-like user agents; a plain, honest one works
      const r = await fetch(url, { headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(30_000) })
      if (r.status === 429 || r.status >= 500) throw new Error(`${r.status} ${url}`)
      return r
    } catch (e) {
      last = e
      await sleep(2000 * (i + 1))
    }
  }
  throw last
}

const GPW_TYPE = { shares: 10, indices: 1, etf: 241 } as const
/** GPW day file: shares (type 10), indices (type 1) or ETFs (type 241); [] on non-trading days. date = YYYY-MM-DD */
export async function fetchGpwDay(kind: keyof typeof GPW_TYPE, date: string): Promise<GpwRow[]> {
  const [y, m, d] = date.split('-')
  const r = await get(`https://www.gpw.pl/archiwum-notowan?fetch=1&type=${GPW_TYPE[kind]}&instrument=&date=${d}-${m}-${y}`)
  const buf = new Uint8Array(await r.arrayBuffer())
  return isXls(buf) ? parseGpwXls(buf) : []
}

/** CPI y/y for the given months (YYYY-MM); unpublished months are skipped. */
export async function fetchCpi(months: readonly string[]): Promise<CpiPoint[]> {
  const out: CpiPoint[] = []
  const base = 'https://api-dbw.stat.gov.pl/api/1.1.0/variable/variable-data-section'
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number)
    const section = gusSection(y)
    const url = (page: number) => `${base}?id-zmienna=${GUS.variable}&id-przekroj=${section}&id-rok=${y}&id-okres=${gusPeriod(m)}&ile-na-stronie=5000&numer-strony=${page}&lang=pl`
    const r0 = await get(url(0), 'application/json')
    if (r0.status === 404) continue
    const p0 = (await r0.json()) as { 'page-count': number; data: GusRow[] }
    let pts = parseGusCpi(p0)
    // since 2026 the total is on the last page
    if (!pts.length && p0['page-count'] > 0) {
      await sleep(400)
      const rl = await get(url(p0['page-count']), 'application/json')
      pts = parseGusCpi((await rl.json()) as { data: GusRow[] })
    }
    out.push(...pts.filter((p) => p.month === ym))
    await sleep(400)
  }
  return out
}

export async function fetchNbpRates() {
  const cur = parseNbpRates(await (await get('https://static.nbp.pl/dane/stopy/stopy_procentowe.xml')).text())
  let history: { from: string; rate: number }[] = []
  try {
    history = parseNbpArchive(await (await get('https://static.nbp.pl/dane/stopy/stopy_procentowe_archiwum.xml')).text())
  } catch {
    /* archive optional */
  }
  if (!history.some((h) => h.from === cur.from)) history.push({ from: cur.from, rate: cur.ref })
  return { ...cur, history }
}

export async function fetchFx() {
  return parseNbpFx(await (await get('https://api.nbp.pl/api/exchangerates/tables/a/?format=json', 'application/json')).json())
}
export async function fetchGold() {
  return parseNbpGold(await (await get('https://api.nbp.pl/api/cenyzlota/last/60?format=json', 'application/json')).json())
}

export async function fetchOffer(): Promise<ReturnType<typeof parseBondPage>[]> {
  const out: ReturnType<typeof parseBondPage>[] = []
  for (const [code, slug] of Object.entries(BOND_PAGES) as [BondCode, string][]) {
    const html = await (await get(`https://www.obligacjeskarbowe.pl/oferta-obligacji/${slug}/`, 'text/html')).text()
    out.push(parseBondPage(code, html))
    await sleep(300)
  }
  return out
}

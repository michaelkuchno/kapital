/**
 * Daily data update (GitHub Actions cron and the Docker server): official GPW day files, GUS CPI, NBP rates/FX/gold,
 * the current treasury bond offer. Writes static files into an output folder (default public/data):
 *   meta.json, macro.json, offer.json, summary.json, indices/<NAME>.csv, shares/<ISIN>.csv, shares/index.json
 * Usage: tsx scripts/fetch-data.ts [--out public/data] [--backfill 560] [--skip-shares]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fetchCpi, fetchFx, fetchGold, fetchGpwDay, fetchNbpRates, fetchOffer, sleep } from '../src/data/fetch'
import { INDICES } from '../src/data/parse'
import { fileKey, fromCsv, groupRows, mergeBars, missingDays, toCsv, type StoredBar } from '../src/data/store'
import { summarizeIndices } from '../src/data/summaries'
import { shiftMonth } from '../src/core/dates'
import type { CpiPoint } from '../src/core/inflation'

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const OUT = arg('out', 'public/data')
const BACKFILL = Number(arg('backfill', '560'))
const SKIP_SHARES = process.argv.includes('--skip-shares')
const today = new Date().toISOString().slice(0, 10)
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

function readJson<T>(f: string, d: T): T {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T
  } catch {
    return d
  }
}
function readSeries(dir: string, key: string): StoredBar[] {
  const f = join(dir, `${fileKey(key)}.csv`)
  return existsSync(f) ? fromCsv(readFileSync(f, 'utf8')) : []
}

async function main() {
  for (const d of ['', 'indices', 'shares']) mkdirSync(join(OUT, d), { recursive: true })
  const meta = readJson<{ lastTradingDay?: string; updatedAt?: string; errors?: string[] }>(join(OUT, 'meta.json'), {})
  const errors: string[] = []

  // 1. GPW: missing trading days since the last stored day
  const days = missingDays(meta.lastTradingDay ?? null, today, BACKFILL)
  log(`GPW: ${days.length} weekday(s) to fetch`)
  const idx = new Map<string, StoredBar[]>()
  const shares = new Map<string, { name: string; bars: StoredBar[] }>()
  let lastDay = meta.lastTradingDay
  for (const day of days) {
    try {
      const ir = await fetchGpwDay('indices', day)
      if (!ir.length) continue // weekend / holiday / not yet published
      for (const [name, bar] of groupRows(ir, 'name')) if ((INDICES as readonly string[]).includes(name)) idx.set(name, [...(idx.get(name) ?? []), bar])
      if (!SKIP_SHARES) {
        await sleep(250)
        const sr = await fetchGpwDay('shares', day)
        for (const r of sr) {
          if (!r.isin) continue
          const e = shares.get(r.isin) ?? { name: r.name, bars: [] }
          e.name = r.name
          e.bars.push({ date: r.date, close: r.close, volume: r.volume })
          shares.set(r.isin, e)
        }
      }
      lastDay = !lastDay || day > lastDay ? day : lastDay
      await sleep(250)
    } catch (e) {
      errors.push(`gpw ${day}: ${(e as Error).message}`)
    }
  }
  const allIdx = new Map<string, StoredBar[]>()
  for (const name of INDICES) {
    const merged = mergeBars(readSeries(join(OUT, 'indices'), name), idx.get(name) ?? [])
    if (merged.length) writeFileSync(join(OUT, 'indices', `${fileKey(name)}.csv`), toCsv(merged.map(({ date, close }) => ({ date, close }))))
    allIdx.set(name, merged)
  }
  const shareIndex = readJson<{ isin: string; name: string; last: number; date: string }[]>(join(OUT, 'shares', 'index.json'), [])
  const byIsin = new Map(shareIndex.map((s) => [s.isin, s]))
  for (const [isin, { name, bars }] of shares) {
    const merged = mergeBars(readSeries(join(OUT, 'shares'), isin), bars)
    writeFileSync(join(OUT, 'shares', `${fileKey(isin)}.csv`), toCsv(merged))
    const l = merged[merged.length - 1]
    byIsin.set(isin, { isin, name, last: l.close, date: l.date })
  }
  if (shares.size) writeFileSync(join(OUT, 'shares', 'index.json'), JSON.stringify([...byIsin.values()].sort((a, b) => a.name.localeCompare(b.name))))
  log(`GPW: indices ${allIdx.size}, shares updated ${shares.size}`)

  // 2. trend summary
  const summary = summarizeIndices(allIdx)
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ date: lastDay, ...summary }))

  // 3. macro: CPI (36 months, re-check the last 3 – GUS may revise), NBP, FX, gold
  const macro = readJson<{ cpi?: CpiPoint[] }>(join(OUT, 'macro.json'), {})
  const have = new Map((macro.cpi ?? []).map((p) => [p.month, p]))
  const months: string[] = []
  const cur = today.slice(0, 7)
  for (let k = 1; k <= 48; k++) {
    const m = shiftMonth(cur, -k)
    if (!have.has(m) || k <= 3) months.push(m)
  }
  let cpi = [...have.values()]
  try {
    const fresh = await fetchCpi(months)
    for (const p of fresh) have.set(p.month, p)
    cpi = [...have.values()].sort((a, b) => a.month.localeCompare(b.month))
    log(`CPI: ${cpi.length} months, latest ${cpi.at(-1)?.month} ${cpi.at(-1)?.yoy}%`)
  } catch (e) {
    errors.push(`cpi: ${(e as Error).message}`)
  }
  log('NBP, FX, gold …')
  const nbp = await fetchNbpRates().catch((e) => (errors.push(`nbp: ${e.message}`), readJson(join(OUT, 'macro.json'), {} as Record<string, unknown>).nbp))
  const fx = await fetchFx().catch((e) => (errors.push(`fx: ${e.message}`), undefined))
  const gold = await fetchGold().catch((e) => (errors.push(`gold: ${e.message}`), undefined))
  writeFileSync(join(OUT, 'macro.json'), JSON.stringify({ cpi, nbp, fx, gold }))

  // 4. bond offer
  log('bond offer …')
  try {
    const offer = await fetchOffer()
    writeFileSync(join(OUT, 'offer.json'), JSON.stringify({ month: cur, items: offer }))
    log(`offer: ${offer.map((o) => `${o.series} ${o.firstRate}%/${o.margin}`).join(', ')}`)
  } catch (e) {
    errors.push(`offer: ${(e as Error).message}`)
  }

  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ updatedAt: new Date().toISOString(), lastTradingDay: lastDay, errors, files: readdirSync(join(OUT, 'indices')).length }, null, 1))
  if (errors.length) log('errors:', errors)
  // fail the job only when nothing at all could be updated
  if (errors.length && !lastDay) process.exit(1)
}

void main()

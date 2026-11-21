/**
 * Daily data update (GitHub Actions cron and the Docker server): official GPW day files, GUS CPI, NBP rates/FX/gold,
 * the current treasury bond offer. Writes static files into an output folder (default public/data):
 *   meta.json, macro.json, offer.json, summary.json, indices/<NAME>.csv, shares/<ISIN>.csv, shares/index.json
 * Usage: tsx scripts/fetch-data.ts [--out public/data] [--backfill 560] [--skip-shares]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fetchCpi, fetchSnb, fetchFred, fetchFx, fetchGold, fetchGpwDay, fetchKnf, fetchNbpRates, fetchGoldRange, fetchOffer, fetchPwpa, fetchPwpaRatings, sleep } from '../src/data/fetch'
import { FRED, SNB } from '../src/data/parse'
import { analyzeMarket } from '../src/data/analysis'
import { INDICES } from '../src/data/parse'
import { fileKey, fromCsv, groupRows, isFresh, mergeBars, mergeDated, missingDays, toCsv, type StoredBar } from '../src/data/store'
import { summarizeIndices } from '../src/data/summaries'
import { shiftMonth } from '../src/core/dates'
import type { CpiPoint } from '../src/core/inflation'
import type { BrokerRating, PwpaReport } from '../src/data/parse'

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const OUT = arg('out', 'public/data')
const BACKFILL = Number(arg('backfill', '560'))
/** years of index history (indices only – one small file per day) */
const INDEX_YEARS = Number(arg('index-years', '5'))
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
  const shares = new Map<string, { name: string; type: 'share' | 'etf'; bars: StoredBar[] }>()
  const addRows = (rows: Awaited<ReturnType<typeof fetchGpwDay>>, type: 'share' | 'etf') => {
    for (const r of rows) {
      if (!r.isin) continue
      const e = shares.get(r.isin) ?? { name: r.name, type, bars: [] }
      e.name = r.name
      e.bars.push({ date: r.date, close: r.close, volume: r.volume })
      shares.set(r.isin, e)
    }
  }
  let lastDay = meta.lastTradingDay
  for (const day of days) {
    try {
      const ir = await fetchGpwDay('indices', day)
      if (!ir.length) continue // weekend / holiday / not yet published
      for (const [name, bar] of groupRows(ir, 'name')) if ((INDICES as readonly string[]).includes(name)) idx.set(name, [...(idx.get(name) ?? []), bar])
      if (!SKIP_SHARES) {
        await sleep(250)
        addRows(await fetchGpwDay('shares', day), 'share')
        await sleep(250)
        addRows(await fetchGpwDay('etf', day), 'etf')
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
  const shareIndex = readJson<{ isin: string; name: string; last: number; date: string; type?: 'share' | 'etf' }[]>(join(OUT, 'shares', 'index.json'), [])
  // ETFs were added later: backfill their history once
  if (!SKIP_SHARES && !shareIndex.some((s) => s.type === 'etf')) {
    const etfDays = missingDays(null, today, BACKFILL)
    log(`ETF backfill: ${etfDays.length} weekday(s)`)
    for (const day of etfDays) {
      try {
        addRows(await fetchGpwDay('etf', day), 'etf')
      } catch (e) {
        errors.push(`etf ${day}: ${(e as Error).message}`)
      }
      await sleep(250)
    }
  }
  const byIsin = new Map(shareIndex.map((s) => [s.isin, s]))
  for (const [isin, { name, type, bars }] of shares) {
    const merged = mergeBars(readSeries(join(OUT, 'shares'), isin), bars)
    writeFileSync(join(OUT, 'shares', `${fileKey(isin)}.csv`), toCsv(merged))
    const l = merged[merged.length - 1]
    byIsin.set(isin, { isin, name, last: l.close, date: l.date, type })
  }
  if (shares.size) writeFileSync(join(OUT, 'shares', 'index.json'), JSON.stringify([...byIsin.values()].sort((a, b) => a.name.localeCompare(b.name))))
  log(`GPW: indices ${allIdx.size}, shares updated ${shares.size}`)
  // save the progress right away: an interrupted run (restart, network) does not have to fetch the quotes again
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ ...meta, updatedAt: new Date().toISOString(), lastTradingDay: lastDay, errors }, null, 1))

  // 1b. longer index history (once): indices only, back to INDEX_YEARS years
  const earliest = allIdx.get('WIG')?.[0]?.date
  const target = new Date(Date.now() - INDEX_YEARS * 365.25 * 86_400_000).toISOString().slice(0, 10)
  // an index added later (e.g. TBSP) has no history yet → fetch the whole period for all indices
  const wigLen = allIdx.get('WIG')?.length ?? 0
  const incomplete = INDICES.some((n) => (allIdx.get(n)?.length ?? 0) < wigLen - 10)
  if (earliest && (earliest > target || incomplete) && !process.argv.includes('--skip-index-history')) {
    const until = incomplete ? (lastDay ?? today) : new Date(Date.parse(earliest) - 86_400_000).toISOString().slice(0, 10)
    const back = missingDays(null, until, Math.round((Date.parse(until) - Date.parse(target)) / 86_400_000) + 1)
    log(`index history: ${back.length} weekday(s) back to ${target}`)
    const extra = new Map<string, StoredBar[]>()
    for (const day of back) {
      try {
        for (const [name, bar] of groupRows(await fetchGpwDay('indices', day), 'name')) if ((INDICES as readonly string[]).includes(name)) extra.set(name, [...(extra.get(name) ?? []), bar])
      } catch (e) {
        errors.push(`index history ${day}: ${(e as Error).message}`)
      }
      await sleep(200)
    }
    for (const name of INDICES) {
      const merged = mergeBars(allIdx.get(name) ?? [], extra.get(name) ?? [])
      if (merged.length) writeFileSync(join(OUT, 'indices', `${fileKey(name)}.csv`), toCsv(merged.map(({ date, close }) => ({ date, close }))))
      allIdx.set(name, merged)
    }
  }

  // 2. trend summary, buy/sell signals, Fear & Greed (Poland from GPW data, world from FRED)
  const summary = summarizeIndices(allIdx)
  const from = new Date(Date.now() - 3 * 365.25 * 86_400_000).toISOString().slice(0, 10)
  const fred = async (id: string) => fetchFred(id, from).catch((e) => (errors.push(`fred ${id}: ${e.message}`), []))
  log('FRED (VIX, S&P 500, high-yield spread) …')
  const [vix, sp500, hy] = [await fred(FRED.vix), await fred(FRED.sp500), await fred(FRED.hy)]
  const shareBars = existsSync(join(OUT, 'shares'))
    ? readdirSync(join(OUT, 'shares'))
        .filter((f) => f.endsWith('.csv'))
        .map((f) => fromCsv(readFileSync(join(OUT, 'shares', f), 'utf8')).map(({ date, close }) => ({ date, close })))
    : []
  const analysis = analyzeMarket({ indices: allIdx, shares: shareBars, vix, sp500, hySpread: hy })
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ date: lastDay, ...summary, ...analysis }))
  writeFileSync(join(OUT, 'world.json'), JSON.stringify({ vix: vix.slice(-520), sp500: sp500.slice(-520), hy: hy.slice(-520) }))
  log(`sentiment PL ${analysis.sentiment.pl?.score.toFixed(0)} (${analysis.sentiment.pl?.mood}), world ${analysis.sentiment.world?.score.toFixed(0)} (${analysis.sentiment.world?.mood}); signals ${analysis.signals.length}`)

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
  const prevMacro = readJson<{ fx?: { date: string }; gold?: { date: string; price: number }[] }>(join(OUT, 'macro.json'), {})
  // the NBP API once answered with data from 2023: stale answers are rejected and the previous values kept
  let fx = await fetchFx().catch((e) => (errors.push(`fx: ${e.message}`), undefined))
  if (fx && !isFresh(fx.date, today)) {
    errors.push(`fx: stale answer ${fx.date}`)
    fx = prevMacro.fx as typeof fx
  }
  const goldNow = await fetchGold().catch((e) => (errors.push(`gold: ${e.message}`), []))
  if (goldNow.length && !isFresh(goldNow.at(-1)!.date, today)) errors.push(`gold: stale answer ${goldNow.at(-1)!.date}`)
  const goldSince = new Date(Date.now() - 3 * 365.25 * 86_400_000).toISOString().slice(0, 10)
  let gold = mergeDated((prevMacro.gold ?? []).filter((p) => p.date >= goldSince), goldNow.filter((p) => isFresh(p.date, today, 120)), goldSince)
  // three years of gold history (once), in 90-day steps, for the technical analysis of gold
  if (!gold.length || gold[0].date > new Date(Date.parse(goldSince) + 30 * 86_400_000).toISOString().slice(0, 10)) {
    const extra: { date: string; price: number }[] = []
    for (let d = Date.parse(goldSince); d < Date.now(); d += 90 * 86_400_000) {
      const a = new Date(d).toISOString().slice(0, 10)
      const b = new Date(Math.min(Date.now(), d + 89 * 86_400_000)).toISOString().slice(0, 10)
      extra.push(...(await fetchGoldRange(a, b).catch((e) => (errors.push(`gold ${a}: ${e.message}`), []))))
      await sleep(300)
    }
    gold = mergeDated(extra, gold, goldSince)
  }
  // Switzerland (SNB): CPI y/y, policy rate, 10-year Confederation bond yield
  log('SNB …')
  const snb = async (cube: string, key: string) => fetchSnb(cube, key).catch((e) => (errors.push(`snb ${cube}: ${e.message}`), []))
  const chCpi = (await snb(...SNB.cpi)).slice(-48)
  const chPolicy = (await snb(...SNB.policy)).at(-1)
  const chY10 = (await snb(...SNB.y10)).at(-1)
  const ch = chCpi.length ? { cpi: chCpi.map((p) => ({ month: p.date, yoy: Math.round(p.value * 100) / 100 })), policy: chPolicy, y10: chY10 } : undefined
  writeFileSync(join(OUT, 'macro.json'), JSON.stringify({ cpi, nbp, fx, gold, ch }))

  // 4. bond offer
  log('bond offer …')
  try {
    const offer = await fetchOffer()
    writeFileSync(join(OUT, 'offer.json'), JSON.stringify({ month: cur, items: offer }))
    log(`offer: ${offer.map((o) => `${o.series} ${o.firstRate}%/${o.margin}`).join(', ')}`)
  } catch (e) {
    errors.push(`offer: ${(e as Error).message}`)
  }

  // 5. institutions: GPW analytical coverage programme (report list) and the KNF public warning list
  log('GPWPA, KNF …')
  try {
    const pwpa = await fetchPwpa()
    const before = readJson<{ reports?: (PwpaReport & { rating?: BrokerRating; read?: boolean })[] }>(join(OUT, 'pwpa.json'), {})
    const known = new Map((before.reports ?? []).filter((r) => r.read).map((r) => [r.pdf, { rating: r.rating }]))
    const ratings = await fetchPwpaRatings(pwpa, known)
    const reports = pwpa.map((r) => (ratings.has(r.pdf) ? { ...r, ...ratings.get(r.pdf), read: true } : r))
    writeFileSync(join(OUT, 'pwpa.json'), JSON.stringify({ updatedAt: today, reports }))
    log(`GPWPA: ${pwpa.length} reports, newest ${pwpa[0]?.date}`)
  } catch (e) {
    errors.push(`gpwpa: ${(e as Error).message}`)
  }
  try {
    const knf = await fetchKnf()
    writeFileSync(join(OUT, 'knf.json'), JSON.stringify({ updatedAt: today, warnings: knf }))
    log(`KNF: ${knf.length} warnings`)
  } catch (e) {
    errors.push(`knf: ${(e as Error).message}`)
  }

  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ updatedAt: new Date().toISOString(), lastTradingDay: lastDay, errors, files: readdirSync(join(OUT, 'indices')).length }, null, 1))
  if (errors.length) log('errors:', errors)
  // fail the job only when nothing at all could be updated
  if (errors.length && !lastDay) process.exit(1)
}

void main()

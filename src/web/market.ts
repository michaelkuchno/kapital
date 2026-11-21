import { fromCsv } from '@data/store'
import type { Bar } from '@core/stats'
import type { CpiPoint } from '@core/inflation'
import type { OfferItem } from '@core/insights'
import type { IndexSummary } from '@data/summaries'
import type { RefRate } from '@core/bonds'

/** Market data published daily (GitHub Pages: ./data/…, Docker server: /data/… – the same paths). */
export interface MarketData {
  meta: { updatedAt?: string; lastTradingDay?: string; errors?: string[] }
  cpi: CpiPoint[]
  ref?: { ref: number; from: string; history: RefRate[] }
  fx?: { date: string; rates: Record<string, number> }
  gold?: { date: string; price: number }[]
  offer: (OfferItem & { label?: string; sale?: string })[]
  offerMonth?: string
  summary: { date?: string; indices: IndexSummary[]; sectors: IndexSummary[] }
  shares: { isin: string; name: string; last: number; date: string; type?: 'share' | 'etf' }[]
  /** Switzerland (SNB): latest CPI y/y, its month, policy rate, 10-year Confederation yield */
  ch?: { cpi: number; cpiMonth: string; policy?: number; y10?: number; y10Date?: string }
  analysis?: import('@data/analysis').MarketAnalysis
  world?: { vix: { date: string; value: number }[]; sp500: { date: string; value: number }[]; hy: { date: string; value: number }[] }
}

const base = () => `${import.meta.env.BASE_URL}data/`

async function json<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(base() + path, { cache: 'no-cache' })
    return r.ok ? ((await r.json()) as T) : fallback
  } catch {
    return fallback
  }
}

export async function loadMarket(): Promise<MarketData> {
  const [meta, macro, offer, summary, shares] = await Promise.all([
    json<MarketData['meta']>('meta.json', {}),
    json<{ cpi?: CpiPoint[]; nbp?: { ref: number; from: string; history?: RefRate[] }; fx?: MarketData['fx']; gold?: MarketData['gold']; ch?: { cpi: CpiPoint[]; policy?: { date: string; value: number }; y10?: { date: string; value: number } } }>('macro.json', {}),
    json<{ month?: string; items?: MarketData['offer'] }>('offer.json', {}),
    json<MarketData['summary'] & Partial<import('@data/analysis').MarketAnalysis>>('summary.json', { indices: [], sectors: [] }),
    json<MarketData['shares']>('shares/index.json', []),
  ])
  const world = await json<MarketData['world']>('world.json', undefined)
  const chLast = macro.ch?.cpi.at(-1)
  return {
    meta,
    cpi: macro.cpi ?? [],
    ref: macro.nbp ? { ref: macro.nbp.ref, from: macro.nbp.from, history: macro.nbp.history ?? [{ from: macro.nbp.from, rate: macro.nbp.ref }] } : undefined,
    fx: macro.fx,
    gold: macro.gold,
    offer: offer.items ?? [],
    offerMonth: offer.month,
    summary: { indices: summary.indices ?? [], sectors: summary.sectors ?? [], date: summary.date },
    shares,
    ch: chLast ? { cpi: chLast.yoy, cpiMonth: chLast.month, policy: macro.ch?.policy?.value, y10: macro.ch?.y10?.value, y10Date: macro.ch?.y10?.date } : undefined,
    analysis: { signals: summary.signals ?? [], sentiment: summary.sentiment ?? {}, world: summary.world },
    world,
  }
}

const cache = new Map<string, Promise<Bar[]>>()
/** Daily closes of an index ("indices/WIG20") or a share ("shares/PLSKRBH00014"). */
export function loadSeries(path: string): Promise<Bar[]> {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(`${base()}${path.replace(/[^A-Za-z0-9_/-]/g, '_')}.csv`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((t) => fromCsv(t).map(({ date, close }) => ({ date, close })))
        .catch(() => []),
    )
  return cache.get(path)!
}

/** Is a home server (Docker) available? It offers encrypted sync of the personal data. */
export async function serverAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/health`, { cache: 'no-store' })
    return r.ok && (await r.json()).ok === true
  } catch {
    return false
  }
}

export interface Institutions {
  pwpa: { updatedAt?: string; reports: (import('@data/parse').PwpaReport & { rating?: import('@data/parse').BrokerRating; read?: boolean })[] }
  knf: { updatedAt?: string; warnings: import('@data/parse').KnfWarning[] }
}
let inst: Promise<Institutions> | null = null
/** GPW analytical reports and the KNF warning list (loaded once, only when a screen needs them). */
export function loadInstitutions(): Promise<Institutions> {
  if (!inst)
    inst = Promise.all([json<Institutions['pwpa']>('pwpa.json', { reports: [] }), json<Institutions['knf']>('knf.json', { warnings: [] })]).then(([pwpa, knf]) => ({ pwpa: { ...pwpa, reports: pwpa.reports ?? [] }, knf: { ...knf, warnings: knf.warnings ?? [] } }))
  return inst
}

/** Members of the Kapitał biotech basket (GPW has no biotech index): ISINs of the shares. */
export const BIOTECH = ['PLMBION00016', 'PLSLVCR00029', 'PLSELVT00013', 'PLCPTRT00014', 'PLCLNPH00015', 'PLONCTH00011', 'PLPLTRG00038', 'PLBCLTX00019', 'PLBIOTN00029']
/** Load an instrument: an index/share path, the biotech basket ("basket/KAP-BIOTECH") or gold ("gold"). */
export async function loadInstrument(path: string, market?: MarketData | null): Promise<Bar[]> {
  if (path === 'basket/KAP-BIOTECH') {
    const { basket } = await import('@core/technical')
    return basket(await Promise.all(BIOTECH.map((i) => loadSeries(`shares/${i}`))))
  }
  if (path === 'gold') return (market?.gold ?? []).map((g) => ({ date: g.date, close: g.price }))
  return loadSeries(path)
}

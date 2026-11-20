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
    json<{ cpi?: CpiPoint[]; nbp?: { ref: number; from: string; history?: RefRate[] }; fx?: MarketData['fx']; gold?: MarketData['gold'] }>('macro.json', {}),
    json<{ month?: string; items?: MarketData['offer'] }>('offer.json', {}),
    json<MarketData['summary']>('summary.json', { indices: [], sectors: [] }),
    json<MarketData['shares']>('shares/index.json', []),
  ])
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

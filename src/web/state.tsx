import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './db'
import { loadMarket, type MarketData } from './market'
import { translate, type Lang } from './i18n'
import { summarize, type Asset, type PortfolioSummary } from '@core/assets'
import { buildInsights, type Insight } from '@core/insights'
import { latestCpi } from '@core/inflation'
import { today } from '@core/dates'
import type { RankedSector } from '@core/trends'

export type Screen = 'dashboard' | 'assets' | 'market' | 'bonds' | 'plan' | 'insights' | 'settings'

interface Ctx {
  lang: Lang
  t: (k: string, v?: Record<string, string | number>) => string
  settings: Settings
  update: (p: Partial<Settings>) => Promise<void>
  market: MarketData | null
  assets: Asset[]
  summary: PortfolioSummary
  insights: Insight[]
  asOf: string
  screen: Screen
  go: (s: Screen) => void
}
const AppCtx = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('outside provider')
  return c
}

export function prices(m: MarketData | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of m?.shares ?? []) {
    out.set(s.isin.toUpperCase(), s.last)
    out.set(s.name.toUpperCase(), s.last)
  }
  return out
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS())
  const [market, setMarket] = useState<MarketData | null>(null)
  const [screen, setScreen] = useState<Screen>(() => (location.hash.slice(1) as Screen) || 'dashboard')
  const assets = useLiveQuery(() => db.assets.toArray(), [], [] as Asset[])
  const asOf = today()

  useEffect(() => {
    void loadSettings().then(setSettings)
    void loadMarket().then(setMarket)
  }, [])
  useEffect(() => {
    const on = () => setScreen((location.hash.slice(1) as Screen) || 'dashboard')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => {
    document.documentElement.lang = settings.lang
  }, [settings.lang])

  const update = useCallback(async (p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }))
    await saveSettings(p)
  }, [])
  const go = useCallback((s: Screen) => {
    location.hash = s
    setScreen(s)
    window.scrollTo?.(0, 0)
  }, [])

  const summary = useMemo(
    () =>
      summarize(assets, {
        asOf,
        cpi: market?.cpi ?? [],
        refRates: market?.ref?.history ?? [],
        prices: prices(market),
        assume: { cpi: settings.assumeCpi, ref: market?.ref?.ref ?? 3.5 },
      }),
    [assets, market, asOf, settings.assumeCpi],
  )
  const insights = useMemo(() => {
    const cpi = latestCpi(market?.cpi ?? [])
    return buildInsights({ asOf, summary, profile: settings, cpi, refRate: market?.ref?.ref, offer: market?.offer, sectors: (market?.summary.sectors ?? []).map((s, i) => ({ code: s.code, report: s.report, rank: s.rank ?? i + 1 })) as RankedSector[] })
  }, [asOf, summary, settings, market])

  const lang = settings.lang
  const t = useCallback((k: string, v?: Record<string, string | number>) => translate(lang, k, v), [lang])
  const value = useMemo(() => ({ lang, t, settings, update, market, assets, summary, insights, asOf, screen, go }), [lang, t, settings, update, market, assets, summary, insights, asOf, screen, go])
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

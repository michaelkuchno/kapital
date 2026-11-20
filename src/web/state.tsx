import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, loadSettings, saveSettings, DEFAULT_SETTINGS, ensurePeople, recordHistory, FAMILY, type Settings, type Person, type StoredAsset, type HistoryPoint } from './db'
import { loadMarket, type MarketData } from './market'
import { translate, money, type Lang, type DisplayCurrency } from './i18n'
import { summarize, type PortfolioSummary } from '@core/assets'
import { buildInsights, type Insight } from '@core/insights'
import { latestCpi } from '@core/inflation'
import { today } from '@core/dates'
import type { RankedSector } from '@core/trends'

export type Screen = 'dashboard' | 'advisor' | 'assets' | 'market' | 'bonds' | 'plan' | 'learn' | 'insights' | 'settings'

interface Ctx {
  lang: Lang
  t: (k: string, v?: Record<string, string | number>) => string
  /** format an amount given in PLN in the display currency */
  fmt: (pln: number, digits?: number) => string
  /** format an amount that is already in the display currency */
  fmtCur: (v: number, digits?: number) => string
  cur: DisplayCurrency
  /** PLN per 1 unit of the display currency (1 for PLN) */
  rate: number
  settings: Settings
  update: (p: Partial<Settings>) => Promise<void>
  market: MarketData | null
  people: Person[]
  /** active person id, or FAMILY for everybody together */
  active: string
  setActive: (id: string) => void
  /** person that new assets belong to (in the family view: the first person) */
  owner: string
  assets: StoredAsset[]
  summary: PortfolioSummary
  insights: Insight[]
  history: HistoryPoint[]
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

const KEY = 'kapital-active'
const readActive = () => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS())
  const [market, setMarket] = useState<MarketData | null>(null)
  const [screen, setScreen] = useState<Screen>(() => (location.hash.slice(1) as Screen) || 'dashboard')
  const [active, setActiveState] = useState<string>(readActive)
  const people = useLiveQuery(() => db.people.orderBy('createdAt').toArray(), [], [] as Person[])
  const asOf = today()

  useEffect(() => {
    void ensurePeople(translate(DEFAULT_SETTINGS().lang, 'people.me'))
    void loadMarket().then(setMarket)
  }, [])
  // a deleted / unknown person → the first one
  const valid = active === FAMILY ? FAMILY : people.find((p) => p.id === active)?.id ?? people[0]?.id ?? 'p1'
  const owner = valid === FAMILY ? (people[0]?.id ?? 'p1') : valid
  useEffect(() => {
    void loadSettings(owner).then(setSettings)
  }, [owner])
  const assets = useLiveQuery(() => (valid === FAMILY ? db.assets.toArray() : db.assets.where('profileId').equals(valid).toArray()), [valid], [] as StoredAsset[])
  const history = useLiveQuery(() => db.history.where('profileId').equals(valid).sortBy('date'), [valid], [] as HistoryPoint[])

  useEffect(() => {
    const on = () => setScreen((location.hash.slice(1) as Screen) || 'dashboard')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => {
    document.documentElement.lang = settings.lang
  }, [settings.lang])

  const update = useCallback(
    async (p: Partial<Settings>) => {
      setSettings((s) => ({ ...s, ...p }))
      await saveSettings(owner, p)
      // the language is shared by everybody on this device
      if (p.lang) for (const person of await db.people.toArray()) if (person.id !== owner) await saveSettings(person.id, { lang: p.lang })
    },
    [owner],
  )
  const setActive = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private mode */
    }
    setActiveState(id)
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
        goldPrice: market?.gold?.at(-1)?.price,
        fx: market?.fx?.rates,
      }),
    [assets, market, asOf, settings.assumeCpi],
  )
  // one history point per day (only with market data, so values are real)
  useEffect(() => {
    if (market?.meta.lastTradingDay && summary.total > 0) void recordHistory(valid, asOf, summary.total, summary.netNow, summary.cost)
  }, [market, summary, valid, asOf])

  const insights = useMemo(() => {
    const cpi = latestCpi(market?.cpi ?? [])
    return buildInsights({ asOf, summary, profile: settings, cpi, refRate: market?.ref?.ref, offer: market?.offer, sectors: (market?.summary.sectors ?? []).map((s, i) => ({ code: s.code, report: s.report, rank: s.rank ?? i + 1 })) as RankedSector[] })
  }, [asOf, summary, settings, market])

  const lang = settings.lang
  const t = useCallback((k: string, v?: Record<string, string | number>) => translate(lang, k, v), [lang])
  const chf = market?.fx?.rates?.CHF
  const cur: DisplayCurrency = settings.displayCurrency === 'CHF' && chf ? 'CHF' : 'PLN'
  const rate = cur === 'CHF' ? chf! : 1
  const fmt = useCallback((pln: number, digits = 0) => money(lang, pln / rate, digits, cur), [lang, rate, cur])
  const fmtCur = useCallback((v: number, digits = 0) => money(lang, v, digits, cur), [lang, cur])
  const value = useMemo(
    () => ({ lang, t, fmt, fmtCur, cur, rate, settings, update, market, people, active: valid, setActive, owner, assets, summary, insights, history, asOf, screen, go }),
    [lang, t, fmt, fmtCur, cur, rate, settings, update, market, people, valid, setActive, owner, assets, summary, insights, history, asOf, screen, go],
  )
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

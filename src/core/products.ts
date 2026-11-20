import type { Bucket, Residence } from './planner'
import { volatility, drawdown, trailingReturn, type Bar } from './stats'
import { signalReport, type Signal } from './signals'

/**
 * Instruments the planner can propose, with the facts a family needs to compare them at a glance.
 * Static facts (how the product works, tax, liquidity) come from the issuers and the tax law; market numbers
 * (volatility, worst fall, 1-year return, trend signal) are computed from real daily prices (GPW, FRED) when the
 * product has a price series. Risk/cost are shown as 1–5 levels so they are easy to read.
 */
export interface Product {
  id: string
  bucket: Bucket
  /** where it is a sensible choice */
  countries: Residence[]
  currency: 'PLN' | 'CHF' | 'USD'
  /** price series used for the live numbers: "indices/WIG20TR", "shares/<ISIN>" or "world/sp500" */
  series?: string
  /** a GPW ETF ticker to look up in the share list (its ISIN gives the series) */
  gpwTicker?: string
  /** 1 (none / very low) … 5 (very high) */
  risk: 1 | 2 | 3 | 4 | 5
  cost: 1 | 2 | 3 | 4 | 5
  liquidity: 'days' | 'fee' | 'locked-until-retirement'
  inflationProtection: 1 | 2 | 3 | 4 | 5
  /** i18n keys */
  taxKey: string
  howKey: string
  /** long-run expected real return range, % per year (DMS yearbook / issuer terms) */
  expectedReal: [number, number]
  canLoseNominal: boolean
}

export const PRODUCTS: Record<string, Product> = {
  reserve: { id: 'reserve', bucket: 'safe', countries: ['PL', 'CH', 'other'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'days', inflationProtection: 1, taxKey: 'tax.interest', howKey: 'how.savings', expectedReal: [-1.5, 0.5], canLoseNominal: false },
  'planned-savings': { id: 'planned-savings', bucket: 'safe', countries: ['PL', 'CH', 'other'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'days', inflationProtection: 1, taxKey: 'tax.interest', howKey: 'how.savings', expectedReal: [-1.5, 0.5], canLoseNominal: false },
  'safe-tos': { id: 'safe-tos', bucket: 'safe', countries: ['PL'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'fee', inflationProtection: 2, taxKey: 'tax.belka', howKey: 'how.tos', expectedReal: [0, 2], canLoseNominal: false },
  'safe-chf': { id: 'safe-chf', bucket: 'safe', countries: ['CH', 'other'], currency: 'CHF', risk: 1, cost: 1, liquidity: 'days', inflationProtection: 1, taxKey: 'tax.ch.interest', howKey: 'how.chfSavings', expectedReal: [-1, 0.5], canLoseNominal: false },
  rod: { id: 'rod', bucket: 'balanced', countries: ['PL'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'fee', inflationProtection: 5, taxKey: 'tax.belka', howKey: 'how.rod', expectedReal: [2.5, 2.5], canLoseNominal: false },
  edo: { id: 'edo', bucket: 'balanced', countries: ['PL'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'fee', inflationProtection: 5, taxKey: 'tax.belka', howKey: 'how.edo', expectedReal: [2, 2], canLoseNominal: false },
  coi: { id: 'coi', bucket: 'balanced', countries: ['PL'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'fee', inflationProtection: 4, taxKey: 'tax.belka', howKey: 'how.coi', expectedReal: [1.5, 1.5], canLoseNominal: false },
  'bonds-pl-etf': { id: 'bonds-pl-etf', bucket: 'balanced', countries: ['PL'], currency: 'PLN', series: 'indices/TBSP_INDEX', gpwTicker: 'ETFBTBSP', risk: 2, cost: 2, liquidity: 'days', inflationProtection: 2, taxKey: 'tax.belka', howKey: 'how.bondEtf', expectedReal: [0.5, 2], canLoseNominal: true },
  'chf-bonds': { id: 'chf-bonds', bucket: 'balanced', countries: ['CH'], currency: 'CHF', risk: 2, cost: 2, liquidity: 'days', inflationProtection: 2, taxKey: 'tax.ch.gainsFree', howKey: 'how.chfBonds', expectedReal: [-0.5, 1], canLoseNominal: true },
  'etf-world': { id: 'etf-world', bucket: 'growth', countries: ['PL', 'CH', 'other'], currency: 'USD', gpwTicker: 'ETFIWDA', risk: 4, cost: 1, liquidity: 'days', inflationProtection: 4, taxKey: 'tax.belkaOrCh', howKey: 'how.world', expectedReal: [3, 6], canLoseNominal: true },
  'etf-poland': { id: 'etf-poland', bucket: 'growth', countries: ['PL'], currency: 'PLN', series: 'indices/WIG20TR', gpwTicker: 'ETFBW20TR', risk: 5, cost: 2, liquidity: 'days', inflationProtection: 3, taxKey: 'tax.belka', howKey: 'how.poland', expectedReal: [2, 6], canLoseNominal: true },
  'etf-swiss': { id: 'etf-swiss', bucket: 'growth', countries: ['CH'], currency: 'CHF', risk: 4, cost: 1, liquidity: 'days', inflationProtection: 3, taxKey: 'tax.ch.gainsFree', howKey: 'how.swiss', expectedReal: [2, 5], canLoseNominal: true },
  gold: { id: 'gold', bucket: 'growth', countries: ['PL', 'CH', 'other'], currency: 'USD', gpwTicker: 'ETFPZUGOLD', risk: 4, cost: 2, liquidity: 'days', inflationProtection: 4, taxKey: 'tax.gold', howKey: 'how.gold', expectedReal: [0, 3], canLoseNominal: true },
  pillar3a: { id: 'pillar3a', bucket: 'growth', countries: ['CH'], currency: 'CHF', risk: 4, cost: 2, liquidity: 'locked-until-retirement', inflationProtection: 4, taxKey: 'tax.ch.3a', howKey: 'how.3a', expectedReal: [2.5, 5], canLoseNominal: true },
  'repay-debt': { id: 'repay-debt', bucket: 'safe', countries: ['PL', 'CH', 'other'], currency: 'PLN', risk: 1, cost: 1, liquidity: 'days', inflationProtection: 1, taxKey: 'tax.none', howKey: 'how.debt', expectedReal: [5, 15], canLoseNominal: false },
}

/** Product of a plan item id (planned-… items map to savings or short bonds). */
export function productFor(itemId: string, residence: Residence): Product {
  if (PRODUCTS[itemId]) return PRODUCTS[itemId]
  if (itemId.startsWith('planned-')) return residence === 'PL' ? PRODUCTS['safe-tos'] : PRODUCTS['safe-chf']
  return PRODUCTS.reserve
}

export interface LiveMetrics {
  /** annualised volatility over the last year */
  vol: number | null
  /** worst fall from a peak within the available history */
  maxDrawdown: number | null
  from: string | null
  ret1y: number | null
  signal: Signal | null
  last: number | null
}

/** Market numbers of a product from its daily prices (null when there is no series). */
export function liveMetrics(bars: readonly Bar[] | null | undefined): LiveMetrics {
  if (!bars || bars.length < 30) return { vol: null, maxDrawdown: null, from: null, ret1y: null, signal: null, last: bars?.at(-1)?.close ?? null }
  return {
    vol: volatility(bars.slice(-252)),
    maxDrawdown: drawdown(bars).maxDrawdown,
    from: bars[0].date,
    ret1y: trailingReturn(bars, Math.min(252, bars.length - 1)),
    signal: signalReport(bars).signal,
    last: bars[bars.length - 1].close,
  }
}

/** Limits for tax-advantaged retirement saving. */
export const PILLAR3A_2026 = 7258 // CHF, employees with a pension fund (BVG)

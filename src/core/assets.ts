import type { BondTerms, BondCode, RefRate, RateAssumption } from './bonds'
import { valueBond, BOND_SPECS, DEFAULT_ASSUMPTION } from './bonds'
import { valueDeposit, type Deposit } from './deposits'
import { valuePosition } from './stocks'
import type { CpiPoint } from './inflation'
import type { ISODate } from './dates'
import { round2, share } from './money'

/** Everything a family can own, as entered by the user (stored only on the user's device / own server). */
export type Asset =
  | { id: string; kind: 'bond'; label?: string; code: BondCode; purchase: ISODate; count: number; firstRate: number; margin: number; ike?: boolean }
  | ({ id: string; kind: 'deposit'; label?: string } & Deposit)
  | { id: string; kind: 'stock'; label?: string; name: string; isin?: string; quantity: number; cost: number; manualPrice?: number; ike?: boolean }
  | { id: string; kind: 'cash'; label?: string; amount: number; rate?: number }
  | { id: string; kind: 'fund'; label?: string; name: string; value: number; cost: number; equityShare: number; ike?: boolean }
  | { id: string; kind: 'other'; label?: string; name: string; value: number }

export type AssetClass = 'bonds-inflation' | 'bonds-fixed' | 'deposits' | 'cash' | 'equities' | 'other'
export type Liquidity = 'now' | 'days' | 'fee' | 'locked'

export interface MarketInputs {
  asOf: ISODate
  cpi: readonly CpiPoint[]
  refRates: readonly RefRate[]
  /** last price per share by ISIN or by name (upper case) */
  prices: ReadonlyMap<string, number>
  assume?: RateAssumption
}

export interface ValuedAsset {
  asset: Asset
  cls: AssetClass
  liquidity: Liquidity
  /** value today (gross, before tax on unrealised gains) */
  value: number
  /** money in hand if turned into cash today (after fees and tax) */
  netNow: number
  /** invested amount (cost basis) */
  cost: number
  gain: number
  /** price was missing (stock without a market price and no manual price) */
  missingPrice?: boolean
  detail?: unknown
}

export function priceFor(a: { name: string; isin?: string; manualPrice?: number }, prices: ReadonlyMap<string, number>): number | undefined {
  return (a.isin ? prices.get(a.isin.toUpperCase()) : undefined) ?? prices.get(a.name.toUpperCase()) ?? a.manualPrice
}

export function valueAsset(a: Asset, m: MarketInputs): ValuedAsset {
  switch (a.kind) {
    case 'bond': {
      const terms: BondTerms = { code: a.code, firstRate: a.firstRate, margin: a.margin }
      const v = valueBond(terms, a.purchase, a.count, m.asOf, m.cpi, m.refRates, m.assume ?? DEFAULT_ASSUMPTION)
      const spec = BOND_SPECS[a.code]
      const netNow = a.ike ? round2(v.value - v.earlyFee) : v.netIfRedeemed
      return { asset: a, cls: spec.index === 'cpi' ? 'bonds-inflation' : 'bonds-fixed', liquidity: spec.earlyRedemption ? 'fee' : 'locked', value: v.value, netNow, cost: v.nominal, gain: round2(v.value + v.paidOutGross - v.nominal), detail: v }
    }
    case 'deposit': {
      const v = valueDeposit(a, m.asOf)
      return { asset: a, cls: 'deposits', liquidity: v.matured ? 'now' : 'fee', value: v.valueNet, netNow: v.breakValue, cost: a.amount, gain: round2(v.valueNet - a.amount), detail: v }
    }
    case 'stock': {
      const price = priceFor(a, m.prices)
      const v = valuePosition({ name: a.name, isin: a.isin, quantity: a.quantity, cost: a.cost, price: price ?? 0 })
      return { asset: a, cls: 'equities', liquidity: 'days', value: price === undefined ? a.cost : v.value, netNow: price === undefined ? a.cost : a.ike ? v.value : v.netIfSold, cost: a.cost, gain: price === undefined ? 0 : v.gain, missingPrice: price === undefined, detail: v }
    }
    case 'fund': {
      const gain = round2(a.value - a.cost)
      const tax = gain > 0 && !a.ike ? round2(gain * 0.19) : 0
      return { asset: a, cls: a.equityShare >= 0.5 ? 'equities' : 'bonds-fixed', liquidity: 'days', value: a.value, netNow: round2(a.value - tax), cost: a.cost, gain }
    }
    case 'cash':
      return { asset: a, cls: 'cash', liquidity: 'now', value: a.amount, netNow: a.amount, cost: a.amount, gain: 0 }
    case 'other':
      return { asset: a, cls: 'other', liquidity: 'locked', value: a.value, netNow: a.value, cost: a.value, gain: 0 }
  }
}

export interface PortfolioSummary {
  total: number
  netNow: number
  cost: number
  gain: number
  byClass: Record<AssetClass, number>
  byLiquidity: Record<Liquidity, number>
  /** largest single position (equities/funds/other) as a share of the total */
  largest: { id: string; name: string; share: number } | null
  /** Herfindahl–Hirschman index over positions (1 = everything in one) */
  hhi: number
  /** share protected against inflation (inflation-indexed bonds) */
  inflationProtected: number
  equityShare: number
  items: ValuedAsset[]
}

export function assetName(a: Asset): string {
  if (a.label) return a.label
  switch (a.kind) {
    case 'bond':
      return `${a.code} (${a.purchase.slice(0, 7)})`
    case 'deposit':
      return a.bank ? `Lokata ${a.bank}` : 'Lokata'
    case 'stock':
    case 'fund':
    case 'other':
      return a.name
    case 'cash':
      return 'Gotówka'
  }
}

export function summarize(assets: readonly Asset[], m: MarketInputs): PortfolioSummary {
  const items = assets.map((a) => valueAsset(a, m))
  const byClass: Record<AssetClass, number> = { 'bonds-inflation': 0, 'bonds-fixed': 0, deposits: 0, cash: 0, equities: 0, other: 0 }
  const byLiquidity: Record<Liquidity, number> = { now: 0, days: 0, fee: 0, locked: 0 }
  let total = 0
  let netNow = 0
  let cost = 0
  for (const it of items) {
    byClass[it.cls] = round2(byClass[it.cls] + it.value)
    byLiquidity[it.liquidity] = round2(byLiquidity[it.liquidity] + it.value)
    total += it.value
    netNow += it.netNow
    cost += it.cost
  }
  total = round2(total)
  let largest: PortfolioSummary['largest'] = null
  let hhi = 0
  for (const it of items) {
    const s = share(it.value, total)
    hhi += s * s
    if ((it.cls === 'equities' || it.cls === 'other') && (!largest || s > largest.share)) largest = { id: it.asset.id, name: assetName(it.asset), share: s }
  }
  return {
    total,
    netNow: round2(netNow),
    cost: round2(cost),
    gain: round2(items.reduce((s, x) => s + x.gain, 0)),
    byClass,
    byLiquidity,
    largest,
    hhi,
    inflationProtected: share(byClass['bonds-inflation'], total),
    equityShare: share(byClass.equities, total),
    items,
  }
}

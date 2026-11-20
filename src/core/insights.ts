import type { PortfolioSummary, ValuedAsset } from './assets'
import { assetName } from './assets'
import type { BondValuation, BondCode } from './bonds'
import type { DepositValuation } from './deposits'
import type { PositionValuation } from './stocks'
import { taxSavedByRealizingLoss } from './stocks'
import type { RankedSector, TrendEvent } from './trends'
import { round2 } from './money'
import { PILLAR3A_2026 } from './products'
import { daysBetween, type ISODate } from './dates'

/**
 * Insights: plain-language observations about the family's money, each with the numbers behind it and the research
 * or legal source. They describe and compare – they are not investment recommendations (the decision stays with the
 * user; for large decisions a licensed adviser can help).
 */
export type Severity = 'warn' | 'tip' | 'info' | 'ok'
export interface Insight {
  id: string
  severity: Severity
  /** i18n key of the title and body; params are filled into the text */
  key: string
  params: Record<string, string | number>
  evidence: string[]
  /** related asset id or sector code */
  ref?: string
}

export interface Profile {
  monthlyExpenses: number
  /** 1 (very cautious) … 5 (very risk tolerant) */
  risk: 1 | 2 | 3 | 4 | 5
  horizonYears: number
  family800: boolean
  usesIke: boolean
  usesIkze: boolean
  /** marginal PIT rate for the IKZE deduction: 12 or 32 (scale) or 19 (linear) */
  pitRate: 12 | 19 | 32
  /** realized gains from selling shares this year (PIT-38), zł */
  realizedGainsThisYear: number
  /** where the family lives and pays tax: Poland or Switzerland */
  country: 'PL' | 'CH'
  usesPillar3a: boolean
}

export const DEFAULT_PROFILE: Profile = { monthlyExpenses: 0, risk: 3, horizonYears: 10, family800: false, usesIke: false, usesIkze: false, pitRate: 12, realizedGainsThisYear: 0, country: 'PL', usesPillar3a: false }

/** Target share of equities by risk profile (inclusive range). */
export const EQUITY_TARGET: Record<Profile['risk'], [number, number]> = { 1: [0, 0.1], 2: [0.1, 0.3], 3: [0.3, 0.5], 4: [0.5, 0.7], 5: [0.7, 0.9] }

/** Yearly limits for 2026 (MRPiPS announcement: 3× / 1.2× the forecast average wage of 9 420 zł). */
export const LIMITS_2026 = { ike: 28_260, ikze: 11_304 }

export interface OfferItem {
  code: BondCode
  series: string
  firstRate: number
  margin: number
}

export interface InsightInputs {
  asOf: ISODate
  summary: PortfolioSummary
  profile: Profile
  /** latest CPI y/y in percent and its month */
  cpi?: { month: string; yoy: number }
  refRate?: number
  offer?: OfferItem[]
  sectors?: RankedSector[]
}

/** fraction → percent with d decimals */
export const pct = (x: number, d = 1) => Number((x * 100).toFixed(d))

export function buildInsights(inp: InsightInputs): Insight[] {
  const out: Insight[] = []
  const { summary: s, profile: p } = inp
  const total = s.total
  if (!total) return [{ id: 'empty', severity: 'info', key: 'insight.empty', params: {}, evidence: [] }]

  // 1. emergency fund: money available within days without losses ≈ 6 months of expenses (financial fragility research)
  if (p.monthlyExpenses > 0) {
    const liquid = round2(s.byLiquidity.now + s.items.filter((i) => i.cls === 'deposits').reduce((a, i) => a + i.netNow, 0))
    const months = liquid / p.monthlyExpenses
    if (months < 3) out.push({ id: 'emergency-low', severity: 'warn', key: 'insight.emergencyLow', params: { months: round2(months), target: round2(6 * p.monthlyExpenses), gap: round2(6 * p.monthlyExpenses - liquid) }, evidence: ['lusardi2011'] })
    else if (months < 6) out.push({ id: 'emergency-mid', severity: 'tip', key: 'insight.emergencyMid', params: { months: round2(months), gap: round2(6 * p.monthlyExpenses - liquid) }, evidence: ['lusardi2011'] })
    else out.push({ id: 'emergency-ok', severity: 'ok', key: 'insight.emergencyOk', params: { months: round2(months) }, evidence: ['lusardi2011'] })
  } else out.push({ id: 'emergency-unknown', severity: 'info', key: 'insight.emergencyUnknown', params: {}, evidence: ['lusardi2011'] })

  // 2. concentration in one company
  if (s.largest && s.largest.share > 0.1) out.push({ id: 'concentration', severity: s.largest.share > 0.2 ? 'warn' : 'tip', key: 'insight.concentration', params: { name: s.largest.name, share: pct(s.largest.share) }, evidence: ['markowitz1952', 'bessembinder2018'], ref: s.largest.id })

  // 3. single shares with big losses: decide by the future, not by the purchase price; tax effect of realizing the loss
  const stocks = s.items.filter((i) => i.asset.kind === 'stock' && !i.missingPrice)
  const otherGains = round2(stocks.filter((i) => i.gain > 0).reduce((a, i) => a + i.gain, 0))
  for (const it of stocks) {
    const d = it.detail as PositionValuation
    if (d.gainPct <= -0.25) {
      const saved = taxSavedByRealizingLoss(p.realizedGainsThisYear + otherGains, d.gain)
      out.push({ id: `loss-${it.asset.id}`, severity: 'tip', key: 'insight.bigLoss', params: { name: assetName(it.asset), loss: pct(d.gainPct), lossZl: Math.abs(d.gain), needed: pct(d.neededToBreakEven), taxSaved: saved }, evidence: ['shefrin1985', 'odean1998', 'pit'], ref: it.asset.id })
    }
  }

  // 4. equities only in single Polish companies → diversification, costs
  const eq = s.items.filter((i) => i.cls === 'equities')
  if (eq.length && eq.every((i) => i.asset.kind === 'stock')) out.push({ id: 'single-stocks-only', severity: 'tip', key: 'insight.singleStocksOnly', params: { count: eq.length, value: round2(eq.reduce((a, i) => a + i.value, 0)) }, evidence: ['french1991', 'sharpe1991', 'bessembinder2018', 'barber2000'] })

  // 5. equity share vs the chosen risk profile
  const [lo, hi] = EQUITY_TARGET[p.risk]
  if (s.equityShare > hi + 0.05 || s.equityShare < lo - 0.05)
    out.push({ id: 'allocation-drift', severity: 'tip', key: s.equityShare > hi ? 'insight.equityHigh' : 'insight.equityLow', params: { share: pct(s.equityShare), lo: pct(lo), hi: pct(hi), amount: round2(Math.abs(s.equityShare - (s.equityShare > hi ? hi : lo)) * total) }, evidence: ['jaconetti2010', 'markowitz1952'] })

  // 6. deposits: ending soon, promotion over, real return
  for (const it of s.items.filter((i) => i.asset.kind === 'deposit')) {
    const a = it.asset as Extract<typeof it.asset, { kind: 'deposit' }>
    const d = it.detail as DepositValuation
    if (!d.matured && d.daysLeft <= 30) {
      const best = (inp.offer ?? []).filter((o) => o.code === 'OTS' || o.code === 'TOS' || o.code === 'COI' || o.code === 'EDO' || (p.family800 && (o.code === 'ROS' || o.code === 'ROD')))
      out.push({ id: `deposit-ending-${a.id}`, severity: 'warn', key: 'insight.depositEnding', params: { name: assetName(a), days: d.daysLeft, end: d.end, amount: d.endValueNet, offers: best.map((o) => `${o.code} ${o.firstRate}%`).join(', ') }, evidence: ['bonds'], ref: a.id })
    }
    if (a.renewRate !== undefined && a.renewRate < a.rate) out.push({ id: `deposit-promo-${a.id}`, severity: 'tip', key: 'insight.depositPromo', params: { name: assetName(a), rate: a.rate, renew: a.renewRate, end: d.end }, evidence: [], ref: a.id })
    if (inp.cpi) {
      const realNet = (1 + (a.rate * 0.81) / 100) / (1 + inp.cpi.yoy / 100) - 1
      if (realNet < 0) out.push({ id: `deposit-real-${a.id}`, severity: 'info', key: 'insight.depositReal', params: { name: assetName(a), real: pct(realNet, 2), cpi: inp.cpi.yoy }, evidence: ['fisher1930', 'gus'], ref: a.id })
    }
  }

  // 7. cash earning nothing
  const cash = s.byClass.cash
  if (inp.cpi && cash > Math.max(10_000, 3 * p.monthlyExpenses)) out.push({ id: 'cash-drag', severity: 'tip', key: 'insight.cashDrag', params: { cash: round2(cash), lossYear: round2((cash * inp.cpi.yoy) / 100) }, evidence: ['fisher1930', 'gus'] })

  // 8. inflation-indexed bonds: what early redemption would cost today, the protection they give
  for (const it of s.items.filter((i) => i.asset.kind === 'bond')) {
    const v = it.detail as BondValuation
    if (v.current && !v.matured) out.push({ id: `bond-${it.asset.id}`, severity: 'info', key: 'insight.bondStatus', params: { name: `${v.series}`, value: v.value, net: v.netIfRedeemed, fee: v.earlyFee, rate: v.current.rate, nextReset: v.current.end, maturity: v.maturityDate, maturityNet: v.maturityNet }, evidence: ['bonds', 'pit'], ref: it.asset.id })
  }

  // 9. family bonds for 800+ families (Polish residents)
  if (p.country === 'PL' && p.family800 && inp.offer) {
    const edo = inp.offer.find((o) => o.code === 'EDO')
    const rod = inp.offer.find((o) => o.code === 'ROD')
    if (edo && rod && rod.margin > edo.margin) out.push({ id: 'family-bonds', severity: 'tip', key: 'insight.familyBonds', params: { rod: rod.margin, edo: edo.margin, rodFirst: rod.firstRate, edoFirst: edo.firstRate }, evidence: ['bonds'] })
  }

  // 10. tax wrappers: IKE/IKZE in Poland, pillar 3a in Switzerland
  if (p.country === 'CH') {
    if (!p.usesPillar3a) out.push({ id: 'pillar3a', severity: 'tip', key: 'insight.pillar3a', params: { limit: PILLAR3A_2026, saved: Math.round(PILLAR3A_2026 * 0.25) }, evidence: ['pillar3a'] })
    if (s.plnShare > 0.5) out.push({ id: 'fx-mismatch', severity: 'tip', key: 'insight.fxMismatch', params: { share: pct(s.plnShare, 0) }, evidence: ['markowitz1952'] })
  } else if (!p.usesIke) out.push({ id: 'ike', severity: 'tip', key: 'insight.ike', params: { limit: LIMITS_2026.ike, saved10: round2(LIMITS_2026.ike * (Math.pow(1.05, 10) - 1) * 0.19) }, evidence: ['ike', 'pit'] })
  if (p.country === 'PL' && !p.usesIkze) out.push({ id: 'ikze', severity: 'tip', key: 'insight.ikze', params: { limit: LIMITS_2026.ikze, refund: round2((LIMITS_2026.ikze * p.pitRate) / 100) }, evidence: ['ike'] })

  // 11. inflation protection share
  if (inp.cpi && s.inflationProtected > 0) out.push({ id: 'inflation-protected', severity: 'ok', key: 'insight.inflationProtected', params: { share: pct(s.inflationProtected), cpi: inp.cpi.yoy }, evidence: ['bonds', 'gus'] })

  // 12. sector trend changes and the strongest sectors (industry momentum)
  if (inp.sectors?.length) {
    const recent = inp.sectors.filter((x) => x.report.events.length && daysBetween(x.report.events[0].date, inp.asOf) <= 14)
    for (const x of recent.slice(0, 6)) {
      const e: TrendEvent = x.report.events[0]
      out.push({ id: `trend-${x.code}`, severity: 'info', key: `insight.trend.${e.kind}`, params: { sector: x.code, date: e.date, rank: x.rank, of: inp.sectors.length }, evidence: e.kind.startsWith('momentum') ? ['moskowitz2012', 'jegadeesh1993'] : ['faber2007'], ref: x.code })
    }
    const top = inp.sectors.filter((x) => x.report.score !== null).slice(0, 3)
    if (top.length) out.push({ id: 'sector-leaders', severity: 'info', key: 'insight.sectorLeaders', params: { list: top.map((x) => x.code).join(', ') }, evidence: ['moskowitz1999', 'jegadeesh1993'] })
  }

  const order: Record<Severity, number> = { warn: 0, tip: 1, info: 2, ok: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/** helper for the UI: items of a class */
export function itemsOf(s: PortfolioSummary, kind: ValuedAsset['asset']['kind']): ValuedAsset[] {
  return s.items.filter((i) => i.asset.kind === kind)
}

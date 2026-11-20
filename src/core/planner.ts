import { addMonths, daysBetween, type ISODate } from './dates'
import { round2 } from './money'
import { project, DEFAULT_PARAMS, type Ar1, type ProjectionYear } from './montecarlo'
import { requiredMonthly } from './goals'
import type { OfferItem } from './insights'
import { LIMITS_2026 } from './insights'
import type { Signal } from './signals'
import type { Mood } from './sentiment'
import { PILLAR3A_2026 } from './products'

/**
 * Financial planner ("Golden hands"): from the household's situation it builds a plan in three buckets –
 * SAFE (emergency fund + money needed within 3 years), BALANCED (inflation-protected bonds) and GROWTH (diversified
 * low-cost equity ETFs + a little gold). It follows the textbook order used by planners and robo-advisers:
 *   1. no expensive debt  2. emergency fund (more months for one earner with children)  3. money for known expenses
 *      matched to its date  4. long-term money split by the risk profile and the horizon  5. tax wrappers (IKE/IKZE)
 * Market data only changes HOW FAST the growth part is invested (one go vs. in tranches), never the long-term split –
 * research shows timing the market does not pay (Sharpe 1975; Vanguard 2012: a lump sum beat averaging in ~2/3 of cases).
 * Nothing here is a guarantee: the stress test shows what a crash would do.
 */
export type Currency = 'PLN' | 'CHF'
export type Residence = 'PL' | 'CH' | 'other'

export interface PlannedExpense {
  name: string
  amount: number
  inMonths: number
}

export interface PlanInput {
  asOf: ISODate
  currency: Currency
  /** PLN per 1 CHF (NBP) */
  chfRate: number
  monthlyIncome: number
  monthlyExpenses: number
  /** people with an income in the household */
  earners: number
  adults: number
  children: { birth: ISODate }[]
  job: 'stable' | 'variable' | 'none'
  residence: Residence
  /** money on accounts now, in `cashCurrency` */
  cash: number
  cashCurrency: Currency
  /** monthly repayments of loans (in `currency`) and whether any loan costs more than ~8 % a year */
  debtMonthly: number
  expensiveDebt: number
  planned: PlannedExpense[]
  /** answers 1–5 to the five risk questions */
  answers: [number, number, number, number, number]
  horizonYears: number
  family800: boolean
  usesIke: boolean
  usesIkze: boolean
  /** what the family already owns (PLN), from the asset list */
  existing: { safe: number; balanced: number; growth: number; largestStockShare: number; /** share of the wealth held in PLN */ plnShare?: number }
  market: {
    offer: OfferItem[]
    cpi: number
    refRate: number
    wigSignal: Signal
    worldSignal: Signal
    plMood: Mood
    worldMood: Mood
    /** 12-month returns of the candidate equity ETFs, for a small momentum tilt */
    momentum: { world?: number; poland?: number }
  }
  cpiModel?: Ar1
  /** a goal for the child at 18, in today's money */
  childGoal?: number
}

export type Bucket = 'safe' | 'balanced' | 'growth'
export interface PlanItem {
  id: string
  bucket: Bucket
  amount: number
  /** i18n key of the explanation + params */
  why: string
  params?: Record<string, string | number>
  evidence: string[]
}
export interface ChecklistItem {
  id: string
  when: ISODate
  key: string
  params?: Record<string, string | number>
}

export interface Plan {
  riskScore: 1 | 2 | 3 | 4 | 5
  riskLabel: 'very-cautious' | 'cautious' | 'balanced' | 'growth' | 'aggressive'
  monthlyIncomePln: number
  monthlyExpensesPln: number
  surplusPln: number
  savingsRate: number
  reserve: { months: number; target: number; have: number; gap: number; currency: Currency }
  plannedSafe: number
  investable: number
  split: Record<Bucket, number>
  totals: Record<Bucket, number>
  items: PlanItem[]
  monthly: { toReserve: number; toInvest: number; monthsToFillReserve: number; split: Record<Bucket, number> }
  entry: { mode: 'lump' | 'staged'; months: number; reason: string }
  child?: { years: number; target: number; monthly: number }
  rodLimit: number
  warnings: { key: string; params?: Record<string, string | number> }[]
  checklist: ChecklistItem[]
  stress: { crashLoss: number; crashPct: number; recoveryYears: number; inflationShockLoss: number }
  scores: { safety: number; growth: number; liquidity: number; inflation: number; cost: number }
  projection: { plan: ProjectionYear[]; cash: ProjectionYear[]; probLoseReal: number; probLoseRealCash: number }
}

/** Long-term split by risk profile (share of long-term money). */
export const SPLITS: Record<1 | 2 | 3 | 4 | 5, Record<Bucket, number>> = {
  1: { safe: 0.6, balanced: 0.4, growth: 0 },
  2: { safe: 0.35, balanced: 0.5, growth: 0.15 },
  3: { safe: 0.2, balanced: 0.45, growth: 0.35 },
  4: { safe: 0.1, balanced: 0.35, growth: 0.55 },
  5: { safe: 0.05, balanced: 0.25, growth: 0.7 },
}
const LABELS = ['very-cautious', 'cautious', 'balanced', 'growth', 'aggressive'] as const

/** Risk score from the answers, capped by the horizon (short horizon → less risk whatever the answers). */
export function riskScore(answers: readonly number[], horizonYears: number): 1 | 2 | 3 | 4 | 5 {
  const valid = answers.filter((a) => Number.isFinite(a) && a >= 1 && a <= 5)
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 3
  let s = Math.round(avg)
  if (horizonYears < 3) s = Math.min(s, 1)
  else if (horizonYears < 5) s = Math.min(s, 2)
  else if (horizonYears < 8) s = Math.min(s, 4)
  return Math.max(1, Math.min(5, s)) as 1 | 2 | 3 | 4 | 5
}

/** Emergency fund in months of expenses: 6 base; one earner with dependants +3; irregular income +3; no income → 12. */
export function reserveMonths(i: Pick<PlanInput, 'earners' | 'adults' | 'children' | 'job'>): number {
  if (i.job === 'none' || i.earners === 0) return 12
  let m = 6
  if (i.earners < i.adults || i.children.length > 0) m += i.earners === 1 ? 3 : 0
  if (i.job === 'variable') m += 3
  return Math.min(12, m)
}

/**
 * The 800+ benefit since the child's birth (500+ until 12/2023, 800+ from 1/2024), paid from the month of birth.
 * The family bonds (ROS/ROD) can be bought up to the amount of benefits received.
 */
export function benefitReceived(birth: ISODate, asOf: ISODate): number {
  let total = 0
  for (let m = birth.slice(0, 7); m <= asOf.slice(0, 7); m = addMonths(`${m}-01`, 1).slice(0, 7)) {
    // before 07/2019 the benefit for the first child depended on income – counted only from the universal 500+ (conservative)
    if (m < '2019-07') continue
    // until the child turns 18
    if (m >= `${Number(birth.slice(0, 4)) + 18}${birth.slice(4, 7)}`) break
    total += m >= '2024-01' ? 800 : 500
  }
  return total
}

export function ageYears(birth: ISODate, asOf: ISODate): number {
  return daysBetween(birth, asOf) / 365.25
}

const toPln = (v: number, c: Currency, chf: number) => (c === 'CHF' ? v * chf : v)

export function buildPlan(i: PlanInput): Plan {
  const chf = i.chfRate > 0 ? i.chfRate : 1
  const income = round2(toPln(i.monthlyIncome, i.currency, chf))
  const expenses = round2(toPln(i.monthlyExpenses, i.currency, chf))
  const debt = round2(toPln(i.debtMonthly, i.currency, chf))
  const surplus = round2(income - expenses - debt)
  const cash = round2(toPln(i.cash, i.cashCurrency, chf))
  const risk = riskScore(i.answers, i.horizonYears)
  const warnings: Plan['warnings'] = []
  const items: PlanItem[] = []
  const checklist: ChecklistItem[] = []

  // 1. expensive debt first: paying 10 % debt is a sure 10 % "return"
  let free = cash
  if (i.expensiveDebt > 0) {
    const pay = Math.min(free, i.expensiveDebt)
    if (pay > 0) items.push({ id: 'repay-debt', bucket: 'safe', amount: round2(pay), why: 'plan.why.debt', evidence: ['fisher1930'] })
    free -= pay
    warnings.push({ key: 'plan.warn.debt', params: { amount: round2(i.expensiveDebt) } })
  }

  // 2. emergency fund (in the currency of the expenses: CHF expenses → keep the reserve in CHF, no exchange-rate risk)
  const months = reserveMonths(i)
  const target = round2(months * expenses)
  const have = round2(i.existing.safe)
  const reserveCur: Currency = i.currency
  const reserveGap = Math.max(0, round2(target - have))
  const toReserve = Math.min(free, reserveGap)
  if (toReserve > 0) items.push({ id: 'reserve', bucket: 'safe', amount: round2(toReserve), why: reserveCur === 'CHF' ? 'plan.why.reserveChf' : 'plan.why.reserve', params: { months }, evidence: ['lusardi2011'] })
  free -= toReserve

  // 3. money for known expenses within 3 years, matched to the date
  let plannedSafe = 0
  const ots = i.market.offer.find((o) => o.code === 'OTS')
  const tos = i.market.offer.find((o) => o.code === 'TOS')
  for (const p of i.planned.filter((x) => x.amount > 0 && x.inMonths <= 36).sort((a, b) => a.inMonths - b.inMonths)) {
    const amt = Math.min(free, toPln(p.amount, i.currency, chf))
    if (amt <= 0) break
    const instrument = i.residence !== 'PL' ? 'chf' : p.inMonths <= 3 ? 'savings' : p.inMonths <= 12 ? 'deposit' : p.inMonths <= 24 ? 'ots-roll' : 'tos'
    items.push({ id: `planned-${p.name}`, bucket: 'safe', amount: round2(amt), why: `plan.why.planned.${instrument}`, params: { name: p.name, months: p.inMonths, tos: tos?.firstRate ?? '–', ots: ots?.firstRate ?? '–' }, evidence: ['bonds'] })
    plannedSafe += amt
    free -= amt
  }

  // 4. long-term money: split by risk profile
  const investable = Math.max(0, round2(free))
  const split = { ...SPLITS[risk] }
  // existing investments count towards the targets: new money fills what is missing
  const longTotal = investable + i.existing.balanced + i.existing.growth + Math.max(0, i.existing.safe - target)
  const want: Record<Bucket, number> = { safe: split.safe * longTotal, balanced: split.balanced * longTotal, growth: split.growth * longTotal }
  const haveB: Record<Bucket, number> = { safe: Math.max(0, i.existing.safe - target), balanced: i.existing.balanced, growth: i.existing.growth }
  const need: Record<Bucket, number> = { safe: Math.max(0, want.safe - haveB.safe), balanced: Math.max(0, want.balanced - haveB.balanced), growth: Math.max(0, want.growth - haveB.growth) }
  const needSum = need.safe + need.balanced + need.growth
  const alloc: Record<Bucket, number> = needSum > 0 ? { safe: (investable * need.safe) / needSum, balanced: (investable * need.balanced) / needSum, growth: (investable * need.growth) / needSum } : { safe: investable * split.safe, balanced: investable * split.balanced, growth: investable * split.growth }

  // SAFE part of long-term money: the best short instrument
  if (alloc.safe >= 100) {
    if (i.residence === 'PL') items.push({ id: 'safe-tos', bucket: 'safe', amount: round2(alloc.safe), why: 'plan.why.tos', params: { rate: tos?.firstRate ?? '–' }, evidence: ['bonds'] })
    else items.push({ id: 'safe-chf', bucket: 'safe', amount: round2(alloc.safe), why: 'plan.why.safeChf', evidence: ['snb'] })
  }

  // BALANCED: family bonds (up to the 800+ received), then EDO; COI if the horizon is 4–9 years
  const rodLimit = i.family800 && i.residence === 'PL' ? i.children.reduce((a, c) => a + benefitReceived(c.birth, i.asOf), 0) : 0
  let bal = alloc.balanced
  const rod = i.market.offer.find((o) => o.code === 'ROD')
  const edo = i.market.offer.find((o) => o.code === 'EDO')
  const coi = i.market.offer.find((o) => o.code === 'COI')
  if (bal >= 100 && rodLimit > 0 && rod && i.horizonYears >= 10) {
    const a = Math.min(bal, rodLimit)
    items.push({ id: 'rod', bucket: 'balanced', amount: Math.floor(a / 100) * 100, why: 'plan.why.rod', params: { margin: rod.margin, first: rod.firstRate, limit: rodLimit }, evidence: ['bonds'] })
    bal -= Math.floor(a / 100) * 100
  }
  if (bal >= 100 && i.residence !== 'PL') {
    // living in Switzerland: CHF bonds (no currency risk against CHF expenses); Polish retail bonds would add PLN risk
    items.push({ id: 'chf-bonds', bucket: 'balanced', amount: round2(bal), why: 'plan.why.chfBonds', evidence: ['snb', 'markowitz1952'] })
    bal = 0
  }
  if (bal >= 100) {
    if (i.horizonYears >= 10 || !coi) items.push({ id: 'edo', bucket: 'balanced', amount: round2(bal), why: 'plan.why.edo', params: { margin: edo?.margin ?? 2, first: edo?.firstRate ?? '–', ike: !i.usesIke && i.residence === 'PL' ? 1 : 0 }, evidence: ['bonds', 'ike'] })
    else items.push({ id: 'coi', bucket: 'balanced', amount: round2(bal), why: 'plan.why.coi', params: { margin: coi.margin, first: coi.firstRate }, evidence: ['bonds'] })
  }

  // GROWTH: a world equity ETF as the core, Poland as a smaller part, gold as a crisis hedge
  const g = alloc.growth
  if (g >= 100 && i.residence === 'CH') {
    // pillar 3a first: tax-deductible up to the yearly limit per earner, invested in index funds
    const limit = PILLAR3A_2026 * chf * Math.max(1, i.earners)
    const p3a = round2(Math.min(g * 0.5, limit))
    const rest = g - p3a
    const gold = round2(rest * 0.1)
    const swiss = round2(rest * 0.25)
    items.push({ id: 'pillar3a', bucket: 'growth', amount: p3a, why: 'plan.why.3a', params: { limit: PILLAR3A_2026 }, evidence: ['pillar3a'] })
    items.push({ id: 'etf-world', bucket: 'growth', amount: round2(rest - gold - swiss), why: 'plan.why.worldCh', evidence: ['sharpe1991', 'french1991', 'bessembinder2018'] })
    items.push({ id: 'etf-swiss', bucket: 'growth', amount: swiss, why: 'plan.why.swiss', evidence: ['french1991'] })
    items.push({ id: 'gold', bucket: 'growth', amount: gold, why: 'plan.why.gold', evidence: ['markowitz1952'] })
  } else if (g >= 100) {
    const tilt = momentumTilt(i.market.momentum)
    const gold = round2(g * 0.1)
    const poland = round2(g * (0.2 + tilt))
    const world = round2(g - gold - poland)
    items.push({ id: 'etf-world', bucket: 'growth', amount: world, why: 'plan.why.world', evidence: ['sharpe1991', 'french1991', 'bessembinder2018'] })
    items.push({ id: 'etf-poland', bucket: 'growth', amount: poland, why: 'plan.why.poland', params: { tilt: Math.round(tilt * 100) }, evidence: ['moskowitz2012'] })
    items.push({ id: 'gold', bucket: 'growth', amount: gold, why: 'plan.why.gold', evidence: ['markowitz1952'] })
  }

  // entry pace for the growth part: market-informed, not market-timing
  const down = i.market.wigSignal === 'sell' || i.market.worldSignal === 'sell'
  const euphoric = i.market.plMood === 'extreme-greed' || i.market.worldMood === 'extreme-greed'
  const entry: Plan['entry'] =
    g < 100 ? { mode: 'lump', months: 0, reason: 'plan.entry.none' } : risk <= 3 || down || euphoric ? { mode: 'staged', months: 6, reason: down ? 'plan.entry.downtrend' : euphoric ? 'plan.entry.euphoria' : 'plan.entry.comfort' } : { mode: 'lump', months: 0, reason: 'plan.entry.lump' }

  // 5. monthly surplus: first the reserve, then the same split; IKZE/IKE first for Polish taxpayers
  const reserveAfterCash = Math.max(0, reserveGap - toReserve)
  const toReserveMonthly = surplus > 0 && reserveAfterCash > 0 ? surplus : 0
  const monthsToFill = toReserveMonthly > 0 ? Math.ceil(reserveAfterCash / toReserveMonthly) : 0
  const monthly = { toReserve: round2(toReserveMonthly), toInvest: round2(surplus > 0 && !reserveAfterCash ? surplus : 0), monthsToFillReserve: monthsToFill, split }

  // child: a start in adult life at 18, in today's money (real return of the plan)
  let child: Plan['child']
  const youngest = [...i.children].sort((a, b) => b.birth.localeCompare(a.birth))[0]
  if (youngest && i.childGoal && i.childGoal > 0) {
    const years = Math.max(0, 18 - ageYears(youngest.birth, i.asOf))
    child = { years: round2(years), target: i.childGoal, monthly: round2(requiredMonthly(i.childGoal, 0, years, expectedReal(split))) }
  }

  // warnings
  if (surplus < 0) warnings.push({ key: 'plan.warn.deficit', params: { amount: round2(-surplus) } })
  else if (income > 0 && surplus / income < 0.1) warnings.push({ key: 'plan.warn.lowSavings', params: { rate: Math.round((surplus / income) * 100) } })
  if (i.currency === 'CHF' && i.residence === 'CH') warnings.push({ key: 'plan.warn.fx', params: { rate: round2(chf) } })
  if (i.earners === 1 && (i.children.length > 0 || i.adults > 1)) warnings.push({ key: 'plan.warn.oneEarner' })
  if (i.existing.largestStockShare > 0.1) warnings.push({ key: 'plan.warn.concentration', params: { share: Math.round(i.existing.largestStockShare * 100) } })
  if (i.residence === 'other') warnings.push({ key: 'plan.warn.residence' })
  if (i.residence === 'CH' && (i.existing.plnShare ?? 0) > 0.5) warnings.push({ key: 'plan.warn.fxAssets', params: { share: Math.round((i.existing.plnShare ?? 0) * 100) } })

  // checklist with dates
  const endOfMonth = addMonths(`${i.asOf.slice(0, 7)}-01`, 1)
  const dayBefore = new Date(Date.parse(endOfMonth) - 86_400_000).toISOString().slice(0, 10)
  if (toReserve > 0) checklist.push({ id: 'c-reserve', when: i.asOf, key: reserveCur === 'CHF' ? 'plan.do.reserveChf' : 'plan.do.reserve', params: { amount: round2(toReserve) } })
  if (items.some((x) => x.id === 'rod' || x.id === 'edo' || x.id === 'coi')) checklist.push({ id: 'c-bonds', when: dayBefore, key: 'plan.do.bonds', params: { series: [rod, edo, coi].filter(Boolean).map((o) => o!.series).join(', ') } })
  if (g >= 100) checklist.push({ id: 'c-broker', when: i.asOf, key: i.residence === 'PL' && !i.usesIke ? 'plan.do.brokerIke' : i.residence === 'CH' ? 'plan.do.brokerCh' : 'plan.do.broker' })
  if (items.some((x) => x.id === 'pillar3a')) checklist.push({ id: 'c-3a', when: `${i.asOf.slice(0, 4)}-12-20`, key: 'plan.do.3a', params: { limit: PILLAR3A_2026 } })
  if (entry.mode === 'staged') for (let k = 0; k < entry.months; k++) checklist.push({ id: `c-tranche-${k}`, when: addMonths(i.asOf, k), key: 'plan.do.tranche', params: { n: k + 1, of: entry.months, amount: round2(g / entry.months) } })
  else if (g >= 100) checklist.push({ id: 'c-etf', when: i.asOf, key: 'plan.do.etf', params: { amount: round2(g) } })
  if (surplus > 0) checklist.push({ id: 'c-standing', when: addMonths(i.asOf, 1), key: 'plan.do.standing', params: { amount: round2(surplus) } })
  if (i.residence === 'PL' && !i.usesIkze && income > 0) checklist.push({ id: 'c-ikze', when: `${i.asOf.slice(0, 4)}-12-15`, key: 'plan.do.ikze', params: { limit: LIMITS_2026.ikze } })
  checklist.push({ id: 'c-review', when: addMonths(i.asOf, 6), key: 'plan.do.review' })
  checklist.sort((a, b) => a.when.localeCompare(b.when))

  const totals: Record<Bucket, number> = { safe: 0, balanced: 0, growth: 0 }
  for (const it of items) totals[it.bucket] = round2(totals[it.bucket] + it.amount)

  // stress test: a 2008-like crash (equities −45 %, gold +5 %, bonds hold their value)
  const eqNow = i.existing.growth + totals.growth * 0.9
  const goldNow = totals.growth * 0.1
  const crashLoss = round2(eqNow * 0.45 - goldNow * 0.05)
  const totalAfter = cash + i.existing.safe + i.existing.balanced + i.existing.growth
  const inflationShockLoss = round2((i.existing.safe + totals.safe) * 0.05)
  const stress = { crashLoss, crashPct: totalAfter ? crashLoss / totalAfter : 0, recoveryYears: 4, inflationShockLoss }

  // projections: the plan vs keeping the money on a deposit
  const cpiModel = i.cpiModel ?? { mean: 2.8, phi: 0.6, sigma: 1.5 }
  const start = { inflationBonds: i.existing.balanced + totals.balanced, fixedBonds: 0, deposits: i.existing.safe + totals.safe, equities: i.existing.growth + totals.growth }
  const yearly = Math.max(0, surplus) * 12
  const years = Math.max(5, Math.min(30, Math.round(i.horizonYears)))
  const plan = project({ start, contribution: yearly, contributionSplit: { inflationBonds: split.balanced, fixedBonds: 0, deposits: split.safe, equities: split.growth }, years, cpi: cpiModel, cpiStart: i.market.cpi, paths: 1500, seed: 11 })
  const all = start.inflationBonds + start.deposits + start.equities
  const cashP = project({ start: { inflationBonds: 0, fixedBonds: 0, deposits: all, equities: 0 }, contribution: yearly, contributionSplit: { inflationBonds: 0, fixedBonds: 0, deposits: 1, equities: 0 }, years, cpi: cpiModel, cpiStart: i.market.cpi, paths: 1500, seed: 11 })

  const shareOf = (b: Bucket) => (totalAfter ? (b === 'safe' ? i.existing.safe + totals.safe : b === 'balanced' ? i.existing.balanced + totals.balanced : i.existing.growth + totals.growth) / totalAfter : 0)
  const scores = {
    safety: Math.round(Math.min(1, (have + toReserve) / Math.max(1, target)) * 60 + (1 - shareOf('growth')) * 40),
    growth: Math.round(Math.min(1, expectedReal(split) / 0.05) * 100),
    liquidity: Math.round(Math.min(1, shareOf('safe') + shareOf('growth') * 0.8) * 100),
    inflation: Math.round(Math.min(1, shareOf('balanced') + shareOf('growth') * 0.7) * 100),
    cost: 90,
  }

  return {
    riskScore: risk,
    riskLabel: LABELS[risk - 1],
    monthlyIncomePln: income,
    monthlyExpensesPln: expenses,
    surplusPln: surplus,
    savingsRate: income > 0 ? surplus / income : 0,
    reserve: { months, target, have, gap: reserveGap, currency: reserveCur },
    plannedSafe: round2(plannedSafe),
    investable,
    split,
    totals,
    items,
    monthly,
    entry,
    child,
    rodLimit,
    warnings,
    checklist,
    stress,
    scores,
    projection: { plan: plan.years, cash: cashP.years, probLoseReal: plan.probLoseReal, probLoseRealCash: cashP.probLoseReal },
  }
}

/** Expected real return of a split (long-run assumptions from montecarlo.ts). */
export function expectedReal(split: Record<Bucket, number>): number {
  const p = DEFAULT_PARAMS
  return (split.safe * p.depositSpread + split.balanced * p.inflationMargin + split.growth * p.equityReal) / 100
}

/** Small momentum tilt between Poland and the world (±5 pp of the growth part), from 12-month returns. */
export function momentumTilt(m: { world?: number; poland?: number }): number {
  if (m.world == null || m.poland == null) return 0
  const d = m.poland - m.world
  return Math.max(-0.05, Math.min(0.05, d * 0.25))
}

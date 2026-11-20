import { addMonths, daysBetween, monthOf, shiftMonth, type ISODate } from './dates'
import { round2, BELKA } from './money'
import type { CpiPoint } from './inflation'

/**
 * Polish retail treasury bonds (obligacje skarbowe detaliczne), nominal 100 zł.
 * Rules follow the issue letters (listy emisyjne) of the Ministry of Finance – see docs/SOURCES.md.
 *  - fixed: one fixed rate for the whole term (OTS, TOS)
 *  - cpi:   period 1 fixed, later periods = CPI y/y announced by GUS in the month before the period starts + margin (never < 0)
 *  - ref:   period 1 fixed, later = NBP reference rate (+ margin)
 * Values are estimates computed the way the issuer computes them (interest per bond rounded to grosze each period,
 * day-by-day accrual inside the running period); the official value is in the investor's account at PKO BP / Pekao.
 */
export type BondCode = 'OTS' | 'ROR' | 'DOR' | 'TOS' | 'COI' | 'EDO' | 'ROS' | 'ROD'
export const BOND_CODES: BondCode[] = ['OTS', 'ROR', 'DOR', 'TOS', 'COI', 'EDO', 'ROS', 'ROD']

export interface BondSpec {
  code: BondCode
  months: number
  index: 'fixed' | 'cpi' | 'ref'
  /** interest added to the capital each period (true) or paid out (false) */
  capitalized: boolean
  /** length of one interest period in months */
  periodMonths: number
  /** early redemption fee per bond (zł): [bought before 1 Sep 2024, bought from 1 Sep 2024] */
  earlyFee: [number, number]
  /**
   * cap of the fee at the interest accrued on the bond: 'always' (capitalized bonds), 'first-period' (COI and the
   * monthly-coupon ROR/DOR: the fee is capped only in the first period, later it is taken in full)
   */
  feeCap: 'always' | 'first-period'
  /** OTS: early redemption returns the paid-in amount, without interest */
  forfeitsInterest?: boolean
  /** only for families receiving the 800+ benefit (ROS, ROD) */
  family?: boolean
  earlyRedemption: boolean
}

/** Fees and rules: obligacjeskarbowe.pl (offer pages, "Wcześniejsze zakończenie oszczędzania"), checked 2026-11-20. */
export const BOND_SPECS: Record<BondCode, BondSpec> = {
  OTS: { code: 'OTS', months: 3, index: 'fixed', capitalized: true, periodMonths: 3, earlyFee: [0, 0], feeCap: 'always', forfeitsInterest: true, earlyRedemption: true },
  ROR: { code: 'ROR', months: 12, index: 'ref', capitalized: false, periodMonths: 1, earlyFee: [0.5, 0.5], feeCap: 'first-period', earlyRedemption: true },
  DOR: { code: 'DOR', months: 24, index: 'ref', capitalized: false, periodMonths: 1, earlyFee: [0.7, 0.7], feeCap: 'first-period', earlyRedemption: true },
  TOS: { code: 'TOS', months: 36, index: 'fixed', capitalized: true, periodMonths: 12, earlyFee: [0.7, 1], feeCap: 'always', earlyRedemption: true },
  COI: { code: 'COI', months: 48, index: 'cpi', capitalized: false, periodMonths: 12, earlyFee: [0.7, 2], feeCap: 'first-period', earlyRedemption: true },
  EDO: { code: 'EDO', months: 120, index: 'cpi', capitalized: true, periodMonths: 12, earlyFee: [2, 3], feeCap: 'always', earlyRedemption: true },
  ROS: { code: 'ROS', months: 72, index: 'cpi', capitalized: true, periodMonths: 12, earlyFee: [0.7, 2], feeCap: 'always', family: true, earlyRedemption: true },
  ROD: { code: 'ROD', months: 144, index: 'cpi', capitalized: true, periodMonths: 12, earlyFee: [2, 3], feeCap: 'always', family: true, earlyRedemption: true },
}

/** the fee table changed for bonds bought from 1 September 2024 */
export const FEE_CHANGE: ISODate = '2024-09-01'
export function earlyFeeFor(code: BondCode, purchase: ISODate): number {
  return BOND_SPECS[code].earlyFee[purchase >= FEE_CHANGE ? 1 : 0]
}

/** The terms of one issue (series): first-period rate and margin, both in percent. */
export interface BondTerms {
  code: BondCode
  firstRate: number
  margin: number
}

/** Series name: code + month and 2-digit year of maturity, e.g. EDO bought in May 2026 → EDO0536. */
export function seriesName(code: BondCode, purchase: ISODate): string {
  const end = addMonths(purchase, BOND_SPECS[code].months)
  return `${code}${end.slice(5, 7)}${end.slice(2, 4)}`
}

export interface RateAssumption {
  /** CPI y/y in percent used for periods whose index is not published yet */
  cpi: number
  /** NBP reference rate in percent for future periods */
  ref: number
}
export const DEFAULT_ASSUMPTION: RateAssumption = { cpi: 2.5, ref: 3.5 }

export interface Period {
  n: number
  start: ISODate
  end: ISODate
  /** annual rate in percent */
  rate: number
  source: 'fixed' | 'cpi' | 'ref' | 'assumed'
  /** month of the CPI reading used (index bonds) */
  cpiMonth?: string
  /** per bond: capital at the start of the period and the interest of the whole period (rounded to grosze) */
  base: number
  interest: number
}

/**
 * CPI month used for period n ≥ 2 of an index bond: the y/y CPI announced by GUS in the month before the period starts,
 * i.e. the reading for the month two months before the start (GUS publishes month M around the middle of month M+1).
 */
export function cpiMonthFor(periodStart: ISODate): string {
  return shiftMonth(monthOf(periodStart), -2)
}

export type RefRate = { from: ISODate; rate: number }

export function bondPeriods(terms: BondTerms, purchase: ISODate, cpi: readonly CpiPoint[] = [], refRates: readonly RefRate[] = [], assume: RateAssumption = DEFAULT_ASSUMPTION): Period[] {
  const spec = BOND_SPECS[terms.code]
  const cpiBy = new Map(cpi.map((p) => [p.month, p.yoy]))
  const refs = [...refRates].sort((a, b) => a.from.localeCompare(b.from))
  const out: Period[] = []
  let base = 100
  const count = spec.months / spec.periodMonths
  for (let n = 1; n <= count; n++) {
    const start = addMonths(purchase, (n - 1) * spec.periodMonths)
    const end = addMonths(purchase, n * spec.periodMonths)
    let rate = terms.firstRate
    let source: Period['source'] = 'fixed'
    let cpiMonth: string | undefined
    if (n > 1 && spec.index === 'cpi') {
      cpiMonth = cpiMonthFor(start)
      const v = cpiBy.get(cpiMonth)
      source = v === undefined ? 'assumed' : 'cpi'
      rate = Math.max(0, (v ?? assume.cpi) + terms.margin)
    } else if (n > 1 && spec.index === 'ref') {
      const known = refs.filter((r) => r.from <= start).at(-1)
      source = known ? 'ref' : 'assumed'
      rate = Math.max(0, (known?.rate ?? assume.ref) + terms.margin)
    }
    const interest = round2((base * rate * spec.periodMonths) / 1200)
    out.push({ n, start, end, rate: round2(rate), source, cpiMonth, base: round2(base), interest })
    if (spec.capitalized) base = round2(base + interest)
  }
  return out
}

export interface BondValuation {
  code: BondCode
  series: string
  count: number
  nominal: number
  /** interest already paid out (COI, ROR, DOR), before tax */
  paidOutGross: number
  /** value today: capital incl. capitalized interest + interest accrued in the running period */
  value: number
  /** interest contained in `value` (not yet taxed) */
  accruedInterest: number
  earlyFee: number
  taxIfRedeemed: number
  netIfRedeemed: number
  matured: boolean
  periods: Period[]
  current?: Period
  /** at maturity: capital + interest (capitalized) or nominal + all coupons (paid out), before / after tax */
  maturityGross: number
  maturityNet: number
  maturityDate: ISODate
  /** number of periods computed with assumed (not yet published) CPI / reference rate */
  assumedPeriods: number
}

/** Value of `count` bonds of one series bought on `purchase`, as of `asOf`. */
export function valueBond(terms: BondTerms, purchase: ISODate, count: number, asOf: ISODate, cpi: readonly CpiPoint[] = [], refRates: readonly RefRate[] = [], assume: RateAssumption = DEFAULT_ASSUMPTION): BondValuation {
  if (!Number.isInteger(count) || count < 0) throw new Error('bond count must be a whole number ≥ 0')
  const spec = BOND_SPECS[terms.code]
  const periods = bondPeriods(terms, purchase, cpi, refRates, assume)
  const last = periods[periods.length - 1]
  const matured = asOf >= last.end
  let paidOut = 0
  let capital = 100
  let accrued = 0
  let current: Period | undefined
  for (const p of periods) {
    if (asOf >= p.end) {
      if (spec.capitalized) capital = round2(p.base + p.interest)
      else paidOut += p.interest
      continue
    }
    if (asOf >= p.start) {
      current = p
      accrued = round2((p.interest * daysBetween(p.start, asOf)) / daysBetween(p.start, p.end))
    }
    break
  }
  const perBondValue = round2(capital + accrued)
  const perBondInterest = round2(perBondValue - 100)
  const feeRaw = earlyFeeFor(terms.code, purchase)
  const inFirstPeriod = !current || current.n === 1
  let fee = 0
  if (!matured && spec.earlyRedemption) {
    if (spec.forfeitsInterest) fee = Math.max(0, perBondInterest)
    else if (spec.feeCap === 'always' || inFirstPeriod) fee = Math.min(feeRaw, Math.max(0, perBondInterest))
    else fee = feeRaw
  }
  // tax at redemption: interest not taxed yet (coupons paid earlier were taxed when paid) minus the fee
  const taxPerBond = round2(Math.max(0, perBondInterest - fee) * BELKA)
  const maturityPerBond = spec.capitalized ? round2(last.base + last.interest) : round2(100 + periods.reduce((s, p) => s + p.interest, 0))
  const maturityTaxPerBond = spec.capitalized ? round2(Math.max(0, maturityPerBond - 100) * BELKA) : round2(periods.reduce((s, p) => s + round2(p.interest * BELKA), 0))
  return {
    code: terms.code,
    series: seriesName(terms.code, purchase),
    count,
    nominal: 100 * count,
    paidOutGross: round2(paidOut * count),
    value: round2(perBondValue * count),
    accruedInterest: round2(perBondInterest * count),
    earlyFee: round2(fee * count),
    taxIfRedeemed: round2(taxPerBond * count),
    netIfRedeemed: round2((perBondValue - fee - taxPerBond) * count),
    matured,
    periods,
    current,
    maturityGross: round2(maturityPerBond * count),
    maturityNet: round2((maturityPerBond - maturityTaxPerBond) * count),
    maturityDate: last.end,
    assumedPeriods: periods.filter((p) => p.source === 'assumed').length,
  }
}

/** Number of bonds bought for an amount (whole bonds of 100 zł; a remainder stays as cash). */
export function bondsFor(amount: number): number {
  return Math.floor(round2(amount) / 100)
}

/** Effective annual net return to maturity (after Belka) – for comparing a bond with a deposit or another bond. */
export function netAnnualToMaturity(v: BondValuation, purchase: ISODate): number {
  if (!v.count) return 0
  const years = daysBetween(purchase, v.maturityDate) / 365.25
  return Math.pow(v.maturityNet / v.nominal, 1 / years) - 1
}

import { describe, expect, it } from 'vitest'
import { BOND_SPECS, BOND_CODES, bondPeriods, bondsFor, cpiMonthFor, earlyFeeFor, netAnnualToMaturity, seriesName, valueBond, type BondTerms } from '@core/bonds'

const EDO: BondTerms = { code: 'EDO', firstRate: 5.6, margin: 2 }

describe('series names match the official offer (November 2026)', () => {
  it.each([
    ['OTS', 'OTS0227'],
    ['ROR', 'ROR1127'],
    ['DOR', 'DOR1128'],
    ['TOS', 'TOS1129'],
    ['COI', 'COI1130'],
    ['ROS', 'ROS1132'],
    ['EDO', 'EDO1136'],
    ['ROD', 'ROD1138'],
  ] as const)('%s bought 2026-11-15 → %s', (code, name) => {
    expect(seriesName(code, '2026-11-15')).toBe(name)
  })
  it('an EDO bought in May 2026 is EDO0536', () => expect(seriesName('EDO', '2026-05-12')).toBe('EDO0536'))
})

describe('rules', () => {
  it('each bond: term divisible into whole periods', () => {
    for (const c of BOND_CODES) expect(BOND_SPECS[c].months % BOND_SPECS[c].periodMonths).toBe(0)
  })
  it('the CPI used for a period is the reading from 2 months before its start (published the month before)', () => {
    expect(cpiMonthFor('2027-05-12')).toBe('2027-03')
    expect(cpiMonthFor('2027-01-05')).toBe('2026-11')
  })
  it('early redemption fees: new table for purchases from 1 Sep 2024', () => {
    expect(earlyFeeFor('EDO', '2024-08-31')).toBe(2)
    expect(earlyFeeFor('EDO', '2024-09-01')).toBe(3)
    expect(earlyFeeFor('COI', '2024-08-31')).toBe(0.7)
    expect(earlyFeeFor('COI', '2026-05-01')).toBe(2)
    expect(earlyFeeFor('TOS', '2026-05-01')).toBe(1)
    expect(earlyFeeFor('ROS', '2026-05-01')).toBe(2)
    expect(earlyFeeFor('ROD', '2026-05-01')).toBe(3)
    expect(earlyFeeFor('ROR', '2026-05-01')).toBe(0.5)
    expect(earlyFeeFor('DOR', '2026-05-01')).toBe(0.7)
    expect(earlyFeeFor('OTS', '2026-05-01')).toBe(0)
  })
  it('bondsFor: whole 100 zł bonds', () => {
    expect(bondsFor(1_234_500)).toBe(12_345)
    expect(bondsFor(199.99)).toBe(1)
    expect(bondsFor(99)).toBe(0)
  })
})

describe('EDO (10 years, capitalized, CPI + margin)', () => {
  const cpi = [
    { month: '2027-03', yoy: 3.0 },
    { month: '2028-03', yoy: -1.0 },
  ]
  const periods = bondPeriods(EDO, '2026-05-12', cpi, [], { cpi: 2.5, ref: 3.5 })
  it('year 1 fixed, year 2 = CPI(March) + margin, base grows by the capitalized interest', () => {
    expect(periods).toHaveLength(10)
    expect(periods[0]).toMatchObject({ n: 1, start: '2026-05-12', end: '2027-05-12', rate: 5.6, source: 'fixed', base: 100, interest: 5.6 })
    expect(periods[1]).toMatchObject({ n: 2, rate: 5, source: 'cpi', cpiMonth: '2027-03', base: 105.6, interest: 5.28 })
  })
  it('negative inflation: the rate is margin + CPI but never below 0 (here −1 + 2 = 1 %)', () => {
    expect(periods[2]).toMatchObject({ rate: 1, source: 'cpi', base: 110.88, interest: 1.11 })
  })
  it('unknown future CPI → assumption, and it is reported', () => {
    expect(periods[3].source).toBe('assumed')
    expect(periods[3].rate).toBe(4.5)
    const v = valueBond(EDO, '2026-05-12', 1, '2026-11-20', cpi)
    expect(v.assumedPeriods).toBe(7) // periods 2 and 3 known, 4–10 assumed
  })
  it('rate floor 0 when CPI + margin < 0', () => {
    const p = bondPeriods({ code: 'EDO', firstRate: 5, margin: 1 }, '2026-05-12', [{ month: '2027-03', yoy: -3 }])
    expect(p[1].rate).toBe(0)
    expect(p[1].interest).toBe(0)
  })
  it('value accrues day by day inside a period', () => {
    // 2026-05-12 → 2027-05-12 has 365 days; 192 days later: 5.60 × 192/365 = 2.95
    const v = valueBond(EDO, '2026-05-12', 2_500, '2026-11-20', cpi)
    expect(v.current?.n).toBe(1)
    expect(v.value).toBe(2_500 * 102.95)
    expect(v.accruedInterest).toBe(2_500 * 2.95)
    expect(v.nominal).toBe(250_000)
    expect(v.series).toBe('EDO0536')
  })
})

describe('fee cap and tax at early redemption', () => {
  it('EDO: interest 2.95 < 3 zł fee → fee = 2.95, nothing taxed, you get 100 zł back per bond', () => {
    const v = valueBond(EDO, '2026-05-12', 100, '2026-11-20')
    expect(v.earlyFee).toBe(295)
    expect(v.taxIfRedeemed).toBe(0)
    expect(v.netIfRedeemed).toBe(10_000)
  })
  it('EDO in year 2: fee 3 zł, 19 % of (interest − fee)', () => {
    const v = valueBond(EDO, '2026-05-12', 10, '2027-11-12', [{ month: '2027-03', yoy: 3 }])
    // capital 105.60 + accrued 5.28 × 184/366 (2027-05-12 → 2028-05-12 = 366 days) = 2.65 → 108.25
    expect(v.value).toBe(1082.5)
    expect(v.earlyFee).toBe(30)
    expect(v.taxIfRedeemed).toBe(10 * Math.round((8.25 - 3) * 0.19 * 100) / 100)
    expect(v.netIfRedeemed).toBe(1082.5 - 30 - v.taxIfRedeemed)
  })
  it('COI from year 2: the 2 zł fee is taken in full even above the accrued interest', () => {
    const coi: BondTerms = { code: 'COI', firstRate: 4.75, margin: 1.5 }
    const v = valueBond(coi, '2026-11-15', 1, '2027-11-20', [{ month: '2027-09', yoy: 3 }])
    expect(v.current?.n).toBe(2)
    expect(v.paidOutGross).toBe(4.75)
    expect(v.accruedInterest).toBeLessThan(2)
    expect(v.earlyFee).toBe(2)
    expect(v.netIfRedeemed).toBeLessThan(100)
  })
  it('COI in year 1: fee capped at the interest', () => {
    const v = valueBond({ code: 'COI', firstRate: 4.75, margin: 1.5 }, '2026-11-15', 1, '2026-12-15')
    expect(v.earlyFee).toBe(v.accruedInterest)
  })
  it('OTS: early redemption returns the paid-in money without interest', () => {
    const v = valueBond({ code: 'OTS', firstRate: 2, margin: 0 }, '2026-11-15', 50, '2027-01-15')
    expect(v.earlyFee).toBe(v.accruedInterest)
    expect(v.netIfRedeemed).toBe(5000)
  })
  it('at maturity: no fee, value = maturity value; Belka on the whole gain', () => {
    const v = valueBond({ code: 'TOS', firstRate: 4.4, margin: 0 }, '2026-11-15', 10, '2029-11-15')
    expect(v.matured).toBe(true)
    expect(v.earlyFee).toBe(0)
    // 100 → 104.40 → 108.99 → 113.79 (interest rounded each year)
    expect(v.maturityGross).toBe(1137.9)
    expect(v.value).toBe(1137.9)
    expect(v.maturityNet).toBe(10 * (113.79 - Math.round(13.79 * 0.19 * 100) / 100))
  })
  it('paid-out bonds: maturity = nominal + all coupons, each coupon taxed', () => {
    const v = valueBond({ code: 'COI', firstRate: 4.75, margin: 1.5 }, '2026-11-15', 1, '2026-11-20', [], [], { cpi: 2.5, ref: 3.5 })
    expect(v.maturityGross).toBe(100 + 4.75 + 4 * 0 + 3 * 4)
    expect(v.maturityNet).toBeCloseTo(100 + (4.75 - 0.9) + 3 * (4 - 0.76), 2)
  })
})

describe('reference-rate bonds (ROR, DOR)', () => {
  it('monthly coupons follow the NBP reference rate known at the start of each month', () => {
    const p = bondPeriods({ code: 'DOR', firstRate: 4.15, margin: 0.15 }, '2026-11-15', [], [
      { from: '2026-03-05', rate: 3.75 },
      { from: '2027-02-10', rate: 3.5 },
    ])
    expect(p).toHaveLength(24)
    expect(p[0]).toMatchObject({ rate: 4.15, source: 'fixed', interest: 0.35 })
    expect(p[1]).toMatchObject({ rate: 3.9, source: 'ref' })
    expect(p[3].rate).toBe(3.65) // starts 2027-02-15, after the cut on 2027-02-10
  })
  it('no known rate → assumption', () => {
    const p = bondPeriods({ code: 'ROR', firstRate: 4, margin: 0 }, '2026-11-15', [], [], { cpi: 2, ref: 3 })
    expect(p[1]).toMatchObject({ source: 'assumed', rate: 3 })
  })
})

describe('validation and helpers', () => {
  it('count must be a whole number ≥ 0', () => {
    expect(() => valueBond(EDO, '2026-05-12', 1.5, '2026-11-20')).toThrow()
    expect(() => valueBond(EDO, '2026-05-12', -1, '2026-11-20')).toThrow()
  })
  it('before purchase: nothing accrued', () => {
    const v = valueBond(EDO, '2026-05-12', 1, '2026-05-01')
    expect(v.value).toBe(100)
    expect(v.current).toBeUndefined()
  })
  it('net annual return to maturity is between 0 and the gross rate', () => {
    const v = valueBond({ code: 'TOS', firstRate: 4.4, margin: 0 }, '2026-11-15', 10, '2026-11-20')
    const r = netAnnualToMaturity(v, '2026-11-15')
    expect(r).toBeGreaterThan(0.035)
    expect(r).toBeLessThan(0.044)
    expect(netAnnualToMaturity(valueBond(EDO, '2026-05-12', 0, '2026-11-20'), '2026-05-12')).toBe(0)
  })
})

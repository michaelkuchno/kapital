import { describe, expect, it } from 'vitest'
import { valueDeposit, depositNetInterest } from '@core/deposits'
import { valuePosition, yearTax, taxSavedByRealizingLoss } from '@core/stocks'

describe('deposits (interest = capital × rate × days / 365, Belka at payment)', () => {
  const d = { amount: 60_000, rate: 6, start: '2026-09-20', months: 3 }
  it('a 3-month promotional deposit, hand-computed', () => {
    // 2026-09-20 → 2026-12-20 = 91 days: 60 000 × 6 % × 91/365 = 897.53; tax 170.53; net 727.00
    const v = valueDeposit(d, '2026-11-20')
    expect(v.end).toBe('2026-12-20')
    expect(v.daysLeft).toBe(30)
    expect(v.interestGross).toBe(897.53)
    expect(v.interestNet).toBe(727)
    expect(v.endValueNet).toBe(60_727)
    expect(v.matured).toBe(false)
  })
  it('breaking it early: the bank returns the capital only (no interest for the running period)', () => {
    const v = valueDeposit(d, '2026-11-20')
    expect(v.breakValue).toBe(60_000)
    // accrued 61 days: 60 000 × 6 % × 61/365 = 601.64 → tax 114.31 → net 487.33
    expect(v.accruedGross).toBe(601.64)
    expect(v.valueNet).toBe(60_487.33)
  })
  it('after the end: matured, value = end value', () => {
    const v = valueDeposit(d, '2027-01-10')
    expect(v.matured).toBe(true)
    expect(v.daysLeft).toBe(0)
    expect(v.breakValue).toBe(60_727)
    expect(v.valueNet).toBe(60_727)
  })
  it('monthly capitalization compounds net interest and keeps credited interest when broken', () => {
    const m = valueDeposit({ ...d, months: 12, capMonths: 1 }, '2026-12-25')
    const once = valueDeposit({ ...d, months: 12 }, '2026-12-25')
    expect(m.interestNet).toBeGreaterThan(once.interestNet)
    expect(m.breakValue).toBeGreaterThan(60_000) // three months already credited
  })
  it('validation and the helper', () => {
    expect(() => valueDeposit({ ...d, amount: -1 }, '2026-11-20')).toThrow()
    expect(() => valueDeposit({ ...d, months: 0 }, '2026-11-20')).toThrow()
    expect(depositNetInterest(10_000, 5, 365)).toBe(405)
  })
  it('before the start nothing is accrued', () => {
    const v = valueDeposit(d, '2026-09-01')
    expect(v.accruedGross).toBe(0)
    expect(v.valueNet).toBe(60_000)
  })
})

describe('shares', () => {
  it('a position at −50 %: needs +100 % to break even, no tax when sold at a loss', () => {
    const v = valuePosition({ name: 'SNTVERSE', quantity: 10_000, cost: 53_400, price: 2.67 })
    expect(v.value).toBe(26_700)
    expect(v.gain).toBe(-26_700)
    expect(v.gainPct).toBeCloseTo(-0.5, 4)
    expect(v.neededToBreakEven).toBeCloseTo(1, 4)
    expect(v.taxIfSold).toBe(0)
    expect(v.netIfSold).toBe(26_700)
    expect(v.breakEvenPrice).toBe(5.34)
  })
  it('a gain: 19 % tax if sold; the selling fee lowers the gain', () => {
    const v = valuePosition({ name: 'SKARBIEC', quantity: 2000, cost: 60_000, price: 36.4 }, 0.0039)
    expect(v.value).toBe(72_800)
    expect(v.gain).toBeCloseTo(72_800 - 283.92 - 60_000, 2)
    expect(v.taxIfSold).toBe(Math.round(v.gain * 19) / 100)
  })
  it('zero quantity and invalid input', () => {
    expect(valuePosition({ name: 'X', quantity: 0, cost: 0, price: 1 })).toMatchObject({ value: 0, gainPct: 0, breakEvenPrice: 0, neededToBreakEven: 0 })
    expect(() => valuePosition({ name: 'X', quantity: -1, cost: 1, price: 1 })).toThrow()
  })
  it('PIT-38: gains and losses of the year are netted; base and tax rounded to full złoty', () => {
    expect(yearTax([12_800.4, -5_000])).toEqual({ result: 7_800.4, lossUsed: 0, tax: Math.round(7800 * 0.19) })
    expect(yearTax([1000, -3000])).toEqual({ result: -2000, lossUsed: 0, tax: 0 })
    expect(yearTax([10_000], 4_000)).toEqual({ result: 10_000, lossUsed: 4_000, tax: 1140 })
    expect(yearTax([1_000], 4_000).tax).toBe(0)
  })
  it('realizing a loss saves 19 % of the gains it offsets (same tax year, shares only)', () => {
    expect(taxSavedByRealizingLoss(12_800, -90_000)).toBe(2432)
    expect(taxSavedByRealizingLoss(100_000, -90_000)).toBe(17_100)
    expect(taxSavedByRealizingLoss(0, -90_000)).toBe(0)
    expect(taxSavedByRealizingLoss(5000, 100)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { round2, belkaTax, afterTax, sum, clamp, share, BELKA } from '@core/money'
import { parseISO, toISO, today, daysBetween, addDays, addMonths, addYears, monthOf, shiftMonth, yearFraction, isWeekend } from '@core/dates'
import { realReturn, cumulativeInflation, purchasingPower, latestCpi, cpiMap } from '@core/inflation'

describe('money', () => {
  it('rounds to grosze half up, without float noise', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(1.004)).toBe(1)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(1234567.125)).toBe(1234567.13)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(0)).toBe(0)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(Number.NaN)).toBeNaN()
    expect(round2(Infinity)).toBe(Infinity)
  })
  it('Belka tax is 19 % of positive gains only, rounded to grosze', () => {
    expect(BELKA).toBe(0.19)
    expect(belkaTax(100)).toBe(19)
    expect(belkaTax(1495.89)).toBe(284.22)
    expect(belkaTax(0)).toBe(0)
    expect(belkaTax(-50)).toBe(0)
    expect(afterTax(100)).toBe(81)
    expect(afterTax(-10)).toBe(-10)
  })
  it('sum, clamp, share', () => {
    expect(sum([1, 2, 3.5])).toBe(6.5)
    expect(sum([])).toBe(0)
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
    expect(share(25, 100)).toBe(0.25)
    expect(share(5, 0)).toBe(0)
  })
})

describe('dates', () => {
  it('parses only real calendar dates', () => {
    expect(toISO(parseISO('2026-05-15'))).toBe('2026-05-15')
    expect(() => parseISO('2026-02-30')).toThrow()
    expect(() => parseISO('2026-13-01')).toThrow()
    expect(() => parseISO('15.05.2026')).toThrow()
    expect(toISO(parseISO('2024-02-29'))).toBe('2024-02-29')
    expect(() => parseISO('2025-02-29')).toThrow()
  })
  it('adds months with end-of-month clamping and across years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-05-15', 120)).toBe('2036-05-15')
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts days, months and weekends', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366)
    expect(daysBetween('2026-05-10', '2026-05-01')).toBe(-9)
    expect(monthOf('2026-11-20')).toBe('2026-11')
    expect(shiftMonth('2026-01', -2)).toBe('2025-11')
    expect(shiftMonth('2026-11', 14)).toBe('2028-01')
    expect(yearFraction('2026-01-01', '2027-01-01')).toBeCloseTo(365 / 365.25, 10)
    expect(isWeekend('2026-11-21')).toBe(true) // Saturday
    expect(isWeekend('2026-11-22')).toBe(true)
    expect(isWeekend('2026-11-20')).toBe(false)
    expect(today(Date.UTC(2026, 10, 20, 12))).toBe('2026-11-20')
  })
})

describe('inflation', () => {
  const cpi = [
    { month: '2025-10', yoy: 2.8 },
    { month: '2024-10', yoy: 5.0 },
    { month: '2023-10', yoy: 6.6 },
  ]
  it('real return (Fisher)', () => {
    expect(realReturn(0.05, 0.05)).toBeCloseTo(0, 12)
    expect(realReturn(0.06, 0.03)).toBeCloseTo(0.029126, 6)
    expect(realReturn(0, 0.04)).toBeCloseTo(-0.038462, 6)
  })
  it('cumulative inflation over whole years, null when data is missing', () => {
    expect(cumulativeInflation(cpi, '2023-10', 2)).toBeCloseTo(1.05 * 1.028 - 1, 12)
    expect(cumulativeInflation(cpi, '2025-10', 1)).toBeNull()
  })
  it('purchasing power and latest point', () => {
    expect(purchasingPower(100_000, 0.03, 10)).toBeCloseTo(74_409.39, 2)
    expect(latestCpi(cpi)?.month).toBe('2025-10')
    expect(latestCpi([])).toBeUndefined()
    expect(cpiMap(cpi).get('2024-10')).toBe(5)
  })
})

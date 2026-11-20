import { shiftMonth } from './dates'

/** Monthly CPI, year-on-year, in percent (e.g. 4.9 means prices +4.9 % vs the same month a year earlier). */
export interface CpiPoint {
  month: string // YYYY-MM
  yoy: number
}

export function cpiMap(series: readonly CpiPoint[]): Map<string, number> {
  return new Map(series.map((p) => [p.month, p.yoy]))
}

/** Latest available CPI point (by month). */
export function latestCpi(series: readonly CpiPoint[]): CpiPoint | undefined {
  return [...series].sort((a, b) => a.month.localeCompare(b.month)).at(-1)
}

/** Real return (Fisher): (1 + nominal) / (1 + inflation) − 1, all as fractions. */
export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1
}

/** Cumulative price growth between two months using y/y values month by month is not exact; use 12-month chunks. */
export function cumulativeInflation(series: readonly CpiPoint[], fromMonth: string, years: number): number | null {
  const m = cpiMap(series)
  let f = 1
  for (let k = 1; k <= years; k++) {
    const v = m.get(shiftMonth(fromMonth, 12 * k))
    if (v === undefined) return null
    f *= 1 + v / 100
  }
  return f - 1
}

/** Purchasing power of `amount` after `years` at a constant annual inflation (fraction). */
export function purchasingPower(amount: number, inflation: number, years: number): number {
  return amount / Math.pow(1 + inflation, years)
}

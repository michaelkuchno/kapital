/** Goal arithmetic in today's money (real terms). Rates are fractions per year. */

/** Future value of a starting amount plus monthly savings. */
export function futureValue(start: number, monthly: number, years: number, rate: number): number {
  const n = Math.round(years * 12)
  const r = Math.pow(1 + rate, 1 / 12) - 1
  if (Math.abs(r) < 1e-12) return start + monthly * n
  const g = Math.pow(1 + r, n)
  return start * g + monthly * ((g - 1) / r)
}

/** Monthly saving needed to reach `target` in `years` from `start` at a yearly rate. 0 when already reached. */
export function requiredMonthly(target: number, start: number, years: number, rate: number): number {
  const n = Math.round(years * 12)
  if (n <= 0) return Math.max(0, target - start)
  const r = Math.pow(1 + rate, 1 / 12) - 1
  const g = Math.pow(1 + r, n)
  const gap = target - start * g
  if (gap <= 0) return 0
  return Math.abs(r) < 1e-12 ? gap / n : gap / ((g - 1) / r)
}

/** Years until `target` is reached with monthly savings (Infinity when it never is). */
export function yearsToGoal(target: number, start: number, monthly: number, rate: number, maxYears = 100): number {
  if (start >= target) return 0
  for (let m = 1; m <= maxYears * 12; m++) if (futureValue(start, monthly, m / 12, rate) >= target) return m / 12
  return Infinity
}

/** "Rule of 72": years to double the money at a yearly rate (exact formula, not the approximation). */
export function doublingYears(rate: number): number {
  return rate > 0 ? Math.log(2) / Math.log(1 + rate) : Infinity
}

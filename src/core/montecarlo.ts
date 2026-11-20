/**
 * Monte Carlo projection of a portfolio in yearly steps.
 * Inflation follows a mean-reverting AR(1) process estimated from the CPI history; asset classes get yearly returns
 * that depend on that year's inflation:
 *  - inflation bonds: CPI + margin (never below 0)          - deposits / cash: CPI + spread (historically ≈ 0 or below in PL)
 *  - fixed bonds: fixed nominal rate                         - equities: CPI + real equity premium + normal shock (fat tails ignored)
 * All randomness comes from a seeded generator, so a projection is reproducible (and testable).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** standard normal via Box–Muller */
export function normal(rng: () => number): number {
  let u = 0
  while (u === 0) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface Ar1 {
  mean: number
  phi: number
  sigma: number
}

/** Fit x_t = μ + φ (x_{t−1} − μ) + ε by least squares on a yearly series (percent values). */
export function fitAr1(xs: readonly number[]): Ar1 {
  if (xs.length < 4) return { mean: 2.5, phi: 0.6, sigma: 1.5 }
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length
  let num = 0
  let den = 0
  for (let i = 1; i < xs.length; i++) {
    num += (xs[i] - mu) * (xs[i - 1] - mu)
    den += (xs[i - 1] - mu) ** 2
  }
  const phi = den ? Math.max(-0.95, Math.min(0.95, num / den)) : 0
  let ss = 0
  for (let i = 1; i < xs.length; i++) ss += (xs[i] - mu - phi * (xs[i - 1] - mu)) ** 2
  return { mean: mu, phi, sigma: Math.sqrt(ss / Math.max(1, xs.length - 2)) }
}

export interface ClassParams {
  /** inflation-indexed bonds: margin over CPI, % */
  inflationMargin: number
  /** fixed bonds: nominal rate, % */
  fixedRate: number
  /** deposits & cash: spread over CPI, % (negative = loses to inflation) */
  depositSpread: number
  /** equities: expected real return, % per year, and volatility, % */
  equityReal: number
  equityVol: number
}

/** Long-run assumptions with sources in docs/SOURCES.md (DMS Global Investment Returns Yearbook; NBP/GUS data). */
export const DEFAULT_PARAMS: ClassParams = { inflationMargin: 1.5, fixedRate: 5.0, depositSpread: -0.5, equityReal: 4.5, equityVol: 22 }

export interface ProjectionInput {
  start: { inflationBonds: number; fixedBonds: number; deposits: number; equities: number }
  /** yearly contribution, split like the target allocation */
  contribution: number
  contributionSplit?: { inflationBonds: number; fixedBonds: number; deposits: number; equities: number }
  years: number
  cpi: Ar1
  cpiStart: number
  params?: ClassParams
  paths?: number
  seed?: number
  /** Belka on yearly gains of deposits/cash; bonds and equities are taxed at the end (simplification) */
  tax?: boolean
}

export interface ProjectionYear {
  year: number
  p10: number
  p50: number
  p90: number
  /** median in today's money */
  real50: number
}

export function project(inp: ProjectionInput): { years: ProjectionYear[]; probLoseReal: number; finalReal: number[] } {
  const p = inp.params ?? DEFAULT_PARAMS
  const n = inp.paths ?? 2000
  const rng = mulberry32(inp.seed ?? 42)
  const split = inp.contributionSplit ?? normalise(inp.start)
  const totals: number[][] = Array.from({ length: inp.years + 1 }, () => [])
  const reals: number[][] = Array.from({ length: inp.years + 1 }, () => [])
  const startTotal = inp.start.inflationBonds + inp.start.fixedBonds + inp.start.deposits + inp.start.equities
  const finalReal: number[] = []
  for (let k = 0; k < n; k++) {
    let { inflationBonds: ib, fixedBonds: fb, deposits: dep, equities: eq } = inp.start
    let cpi = inp.cpiStart
    let price = 1
    totals[0].push(startTotal)
    reals[0].push(startTotal)
    for (let y = 1; y <= inp.years; y++) {
      cpi = inp.cpi.mean + inp.cpi.phi * (cpi - inp.cpi.mean) + inp.cpi.sigma * normal(rng)
      const c = cpi / 100
      price *= 1 + c
      ib *= 1 + Math.max(0, c + p.inflationMargin / 100)
      fb *= 1 + p.fixedRate / 100
      const depRate = Math.max(0, c + p.depositSpread / 100)
      dep *= 1 + depRate * (inp.tax === false ? 1 : 0.81)
      eq *= Math.exp(Math.log(1 + c) + (p.equityReal - (p.equityVol * p.equityVol) / 200) / 100 + (p.equityVol / 100) * normal(rng))
      ib += inp.contribution * split.inflationBonds
      fb += inp.contribution * split.fixedBonds
      dep += inp.contribution * split.deposits
      eq += inp.contribution * split.equities
      const tot = ib + fb + dep + eq
      totals[y].push(tot)
      reals[y].push(tot / price)
    }
    finalReal.push(reals[inp.years][k])
  }
  const invested = startTotal + inp.contribution * inp.years
  const years = totals.map((xs, y) => ({ year: y, p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), real50: quantile(reals[y], 0.5) }))
  return { years, probLoseReal: finalReal.filter((x) => x < invested).length / n, finalReal }
}

function normalise(s: ProjectionInput['start']) {
  const t = s.inflationBonds + s.fixedBonds + s.deposits + s.equities || 1
  return { inflationBonds: s.inflationBonds / t, fixedBonds: s.fixedBonds / t, deposits: s.deposits / t, equities: s.equities / t }
}

export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

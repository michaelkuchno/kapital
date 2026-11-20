import { describe, expect, it } from 'vitest'
import { mulberry32, normal, fitAr1, project, quantile, DEFAULT_PARAMS } from '@core/montecarlo'
import { futureValue, requiredMonthly, yearsToGoal, doublingYears } from '@core/goals'

describe('random numbers (seeded, reproducible)', () => {
  it('same seed → same sequence; values in [0, 1)', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(mulberry32(8)()).not.toBe(xs[0])
  })
  it('normal draws have mean ≈ 0 and sd ≈ 1', () => {
    const r = mulberry32(1)
    const xs = Array.from({ length: 40_000 }, () => normal(r))
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length)
    expect(Math.abs(m)).toBeLessThan(0.02)
    expect(Math.abs(sd - 1)).toBeLessThan(0.02)
  })
  it('quantiles interpolate', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([5, 1, 3], 0)).toBe(1)
    expect(quantile([], 0.5)).toBeNaN()
  })
})

describe('inflation model AR(1)', () => {
  it('recovers the parameters of a simulated process', () => {
    const r = mulberry32(3)
    const xs = [3]
    for (let i = 1; i < 5000; i++) xs.push(3 + 0.7 * (xs[i - 1] - 3) + 1.2 * normal(r))
    const f = fitAr1(xs)
    expect(f.mean).toBeCloseTo(3, 0)
    expect(f.phi).toBeCloseTo(0.7, 1)
    expect(f.sigma).toBeCloseTo(1.2, 1)
  })
  it('too little data → sensible defaults; φ is kept stationary', () => {
    expect(fitAr1([1, 2])).toEqual({ mean: 2.5, phi: 0.6, sigma: 1.5 })
    expect(Math.abs(fitAr1([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).phi)).toBeLessThanOrEqual(0.95)
    expect(fitAr1([2, 2, 2, 2, 2]).phi).toBe(0)
  })
})

describe('portfolio projection', () => {
  const base = { start: { inflationBonds: 250_000, fixedBonds: 0, deposits: 60_000, equities: 45_000 }, contribution: 0, years: 10, cpi: { mean: 3, phi: 0.6, sigma: 1.5 }, cpiStart: 3.5, paths: 1500 }
  it('is reproducible with the same seed', () => {
    expect(project({ ...base, seed: 5 }).years).toEqual(project({ ...base, seed: 5 }).years)
  })
  it('percentiles are ordered every year; year 0 = today', () => {
    const p = project(base)
    expect(p.years).toHaveLength(11)
    expect(p.years[0].p50).toBe(355_000)
    for (const y of p.years) expect(y.p10).toBeLessThanOrEqual(y.p50 + 1e-6)
    for (const y of p.years) expect(y.p50).toBeLessThanOrEqual(y.p90 + 1e-6)
  })
  it('without risk the result equals deterministic compounding', () => {
    const p = project({ start: { inflationBonds: 100, fixedBonds: 100, deposits: 100, equities: 0 }, contribution: 0, years: 3, cpi: { mean: 4, phi: 0, sigma: 0 }, cpiStart: 4, paths: 10, params: { ...DEFAULT_PARAMS, equityVol: 0 }, tax: false })
    const ib = 100 * 1.055 ** 3
    const fb = 100 * 1.05 ** 3
    const dep = 100 * 1.035 ** 3
    expect(p.years[3].p50).toBeCloseTo(ib + fb + dep, 6)
    expect(p.years[3].real50).toBeCloseTo((ib + fb + dep) / 1.04 ** 3, 6)
  })
  it('contributions are added each year; inflation bonds keep real value (probability of losing purchasing power is low)', () => {
    const withC = project({ ...base, contribution: 50_000 })
    const noC = project(base)
    expect(withC.years[10].p50).toBeGreaterThan(noC.years[10].p50 + 400_000)
    const ib = project({ ...base, start: { inflationBonds: 1_000_000, fixedBonds: 0, deposits: 0, equities: 0 } })
    expect(ib.probLoseReal).toBeLessThan(0.05)
  })
  it('deposits below inflation lose purchasing power in most paths', () => {
    const dep = project({ ...base, start: { inflationBonds: 0, fixedBonds: 0, deposits: 100_000, equities: 0 } })
    expect(dep.probLoseReal).toBeGreaterThan(0.7)
  })
})

describe('goals', () => {
  it('future value and required saving are inverse to each other', () => {
    const m = requiredMonthly(1_000_000, 100_000, 15, 0.04)
    expect(futureValue(100_000, m, 15, 0.04)).toBeCloseTo(1_000_000, 4)
  })
  it('zero rate: plain sums', () => {
    expect(futureValue(1000, 100, 1, 0)).toBe(2200)
    expect(requiredMonthly(2200, 1000, 1, 0)).toBeCloseTo(100, 10)
  })
  it('already reached / no time left', () => {
    expect(requiredMonthly(100, 200, 5, 0.03)).toBe(0)
    expect(requiredMonthly(300, 200, 0, 0.03)).toBe(100)
    expect(yearsToGoal(100, 200, 0, 0.03)).toBe(0)
  })
  it('years to a goal and doubling time', () => {
    expect(yearsToGoal(2000, 1000, 0, 0.07)).toBeCloseTo(doublingYears(0.07), 0)
    expect(yearsToGoal(1e9, 0, 0, 0.05)).toBe(Infinity)
    expect(doublingYears(0.072)).toBeCloseTo(9.97, 2)
    expect(doublingYears(0)).toBe(Infinity)
  })
})

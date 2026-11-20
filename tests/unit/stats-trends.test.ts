import { describe, expect, it } from 'vitest'
import { assertSeries, returns, logReturns, mean, stdev, volatility, totalReturn, cagr, trailingReturn, drawdown, sma, ema, rsi, align, betaCorr, sharpe, relative, type Bar } from '@core/stats'
import { analyzeTrend, rankSectors } from '@core/trends'

/** business-day series from closes */
function series(closes: number[], start = '2024-01-01'): Bar[] {
  const out: Bar[] = []
  let t = Date.parse(start + 'T00:00:00Z')
  for (const c of closes) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000
    out.push({ date: new Date(t).toISOString().slice(0, 10), close: c })
    t += 86_400_000
  }
  return out
}
const line = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step)

describe('basic statistics', () => {
  const s = series([100, 110, 99, 120])
  it('returns and log returns', () => {
    expect(returns(s)).toEqual([0.1, -0.1, 120 / 99 - 1].map((x) => expect.closeTo(x, 12) as unknown as number))
    expect(logReturns(s)[0]).toBeCloseTo(Math.log(1.1), 12)
  })
  it('mean and sample standard deviation', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(mean([])).toBeNaN()
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5)
    expect(stdev([1])).toBeNaN()
  })
  it('total return, trailing return with skip, CAGR', () => {
    expect(totalReturn(s)).toBeCloseTo(0.2, 12)
    expect(totalReturn(series([5]))).toBe(0)
    expect(trailingReturn(s, 2)).toBeCloseTo(120 / 110 - 1, 12)
    expect(trailingReturn(s, 2, 1)).toBeCloseTo(99 / 100 - 1, 12)
    expect(trailingReturn(s, 10)).toBeNull()
    const y = [{ date: '2020-01-01', close: 100 }, { date: '2022-01-01', close: 121 }]
    expect(cagr(y)).toBeCloseTo(0.1, 3)
    expect(cagr(series([1]))).toBe(0)
  })
  it('volatility of a constant-growth series is 0; of an alternating series > 0', () => {
    expect(volatility(series(line(30, 100, 0).map((_, i) => 100 * 1.01 ** i)))).toBeCloseTo(0, 10)
    expect(volatility(series([100, 101, 100, 101, 100, 101]))).toBeGreaterThan(0.1)
  })
  it('drawdown: max fall from a peak and the current one', () => {
    const d = drawdown(series([100, 120, 90, 110, 60, 80]))
    expect(d.maxDrawdown).toBeCloseTo(-0.5, 12)
    expect(d.peakDate).toBe('2024-01-02')
    expect(d.troughDate).toBe('2024-01-05')
    expect(d.current).toBeCloseTo(80 / 120 - 1, 12)
  })
  it('moving averages and RSI', () => {
    expect(sma(series([1, 2, 3, 4, 5]), 3)).toEqual([null, null, 2, 3, 4])
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    expect(rsi(series(line(20, 10, 1)))).toBe(100)
    expect(rsi(series(line(20, 30, -1)))).toBe(0)
    expect(rsi(series([1, 2]))).toBeNull()
    const r = rsi(series([10, 11, 10.5, 11.5, 11, 12, 11.4, 12.5, 12, 13, 12.2, 13.4, 12.8, 13.9, 13, 14]))
    expect(r).toBeGreaterThan(50)
    expect(r).toBeLessThan(100)
  })
  it('alignment, beta and correlation, relative strength, Sharpe', () => {
    const a = series([100, 102, 101, 105, 104, 108])
    const b = series([100, 101, 100.5, 102.5, 102, 104])
    const [aa, bb] = align(a, b.slice(1))
    expect(aa).toHaveLength(5)
    expect(bb[0].date).toBe(aa[0].date)
    expect(betaCorr(a, a)).toEqual({ beta: expect.closeTo(1, 12), corr: expect.closeTo(1, 12) })
    expect(betaCorr(a, series([1, 2])).beta).toBeNaN()
    expect(relative(a, a).every((x) => x.close === 1)).toBe(true)
    expect(Number.isFinite(sharpe(a, 0.04))).toBe(true)
  })
  it('validates series', () => {
    expect(() => assertSeries([{ date: '2024-01-02', close: 1 }, { date: '2024-01-01', close: 1 }])).toThrow()
    expect(() => assertSeries([{ date: '2024-01-02', close: 0 }])).toThrow()
    expect(() => assertSeries(series([1, 2, 3]))).not.toThrow()
  })
})

describe('trend detection', () => {
  // 300 sessions rising, then 120 falling → the 50-day average crosses below the 200-day one (death cross)
  const upDown = series([...line(300, 100, 0.5), ...line(120, 249.5, -1.5)])
  it('a long rise is an up-trend with positive momentum', () => {
    const r = analyzeTrend(series(line(300, 100, 0.5)))
    expect(r.state).toBe('up')
    expect(r.mom12_1).toBeGreaterThan(0)
    expect(r.ret12m).toBeGreaterThan(0)
    expect(r.vs200).toBeGreaterThan(0)
    expect(r.score).not.toBeNull()
  })
  it('after the fall the trend is down and the death cross is found with its date', () => {
    const full = analyzeTrend(upDown, undefined, 400)
    const dc = full.events.find((e) => e.kind === 'death-cross')
    expect(dc).toBeDefined()
    expect(full.events.some((e) => e.kind === 'below-200')).toBe(true)
    expect(analyzeTrend(upDown).state).toBe('down')
    // the event lies in the falling part
    expect(dc!.date > upDown[300].date).toBe(true)
  })
  it('a recovery produces a golden cross and the price rising above the 200-day average', () => {
    const s = series([...line(260, 200, -0.4), ...line(160, 96, 1.2)])
    const r = analyzeTrend(s, undefined, 420)
    expect(r.events.some((e) => e.kind === 'golden-cross')).toBe(true)
    expect(r.events.some((e) => e.kind === 'above-200')).toBe(true)
    expect(r.events.some((e) => e.kind === 'momentum-positive')).toBe(true)
    // newest first
    for (let i = 1; i < r.events.length; i++) expect(r.events[i - 1].date >= r.events[i].date).toBe(true)
  })
  it('only events inside the look-back window are reported', () => {
    expect(analyzeTrend(upDown, undefined, 5).events.every((e) => e.date >= upDown[upDown.length - 5].date)).toBe(true)
  })
  it('short history: state unknown, score null; empty series throws', () => {
    const r = analyzeTrend(series(line(30, 10, 0.1)))
    expect(r.state).toBe('unknown')
    expect(r.score).toBeNull()
    expect(r.sma200).toBeNull()
    expect(() => analyzeTrend([])).toThrow()
  })
  it('relative strength against the market', () => {
    const market = series(line(300, 100, 0.1))
    const strong = series(line(300, 100, 0.6))
    expect(analyzeTrend(strong, market).rs3m).toBeGreaterThan(0)
    expect(analyzeTrend(market, strong).rs3m).toBeLessThan(0)
  })
  it('sideways when price and averages disagree', () => {
    const s = series([...line(280, 100, 0.5), ...line(20, 239.5, -3.5)])
    expect(analyzeTrend(s).state).toBe('sideways')
  })
  it('ranks sectors strongest first, sectors without history last', () => {
    const r = rankSectors([
      { code: 'B', report: { ...analyzeTrend(series(line(300, 100, 0.1))) } },
      { code: 'A', report: { ...analyzeTrend(series(line(300, 100, 0.6))) } },
      { code: 'C', report: { ...analyzeTrend(series(line(20, 100, 1))) } },
    ])
    expect(r.map((x) => x.code)).toEqual(['A', 'B', 'C'])
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3])
  })
})

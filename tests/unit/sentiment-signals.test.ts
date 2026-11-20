import { describe, expect, it } from 'vitest'
import { mood, percentileRank, scoreSeries, distanceFromAverage, rollingReturn, rollingVol, spread, combine, plSentiment, worldSentiment, breadth, type Series } from '@core/sentiment'
import { classify, signalHistory, signalReport, backtestTrend, ret12 } from '@core/signals'
import type { Bar } from '@core/stats'

function bars(closes: number[], start = '2023-01-02'): Bar[] {
  const out: Bar[] = []
  let t = Date.parse(start + 'T00:00:00Z')
  for (const c of closes) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000
    out.push({ date: new Date(t).toISOString().slice(0, 10), close: c })
    t += 86_400_000
  }
  return out
}
const series = (vals: number[]): Series => bars(vals).map((b) => ({ date: b.date, value: b.close }))
const wave = (n: number, base = 100, amp = 10, period = 120) => Array.from({ length: n }, (_, i) => base + amp * Math.sin((2 * Math.PI * i) / period))

describe('sentiment building blocks', () => {
  it('mood bands', () => {
    expect([0, 24.9, 25, 44.9, 45, 55, 55.1, 75, 75.1, 100].map(mood)).toEqual(['extreme-fear', 'extreme-fear', 'fear', 'fear', 'neutral', 'neutral', 'greed', 'greed', 'extreme-greed', 'extreme-greed'])
  })
  it('percentile rank', () => {
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(87.5)
    expect(percentileRank([1, 2, 3, 4], 2)).toBe(37.5)
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0)
    expect(percentileRank([1, 2, 3, 4], 9)).toBe(100)
    expect(percentileRank([5, 5, 5], 5)).toBe(50) // ties → middle
    expect(percentileRank([], 5)).toBe(50)
  })
  it('scoring uses only the past (no look-ahead) and can invert', () => {
    const s = series(Array.from({ length: 100 }, (_, i) => i))
    const sc = scoreSeries(s, 504, false, 10)
    expect(sc[0].date).toBe(s[9].date)
    expect(sc.every((p) => p.value > 94)).toBe(true) // a rising series is always at its own high
    expect(scoreSeries(s, 504, true, 10).every((p) => p.value < 6)).toBe(true)
    const s2 = [...s.slice(0, 50), { date: '2099-01-01', value: 1e9 }]
    expect(scoreSeries(s2, 504, false, 10).slice(0, 40)).toEqual(sc.slice(0, 40))
  })
  it('distance from the average, returns, volatility, spread', () => {
    const b = bars(Array.from({ length: 30 }, () => 100))
    expect(distanceFromAverage(b, 10).every((p) => p.value === 0)).toBe(true)
    expect(rollingReturn(bars([100, 110, 121]), 1).map((p) => Number(p.value.toFixed(10)))).toEqual([0.1, 0.1])
    expect(rollingVol(bars(Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i)), 20).every((p) => p.value < 1e-9)).toBe(true)
    expect(rollingVol(bars(Array.from({ length: 30 }, (_, i) => (i % 2 ? 101 : 100))), 20)[0].value).toBeGreaterThan(0.1)
    expect(spread(series([3, 4]), series([1, 1]))).toEqual([
      { date: '2023-01-02', value: 2 },
      { date: '2023-01-03', value: 3 },
    ])
  })
  it('combining: average of components available that day; empty input → neutral', () => {
    const a = series([1, 2, 3])
    const c = combine([
      { id: 'a', raw: a, scored: series([20, 40, 60]) },
      { id: 'b', raw: a, scored: series([80, 80, 100]) },
    ])
    expect(c.score).toBe(80)
    expect(c.mood).toBe('extreme-greed')
    expect(c.history.map((h) => h.score)).toEqual([50, 60, 80])
    expect(c.components.map((x) => x.id)).toEqual(['a', 'b'])
    expect(combine([]).score).toBe(50)
  })
})

describe('Polish and world Fear & Greed', () => {
  it('a steady boom reads as greed, a crash as fear', () => {
    const up = bars(Array.from({ length: 700 }, (_, i) => 100 * 1.0008 ** i + Math.sin(i) * 0.3))
    const crash = bars([...Array.from({ length: 650 }, (_, i) => 100 + Math.sin(i / 5) * 3), ...Array.from({ length: 50 }, (_, i) => 100 - i * 1.2 + (i % 2) * 2)])
    const tbsp = bars(Array.from({ length: 700 }, (_, i) => 100 + i * 0.01))
    const boom = plSentiment({ wig: up, wig20: up, swig80: up, tbsp })
    const panic = plSentiment({ wig: crash, wig20: crash, swig80: crash, tbsp })
    expect(boom.score).toBeGreaterThan(panic.score)
    expect(panic.score).toBeLessThan(45)
    expect(['fear', 'extreme-fear']).toContain(panic.mood)
    expect(boom.components.map((c) => c.id).sort()).toEqual(['momentum', 'safe-haven', 'small-caps', 'volatility'])
    expect(boom.history.length).toBeGreaterThan(100)
  })
  it('breadth and highs/lows join when available', () => {
    const w = bars(wave(700))
    const s = plSentiment({ wig: w, wig20: w, swig80: w, tbsp: w, breadth: series(wave(700, 0.5, 0.2)), highsLows: series(wave(700, 0, 0.1)) })
    expect(s.components.map((c) => c.id)).toEqual(expect.arrayContaining(['breadth', 'highs-lows']))
    expect(s.score).toBeGreaterThanOrEqual(0)
    expect(s.score).toBeLessThanOrEqual(100)
  })
  it('world: calm rising market = greed; a VIX spike with falling stocks and wider junk spreads = fear', () => {
    const n = 600
    // calm: VIX drifting down with small noise, stocks rising faster and faster, junk spreads tightening
    const calm = worldSentiment({ vix: series(Array.from({ length: n }, (_, i) => 20 - i * 0.01 + (i % 4) * 0.2)), sp500: bars(Array.from({ length: n }, (_, i) => 4000 * Math.exp(0.000002 * i * i))), hySpread: series(Array.from({ length: n }, (_, i) => 5 - i * 0.003)) })
    const stress = worldSentiment({
      vix: series([...Array.from({ length: n - 20 }, (_, i) => 15 + (i % 3) * 0.5), ...Array.from({ length: 20 }, (_, i) => 20 + i * 2)]),
      sp500: bars([...Array.from({ length: n - 20 }, (_, i) => 4000 + i), ...Array.from({ length: 20 }, (_, i) => 4560 - i * 40)]),
      hySpread: series([...Array.from({ length: n - 20 }, () => 3.5), ...Array.from({ length: 20 }, (_, i) => 3.5 + i * 0.2)]),
    })
    expect(calm.score).toBeGreaterThan(60)
    expect(['greed', 'extreme-greed']).toContain(calm.mood)
    expect(stress.score).toBeLessThan(25)
    expect(stress.components.find((c) => c.id === 'vix')?.value).toBe(58)
  })
  it('breadth of the market from single shares', () => {
    const rising = bars(Array.from({ length: 300 }, (_, i) => 10 + i * 0.1))
    const falling = bars(Array.from({ length: 300 }, (_, i) => 50 - i * 0.1))
    const shares = [...Array.from({ length: 15 }, () => rising), ...Array.from({ length: 5 }, () => falling)]
    const b = breadth(shares)
    expect(b.above50.at(-1)?.value).toBeCloseTo(0.75, 10)
    expect(b.highsLows.at(-1)?.value).toBeCloseTo((15 - 5) / 20, 10)
    expect(breadth(shares.slice(0, 5)).above50).toEqual([])
  })
})

describe('buy / sell signals', () => {
  it('rule: all three conditions must agree', () => {
    expect(classify(110, 105, 100, 0.1)).toBe('buy')
    expect(classify(90, 95, 100, -0.1)).toBe('sell')
    expect(classify(110, 95, 100, 0.1)).toBe('neutral')
    expect(classify(110, 105, 100, -0.01)).toBe('neutral')
    expect(classify(110, null, 100, 0.1)).toBe('neutral')
    expect(classify(110, 105, 100, null)).toBe('neutral')
  })
  it('a long rise is a buy, a long fall a sell, with the date the signal started', () => {
    const up = bars(Array.from({ length: 400 }, (_, i) => 100 + i))
    const r = signalReport(up)
    expect(r.signal).toBe('buy')
    expect(r.reasons).toEqual(expect.arrayContaining(['above-200', '50-over-200', 'momentum-up', 'overbought']))
    expect(r.fromHigh).toBe(0)
    expect(r.since).toBe(signalHistory(up).find((x) => x.signal === 'buy')!.date)
    const down = bars(Array.from({ length: 400 }, (_, i) => 500 - i))
    expect(signalReport(down).signal).toBe('sell')
    expect(signalReport(down).reasons).toEqual(expect.arrayContaining(['below-200', '50-under-200', 'momentum-down', 'oversold']))
    expect(signalReport(down).fromHigh).toBeLessThan(-0.4)
  })
  it('the signal switches after a turn and "since" moves with it', () => {
    const s = bars([...Array.from({ length: 300 }, (_, i) => 100 + i), ...Array.from({ length: 200 }, (_, i) => 399 - i * 2)])
    const r = signalReport(s)
    expect(r.signal).not.toBe('buy')
    expect(r.since > s[300].date).toBe(true)
  })
  it('short history: neutral, no back-test; empty throws', () => {
    const r = signalReport(bars(Array.from({ length: 100 }, (_, i) => 100 + i)))
    expect(r.signal).toBe('neutral')
    expect(r.backtest).toBeNull()
    expect(() => signalReport([])).toThrow()
    expect(ret12(bars([1, 2]))).toBeNull()
  })
  it('back-test: the trend rule avoids most of a crash and decides one day late (no look-ahead)', () => {
    const s = bars([...Array.from({ length: 300 }, (_, i) => 100 * 1.002 ** i), ...Array.from({ length: 150 }, (_, i) => 182 * 0.994 ** i), ...Array.from({ length: 200 }, (_, i) => 74 * 1.003 ** i)])
    const b = backtestTrend(s, 0)
    expect(b.ruleMaxDD).toBeGreaterThan(b.buyHoldMaxDD)
    expect(b.trades).toBeGreaterThanOrEqual(2)
    expect(b.timeInMarket).toBeGreaterThan(0.3)
    expect(b.timeInMarket).toBeLessThan(1)
    expect(b.from).toBe(s[199].date)
    const up = bars(Array.from({ length: 400 }, (_, i) => 100 * 1.001 ** i))
    const u = backtestTrend(up, 0)
    expect(u.rule).toBeCloseTo(u.buyHold, 10)
    expect(u.trades).toBe(1)
  })
})

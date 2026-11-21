import { describe, expect, it } from 'vitest'
import { rsi, type Bar } from '@core/stats'
import { basket, bollinger, divergence, findPatterns, levels, macd, marketPhase, pivots, pivotThreshold, rate, regression, roc, rsiSeries, technicalReport } from '@core/technical'

/** A daily series through the given anchor prices, `step` sessions apart (straight lines between anchors). */
function path(anchors: number[], step = 20, start = '2024-01-01'): Bar[] {
  const out: Bar[] = []
  const d0 = Date.parse(start)
  let k = 0
  for (let a = 0; a < anchors.length - 1; a++)
    for (let j = 0; j < step; j++) out.push({ date: new Date(d0 + k++ * 86_400_000).toISOString().slice(0, 10), close: anchors[a] + ((anchors[a + 1] - anchors[a]) * j) / step })
  out.push({ date: new Date(d0 + k * 86_400_000).toISOString().slice(0, 10), close: anchors[anchors.length - 1] })
  return out
}
const flat = (n: number, v = 100) => path([v, v], n)
/** small deterministic wiggle so that oscillators have both gains and losses */
const wiggle = (s: Bar[], amp = 0.004) => s.map((b, i) => ({ ...b, close: b.close * (1 + amp * Math.sin(i * 1.7)) }))

describe('indicators', () => {
  it('RSI series ends at the same value as the single RSI; flat start is null', () => {
    const s = wiggle(path([100, 130, 110, 140], 40))
    const r = rsiSeries(s)
    expect(r[13]).toBeNull()
    expect(r.at(-1)).toBeCloseTo(rsi(s)!, 8)
    expect(rsiSeries(s.slice(0, 10)).every((v) => v === null)).toBe(true)
    expect(rsiSeries(path([100, 120], 30)).at(-1)).toBe(100) // only gains
  })
  it('MACD is positive in a rising market and negative in a falling one; signal and histogram follow', () => {
    const up = macd(path([100, 200], 120))
    expect(up.macd.at(-1)!).toBeGreaterThan(0)
    expect(up.signal.at(-1)).not.toBeNull()
    expect(up.hist[10]).toBeNull()
    const down = macd(path([200, 100], 120))
    expect(down.macd.at(-1)!).toBeLessThan(0)
    expect(macd(path([100, 101], 5)).signal.every((v) => v === null)).toBe(true)
  })
  it('Bollinger bands: zero width on a flat line (%B 0.5), price above the upper band after a jump', () => {
    const b = bollinger(flat(40))
    expect(b.width.at(-1)).toBe(0)
    expect(b.pctB.at(-1)).toBe(0.5)
    expect(b.upper[5]).toBeNull()
    const jump = [...flat(40), { date: '2030-01-01', close: 130 }]
    expect(bollinger(jump).pctB.at(-1)!).toBeGreaterThan(1)
  })
  it('rate of change and the regression channel', () => {
    expect(roc(path([100, 110], 10), 10)).toBeCloseTo(0.1, 10)
    expect(roc(path([100, 110], 3), 10)).toBeNull()
    const g = Array.from({ length: 300 }, (_, i) => ({ date: `d${String(i).padStart(4, '0')}`, close: 100 * 1.001 ** i }))
    const r = regression(g, 100)!
    expect(r.r2).toBeCloseTo(1, 8)
    expect(r.slopeYear).toBeCloseTo(1.001 ** 252 - 1, 6)
    expect(r.line).toHaveLength(100)
    expect(regression(g.slice(0, 5), 100)).toBeNull()
    expect(regression(flat(120), 100)!.r2).toBe(0)
  })
})

describe('market phase (20 % rule)', () => {
  it('bull → bear → bull, switching at the peak and at the trough', () => {
    const s = path([100, 130, 100, 125])
    const p = marketPhase(s)
    expect(p.kind).toBe('bull')
    expect(p.segments.map((x) => x.kind)).toEqual(['bull', 'bear', 'bull'])
    expect(p.segments[1].from).toBe(s[20].date) // the peak at 130
    expect(p.segments[2].from).toBe(s[40].date) // the trough at 100
    expect(p.since).toBe(s[40].date)
    expect(p.sinceStart).toBeCloseTo(0.25, 10)
  })
  it('correction inside a bull market and a rebound inside a bear market', () => {
    expect(marketPhase(path([100, 130, 115])).kind).toBe('correction')
    const bear = marketPhase(path([130, 100, 112]))
    expect(bear.kind).toBe('rebound')
    expect(bear.fromTrough).toBeCloseTo(0.12, 10)
    expect(marketPhase(path([130, 100, 104])).kind).toBe('bear')
  })
  it('no 20 % move yet: unknown; empty series: unknown', () => {
    const p = marketPhase(path([100, 110, 95, 105]))
    expect(p.kind).toBe('unknown')
    expect(p.since).toBeNull()
    expect(marketPhase([]).kind).toBe('unknown')
  })
})

describe('turning points', () => {
  it('zig-zag finds alternating highs and lows; the last one is provisional', () => {
    const p = pivots(path([100, 120, 105, 125, 110]), 0.05)
    expect(p.map((x) => x.type)).toEqual(['low', 'high', 'low', 'high', 'low'])
    expect(p.map((x) => Math.round(x.price))).toEqual([100, 120, 105, 125, 110])
    expect(pivots(path([120, 100, 115]), 0.05).map((x) => x.type)).toEqual(['high', 'low', 'high'])
    expect(pivots(path([100, 101]).slice(0, 2), 0.05)).toEqual([])
  })
  it('threshold adapts to volatility within 3–15 %', () => {
    expect(pivotThreshold(flat(300))).toBe(0.03)
    const wild = Array.from({ length: 300 }, (_, i) => ({ date: `d${String(i).padStart(4, '0')}`, close: i % 2 ? 100 : 160 }))
    expect(pivotThreshold(wild)).toBe(0.15)
  })
})

describe('chart patterns', () => {
  const kinds = (s: Bar[]) => findPatterns(s, 400, 0.05).map((p) => `${p.kind}/${p.status}`)
  it('head and shoulders (RGR): confirmed below the neckline, measured-move target', () => {
    const s = path([80, 110, 100, 122, 100, 110, 88])
    const p = findPatterns(s, 400, 0.05).find((x) => x.kind === 'head-shoulders')!
    expect(p.status).toBe('confirmed')
    expect(p.bias).toBe(-1)
    expect(p.points.map((x) => x.label)).toEqual(['L', 'H', 'R'])
    expect(p.target).toBeCloseTo(100 - 22, 0)
    expect(p.breakDate).toBeDefined()
  })
  it('head and shoulders that broke and then rallied above the right shoulder has failed', () => {
    expect(kinds(path([80, 110, 100, 122, 100, 110, 97, 118]))).toContain('head-shoulders/failed')
  })
  it('head and shoulders still forming (neckline not broken) is reported only when its right shoulder is settled', () => {
    expect(kinds(path([80, 110, 100, 122, 100, 110, 103]))).toContain('head-shoulders/forming')
    expect(kinds(path([80, 110, 100, 122, 100, 110]))).not.toContain('head-shoulders/forming')
  })
  it('inverse head and shoulders: confirmed above the neckline, failed after falling back below the right shoulder', () => {
    const s = path([120, 90, 100, 78, 100, 90, 112])
    const p = findPatterns(s, 400, 0.05).find((x) => x.kind === 'inverse-head-shoulders')!
    expect(p.status).toBe('confirmed')
    expect(p.target).toBeCloseTo(100 + 22, 0)
    expect(kinds(path([120, 90, 100, 78, 100, 90, 103, 85]))).toContain('inverse-head-shoulders/failed')
    expect(kinds(path([120, 90, 100, 78, 100, 90, 96]))).toContain('inverse-head-shoulders/forming')
  })
  it('double top and double bottom with targets; failed and forming variants', () => {
    const top = findPatterns(path([80, 110, 95, 110, 85]), 400, 0.05).find((x) => x.kind === 'double-top')!
    expect(top.status).toBe('confirmed')
    expect(top.target).toBeCloseTo(80, 0)
    expect(kinds(path([80, 110, 95, 110, 92, 115]))).toContain('double-top/failed')
    expect(kinds(path([80, 110, 95, 110, 100]))).toContain('double-top/forming')
    const bottom = findPatterns(path([120, 90, 105, 90, 115]), 400, 0.05).find((x) => x.kind === 'double-bottom')!
    expect(bottom.status).toBe('confirmed')
    expect(bottom.target).toBeCloseTo(120, 0)
    expect(kinds(path([120, 90, 105, 90, 108, 85]))).toContain('double-bottom/failed')
    expect(kinds(path([120, 90, 105, 90, 100]))).toContain('double-bottom/forming')
  })
  it('triangles: ascending breaks up, descending breaks down, symmetric either way; a break against the bias fails', () => {
    expect(kinds(path([80, 110, 90, 110, 100, 120]))).toContain('triangle-ascending/confirmed')
    expect(kinds(path([120, 90, 110, 90, 100, 80]))).toContain('triangle-descending/confirmed')
    const sym = findPatterns(path([80, 120, 90, 112, 98, 125]), 400, 0.05).find((x) => x.kind === 'triangle-symmetric')!
    expect(sym.status).toBe('confirmed')
    expect(sym.bias).toBe(1)
    expect(sym.line2).toBeDefined()
    expect(kinds(path([80, 120, 90, 112, 98, 80]))).toContain('triangle-symmetric/confirmed')
    expect(kinds(path([80, 110, 90, 110, 100, 85]))).toContain('triangle-ascending/failed')
    expect(kinds(path([80, 110, 90, 110, 100, 105]))).toContain('triangle-ascending/forming')
  })
  it('breakout above resistance and below support in the last sessions', () => {
    const up = [...path([100, 110, 100, 110, 100, 108], 20), ...path([108, 116], 5, '2030-01-01')]
    expect(findPatterns(up, 400, 0.05).map((p) => p.kind)).toContain('breakout-resistance')
    const down = [...path([100, 90, 100, 90, 100, 92], 20), ...path([92, 84], 5, '2030-01-01')]
    expect(findPatterns(down, 400, 0.05).map((p) => p.kind)).toContain('breakdown-support')
  })
  it('too short or pattern-free series give no patterns', () => {
    expect(findPatterns(path([100, 110], 10))).toEqual([])
    expect(findPatterns(path([100, 200], 100), 400, 0.05)).toEqual([])
  })
})

describe('support, resistance and divergence', () => {
  it('levels group turning points within 2 % and sort nearest first', () => {
    const s = path([100, 120, 101, 121, 100, 110])
    const l = levels(s, 0.05)
    expect(l.resistance[0].price).toBeCloseTo(120.5, 0)
    expect(l.resistance[0].touches).toBe(2)
    expect(l.support[0].price).toBeCloseTo(100.5, 0)
  })
  it('bullish divergence: price lower low, RSI higher low; bearish: price higher high, RSI lower high', () => {
    const bull = [...path([150, 100], 30), ...path([100, 112], 15, '2024-01-31'), ...path([112, 98], 40, '2024-02-15')]
    expect(divergence(bull, rsiSeries(bull), 0.05)?.kind).toBe('bullish')
    const bear = [...path([60, 100], 30), ...path([100, 88], 15, '2024-01-31'), ...path([88, 102], 40, '2024-02-15')]
    expect(divergence(bear, rsiSeries(bear), 0.05)?.kind).toBe('bearish')
    expect(divergence(path([100, 120], 40), rsiSeries(path([100, 120], 40)), 0.05)).toBeNull()
  })
})

describe('technical report and rating', () => {
  it('rating thresholds', () => {
    expect([0.6, 0.3, 0, -0.3, -0.6].map(rate)).toEqual(['strong-buy', 'buy', 'neutral', 'sell', 'strong-sell'])
  })
  it('a long steady rise rates strong buy; a long fall strong sell', () => {
    const up = technicalReport(wiggle(path([100, 200], 400), 0.0005))
    expect(up.rating.label).toBe('strong-buy')
    expect(up.rating.ma.buy).toBe(10)
    expect(up.phase.kind).toBe('bull')
    expect(up.short).toBe(false)
    expect(up.trend!.r2).toBeGreaterThan(0.9)
    expect(up.fromHigh52).toBeLessThanOrEqual(0)
    const down = technicalReport(wiggle(path([200, 100], 400), 0.0005))
    expect(down.rating.label).toBe('strong-sell')
    expect(down.votes.find((v) => v.id === 'mom12')!.vote).toBe('sell')
  })
  it('short history: long averages abstain, report is marked short', () => {
    const r = technicalReport(path([100, 105, 102], 30))
    expect(r.short).toBe(true)
    expect(r.votes.find((v) => v.id === 'sma200')!.value).toBeNull()
    expect(r.votes.find((v) => v.id === 'sma200')!.vote).toBe('neutral')
    expect(() => technicalReport([{ date: '2026-01-01', close: 1 }])).toThrow()
  })
  it('oversold and turning up votes buy on RSI; overbought turning down votes sell; flat price: neutral MAs', () => {
    const os = technicalReport([...path([200, 120], 30), { date: '2030-01-01', close: 121 }])
    expect(os.votes.find((v) => v.id === 'rsi')!.vote).toBe('buy')
    const ob = technicalReport([...path([100, 180], 30), { date: '2030-01-01', close: 179 }])
    expect(ob.votes.find((v) => v.id === 'rsi')!.vote).toBe('sell')
    const fl = technicalReport(flat(260))
    expect(fl.votes.filter((v) => v.group === 'ma').every((v) => v.vote === 'neutral')).toBe(true)
    expect(fl.votes.find((v) => v.id === 'roc10')!.vote).toBe('neutral')
    expect(fl.bollinger.squeeze).toBe(true)
  })
  it('MACD cross in the last sessions is reported with its date', () => {
    const turn = technicalReport(wiggle([...path([200, 100], 120), ...path([100, 106], 4, '2030-01-01')], 0.0005))
    expect(turn.macd.cross?.kind).toBe('bullish')
    const top = technicalReport(wiggle([...path([100, 200], 120), ...path([200, 194], 4, '2030-01-01')], 0.0005))
    expect(top.macd.cross?.kind).toBe('bearish')
  })
})

describe('equal-weight basket', () => {
  it('averages daily returns of the members, skips missing days, starts at the base', () => {
    const a = [
      { date: '2026-01-01', close: 10 },
      { date: '2026-01-02', close: 11 },
      { date: '2026-01-03', close: 12.1 },
    ]
    const b = [
      { date: '2026-01-01', close: 20 },
      { date: '2026-01-03', close: 18 },
    ]
    const s = basket([a, b])
    expect(s[0]).toEqual({ date: '2026-01-01', close: 1000 })
    expect(s[1].close).toBeCloseTo(1100, 6) // only a traded: +10 %
    expect(s[2].close).toBeCloseTo(1100 * (1 + (0.1 - 0.1) / 2), 6) // a +10 %, b −10 % since its last price
    expect(basket([])).toEqual([])
  })
})

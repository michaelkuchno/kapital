import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRODUCTS, productFor, liveMetrics, PILLAR3A_2026 } from '@core/products'
import { analyzeMarket, SIGNAL_INDICES } from '@data/analysis'
import { parseFredCsv, FRED } from '@data/parse'
import { summarize, type MarketInputs } from '@core/assets'
import { buildInsights, DEFAULT_PROFILE } from '@core/insights'
import { EVIDENCE } from '@core/evidence'
import type { Bar } from '@core/stats'

function bars(closes: number[], start = '2022-01-03'): Bar[] {
  const out: Bar[] = []
  let t = Date.parse(start + 'T00:00:00Z')
  for (const c of closes) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000
    out.push({ date: new Date(t).toISOString().slice(0, 10), close: c })
    t += 86_400_000
  }
  return out
}

describe('product facts', () => {
  it('every product is consistent: levels 1–5, sensible return ranges, valid tax/how keys', () => {
    for (const p of Object.values(PRODUCTS)) {
      for (const v of [p.risk, p.cost, p.inflationProtection]) expect(v >= 1 && v <= 5, p.id).toBe(true)
      expect(p.expectedReal[0], p.id).toBeLessThanOrEqual(p.expectedReal[1])
      expect(p.taxKey.startsWith('tax.'), p.id).toBe(true)
      expect(p.howKey.startsWith('how.'), p.id).toBe(true)
      expect(p.countries.length, p.id).toBeGreaterThan(0)
      // products that cannot lose nominal value must be low-risk
      if (!p.canLoseNominal) expect(p.risk, p.id).toBeLessThanOrEqual(1)
    }
  })
  it('Polish products only for Poland, Swiss ones only for Switzerland', () => {
    for (const id of ['edo', 'rod', 'coi', 'safe-tos', 'etf-poland']) expect(PRODUCTS[id].countries).toEqual(['PL'])
    for (const id of ['pillar3a', 'etf-swiss', 'chf-bonds']) expect(PRODUCTS[id].countries).toEqual(['CH'])
    expect(PRODUCTS.pillar3a.liquidity).toBe('locked-until-retirement')
    expect(PILLAR3A_2026).toBe(7258)
  })
  it('planned expenses map to the right product per country; unknown → reserve', () => {
    expect(productFor('planned-auto', 'PL').id).toBe('safe-tos')
    expect(productFor('planned-auto', 'CH').id).toBe('safe-chf')
    expect(productFor('edo', 'PL').id).toBe('edo')
    expect(productFor('something', 'CH').id).toBe('reserve')
  })
  it('live numbers from prices: volatility, worst fall, 1-year return, signal', () => {
    const s = bars([...Array.from({ length: 300 }, (_, i) => 100 + i * 0.5 + (i % 2)), ...Array.from({ length: 60 }, (_, i) => 250 - i)])
    const m = liveMetrics(s)
    expect(m.vol).toBeGreaterThan(0)
    expect(m.maxDrawdown).toBeLessThan(-0.2)
    expect(m.from).toBe(s[0].date)
    expect(m.ret1y).not.toBeNull()
    expect(['buy', 'sell', 'neutral']).toContain(m.signal)
    expect(m.last).toBe(191)
    expect(liveMetrics(bars([1, 2, 3]))).toMatchObject({ vol: null, signal: null, last: 3 })
    expect(liveMetrics(null).last).toBeNull()
  })
})

describe('market analysis (signals + Fear & Greed)', () => {
  const up = bars(Array.from({ length: 700 }, (_, i) => 1000 * 1.0006 ** i * (1 + 0.01 * Math.sin(i / 7))))
  const idx = new Map<string, Bar[]>([
    ['WIG', up],
    ['WIG20', up],
    ['SWIG80', up],
    ['TBSP.INDEX', bars(Array.from({ length: 700 }, (_, i) => 2000 + i * 0.2))],
    ['WIG-BANKI', bars(Array.from({ length: 20 }, (_, i) => 100 + i))], // too short → no signal
  ])
  const ser = (n: number, f: (i: number) => number) => bars(Array.from({ length: n }, (_, i) => f(i))).map((b) => ({ date: b.date, value: b.close }))
  it('signals for the indices with enough history, both sentiments, the VIX', () => {
    const a = analyzeMarket({ indices: idx, shares: [up, up, up, up, up, up, up, up, up, up, up, up, up, up, up, up, up, up, up, up], vix: ser(600, (i) => 18 + Math.sin(i / 9)), sp500: ser(600, (i) => 5000 + i * 2), hySpread: ser(600, () => 3.5) })
    expect(a.signals.map((s) => s.code)).toEqual(['WIG', 'WIG20', 'SWIG80'])
    expect(a.sentiment.pl?.components.map((c) => c.id)).toEqual(expect.arrayContaining(['breadth', 'highs-lows']))
    expect(a.sentiment.world?.score).toBeGreaterThanOrEqual(0)
    expect(a.world?.vix).toBeCloseTo(18 + Math.sin(599 / 9), 10)
    expect(a.world?.sp500Signal?.signal).toBe('buy')
    expect(SIGNAL_INDICES).toContain('WIG-ENERG')
  })
  it('missing data → no sentiment instead of a wrong number', () => {
    const a = analyzeMarket({ indices: new Map(), shares: [], vix: [], sp500: [], hySpread: [] })
    expect(a).toEqual({ signals: [], sentiment: { pl: undefined, world: undefined }, world: undefined })
  })
})

describe('FRED CSV', () => {
  it('real file: header skipped, "." (holiday) skipped', () => {
    const v = parseFredCsv(readFileSync(join(__dirname, '..', 'fixtures', 'fred-vix.csv'), 'utf8'))
    expect(v.length).toBeGreaterThan(2)
    expect(v[0]).toEqual({ date: '2026-09-01', value: 16.34 })
    expect(v.some((p) => p.date === '2026-11-11')).toBe(false)
    expect(parseFredCsv('observation_date,X\nbad,1\n2026-01-01,\n')).toEqual([])
    expect(FRED).toEqual({ vix: 'VIXCLS', sp500: 'SP500', hy: 'BAMLH0A0HYM2' })
  })
})

describe('insights for families living in Switzerland', () => {
  const m: MarketInputs = { asOf: '2026-11-20', cpi: [], refRates: [], prices: new Map(), fx: { CHF: 4.8 } }
  const s = summarize([{ id: 'c', kind: 'cash', amount: 300_000 }, { id: 'f', kind: 'fx', currency: 'CHF', amount: 10_000 }], m)
  it('pillar 3a instead of IKE/IKZE, warning about wealth in PLN with CHF expenses, no Polish family bonds', () => {
    const ins = buildInsights({ asOf: '2026-11-20', summary: s, profile: { ...DEFAULT_PROFILE, country: 'CH', family800: true }, offer: [{ code: 'EDO', series: 'EDO1136', firstRate: 5.35, margin: 2 }, { code: 'ROD', series: 'ROD1138', firstRate: 5.6, margin: 2.5 }] })
    const ids = ins.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['pillar3a', 'fx-mismatch']))
    for (const id of ['ike', 'ikze', 'family-bonds']) expect(ids).not.toContain(id)
    expect(ins.find((i) => i.id === 'pillar3a')!.params).toMatchObject({ limit: 7258, saved: Math.round(7258 * 0.25) })
    expect(ins.find((i) => i.id === 'fx-mismatch')!.params.share).toBe(86)
    for (const i of ins) for (const e of i.evidence) expect(EVIDENCE[e]).toBeDefined()
    expect(buildInsights({ asOf: '2026-11-20', summary: s, profile: { ...DEFAULT_PROFILE, country: 'CH', usesPillar3a: true } }).map((i) => i.id)).not.toContain('pillar3a')
  })
  it('the PLN share of the wealth', () => {
    expect(s.plnShare).toBeCloseTo(300_000 / 348_000, 10)
  })
})

describe('SNB CSV (Swiss inflation, policy rate)', async () => {
  const { parseSnbCsv, SNB } = await import('@data/parse')
  it('real file: BOM, quotes, semicolons; only the requested key; empty values skipped', () => {
    const csv = readFileSync(join(__dirname, '..', 'fixtures', 'snb-plkopr.csv'), 'utf8')
    const cpi = parseSnbCsv(csv, 'VVP')
    expect(cpi.at(-1)).toEqual({ date: '2026-09', value: 0.99005861 })
    expect(cpi.every((p) => p.date >= '2026-07')).toBe(true) // 1921 rows have no y/y value
    expect(parseSnbCsv(csv, 'LD2010100')[0]).toEqual({ date: '1921-01', value: 19.588398 })
    expect(parseSnbCsv('"2026-11-13";"LZ";"0"\n"2026-11-13";"SARON";"-0.04"', 'LZ')).toEqual([{ date: '2026-11-13', value: 0 }])
    expect(parseSnbCsv('garbage', 'LZ')).toEqual([])
    expect(SNB.cpi).toEqual(['plkopr', 'VVP'])
  })
})

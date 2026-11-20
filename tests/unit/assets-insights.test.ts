import { describe, expect, it } from 'vitest'
import { summarize, valueAsset, assetName, priceFor, type Asset, type MarketInputs } from '@core/assets'
import { buildInsights, DEFAULT_PROFILE, EQUITY_TARGET, LIMITS_2026, itemsOf, pct, type Profile } from '@core/insights'
import { analyzeTrend, rankSectors } from '@core/trends'
import { EVIDENCE } from '@core/evidence'

/** A family portfolio shaped like the user's (example numbers – the real ones live only on the user's device). */
const family: Asset[] = [
  { id: 'edo', kind: 'bond', code: 'EDO', purchase: '2026-05-12', count: 2_500, firstRate: 5.6, margin: 2 },
  { id: 'dep', kind: 'deposit', bank: 'BankX', amount: 60_000, rate: 6, start: '2026-09-20', months: 3, renewRate: 4 },
  { id: 'skh', kind: 'stock', name: 'SKARBIEC', isin: 'PLSKRBH00014', quantity: 500, cost: 15_000 },
  { id: 'snt', kind: 'stock', name: 'SNTVERSE', isin: 'PLBMDLB00018', quantity: 10_000, cost: 53_400 },
]
const market: MarketInputs = {
  asOf: '2026-11-20',
  cpi: [{ month: '2026-10', yoy: 3.5 }],
  refRates: [{ from: '2026-03-05', rate: 3.75 }],
  prices: new Map([
    ['PLSKRBH00014', 36.4],
    ['PLBMDLB00018', 2.67],
  ]),
}
const offer = [
  { code: 'OTS' as const, series: 'OTS0227', firstRate: 2, margin: 0 },
  { code: 'TOS' as const, series: 'TOS1129', firstRate: 4.4, margin: 0 },
  { code: 'COI' as const, series: 'COI1130', firstRate: 4.75, margin: 1.5 },
  { code: 'EDO' as const, series: 'EDO1136', firstRate: 5.35, margin: 2 },
  { code: 'ROS' as const, series: 'ROS1132', firstRate: 5, margin: 2 },
  { code: 'ROD' as const, series: 'ROD1138', firstRate: 5.6, margin: 2.5 },
]

describe('portfolio summary', () => {
  const s = summarize(family, market)
  it('values every asset and adds them up', () => {
    expect(s.items).toHaveLength(4)
    expect(s.total).toBeCloseTo(s.items.reduce((a, i) => a + i.value, 0), 2)
    expect(s.byClass['bonds-inflation']).toBe(2_500 * 102.95)
    expect(s.byClass.equities).toBe(round(500 * 36.4 + 26_700))
    expect(s.byClass.deposits).toBe(60_487.33)
    expect(Object.values(s.byClass).reduce((a, b) => a + b, 0)).toBeCloseTo(s.total, 1)
    expect(Object.values(s.byLiquidity).reduce((a, b) => a + b, 0)).toBeCloseTo(s.total, 1)
  })
  it('largest single company, concentration index, inflation-protected share', () => {
    expect(s.largest?.name).toBe('SNTVERSE')
    expect(s.largest?.share).toBeCloseTo(26_700 / s.total, 6)
    expect(s.hhi).toBeGreaterThan(0.5) // dominated by the EDO
    expect(s.hhi).toBeLessThanOrEqual(1)
    expect(s.inflationProtected).toBeGreaterThan(0.65)
    expect(s.equityShare).toBeCloseTo(s.byClass.equities / s.total, 10)
  })
  it('net if turned into cash today: bond fee + tax, deposit loses the running interest, shares taxed only on gains', () => {
    const net = (id: string) => s.items.find((i) => i.asset.id === id)!.netNow
    expect(net('edo')).toBe(250_000) // interest 2.95 < 3 zł fee
    expect(net('dep')).toBe(60_000)
    expect(net('snt')).toBe(26_700)
    expect(net('skh')).toBeLessThan(500 * 36.4)
  })
  it('missing price → cost is used and flagged; manual price is honoured', () => {
    const m = { ...market, prices: new Map<string, number>() }
    const v = valueAsset({ id: 'x', kind: 'stock', name: 'NOWA', quantity: 10, cost: 500 }, m)
    expect(v).toMatchObject({ value: 500, gain: 0, missingPrice: true })
    expect(valueAsset({ id: 'y', kind: 'stock', name: 'NOWA', quantity: 10, cost: 500, manualPrice: 60 }, m).value).toBe(600)
    expect(priceFor({ name: 'skarbiec' }, new Map([['SKARBIEC', 1]]))).toBe(1)
  })
  it('IKE: no Belka on bonds and shares held in IKE', () => {
    const ike = valueAsset({ id: 'i', kind: 'stock', name: 'SKARBIEC', isin: 'PLSKRBH00014', quantity: 500, cost: 15_000, ike: true }, market)
    expect(ike.netNow).toBe(ike.value)
  })
  it('other asset kinds', () => {
    const s2 = summarize(
      [
        { id: 'c', kind: 'cash', amount: 20_000 },
        { id: 'f', kind: 'fund', name: 'ETF WIG20TR', value: 12_000, cost: 10_000, equityShare: 1 },
        { id: 'f2', kind: 'fund', name: 'Fundusz obligacji', value: 5_000, cost: 6_000, equityShare: 0 },
        { id: 'o', kind: 'other', name: 'Złoto', value: 8_000 },
        { id: 't', kind: 'bond', code: 'TOS', purchase: '2026-11-15', count: 10, firstRate: 4.4, margin: 0 },
        { id: 'o2', kind: 'bond', code: 'OTS', purchase: '2026-11-15', count: 10, firstRate: 2, margin: 0 },
      ],
      market,
    )
    expect(s2.byClass.cash).toBe(20_000)
    expect(s2.byClass.equities).toBe(12_000)
    expect(s2.byClass['bonds-fixed']).toBeGreaterThan(7_000)
    expect(s2.byClass.other).toBe(8_000)
    expect(s2.items.find((i) => i.asset.id === 'f')!.netNow).toBe(12_000 - 380)
    expect(s2.items.find((i) => i.asset.id === 'f2')!.netNow).toBe(5_000)
    expect(s2.byLiquidity.locked).toBe(8_000)
  })
  it('names', () => {
    expect(assetName(family[0])).toBe('EDO (2026-05)')
    expect(assetName(family[1])).toBe('Lokata BankX')
    expect(assetName({ id: 'd', kind: 'deposit', amount: 1, rate: 1, start: '2026-01-01', months: 1 })).toBe('Lokata')
    expect(assetName({ id: 'c', kind: 'cash', amount: 1 })).toBe('Gotówka')
    expect(assetName({ id: 'c', kind: 'cash', amount: 1, label: 'Konto' })).toBe('Konto')
  })
  it('empty portfolio', () => {
    const e = summarize([], market)
    expect(e).toMatchObject({ total: 0, hhi: 0, largest: null, inflationProtected: 0, equityShare: 0 })
    expect(buildInsights({ asOf: market.asOf, summary: e, profile: DEFAULT_PROFILE })).toEqual([expect.objectContaining({ id: 'empty' })])
  })
})

function round(x: number) {
  return Math.round(x * 100) / 100
}

describe('insights', () => {
  const s = summarize(family, market)
  const profile: Profile = { ...DEFAULT_PROFILE, monthlyExpenses: 9_000, risk: 3, family800: true }
  const ins = buildInsights({ asOf: '2026-11-20', summary: s, profile, cpi: { month: '2026-10', yoy: 3.5 }, refRate: 3.75, offer })
  const ids = ins.map((i) => i.id)
  it('every insight cites existing sources', () => {
    for (const i of ins) for (const e of i.evidence) expect(EVIDENCE[e], `${i.id} → ${e}`).toBeDefined()
  })
  it('warnings first, then tips, info, ok', () => {
    const order = { warn: 0, tip: 1, info: 2, ok: 3 }
    for (let k = 1; k < ins.length; k++) expect(order[ins[k - 1].severity]).toBeLessThanOrEqual(order[ins[k].severity])
  })
  it('a 50 % loss: compares the future, shows what is needed to break even and the tax effect of realizing it', () => {
    const l = ins.find((i) => i.id === 'loss-snt')!
    expect(l.severity).toBe('tip')
    expect(l.params.loss).toBe(-50)
    expect(l.params.needed).toBe(100)
    // unrealised gain on Skarbiec could be offset: tax saved = 19 % of that gain
    expect(l.params.taxSaved).toBeGreaterThan(0)
    expect(l.evidence).toEqual(expect.arrayContaining(['shefrin1985', 'odean1998', 'pit']))
  })
  it('deposit ending in 30 days → reminder with the current bond offer; promotion ending → tip', () => {
    const d = ins.find((i) => i.id === 'deposit-ending-dep')!
    expect(d.severity).toBe('warn')
    expect(d.params.days).toBe(30)
    expect(String(d.params.offers)).toContain('EDO 5.35%')
    expect(String(d.params.offers)).toContain('ROD 5.6%') // family800
    expect(ids).toContain('deposit-promo-dep')
  })
  it('concentration in one company above 10 % is flagged', () => {
    // SNT ≈ 27k of ≈ 363k → below 10 %: not flagged
    expect(ids).not.toContain('concentration')
    const s2 = summarize([...family.slice(1)], market)
    const i2 = buildInsights({ asOf: '2026-11-20', summary: s2, profile })
    expect(i2.find((i) => i.id === 'concentration')?.severity).toBe('warn')
  })
  it('only single Polish shares → diversification tip', () => {
    expect(ids).toContain('single-stocks-only')
  })
  it('equity share far below a balanced profile → allocation tip with the amount', () => {
    const a = ins.find((i) => i.id === 'allocation-drift')!
    expect(a.key).toBe('insight.equityLow')
    expect(a.params.lo).toBe(EQUITY_TARGET[3][0] * 100)
    expect(Number(a.params.amount)).toBeGreaterThan(0)
  })
  it('emergency fund levels', () => {
    const mk = (monthlyExpenses: number) => buildInsights({ asOf: '2026-11-20', summary: s, profile: { ...profile, monthlyExpenses } }).map((i) => i.id)
    expect(mk(9_000)).toContain('emergency-ok') // 60 000 / 9 000 > 6 months
    expect(mk(15_000)).toContain('emergency-mid')
    expect(mk(60_000)).toContain('emergency-low')
    expect(mk(0)).toContain('emergency-unknown')
  })
  it('family bonds for 800+ families (ROD margin above EDO)', () => {
    expect(ins.find((i) => i.id === 'family-bonds')?.params).toMatchObject({ rod: 2.5, edo: 2 })
    const no = buildInsights({ asOf: '2026-11-20', summary: s, profile: { ...profile, family800: false }, offer })
    expect(no.map((i) => i.id)).not.toContain('family-bonds')
  })
  it('IKE / IKZE when not used, with the 2026 limits', () => {
    expect(ins.find((i) => i.id === 'ike')?.params.limit).toBe(LIMITS_2026.ike)
    expect(ins.find((i) => i.id === 'ikze')?.params.refund).toBe((LIMITS_2026.ikze * 12) / 100)
    const used = buildInsights({ asOf: '2026-11-20', summary: s, profile: { ...profile, usesIke: true, usesIkze: true } })
    expect(used.map((i) => i.id)).not.toContain('ike')
  })
  it('bond status, inflation protection, real deposit rate', () => {
    expect(ins.find((i) => i.id === 'bond-edo')?.params).toMatchObject({ name: 'EDO0536', fee: 2_500 * 2.95 })
    expect(ids).toContain('inflation-protected')
    // 6 % × 0.81 = 4.86 % net > 3.5 % CPI → not negative
    expect(ids).not.toContain('deposit-real-dep')
    const low = summarize([{ id: 'd2', kind: 'deposit', amount: 50_000, rate: 3, start: '2026-09-01', months: 12 }], market)
    expect(buildInsights({ asOf: '2026-11-20', summary: low, profile, cpi: { month: '2026-10', yoy: 3.5 } }).map((i) => i.id)).toContain('deposit-real-d2')
  })
  it('cash drag when lots of cash sits idle', () => {
    const c = summarize([{ id: 'c', kind: 'cash', amount: 200_000 }], market)
    const r = buildInsights({ asOf: '2026-11-20', summary: c, profile, cpi: { month: '2026-10', yoy: 3.5 } })
    expect(r.find((i) => i.id === 'cash-drag')?.params.lossYear).toBe(7000)
  })
  it('equities above the profile', () => {
    const c = summarize([{ id: 'f', kind: 'fund', name: 'ETF', value: 100_000, cost: 100_000, equityShare: 1 }], market)
    const r = buildInsights({ asOf: '2026-11-20', summary: c, profile: { ...profile, risk: 2 } })
    expect(r.find((i) => i.id === 'allocation-drift')?.key).toBe('insight.equityHigh')
    expect(r.map((i) => i.id)).not.toContain('single-stocks-only')
  })
  it('sector trend changes from the last 2 weeks and the leaders', () => {
    const mk = (closes: number[]) => closes.map((c, i) => ({ date: new Date(Date.UTC(2025, 6, 1) + i * 86_400_000).toISOString().slice(0, 10), close: c }))
    const rising = mk(Array.from({ length: 300 }, (_, i) => 100 + i))
    const turning = mk([...Array.from({ length: 300 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 140 }, (_, i) => 249 - i * 1.6)])
    const sectors = rankSectors([
      { code: 'WIG-GRY', report: analyzeTrend(rising) },
      { code: 'WIG-BANKI', report: analyzeTrend(turning, undefined, 200) },
    ])
    const asOf = sectors[1].report.events[0].date
    const r = buildInsights({ asOf, summary: s, profile, sectors })
    expect(r.find((i) => i.id === 'trend-WIG-BANKI')).toBeDefined()
    expect(r.find((i) => i.id === 'sector-leaders')?.params.list).toContain('WIG-GRY')
  })
  it('helpers', () => {
    expect(itemsOf(s, 'stock')).toHaveLength(2)
    expect(pct(0.12345)).toBe(12.3)
    expect(pct(0.12345, 2)).toBe(12.35)
  })
})

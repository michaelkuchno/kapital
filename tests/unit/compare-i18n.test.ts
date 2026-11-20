import { describe, expect, it } from 'vitest'
import { compareBond, compareDeposit } from '@core/compare'
import { DICTS, translate, money, percent, dateFmt, LANGS } from '@web/i18n'
import { buildInsights, DEFAULT_PROFILE } from '@core/insights'
import { summarize, type Asset } from '@core/assets'
import { analyzeTrend, rankSectors } from '@core/trends'

describe('bond vs deposit comparison', () => {
  it('TOS held exactly 3 years: hand-computed', () => {
    // 100 → 104.40 → 108.99 → 113.79 per bond, tax 19 % of 13.79 = 2.62 → 111.17 per bond
    const r = compareBond({ code: 'TOS', firstRate: 4.4, margin: 0 }, 10_000, 3, '2026-11-15', 3, 3.75)
    expect(r.net).toBe(11_117)
    expect(r.annual).toBeCloseTo(Math.pow(1.1117, 1 / 3) - 1, 10)
    expect(r.real).toBeCloseTo(11_117 / 1.03 ** 3, 2)
  })
  it('EDO for 2 years is redeemed early (fee 3 zł/bond, tax on interest minus fee)', () => {
    const r = compareBond({ code: 'EDO', firstRate: 5.35, margin: 2 }, 10_000, 2, '2026-11-15', 3, 3.75)
    // year 1: 105.35; year 2: (3 + 2) % → 5.27 → 110.62; fee 3 → taxable 7.62 → tax 1.45 → 106.17 per bond
    expect(r.net).toBe(10_617)
  })
  it('OTS rolled over every 3 months; remainder below 100 zł stays as cash', () => {
    const r = compareBond({ code: 'OTS', firstRate: 2, margin: 0 }, 1_050, 1, '2026-11-15', 3, 3.75)
    expect(r.net).toBeGreaterThan(1_050)
    expect(r.net).toBeLessThan(1_050 + 10 * 2 * 0.81 + 1)
  })
  it('COI coupons are kept (net) and counted', () => {
    const r = compareBond({ code: 'COI', firstRate: 4.75, margin: 1.5 }, 10_000, 4, '2026-11-15', 3, 3.75)
    // coupons 4.75 + 3 × 4.50, tax rounded per coupon: 0.90 and 0.86 (0.855 → 0.86) → 3.85 + 3 × 3.64 = 14.77 per bond
    expect(r.net).toBe(11_477)
  })
  it('amount below one bond: nothing invested, money stays as is', () => {
    expect(compareBond({ code: 'EDO', firstRate: 5.35, margin: 2 }, 50, 5, '2026-11-15', 3, 3.75).net).toBe(50)
  })
  it('deposit: yearly Belka', () => {
    const d = compareDeposit(10_000, 5, 2, 3)
    expect(d.net).toBe(10_000 + 405 + round(10_405 * 0.05 * 0.81))
    expect(compareDeposit(0, 5, 2, 3).annual).toBe(0)
  })
})
const round = (x: number) => Math.round(x * 100) / 100

describe('translations', () => {
  it('Polish, English and German have exactly the same keys', () => {
    const pl = Object.keys(DICTS.pl).sort()
    expect(Object.keys(DICTS.en).sort()).toEqual(pl)
    expect(Object.keys(DICTS.de).sort()).toEqual(pl)
  })
  it('no empty texts; placeholders match across languages', () => {
    for (const k of Object.keys(DICTS.pl)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
      for (const l of LANGS) expect(DICTS[l][k].trim().length, `${l} ${k}`).toBeGreaterThan(0)
      expect(ph(DICTS.en[k]), `en ${k}`).toBe(ph(DICTS.pl[k]))
      expect(ph(DICTS.de[k]), `de ${k}`).toBe(ph(DICTS.pl[k]))
    }
  })
  it('every insight the engine can produce has a title and a text in all languages', () => {
    const mk = (closes: number[]) => closes.map((c, i) => ({ date: new Date(Date.UTC(2025, 6, 1) + i * 86_400_000).toISOString().slice(0, 10), close: c }))
    const assets: Asset[] = [
      { id: 'a', kind: 'bond', code: 'EDO', purchase: '2026-05-12', count: 100, firstRate: 5.6, margin: 2 },
      { id: 'b', kind: 'deposit', amount: 50_000, rate: 2, start: '2026-11-01', months: 1, renewRate: 1 },
      { id: 'c', kind: 'stock', name: 'X', quantity: 100, cost: 10_000, manualPrice: 40 },
      { id: 'd', kind: 'cash', amount: 100_000 },
    ]
    const sectors = rankSectors(['up', 'down', 'cross'].map((code, k) => ({ code, report: analyzeTrend(mk(Array.from({ length: 300 + k * 60 }, (_, i) => (k === 1 ? 400 - i : 100 + i * (k === 2 && i > 300 ? -2 : 0.5)))), undefined, 400) })))
    const keys = new Set<string>()
    for (const p of [{ ...DEFAULT_PROFILE, family800: true, monthlyExpenses: 1000 }, { ...DEFAULT_PROFILE, monthlyExpenses: 100_000 }, DEFAULT_PROFILE, { ...DEFAULT_PROFILE, risk: 1 as const, monthlyExpenses: 30_000 }])
      for (const i of buildInsights({ asOf: '2026-11-20', summary: summarize(assets, { asOf: '2026-11-20', cpi: [], refRates: [], prices: new Map() }), profile: p, cpi: { month: '2026-10', yoy: 3.5 }, offer: [{ code: 'EDO', series: 'EDO1136', firstRate: 5.35, margin: 2 }, { code: 'ROD', series: 'ROD1138', firstRate: 5.6, margin: 2.5 }], sectors })) keys.add(i.key)
    keys.add('insight.empty')
    for (const k of ['golden-cross', 'death-cross', 'above-200', 'below-200', 'momentum-positive', 'momentum-negative']) keys.add(`insight.trend.${k}`)
    expect(keys.size).toBeGreaterThan(12)
    for (const k of keys)
      for (const l of LANGS) {
        expect(DICTS[l][`${k}.title`], `${l} ${k}.title`).toBeTruthy()
        expect(DICTS[l][k.startsWith('insight.trend.') ? 'insight.trend.body' : `${k}.body`], `${l} ${k}.body`).toBeTruthy()
      }
  })
  it('formatting: variables, money, percent, dates per language', () => {
    expect(translate('pl', 'dataAsOf', { date: '20.11' })).toBe('Dane z 20.11')
    expect(translate('de', 'missing.key')).toBe('missing.key')
    expect(translate('en', 'insight.ike.title', { limit: 28_260 })).toBe('IKE: up to 28,260 zł a year without Belka tax')
    expect(money('pl', 1_234_567).replace(/\s/g, ' ')).toBe('1 234 567 zł')
    expect(money('en', 12.5, 2)).toContain('12.50')
    expect(percent('pl', 0.123).replace(/\s/g, '')).toBe('12,3%')
    expect(percent('en', 0.05, 1, true)).toBe('+5.0%')
    expect(percent('de', null)).toBe('–')
    expect(dateFmt('pl', '2026-11-20')).toContain('2026')
    expect(dateFmt('en', '')).toBe('–')
  })
})

describe('insight texts are localized', async () => {
  const { localParams } = await import('@web/components/ui')
  it('ISO dates and decimal points follow the language', () => {
    const p = { end: '2026-12-20', offers: 'OTS 2%, TOS 4.4%, EDO 5.35%', n: 3.5 }
    const pl = localParams('pl', p)
    expect(pl.offers).toBe('OTS 2%, TOS 4,4%, EDO 5,35%')
    expect(String(pl.end)).toMatch(/20 gru 2026/)
    expect(localParams('en', p).offers).toBe('OTS 2%, TOS 4.4%, EDO 5.35%')
    expect(pl.n).toBe(3.5)
  })
})

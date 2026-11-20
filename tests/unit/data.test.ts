import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isXls, parseGpwXls, parseGusCpi, parseNbpRates, parseNbpArchive, parseBondPage, parseNbpFx, parseNbpGold, INDICES, SECTORS, GUS, gusSection, gusPeriod, BOND_PAGES, type GusRow } from '@data/parse'
import { toCsv, fromCsv, mergeBars, groupRows, fileKey, missingDays } from '@data/store'
import { summarizeIndices, SECTOR_NAMES } from '@data/summaries'
import { BOND_CODES } from '@core/bonds'

const fx = (p: string) => readFileSync(join(__dirname, '..', 'fixtures', p))
const txt = (p: string) => fx(p).toString('utf8')

describe('GPW official archive (real files from 19 Nov 2026)', () => {
  const indices = parseGpwXls(new Uint8Array(fx('gpw/indices-2026-11-19.xls')))
  const shares = parseGpwXls(new Uint8Array(fx('gpw/shares-2026-11-19.xls')))
  it('recognises the .xls and the HTML returned on non-trading days', () => {
    expect(isXls(new Uint8Array(fx('gpw/indices-2026-11-19.xls')))).toBe(true)
    const html = new Uint8Array(fx('gpw/weekend-form.html'))
    expect(isXls(html)).toBe(false)
    expect(parseGpwXls(html)).toEqual([])
    expect(isXls(new Uint8Array([1, 2]))).toBe(false)
  })
  it('indices: every tracked index is present (names exactly as GPW writes them)', () => {
    const names = new Set(indices.map((r) => r.name))
    for (const i of INDICES) expect(names.has(i), i).toBe(true)
    expect(indices.every((r) => r.date === '2026-11-19' && r.close > 0)).toBe(true)
    expect(SECTORS).toHaveLength(14)
    expect(SECTORS).not.toContain('WIG')
  })
  it('shares: Skarbiec Holding and SNTverse with ISIN and close', () => {
    expect(shares.length).toBeGreaterThan(350)
    expect(shares.find((r) => r.name === 'SKARBIEC')).toMatchObject({ isin: 'PLSKRBH00014', close: 36.4, date: '2026-11-19' })
    expect(shares.find((r) => r.name === 'SNTVERSE')).toMatchObject({ isin: 'PLBMDLB00018', close: 2.67 })
    const r = shares.find((x) => x.name === 'SKARBIEC')!
    expect(typeof r.volume).toBe('number')
    expect(r.high! >= r.low!).toBe(true)
  })
})

describe('GUS CPI (DBW API)', () => {
  it('real page for October 2025 (old COICOP section): total CPI y/y = 2.8 %', () => {
    expect(parseGusCpi(JSON.parse(txt('gus/cpi-736-2025-10.json')))).toEqual([{ month: '2025-10', yoy: 2.8 }])
  })
  it('2026+ section, filters measure, household group, region and missing values', () => {
    const row = (o: Partial<GusRow>): GusRow => ({ 'id-pozycja-1': 33617, 'id-pozycja-2': GUS.totalNew, 'id-pozycja-3': GUS.households, 'id-okres': 256, 'id-sposob-prezentacji-miara': 5, 'id-daty': 2026, wartosc: 103.5, ...o })
    const page = { data: [row({}), row({ 'id-sposob-prezentacji-miara': 2, wartosc: 100.2 }), row({ 'id-pozycja-3': 630869, wartosc: 101 }), row({ 'id-pozycja-1': 1, wartosc: 99 }), row({ 'id-pozycja-2': 123 }), row({ 'id-okres': 260 }), row({ wartosc: null }), row({ 'id-okres': 247, wartosc: 102.1 })] }
    expect(parseGusCpi(page)).toEqual([
      { month: '2026-10', yoy: 3.5 },
      { month: '2026-01', yoy: 2.1 },
    ])
    expect(parseGusCpi({})).toEqual([])
  })
  it('section and period ids', () => {
    expect(gusSection(2025)).toBe(736)
    expect(gusSection(2026)).toBe(1698)
    expect(gusPeriod(1)).toBe(247)
    expect(gusPeriod(12)).toBe(258)
  })
})

describe('NBP', () => {
  it('reference rate from the official XML (BOM, decimal comma)', () => {
    expect(parseNbpRates(txt('nbp/stopy.xml'))).toEqual({ ref: 3.75, from: '2026-03-05', published: '2026-03-05' })
    expect(() => parseNbpRates('<stopy_procentowe><tabela id="x"><pozycja id="lom" oprocentowanie="1"/></tabela></stopy_procentowe>')).toThrow()
  })
  it('archive: sorted list of reference rates', () => {
    const a = parseNbpArchive(txt('nbp/stopy-archiwum.xml'))
    expect(a.length).toBeGreaterThan(20)
    expect(a[0]).toEqual({ from: '1998-02-26', rate: 24 })
    for (let i = 1; i < a.length; i++) expect(a[i].from > a[i - 1].from).toBe(true)
    expect(parseNbpArchive('<x/>')).toEqual([])
  })
  it('FX table and gold', () => {
    expect(parseNbpFx([{ effectiveDate: '2026-11-20', rates: [{ code: 'EUR', mid: 4.4559 }, { code: 'USD', mid: 4.0613 }] }])).toEqual({ date: '2026-11-20', rates: { EUR: 4.4559, USD: 4.0613 } })
    expect(parseNbpGold([{ data: '2026-11-20', cena: 481.23 }])).toEqual([{ date: '2026-11-20', price: 481.23 }])
  })
})

describe('treasury bond offer (real pages, November 2026)', () => {
  const expected = {
    OTS: ['OTS0227', 2, 0],
    ROR: ['ROR1127', 4, 0],
    DOR: ['DOR1128', 4.15, 0.15],
    TOS: ['TOS1129', 4.4, 0],
    COI: ['COI1130', 4.75, 1.5],
    EDO: ['EDO1136', 5.35, 2],
    ROS: ['ROS1132', 5, 2],
    ROD: ['ROD1138', 5.6, 2.5],
  } as const
  for (const code of BOND_CODES)
    it(`${code}: series, first rate, margin`, () => {
      const o = parseBondPage(code, txt(`bonds/${code.toLowerCase()}.html`))
      expect([o.series, o.firstRate, o.margin]).toEqual(expected[code])
      expect(o.label.length).toBeGreaterThan(5)
      expect(BOND_PAGES[code]).toContain(code.toLowerCase())
    })
  it('a page without the offer fields or with the wrong series is rejected', () => {
    expect(() => parseBondPage('EDO', '<html></html>')).toThrow()
    expect(() => parseBondPage('COI', txt('bonds/edo.html'))).toThrow(/unexpected series/)
    const noRate = '<strong class="product-details__list-label">Seria:</strong><span class="product-details__list-value">EDO1136</span><strong class="product-details__list-label">Oprocentowanie:</strong><span class="product-details__list-value">zmienne</span>'
    expect(() => parseBondPage('EDO', noRate)).toThrow(/no rate/)
  })
})

describe('storage', () => {
  it('CSV round trip with and without volume; malformed lines are skipped', () => {
    const bars = [{ date: '2026-11-18', close: 10.5, volume: 100 }, { date: '2026-11-19', close: 11, volume: null }]
    expect(fromCsv(toCsv(bars))).toEqual(bars)
    expect(fromCsv(toCsv([{ date: '2026-11-19', close: 3 }]))).toEqual([{ date: '2026-11-19', close: 3 }])
    expect(fromCsv('date,close\nbad,1\n2026-11-19,0\n2026-11-20,2\n')).toEqual([{ date: '2026-11-20', close: 2 }])
    expect(fromCsv('nonsense')).toEqual([])
  })
  it('merge: newer value wins, sorted, no duplicates', () => {
    const m = mergeBars([{ date: '2026-11-19', close: 1 }, { date: '2026-11-17', close: 1 }], [{ date: '2026-11-19', close: 2 }, { date: '2026-11-20', close: 3 }])
    expect(m).toEqual([{ date: '2026-11-17', close: 1 }, { date: '2026-11-19', close: 2 }, { date: '2026-11-20', close: 3 }])
  })
  it('group a day file by name / ISIN, file keys are safe', () => {
    const rows = parseGpwXls(new Uint8Array(fx('gpw/shares-2026-11-19.xls')))
    expect(groupRows(rows, 'isin').get('PLSKRBH00014')?.close).toBe(36.4)
    expect(groupRows(parseGpwXls(new Uint8Array(fx('gpw/indices-2026-11-19.xls'))), 'name').has('WIG-BANKI')).toBe(true)
    expect(fileKey('WIG-BANKI')).toBe('WIG-BANKI')
    expect(fileKey('a/b c')).toBe('a_b_c')
  })
  it('missing trading days skip weekends; backfill counts calendar days', () => {
    expect(missingDays('2026-11-19', '2026-11-24', 10)).toEqual(['2026-11-20', '2026-11-23', '2026-11-24'])
    expect(missingDays(null, '2026-11-20', 7)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'])
    expect(missingDays('2026-11-20', '2026-11-20', 7)).toEqual([])
  })
})

describe('index summaries', () => {
  it('ranks only sectors, measures them against the WIG, names exist in 3 languages', () => {
    const mk = (step: number) => Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), close: 100 + i * step }))
    const m = new Map([
      ['WIG', mk(0.2)],
      ['WIG-GRY', mk(0.6)],
      ['WIG-BANKI', mk(0.1)],
      ['WIG20', mk(0.3)],
      ['EMPTY', []],
    ])
    const r = summarizeIndices(m)
    expect(r.indices.map((x) => x.code)).toEqual(['WIG', 'WIG-BANKI', 'WIG-GRY', 'WIG20'])
    expect(r.sectors.map((x) => x.code)).toEqual(['WIG-GRY', 'WIG-BANKI'])
    expect(r.sectors[0].report.rs3m).toBeGreaterThan(0)
    for (const i of INDICES) expect(SECTOR_NAMES[i], i).toMatchObject({ pl: expect.any(String), en: expect.any(String), de: expect.any(String) })
  })
})

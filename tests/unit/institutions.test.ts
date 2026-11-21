import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseKnf, parsePwpa, parseReportRating } from '@data/parse'

const fx = (f: string) => readFileSync(`tests/fixtures/${f}`, 'utf8')

describe('GPW analytical coverage programme (GPWPA)', () => {
  it('reads date, ticker, company, PDF link, report type and broker from the report list', () => {
    const r = parsePwpa(fx('pwpa.html'))
    expect(r).toHaveLength(3)
    expect(r[0]).toEqual({ date: '2026-11-20', code: 'NVA', company: 'P.A. NOVA S.A.', pdf: '/pub/pwpa/20261120_ipopema_securities_nva_pl_aw.pdf', type: 'analiza wyników', broker: 'IPOPEMA Securities S.A.' })
    expect(r.every((x) => x.pdf.startsWith('/pub/pwpa/') && /^\d{4}-\d{2}-\d{2}$/.test(x.date))).toBe(true)
  })
  it('skips rows without a date or a PDF and decodes entities', () => {
    expect(parsePwpa('<tr><td>x</td><td>A</td><td>B</td><td>no link</td><td>t</td><td>b</td></tr>')).toEqual([])
    expect(parsePwpa('<tr><td>2026-01-02</td><td>A&amp;B</td><td>&quot;X&quot; S.A.</td><td><a href="/pub/pwpa/a.pdf">a</a></td><td>komentarz</td><td>DM&nbsp;X</td></tr>')[0]).toMatchObject({ code: 'A&B', company: '"X" S.A.', broker: 'DM X' })
    expect(parsePwpa('<tr><td>2026-01-02</td></tr>')).toEqual([])
  })
})

describe('KNF public warning list', () => {
  it('reads every entity with its identifier and the note', () => {
    const k = parseKnf(fx('knf.html'))
    expect(k).toHaveLength(3)
    expect(k[0].name).toContain('Bank Gospodarczy')
    expect(k[0].id).toBe('brak danych')
    expect(k[1].name.split('\n')).toHaveLength(4)
    expect(k[1].id).toContain('KRS 0000399383')
    expect(k[2].info).toContain('art. 171')
    expect(parseKnf('<p>nothing</p>')).toEqual([])
  })
})

describe('broker rating on the first page of a report', () => {
  it('prefers the rating stated next to "rekomendacja"', () => {
    expect(parseReportRating('Opis spółki. Rating definitions: SELL means… Wydajemy rekomendację Trzymaj dla walorów BioMaxima')).toEqual({ rating: 'hold' })
    expect(parseReportRating('Recommendation: OUTPERFORM')).toEqual({ rating: 'buy' })
  })
  it('falls back to the first rating word; maps Polish and English words', () => {
    expect(parseReportRating('VIGO Photonics  KUPUJ  Solidny wzrost')).toEqual({ rating: 'buy' })
    expect(parseReportRating('Akumuluj')).toEqual({ rating: 'accumulate' })
    expect(parseReportRating('Neutralnie')).toEqual({ rating: 'hold' })
    expect(parseReportRating('REDUKUJ')).toEqual({ rating: 'reduce' })
    expect(parseReportRating('Sprzedaj')).toEqual({ rating: 'sell' })
    expect(parseReportRating('underweight')).toEqual({ rating: 'sell' })
    expect(parseReportRating('Wyniki za III kwartał')).toEqual({ rating: undefined })
  })
})

describe('stale answers and dated history', () => {
  it('a point older than 10 days is stale (the NBP API once answered with data from 2023)', async () => {
    const { isFresh } = await import('@data/store')
    expect(isFresh('2026-11-20', '2026-11-21')).toBe(true)
    expect(isFresh('2023-06-23', '2026-11-21')).toBe(false)
    expect(isFresh('2026-11-01', '2026-11-21', 30)).toBe(true)
    expect(isFresh(undefined, '2026-11-21')).toBe(false)
  })
  it('merges dated points, newer values win, sorted, cut at a start date', async () => {
    const { mergeDated } = await import('@data/store')
    const m = mergeDated([{ date: '2026-01-02', price: 1 }, { date: '2025-01-01', price: 0 }], [{ date: '2026-01-02', price: 2 }, { date: '2026-01-03', price: 3 }], '2026-01-01')
    expect(m).toEqual([{ date: '2026-01-02', price: 2 }, { date: '2026-01-03', price: 3 }])
    expect(mergeDated([{ date: 'b' }], [{ date: 'a' }]).map((p) => p.date)).toEqual(['a', 'b'])
  })
})

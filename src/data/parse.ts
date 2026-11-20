import * as XLSX from 'xlsx'
import { XMLParser } from 'fast-xml-parser'
import type { CpiPoint } from '../core/inflation'
import type { BondCode } from '../core/bonds'
import type { OfferItem } from '../core/insights'

/** ---------- GPW daily archive (official .xls, BIFF8) ---------- */
export interface GpwRow {
  date: string
  name: string
  isin: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  changePct: number | null
  volume: number | null
  /** turnover in thousands of PLN */
  turnover: number | null
}

/** True when the bytes are an OLE2 (.xls) file. On non-trading days the GPW returns its HTML form instead. */
export function isXls(buf: Uint8Array): boolean {
  return buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function parseGpwXls(buf: Uint8Array): GpwRow[] {
  if (!isXls(buf)) return []
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const out: GpwRow[] = []
  for (const r of rows) {
    const close = num(r['Kurs zamknięcia'])
    const name = r['Nazwa']
    const date = r['Data']
    if (!name || !date || close === null || close <= 0) continue
    out.push({
      date: String(date).slice(0, 10),
      name: String(name).trim(),
      isin: String(r['ISIN'] ?? '').trim(),
      open: num(r['Kurs otwarcia']),
      high: num(r['Kurs max']),
      low: num(r['Kurs min']),
      close,
      changePct: num(r['Zmiana']),
      volume: num(r['Wolumen']),
      turnover: num(r['Obrót']),
    })
  }
  return out
}

/** Sector and broad indices tracked (names exactly as in the GPW file). There is no telecom index on the GPW any more. */
export const INDICES = ['WIG', 'WIG20', 'MWIG40', 'SWIG80', 'WIG-BANKI', 'WIG-BUDOW', 'WIG-CHEMIA', 'WIG-ENERG', 'WIG-GORNIC', 'WIG-GRY', 'WIG-INFO', 'WIG-LEKI', 'WIG-MEDIA', 'WIG-MOTO', 'WIG-NRCHOM', 'WIG-ODZIEZ', 'WIG-PALIWA', 'WIG-SPOZYW'] as const
export const SECTORS = INDICES.filter((x) => x.startsWith('WIG-'))

/** ---------- GUS DBW: CPI y/y ---------- */
export interface GusRow {
  'id-pozycja-1': number
  'id-pozycja-2': number
  'id-pozycja-3': number
  'id-okres': number
  'id-sposob-prezentacji-miara': number
  'id-daty': number
  wartosc: number | null
}
/** Total CPI: Polska, "ogółem" (COICOP section changes in 2026), households "ogółem", measure 5 = same month a year earlier = 100 */
export const GUS = { variable: 305, sectionOld: 736, sectionNew: 1698, totalOld: 6656078, totalNew: 14916914, poland: 33617, households: 6902025, yoy: 5, firstNewYear: 2026 }
export const gusSection = (year: number) => (year >= GUS.firstNewYear ? GUS.sectionNew : GUS.sectionOld)
/** month 1..12 → id-okres 247..258 */
export const gusPeriod = (month: number) => 246 + month

export function parseGusCpi(page: { data?: GusRow[] }): CpiPoint[] {
  const out: CpiPoint[] = []
  for (const r of page.data ?? []) {
    if (r['id-pozycja-1'] !== GUS.poland || r['id-pozycja-3'] !== GUS.households || r['id-sposob-prezentacji-miara'] !== GUS.yoy) continue
    if (r['id-pozycja-2'] !== GUS.totalOld && r['id-pozycja-2'] !== GUS.totalNew) continue
    const m = r['id-okres'] - 246
    if (m < 1 || m > 12 || r.wartosc === null || !Number.isFinite(r.wartosc)) continue
    out.push({ month: `${r['id-daty']}-${String(m).padStart(2, '0')}`, yoy: Math.round((r.wartosc - 100) * 10) / 10 })
  }
  return out
}

/** ---------- NBP interest rates (XML, decimal comma, may start with a BOM) ---------- */
export function parseNbpRates(xml: string): { ref: number; from: string; published: string } {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  const j = p.parse(xml.replace(/^\uFEFF/, ''))
  const root = j.stopy_procentowe
  const tables = Array.isArray(root.tabela) ? root.tabela : [root.tabela]
  for (const t of tables) {
    const items = Array.isArray(t.pozycja) ? t.pozycja : [t.pozycja]
    const ref = items.find((x: { id: string }) => x.id === 'ref')
    if (ref) return { ref: Number(String(ref.oprocentowanie).replace(',', '.')), from: ref.obowiazuje_od, published: root.data_publikacji }
  }
  throw new Error('reference rate not found')
}

/** Archive of NBP rates: list of { from, ref } */
export function parseNbpArchive(xml: string): { from: string; rate: number }[] {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  const j = p.parse(xml.replace(/^\uFEFF/, ''))
  const groups = j.stopy_procentowe_archiwum?.pozycje ?? []
  const arr = Array.isArray(groups) ? groups : [groups]
  const out: { from: string; rate: number }[] = []
  for (const g of arr) {
    const items = Array.isArray(g.pozycja) ? g.pozycja : [g.pozycja]
    const ref = items.find((x: { id: string }) => x?.id === 'ref')
    if (ref) out.push({ from: g.obowiazuje_od, rate: Number(String(ref.oprocentowanie).replace(',', '.')) })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

/** ---------- Retail treasury bonds: current offer (obligacjeskarbowe.pl product page) ---------- */
export const BOND_PAGES: Record<BondCode, string> = {
  OTS: 'obligacje-3-miesieczne-ots',
  ROR: 'obligacje-roczne-ror',
  DOR: 'obligacje-2-letnie-dor',
  TOS: 'obligacje-3-letnie-tos',
  COI: 'obligacje-4-letnie-coi',
  EDO: 'obligacje-10-letnie-edo',
  ROS: 'obligacje-6-letnie-ros',
  ROD: 'obligacje-12-letnie-rod',
}

const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&oacute;/g, 'ó')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const pctNum = (s: string) => Number(s.replace(',', '.'))

export function parseBondPage(code: BondCode, html: string): OfferItem & { label: string; sale?: string } {
  const fields: Record<string, string> = {}
  const re = /<strong class="product-details__list-label">([^<]*)<\/strong>\s*<span class="product-details__list-value">([\s\S]*?)<\/span>/g
  for (let m = re.exec(html); m; m = re.exec(html)) fields[clean(m[1]).replace(/:$/, '')] = clean(m[2])
  // "EDO1136 ZOBACZ LIST EMISYJNY" → EDO1136
  const series = (fields['Seria'] ?? '').match(/[A-Z]{3}\d{4}/i)?.[0] ?? ''
  const rateText = fields['Oprocentowanie']
  if (!series || !rateText) throw new Error(`${code}: offer fields not found`)
  const rates = [...rateText.matchAll(/(\d+,\d+)\s*%/g)].map((m) => pctNum(m[1]))
  if (!rates.length) throw new Error(`${code}: no rate in "${rateText}"`)
  const firstRate = rates[0]
  // margin: "marża 2,00% + inflacja" / "stopa referencyjna NBP+0,15%"; fixed bonds have no margin
  const mm = rateText.match(/marża\s*(\d+,\d+)\s*%/i) ?? rateText.match(/referencyjna\s*NBP\s*\+\s*(\d+,\d+)\s*%/i)
  const margin = mm ? pctNum(mm[1]) : 0
  if (!series.toUpperCase().startsWith(code)) throw new Error(`${code}: unexpected series ${series}`)
  return { code, series: series.toUpperCase(), firstRate, margin, label: rateText, sale: fields['Sprzedaż'] }
}

/** ---------- NBP FX and gold (JSON API) ---------- */
export function parseNbpFx(json: unknown): { date: string; rates: Record<string, number> } {
  const t = (json as { effectiveDate: string; rates: { code: string; mid: number }[] }[])[0]
  return { date: t.effectiveDate, rates: Object.fromEntries(t.rates.map((r) => [r.code, r.mid])) }
}
export function parseNbpGold(json: unknown): { date: string; price: number }[] {
  return (json as { data: string; cena: number }[]).map((x) => ({ date: x.data, price: x.cena }))
}

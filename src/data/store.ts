import type { Bar } from '../core/stats'
import type { GpwRow } from './parse'

/** Compact CSV storage of daily series: "date,close[,volume]" with a header line. */
export interface StoredBar extends Bar {
  volume?: number | null
}

export function toCsv(bars: readonly StoredBar[]): string {
  const withVol = bars.some((b) => b.volume !== undefined && b.volume !== null)
  const head = withVol ? 'date,close,volume' : 'date,close'
  return [head, ...bars.map((b) => (withVol ? `${b.date},${b.close},${b.volume ?? ''}` : `${b.date},${b.close}`))].join('\n') + '\n'
}

export function fromCsv(csv: string): StoredBar[] {
  const lines = csv.trim().split(/\r?\n/)
  if (!lines.length || !lines[0].startsWith('date,close')) return []
  const out: StoredBar[] = []
  for (const l of lines.slice(1)) {
    const [date, close, volume] = l.split(',')
    const c = Number(close)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(c > 0)) continue
    out.push(volume !== undefined ? { date, close: c, volume: volume === '' ? null : Number(volume) } : { date, close: c })
  }
  return out
}

/** Merge new bars into a series: newer values for the same date win, result sorted ascending, no duplicates. */
export function mergeBars(existing: readonly StoredBar[], incoming: readonly StoredBar[]): StoredBar[] {
  const m = new Map(existing.map((b) => [b.date, b]))
  for (const b of incoming) m.set(b.date, b)
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Group one GPW day file into per-instrument bars (keyed by name for indices, by ISIN for shares). */
export function groupRows(rows: readonly GpwRow[], key: 'name' | 'isin'): Map<string, StoredBar> {
  const out = new Map<string, StoredBar>()
  for (const r of rows) {
    const k = key === 'isin' ? r.isin : r.name
    if (k) out.set(k, { date: r.date, close: r.close, volume: r.volume })
  }
  return out
}

/** Safe file name for an instrument key */
export function fileKey(k: string): string {
  return k.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Trading days still missing between the last stored day and `to` (weekdays only; holidays are skipped by the source). */
export function missingDays(lastStored: string | null, to: string, backfillDays: number): string[] {
  const out: string[] = []
  const end = Date.parse(to + 'T00:00:00Z')
  const start = lastStored ? Date.parse(lastStored + 'T00:00:00Z') + 86_400_000 : end - (backfillDays - 1) * 86_400_000
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t)
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

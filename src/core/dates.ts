/** Calendar helpers on ISO dates (YYYY-MM-DD), timezone-free (UTC arithmetic). */
export type ISODate = string

const DAY = 86_400_000
export function parseISO(d: ISODate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid date ${d}`)
  const [y, m, dd] = d.split('-').map(Number)
  const t = Date.UTC(y, m - 1, dd)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== dd) throw new Error(`invalid date ${d}`)
  return t
}
export function toISO(t: number): ISODate {
  return new Date(t).toISOString().slice(0, 10)
}
export function today(now = Date.now()): ISODate {
  return toISO(now)
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b) - parseISO(a)) / DAY)
}
export function addDays(d: ISODate, n: number): ISODate {
  return toISO(parseISO(d) + n * DAY)
}
/** Add calendar months; the day is clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, dd] = d.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return toISO(Date.UTC(ny, nm, Math.min(dd, last)))
}
export function addYears(d: ISODate, n: number): ISODate {
  return addMonths(d, 12 * n)
}
/** "YYYY-MM" of a date */
export function monthOf(d: ISODate): string {
  return d.slice(0, 7)
}
/** month key n months before/after "YYYY-MM" */
export function shiftMonth(ym: string, n: number): string {
  return addMonths(`${ym}-01`, n).slice(0, 7)
}
export function yearFraction(a: ISODate, b: ISODate): number {
  return daysBetween(a, b) / 365.25
}
export function isWeekend(d: ISODate): boolean {
  const w = new Date(parseISO(d)).getUTCDay()
  return w === 0 || w === 6
}

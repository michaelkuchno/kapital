/** Price-series statistics. A series is sorted by date ascending; closes > 0. 252 sessions ≈ 1 year on the GPW. */
export interface Bar {
  date: string
  close: number
}
export const TRADING_DAYS = 252

export function assertSeries(s: readonly Bar[]): void {
  for (let i = 0; i < s.length; i++) {
    if (!(s[i].close > 0)) throw new Error(`non-positive close at ${s[i].date}`)
    if (i && s[i].date <= s[i - 1].date) throw new Error(`series not strictly ascending at ${s[i].date}`)
  }
}

export function returns(s: readonly Bar[]): number[] {
  const out: number[] = []
  for (let i = 1; i < s.length; i++) out.push(s[i].close / s[i - 1].close - 1)
  return out
}
export function logReturns(s: readonly Bar[]): number[] {
  const out: number[] = []
  for (let i = 1; i < s.length; i++) out.push(Math.log(s[i].close / s[i - 1].close))
  return out
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}
/** sample standard deviation (n − 1) */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

/** annualised volatility of daily log returns */
export function volatility(s: readonly Bar[], days = TRADING_DAYS): number {
  return stdev(logReturns(s)) * Math.sqrt(days)
}

/** total return between the first and last bar */
export function totalReturn(s: readonly Bar[]): number {
  return s.length < 2 ? 0 : s[s.length - 1].close / s[0].close - 1
}

/** compound annual growth rate using calendar time */
export function cagr(s: readonly Bar[]): number {
  if (s.length < 2) return 0
  const years = (Date.parse(s[s.length - 1].date) - Date.parse(s[0].date)) / (365.25 * 86_400_000)
  return years > 0 ? Math.pow(s[s.length - 1].close / s[0].close, 1 / years) - 1 : 0
}

/** return over the last n sessions (null when the series is too short) */
export function trailingReturn(s: readonly Bar[], n: number, skip = 0): number | null {
  const end = s.length - 1 - skip
  const start = end - n
  if (start < 0 || end < 0) return null
  return s[end].close / s[start].close - 1
}

export interface Drawdown {
  maxDrawdown: number
  peakDate: string
  troughDate: string
  /** drawdown of the last close from the running peak */
  current: number
}
export function drawdown(s: readonly Bar[]): Drawdown {
  let peak = s[0]
  let best: Drawdown = { maxDrawdown: 0, peakDate: s[0]?.date ?? '', troughDate: s[0]?.date ?? '', current: 0 }
  for (const b of s) {
    if (b.close > peak.close) peak = b
    const dd = b.close / peak.close - 1
    if (dd < best.maxDrawdown) best = { ...best, maxDrawdown: dd, peakDate: peak.date, troughDate: b.date }
  }
  const last = s[s.length - 1]
  return { ...best, current: last ? last.close / peak.close - 1 : 0 }
}

/** simple moving average of closes; null where not enough data */
export function sma(s: readonly Bar[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  let acc = 0
  for (let i = 0; i < s.length; i++) {
    acc += s[i].close
    if (i >= n) acc -= s[i - n].close
    out.push(i >= n - 1 ? acc / n : null)
  }
  return out
}

/** exponential moving average (seeded with the SMA of the first n values) */
export function ema(values: readonly number[], n: number): (number | null)[] {
  const k = 2 / (n + 1)
  const out: (number | null)[] = []
  let prev: number | null = null
  let acc = 0
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      acc += values[i]
      if (i === n - 1) prev = acc / n
      out.push(prev)
    } else {
      prev = values[i] * k + prev * (1 - k)
      out.push(prev)
    }
  }
  return out
}

/** RSI (Wilder) of the last bar */
export function rsi(s: readonly Bar[], n = 14): number | null {
  if (s.length <= n) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= n; i++) {
    const d = s[i].close - s[i - 1].close
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= n
  loss /= n
  for (let i = n + 1; i < s.length; i++) {
    const d = s[i].close - s[i - 1].close
    gain = (gain * (n - 1) + Math.max(0, d)) / n
    loss = (loss * (n - 1) + Math.max(0, -d)) / n
  }
  if (loss === 0) return 100
  return 100 - 100 / (1 + gain / loss)
}

/** align two series on common dates */
export function align(a: readonly Bar[], b: readonly Bar[]): [Bar[], Bar[]] {
  const m = new Map(b.map((x) => [x.date, x]))
  const aa: Bar[] = []
  const bb: Bar[] = []
  for (const x of a) {
    const y = m.get(x.date)
    if (y) {
      aa.push(x)
      bb.push(y)
    }
  }
  return [aa, bb]
}

/** beta and correlation of a series against a benchmark (daily returns on common dates) */
export function betaCorr(s: readonly Bar[], bench: readonly Bar[]): { beta: number; corr: number } {
  const [a, b] = align(s, bench)
  const ra = returns(a)
  const rb = returns(b)
  if (ra.length < 3) return { beta: NaN, corr: NaN }
  const ma = mean(ra)
  const mb = mean(rb)
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb)
    va += (ra[i] - ma) ** 2
    vb += (rb[i] - mb) ** 2
  }
  return { beta: vb ? cov / vb : NaN, corr: va && vb ? cov / Math.sqrt(va * vb) : NaN }
}

/** Sharpe ratio: (annual return − risk-free) / annual volatility */
export function sharpe(s: readonly Bar[], riskFree: number): number {
  const v = volatility(s)
  return v ? (cagr(s) - riskFree) / v : NaN
}

/** ratio series a / b (relative strength), on common dates */
export function relative(a: readonly Bar[], b: readonly Bar[]): Bar[] {
  const [aa, bb] = align(a, b)
  return aa.map((x, i) => ({ date: x.date, close: x.close / bb[i].close }))
}

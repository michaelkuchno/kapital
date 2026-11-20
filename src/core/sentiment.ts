import { sma, type Bar } from './stats'

/**
 * Fear & Greed index (0 = extreme fear, 100 = extreme greed), built like the well-known market sentiment composites:
 * every component is turned into a percentile of its own history (so it says "how unusual is today"), and the index is
 * the average of the available components. Separate indices for the Polish market (GPW data) and the world (FRED: VIX,
 * S&P 500, high-yield bond spread). Sentiment extremes are a description of the mood, not a timing signal.
 */
export type Mood = 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed'
export interface Component {
  id: string
  /** 0–100, high = greed */
  score: number
  /** raw value today (for display) */
  value: number
}
export interface SentimentPoint {
  date: string
  score: number
}
export interface Sentiment {
  score: number
  mood: Mood
  components: Component[]
  history: SentimentPoint[]
}

export function mood(score: number): Mood {
  return score < 25 ? 'extreme-fear' : score < 45 ? 'fear' : score <= 55 ? 'neutral' : score <= 75 ? 'greed' : 'extreme-greed'
}

/** percentile rank of x within xs, mid-rank for ties (all equal → 50), 0–100 */
export function percentileRank(xs: readonly number[], x: number): number {
  if (!xs.length) return 50
  let below = 0
  let equal = 0
  for (const v of xs) {
    if (v < x) below++
    else if (v === x) equal++
  }
  return ((below + equal / 2) / xs.length) * 100
}

/** A dated raw indicator series. */
export type Series = { date: string; value: number }[]

/** Score a raw series day by day against its trailing window (no look-ahead), optionally inverted (high value = fear). */
export function scoreSeries(s: Series, window = 504, invert = false, minHistory = 60): Series {
  const out: Series = []
  for (let i = 0; i < s.length; i++) {
    const from = Math.max(0, i - window + 1)
    if (i - from + 1 < minHistory) continue
    const hist = s.slice(from, i + 1).map((p) => p.value)
    const p = percentileRank(hist, s[i].value)
    out.push({ date: s[i].date, value: invert ? 100 - p : p })
  }
  return out
}

/** distance of the close from its n-session average, as a dated series */
export function distanceFromAverage(bars: readonly Bar[], n: number): Series {
  const a = sma(bars, n)
  return bars.flatMap((b, i) => (a[i] ? [{ date: b.date, value: b.close / a[i]! - 1 }] : []))
}

/** n-session return, as a dated series */
export function rollingReturn(bars: readonly Bar[], n: number): Series {
  return bars.slice(n).map((b, i) => ({ date: b.date, value: b.close / bars[i].close - 1 }))
}

/** annualised realised volatility of daily log returns over n sessions */
export function rollingVol(bars: readonly Bar[], n: number): Series {
  const r = bars.slice(1).map((b, i) => Math.log(b.close / bars[i].close))
  const out: Series = []
  for (let i = n - 1; i < r.length; i++) {
    const w = r.slice(i - n + 1, i + 1)
    const m = w.reduce((a, b) => a + b, 0) / n
    out.push({ date: bars[i + 1].date, value: Math.sqrt((w.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) * 252) })
  }
  return out
}

/** difference of two dated series on common dates */
export function spread(a: Series, b: Series): Series {
  const m = new Map(b.map((p) => [p.date, p.value]))
  return a.flatMap((p) => (m.has(p.date) ? [{ date: p.date, value: p.value - m.get(p.date)! }] : []))
}

/** Combine scored components into the index: average of the components available on each date. */
export function combine(components: { id: string; raw: Series; scored: Series }[], historyDays = 250): Sentiment {
  const byDate = new Map<string, number[]>()
  for (const c of components) for (const p of c.scored) (byDate.get(p.date) ?? byDate.set(p.date, []).get(p.date)!).push(p.value)
  const need = Math.max(1, Math.ceil(components.filter((c) => c.scored.length).length / 2))
  const history = [...byDate.entries()]
    .filter(([, v]) => v.length >= need)
    .map(([date, v]) => ({ date, score: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-historyDays)
  const last = components.filter((c) => c.scored.length).map((c) => ({ id: c.id, score: c.scored[c.scored.length - 1].value, value: c.raw[c.raw.length - 1]?.value ?? NaN }))
  const score = last.length ? last.reduce((a, c) => a + c.score, 0) / last.length : 50
  return { score, mood: mood(score), components: last, history }
}

export interface PlInputs {
  wig: readonly Bar[]
  wig20: readonly Bar[]
  swig80: readonly Bar[]
  tbsp: readonly Bar[]
  /** % of GPW shares above their 50-session average, by date (0–1) */
  breadth?: Series
  /** (new 52-week highs − new lows) / number of shares, by date */
  highsLows?: Series
}

/** Polish market: momentum, breadth, highs/lows, volatility, safe-haven demand, small-cap risk appetite. */
export function plSentiment(i: PlInputs): Sentiment {
  const momentum = distanceFromAverage(i.wig, 125)
  const vol = rollingVol(i.wig20, 20)
  const safeHaven = spread(rollingReturn(i.wig, 20), rollingReturn(i.tbsp, 20))
  const appetite = spread(rollingReturn(i.swig80, 20), rollingReturn(i.wig20, 20))
  const comps = [
    { id: 'momentum', raw: momentum, scored: scoreSeries(momentum) },
    { id: 'volatility', raw: vol, scored: scoreSeries(vol, 504, true) },
    { id: 'safe-haven', raw: safeHaven, scored: scoreSeries(safeHaven) },
    { id: 'small-caps', raw: appetite, scored: scoreSeries(appetite) },
  ]
  if (i.breadth?.length) comps.push({ id: 'breadth', raw: i.breadth, scored: scoreSeries(i.breadth) })
  if (i.highsLows?.length) comps.push({ id: 'highs-lows', raw: i.highsLows, scored: scoreSeries(i.highsLows) })
  return combine(comps)
}

export interface WorldInputs {
  vix: Series
  sp500: readonly Bar[]
  /** ICE BofA US High Yield option-adjusted spread, % */
  hySpread: Series
}

/** World: VIX level and its jump vs its 50-day average, S&P 500 momentum, junk-bond demand. */
export function worldSentiment(i: WorldInputs): Sentiment {
  const vixBars = i.vix.map((p) => ({ date: p.date, close: p.value }))
  const vixVsAvg = distanceFromAverage(vixBars, 50)
  const momentum = distanceFromAverage(i.sp500, 125)
  return combine([
    { id: 'vix', raw: i.vix, scored: scoreSeries(i.vix, 504, true) },
    { id: 'vix-jump', raw: vixVsAvg, scored: scoreSeries(vixVsAvg, 504, true) },
    { id: 'momentum', raw: momentum, scored: scoreSeries(momentum) },
    { id: 'junk-bonds', raw: i.hySpread, scored: scoreSeries(i.hySpread, 504, true) },
  ])
}

/** Market breadth from per-share closes: share of stocks above their 50-session average, and net new 52-week highs. */
export function breadth(shares: readonly (readonly Bar[])[]): { above50: Series; highsLows: Series } {
  const above = new Map<string, [number, number]>()
  const hl = new Map<string, [number, number]>()
  for (const s of shares) {
    const a = sma(s, 50)
    for (let i = 0; i < s.length; i++) {
      if (a[i] != null) {
        const e = above.get(s[i].date) ?? [0, 0]
        e[0] += s[i].close > a[i]! ? 1 : 0
        e[1]++
        above.set(s[i].date, e)
      }
      if (i >= 251) {
        let hi = -Infinity
        let lo = Infinity
        for (let k = i - 251; k < i; k++) {
          hi = Math.max(hi, s[k].close)
          lo = Math.min(lo, s[k].close)
        }
        const e = hl.get(s[i].date) ?? [0, 0]
        e[0] += s[i].close > hi ? 1 : s[i].close < lo ? -1 : 0
        e[1]++
        hl.set(s[i].date, e)
      }
    }
  }
  const toSeries = (m: Map<string, [number, number]>, min: number) =>
    [...m.entries()]
      .filter(([, [, n]]) => n >= min)
      .map(([date, [k, n]]) => ({ date, value: k / n }))
      .sort((x, y) => x.date.localeCompare(y.date))
  return { above50: toSeries(above, 20), highsLows: toSeries(hl, 20) }
}

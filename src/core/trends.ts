import { drawdown, relative, sma, trailingReturn, volatility, type Bar } from './stats'

/**
 * Trend analysis of an index or a share – the rules used by trend-following and momentum research:
 *  - 200-session moving average as the long-term trend filter (Faber 2007, "A Quantitative Approach to Tactical Asset Allocation")
 *  - 50/200 crossover ("golden cross" / "death cross") as the trend-change signal
 *  - 12-1 momentum: return over the last 12 months skipping the last month (Jegadeesh & Titman 1993)
 *  - time-series momentum: the sign of the 12-month return (Moskowitz, Ooi & Pedersen 2012)
 *  - industry momentum: sectors that did best keep doing better for months (Moskowitz & Grinblatt 1999)
 *  - relative strength against the WIG (the whole market)
 * These are statistical tendencies, not certainties; a trend can turn at any time.
 */
export type TrendState = 'up' | 'down' | 'sideways' | 'unknown'
export type TrendEvent =
  | { kind: 'golden-cross' | 'death-cross'; date: string }
  | { kind: 'above-200' | 'below-200'; date: string }
  | { kind: 'momentum-positive' | 'momentum-negative'; date: string }

export interface TrendReport {
  last: number
  date: string
  state: TrendState
  sma50: number | null
  sma200: number | null
  /** distance of the last close from the 200-session average, fraction */
  vs200: number | null
  ret1m: number | null
  ret3m: number | null
  ret12m: number | null
  /** 12-1 momentum */
  mom12_1: number | null
  rs3m: number | null
  vol: number
  drawdown: number
  maxDrawdown: number
  /** trend changes within the look-back window (newest first) */
  events: TrendEvent[]
  /** combined score for ranking sectors (higher = stronger), null when there is not enough history */
  score: number | null
}

const M1 = 21
const M3 = 63
const M12 = 252

function crossEvents(s: readonly Bar[], fast: (number | null)[], slow: (number | null)[], from: number): TrendEvent[] {
  const ev: TrendEvent[] = []
  for (let i = Math.max(1, from); i < s.length; i++) {
    const f0 = fast[i - 1]
    const s0 = slow[i - 1]
    const f1 = fast[i]
    const s1 = slow[i]
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue
    if (f0 <= s0 && f1 > s1) ev.push({ kind: 'golden-cross', date: s[i].date })
    if (f0 >= s0 && f1 < s1) ev.push({ kind: 'death-cross', date: s[i].date })
  }
  return ev
}

export function analyzeTrend(s: readonly Bar[], benchmark?: readonly Bar[], lookback = 10): TrendReport {
  if (!s.length) throw new Error('empty series')
  const last = s[s.length - 1]
  const a50 = sma(s, 50)
  const a200 = sma(s, 200)
  const from = s.length - lookback
  const events: TrendEvent[] = [...crossEvents(s, a50, a200, from)]
  // price crossing the 200-session average
  for (let i = Math.max(1, from); i < s.length; i++) {
    const p0 = a200[i - 1]
    const p1 = a200[i]
    if (p0 == null || p1 == null) continue
    if (s[i - 1].close <= p0 && s[i].close > p1) events.push({ kind: 'above-200', date: s[i].date })
    if (s[i - 1].close >= p0 && s[i].close < p1) events.push({ kind: 'below-200', date: s[i].date })
  }
  // 12-month momentum changing sign
  for (let i = Math.max(M12 + 1, from); i < s.length; i++) {
    const r0 = s[i - 1].close / s[i - 1 - M12].close - 1
    const r1 = s[i].close / s[i - M12].close - 1
    if (r0 <= 0 && r1 > 0) events.push({ kind: 'momentum-positive', date: s[i].date })
    if (r0 >= 0 && r1 < 0) events.push({ kind: 'momentum-negative', date: s[i].date })
  }
  events.sort((x, y) => y.date.localeCompare(x.date))
  const sma50 = a50[a50.length - 1]
  const sma200 = a200[a200.length - 1]
  const vs200 = sma200 ? last.close / sma200 - 1 : null
  let state: TrendState = 'unknown'
  if (sma200 != null && sma50 != null) {
    if (last.close > sma200 && sma50 > sma200) state = 'up'
    else if (last.close < sma200 && sma50 < sma200) state = 'down'
    else state = 'sideways'
  }
  const ret12m = trailingReturn(s, M12)
  const mom12_1 = trailingReturn(s, M12 - M1, M1)
  let rs3m: number | null = null
  if (benchmark?.length) rs3m = trailingReturn(relative(s, benchmark), M3)
  const dd = drawdown(s)
  const ret3m = trailingReturn(s, M3)
  // score: 12-1 momentum (main), 3-month relative strength, bonus for an up-trend (all comparable fractions)
  const score = mom12_1 == null || ret3m == null ? null : mom12_1 + 0.5 * (rs3m ?? ret3m) + (state === 'up' ? 0.05 : state === 'down' ? -0.05 : 0)
  return {
    last: last.close,
    date: last.date,
    state,
    sma50,
    sma200,
    vs200,
    ret1m: trailingReturn(s, M1),
    ret3m,
    ret12m,
    mom12_1,
    rs3m,
    vol: s.length > 2 ? volatility(s.slice(-M12)) : NaN,
    drawdown: dd.current,
    maxDrawdown: dd.maxDrawdown,
    events,
    score,
  }
}

export interface RankedSector {
  code: string
  report: TrendReport
  rank: number
}

/** Rank sectors by score (strongest first); sectors without enough history go last. */
export function rankSectors(items: readonly { code: string; report: TrendReport }[]): RankedSector[] {
  const sorted = [...items].sort((a, b) => (b.report.score ?? -Infinity) - (a.report.score ?? -Infinity) || a.code.localeCompare(b.code))
  return sorted.map((x, i) => ({ ...x, rank: i + 1 }))
}

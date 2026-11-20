import { sma, rsi, trailingReturn, drawdown, type Bar } from './stats'

/**
 * Buy / sell signals for an index, from rules with decades of published evidence:
 *  - trend: price and the 50-session average above / below the 200-session average (Faber 2007; Moskowitz et al. 2012)
 *  - momentum: return over the last 12 months without the last one (Jegadeesh & Titman 1993); 6 months when shorter history
 *  - RSI(14) extremes as a warning of a stretched market (overbought > 70, oversold < 30)
 * Every signal comes with the date it started and with a back-test of the trend rule on this index.
 */
export type Signal = 'buy' | 'sell' | 'neutral'
export interface SignalReport {
  signal: Signal
  /** date the current signal started */
  since: string
  reasons: string[]
  rsi: number | null
  /** distance from the 52-week high (≤ 0) */
  fromHigh: number
  backtest: Backtest | null
}

export function classify(close: number, a50: number | null, a200: number | null, mom: number | null): Signal {
  if (a50 == null || a200 == null || mom == null) return 'neutral'
  if (close > a200 && a50 > a200 && mom > 0) return 'buy'
  if (close < a200 && a50 < a200 && mom < 0) return 'sell'
  return 'neutral'
}

function momentumAt(s: readonly Bar[], i: number): number | null {
  if (i >= 252) return s[i - 21].close / s[i - 252].close - 1
  if (i >= 126) return s[i - 21].close / s[i - 126].close - 1
  return null
}

export function signalHistory(s: readonly Bar[]): { date: string; signal: Signal }[] {
  const a50 = sma(s, 50)
  const a200 = sma(s, 200)
  return s.map((b, i) => ({ date: b.date, signal: classify(b.close, a50[i], a200[i], momentumAt(s, i)) }))
}

export function signalReport(s: readonly Bar[]): SignalReport {
  if (!s.length) throw new Error('empty series')
  const h = signalHistory(s)
  const last = h[h.length - 1]
  let k = h.length - 1
  while (k > 0 && h[k - 1].signal === last.signal) k--
  const a50 = sma(s, 50).at(-1) ?? null
  const a200 = sma(s, 200).at(-1) ?? null
  const close = s[s.length - 1].close
  const reasons: string[] = []
  if (a200 != null) reasons.push(close > a200 ? 'above-200' : 'below-200')
  if (a50 != null && a200 != null) reasons.push(a50 > a200 ? '50-over-200' : '50-under-200')
  const mom = momentumAt(s, s.length - 1)
  if (mom != null) reasons.push(mom > 0 ? 'momentum-up' : 'momentum-down')
  const r = rsi(s.slice(-260))
  if (r != null && r > 70) reasons.push('overbought')
  if (r != null && r < 30) reasons.push('oversold')
  const year = s.slice(-252)
  const hi = Math.max(...year.map((b) => b.close))
  return { signal: last.signal, since: h[k].date, reasons, rsi: r, fromHigh: close / hi - 1, backtest: s.length >= 260 ? backtestTrend(s) : null }
}

export interface Backtest {
  from: string
  to: string
  /** total return of the rule (in the index when above the 200-day average, otherwise in cash earning `cashRate`) */
  rule: number
  buyHold: number
  ruleMaxDD: number
  buyHoldMaxDD: number
  trades: number
  timeInMarket: number
}

/** Back-test of the 200-session trend rule: decide on the close, act on the next session (no look-ahead). */
export function backtestTrend(s: readonly Bar[], cashRate = 0.04): Backtest {
  const a200 = sma(s, 200)
  const start = a200.findIndex((v) => v != null)
  let eq = 1
  let inMkt = false
  let trades = 0
  let days = 0
  let inDays = 0
  const curve: Bar[] = [{ date: s[start].date, close: 1 }]
  for (let i = start + 1; i < s.length; i++) {
    // position decided at the previous close
    const want = s[i - 1].close > a200[i - 1]!
    if (want !== inMkt) {
      trades++
      inMkt = want
    }
    eq *= inMkt ? s[i].close / s[i - 1].close : 1 + cashRate / 252
    days++
    if (inMkt) inDays++
    curve.push({ date: s[i].date, close: eq })
  }
  const bh = s.slice(start)
  return { from: s[start].date, to: s[s.length - 1].date, rule: eq - 1, buyHold: s[s.length - 1].close / s[start].close - 1, ruleMaxDD: drawdown(curve).maxDrawdown, buyHoldMaxDD: drawdown(bh).maxDrawdown, trades, timeInMarket: days ? inDays / days : 0 }
}

/** helper re-export for the UI */
export const ret12 = (s: readonly Bar[]) => trailingReturn(s, 252)

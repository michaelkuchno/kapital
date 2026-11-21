import { ema, sma, stdev, returns, type Bar } from './stats'

/**
 * Technical analysis of one instrument (index, sector, share, ETF) from its daily closes.
 * Everything here is a well-known, published method; nothing is a forecast:
 *  - market phase: the classic 20 % rule – a bear market is a fall of 20 % from a peak, a bull market a rise of 20 %
 *    from a trough (used by S&P Dow Jones Indices, Ned Davis Research); −10…−20 % inside a bull market is a correction
 *  - moving averages (SMA/EMA 10–200), MACD 12/26/9 (Appel 1979), RSI 14 (Wilder 1978), Bollinger Bands 20/2
 *    (Bollinger 2001), rate of change, a linear-regression trend channel (slope and R²)
 *  - chart patterns found on turning points (zig-zag): head and shoulders (RGR) and its inverse, double top/bottom,
 *    triangles, breakouts of support/resistance (Bulkowski, "Encyclopedia of Chart Patterns", 2005);
 *    a pattern is "confirmed" only after the close breaks its neckline; the target is the classic measured move
 *  - a summary rating that counts the votes of moving averages and oscillators (the same idea as the public
 *    technical ratings of trading platforms)
 * Research on technical rules is mixed (Brock, Lakonishok & LeBaron 1992 found value in moving-average rules;
 * Lo, Mamaysky & Wang 2000 found some information in patterns; later studies show much of it faded). The app
 * therefore shows the analysis as context and explanation, never as an instruction.
 * Only closes are available for GPW indices, so indicators that need the daily high/low (ADX, ATR, stochastic)
 * are not used.
 */

export type Vote = 'buy' | 'sell' | 'neutral'
export type Rating = 'strong-buy' | 'buy' | 'neutral' | 'sell' | 'strong-sell'
export type PhaseKind = 'bull' | 'bear' | 'correction' | 'rebound' | 'unknown'

/* ---------------- indicator series ---------------- */

export function closes(s: readonly Bar[]): number[] {
  return s.map((b) => b.close)
}

/** RSI (Wilder) for every bar; null for the first n bars. */
export function rsiSeries(s: readonly Bar[], n = 14): (number | null)[] {
  const out: (number | null)[] = s.map(() => null)
  if (s.length <= n) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= n; i++) {
    const d = s[i].close - s[i - 1].close
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= n
  loss /= n
  const val = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  out[n] = val()
  for (let i = n + 1; i < s.length; i++) {
    const d = s[i].close - s[i - 1].close
    gain = (gain * (n - 1) + Math.max(0, d)) / n
    loss = (loss * (n - 1) + Math.max(0, -d)) / n
    out[i] = val()
  }
  return out
}

/** EMA of a series that may start with nulls (the EMA starts at the first full window of values). */
function emaNullable(values: readonly (number | null)[], n: number): (number | null)[] {
  const first = values.findIndex((v) => v != null)
  if (first < 0) return values.map(() => null)
  const tail = ema(values.slice(first).map((v) => v ?? 0), n)
  return [...values.slice(0, first).map(() => null), ...tail]
}

/** MACD 12/26/9: the difference of two EMAs, its 9-day EMA (signal) and the histogram. */
export function macd(s: readonly Bar[], fast = 12, slow = 26, sig = 9): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
  const c = closes(s)
  const f = ema(c, fast)
  const sl = ema(c, slow)
  const m = c.map((_, i) => (f[i] != null && sl[i] != null ? f[i]! - sl[i]! : null))
  const signal = emaNullable(m, sig)
  return { macd: m, signal, hist: m.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null)) }
}

/** Bollinger Bands (n, k standard deviations), %B and band width (fraction of the middle band). */
export function bollinger(s: readonly Bar[], n = 20, k = 2) {
  const mid = sma(s, n)
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []
  const pctB: (number | null)[] = []
  const width: (number | null)[] = []
  for (let i = 0; i < s.length; i++) {
    const m = mid[i]
    if (m == null) {
      upper.push(null)
      lower.push(null)
      pctB.push(null)
      width.push(null)
      continue
    }
    let v = 0
    for (let j = i - n + 1; j <= i; j++) v += (s[j].close - m) ** 2
    const sd = Math.sqrt(v / n)
    const u = m + k * sd
    const l = m - k * sd
    upper.push(u)
    lower.push(l)
    pctB.push(u === l ? 0.5 : (s[i].close - l) / (u - l))
    width.push((u - l) / m)
  }
  return { mid, upper, lower, pctB, width }
}

/** Rate of change over n sessions (fraction). */
export function roc(s: readonly Bar[], n: number): number | null {
  return s.length > n ? s[s.length - 1].close / s[s.length - 1 - n].close - 1 : null
}

/** Least-squares line through the log closes of the last n sessions: yearly slope and R² (trend strength). */
export function regression(s: readonly Bar[], n = 100): { slopeYear: number; r2: number; from: number; line: number[] } | null {
  if (s.length < Math.max(10, n)) return null
  const w = s.slice(-n)
  const y = w.map((b) => Math.log(b.close))
  const xm = (n - 1) / 2
  const ym = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (i - xm) * (y[i] - ym)
    sxx += (i - xm) ** 2
    syy += (y[i] - ym) ** 2
  }
  const b = sxy / sxx
  const a = ym - b * xm
  return { slopeYear: Math.exp(b * 252) - 1, r2: syy ? (sxy * sxy) / (sxx * syy) : 0, from: s.length - n, line: y.map((_, i) => Math.exp(a + b * i)) }
}

/* ---------------- market phase (hossa / bessa) ---------------- */

export interface PhaseSegment {
  kind: 'bull' | 'bear'
  from: string
  to: string
}
export interface Phase {
  kind: PhaseKind
  /** date the current bull or bear market started (its trough / peak) */
  since: string | null
  /** change since that start */
  sinceStart: number | null
  /** distance from the highest close of the current bull market / since the data begins */
  fromPeak: number
  /** rise from the lowest close of the current bear market */
  fromTrough: number
  segments: PhaseSegment[]
}

/** The 20 % rule on closes: phases switch at the peak (bull → bear) or the trough (bear → bull). */
export function marketPhase(s: readonly Bar[], threshold = 0.2): Phase {
  const segments: PhaseSegment[] = []
  if (!s.length) return { kind: 'unknown', since: null, sinceStart: null, fromPeak: 0, fromTrough: 0, segments }
  let state: 'bull' | 'bear' | null = null
  let start = 0
  // before the first phase is known: running max and min
  let hi = 0
  let lo = 0
  for (let i = 1; i < s.length; i++) {
    const c = s[i].close
    if (state === null) {
      if (c > s[hi].close) hi = i
      if (c < s[lo].close) lo = i
      if (c >= s[lo].close * (1 + threshold)) {
        state = 'bull'
        start = lo
        hi = i
      } else if (c <= s[hi].close * (1 - threshold)) {
        state = 'bear'
        start = hi
        lo = i
      }
    } else if (state === 'bull') {
      if (c > s[hi].close) hi = i
      if (c <= s[hi].close * (1 - threshold)) {
        segments.push({ kind: 'bull', from: s[start].date, to: s[hi].date })
        state = 'bear'
        start = hi
        lo = i
      }
    } else {
      if (c < s[lo].close) lo = i
      if (c >= s[lo].close * (1 + threshold)) {
        segments.push({ kind: 'bear', from: s[start].date, to: s[lo].date })
        state = 'bull'
        start = lo
        hi = i
      }
    }
  }
  const last = s[s.length - 1]
  const peak = Math.max(...s.slice(state ? start : 0).map((b) => b.close))
  const trough = Math.min(...s.slice(state ? start : 0).map((b) => b.close))
  const fromPeak = last.close / peak - 1
  const fromTrough = last.close / trough - 1
  if (!state) return { kind: 'unknown', since: null, sinceStart: null, fromPeak, fromTrough, segments }
  segments.push({ kind: state, from: s[start].date, to: last.date })
  let kind: PhaseKind = state
  if (state === 'bull' && fromPeak <= -0.1) kind = 'correction'
  if (state === 'bear' && fromTrough >= 0.1) kind = 'rebound'
  return { kind, since: s[start].date, sinceStart: last.close / s[start].close - 1, fromPeak, fromTrough, segments }
}

/* ---------------- turning points and chart patterns ---------------- */

export interface Pivot {
  i: number
  date: string
  price: number
  type: 'high' | 'low'
}

/** Zig-zag turning points: a new pivot needs a reversal of at least `pct` from the last extreme. */
export function pivots(s: readonly Bar[], pct: number): Pivot[] {
  const out: Pivot[] = []
  if (s.length < 3) return out
  let dir: 'up' | 'down' | null = null
  let ext = 0
  // until the first swing is known: running highest and lowest close
  let hi = 0
  let lo = 0
  for (let i = 1; i < s.length; i++) {
    const c = s[i].close
    if (dir === null) {
      if (c > s[hi].close) hi = i
      if (c < s[lo].close) lo = i
      if (c >= s[lo].close * (1 + pct)) {
        out.push({ i: lo, date: s[lo].date, price: s[lo].close, type: 'low' })
        dir = 'up'
        ext = i
      } else if (c <= s[hi].close * (1 - pct)) {
        out.push({ i: hi, date: s[hi].date, price: s[hi].close, type: 'high' })
        dir = 'down'
        ext = i
      }
      continue
    }
    if (dir === 'up') {
      if (c > s[ext].close) ext = i
      else if (c <= s[ext].close * (1 - pct)) {
        out.push({ i: ext, date: s[ext].date, price: s[ext].close, type: 'high' })
        dir = 'down'
        ext = i
      }
    } else {
      if (c < s[ext].close) ext = i
      else if (c >= s[ext].close * (1 + pct)) {
        out.push({ i: ext, date: s[ext].date, price: s[ext].close, type: 'low' })
        dir = 'up'
        ext = i
      }
    }
  }
  // the last extreme is a provisional pivot
  if (dir) out.push({ i: ext, date: s[ext].date, price: s[ext].close, type: dir === 'up' ? 'high' : 'low' })
  return out
}

/** Zig-zag threshold adapted to the instrument: about one month of typical moves, between 3 % and 15 %. */
export function pivotThreshold(s: readonly Bar[]): number {
  const r = returns(s.slice(-253))
  const sd = r.length > 2 ? stdev(r) : 0.01
  return Math.min(0.15, Math.max(0.03, sd * Math.sqrt(21) * 0.9))
}

export type PatternKind =
  | 'head-shoulders'
  | 'inverse-head-shoulders'
  | 'double-top'
  | 'double-bottom'
  | 'triangle-symmetric'
  | 'triangle-ascending'
  | 'triangle-descending'
  | 'breakout-resistance'
  | 'breakdown-support'

export type PatternStatus = 'forming' | 'confirmed' | 'failed'
export interface Pattern {
  kind: PatternKind
  /** bullish (+1) or bearish (−1) meaning when confirmed */
  bias: 1 | -1
  status: PatternStatus
  /** first and last date of the pattern */
  from: string
  to: string
  /** date the neckline / line was broken */
  breakDate?: string
  /** neckline (or the broken level) at the start and the end of the chart window: two points of a line */
  line: { i1: number; p1: number; i2: number; p2: number }
  /** second line (triangles: the other side) */
  line2?: { i1: number; p1: number; i2: number; p2: number }
  /** classic measured-move target */
  target: number
  /** key points (shoulders, head, tops, bottoms) for the chart */
  points: { i: number; price: number; label: string }[]
}

const lineAt = (l: Pattern['line'], i: number) => l.p1 + ((l.p2 - l.p1) * (i - l.i1)) / (l.i2 - l.i1 || 1)

/** Find chart patterns among the turning points of the last `window` sessions. */
export function findPatterns(s: readonly Bar[], window = 260, pct = pivotThreshold(s)): Pattern[] {
  const out: Pattern[] = []
  if (s.length < 30) return out
  const startI = Math.max(0, s.length - window)
  const pv = pivots(s, pct).filter((p) => p.i >= startI)
  // the last turning point is provisional (the move may still continue): a pattern may end there only once its line is broken
  const provisional = pv.at(-1)?.i
  const last = s.length - 1
  /** first close after `from` that breaks the line downwards (dir −1) or upwards (+1) */
  const breakOf = (l: Pattern['line'], from: number, dir: 1 | -1): number | null => {
    for (let i = from + 1; i <= last; i++) if (dir < 0 ? s[i].close < lineAt(l, i) : s[i].close > lineAt(l, i)) return i
    return null
  }

  for (let k = 0; k + 4 < pv.length; k++) {
    const [a, b, c, d, e] = pv.slice(k, k + 5)
    // head and shoulders (top): high, low, higher high, low, lower high
    if (a.type === 'high') {
      const shouldersClose = Math.abs(a.price - e.price) / Math.max(a.price, e.price) <= 0.06
      const headAbove = c.price >= Math.max(a.price, e.price) * 1.02
      const neckFlat = Math.abs(b.price - d.price) / Math.max(b.price, d.price) <= 0.08
      const before = pv[k - 1]
      const upBefore = !before || before.price < Math.min(b.price, d.price)
      if (shouldersClose && headAbove && neckFlat && upBefore) {
        const line = { i1: b.i, p1: b.price, i2: d.i, p2: d.price }
        const br = breakOf(line, e.i, -1)
        const height = c.price - lineAt(line, c.i)
        const status: PatternStatus = br == null ? 'forming' : s.slice(br).some((x) => x.close > e.price) ? 'failed' : 'confirmed'
        if (br != null || (last - e.i <= 60 && e.i !== provisional))
          out.push({ kind: 'head-shoulders', bias: -1, status, from: a.date, to: e.date, breakDate: br != null ? s[br].date : undefined, line, target: (br != null ? lineAt(line, br) : lineAt(line, last)) - height, points: [{ i: a.i, price: a.price, label: 'L' }, { i: c.i, price: c.price, label: 'H' }, { i: e.i, price: e.price, label: 'R' }] })
      }
    } else {
      // inverse head and shoulders (bottom)
      const shouldersClose = Math.abs(a.price - e.price) / Math.min(a.price, e.price) <= 0.06
      const headBelow = c.price <= Math.min(a.price, e.price) * 0.98
      const neckFlat = Math.abs(b.price - d.price) / Math.min(b.price, d.price) <= 0.08
      const before = pv[k - 1]
      const downBefore = !before || before.price > Math.max(b.price, d.price)
      if (shouldersClose && headBelow && neckFlat && downBefore) {
        const line = { i1: b.i, p1: b.price, i2: d.i, p2: d.price }
        const br = breakOf(line, e.i, 1)
        const height = lineAt(line, c.i) - c.price
        const status: PatternStatus = br == null ? 'forming' : s.slice(br).some((x) => x.close < e.price) ? 'failed' : 'confirmed'
        if (br != null || (last - e.i <= 60 && e.i !== provisional))
          out.push({ kind: 'inverse-head-shoulders', bias: 1, status, from: a.date, to: e.date, breakDate: br != null ? s[br].date : undefined, line, target: (br != null ? lineAt(line, br) : lineAt(line, last)) + height, points: [{ i: a.i, price: a.price, label: 'L' }, { i: c.i, price: c.price, label: 'H' }, { i: e.i, price: e.price, label: 'R' }] })
      }
    }
  }

  // double top / bottom: two similar extremes with a clear swing between them, at least 10 sessions apart
  for (let k = 0; k + 2 < pv.length; k++) {
    const [a, b, c] = pv.slice(k, k + 3)
    if (c.i - a.i < 10) continue
    const similar = Math.abs(a.price - c.price) / Math.max(a.price, c.price) <= 0.03
    if (!similar) continue
    // not part of a head and shoulders already reported
    if (out.some((p) => (p.kind === 'head-shoulders' || p.kind === 'inverse-head-shoulders') && p.points.some((q) => q.i === a.i || q.i === c.i))) continue
    if (a.type === 'high') {
      const line = { i1: b.i, p1: b.price, i2: b.i + 1, p2: b.price }
      const br = breakOf(line, c.i, -1)
      const status: PatternStatus = br == null ? 'forming' : s.slice(br).some((x) => x.close > Math.max(a.price, c.price)) ? 'failed' : 'confirmed'
      if (br != null || (last - c.i <= 40 && c.i !== provisional))
        out.push({ kind: 'double-top', bias: -1, status, from: a.date, to: c.date, breakDate: br != null ? s[br].date : undefined, line, target: b.price - (Math.max(a.price, c.price) - b.price), points: [{ i: a.i, price: a.price, label: '1' }, { i: c.i, price: c.price, label: '2' }] })
    } else {
      const line = { i1: b.i, p1: b.price, i2: b.i + 1, p2: b.price }
      const br = breakOf(line, c.i, 1)
      const status: PatternStatus = br == null ? 'forming' : s.slice(br).some((x) => x.close < Math.min(a.price, c.price)) ? 'failed' : 'confirmed'
      if (br != null || (last - c.i <= 40 && c.i !== provisional))
        out.push({ kind: 'double-bottom', bias: 1, status, from: a.date, to: c.date, breakDate: br != null ? s[br].date : undefined, line, target: b.price + (b.price - Math.min(a.price, c.price)), points: [{ i: a.i, price: a.price, label: '1' }, { i: c.i, price: c.price, label: '2' }] })
    }
  }

  // triangles from the last two highs and the last two lows (excluding the provisional last pivot)
  const settled = pv.slice(0, -1)
  const highs = settled.filter((p) => p.type === 'high').slice(-2)
  const lows = settled.filter((p) => p.type === 'low').slice(-2)
  if (highs.length === 2 && lows.length === 2 && last - Math.min(highs[0].i, lows[0].i) <= 160) {
    const hs = (highs[1].price - highs[0].price) / highs[0].price
    const ls = (lows[1].price - lows[0].price) / lows[0].price
    const flat = 0.015
    let kind: PatternKind | null = null
    if (hs < -flat && ls > flat) kind = 'triangle-symmetric'
    else if (Math.abs(hs) <= flat && ls > flat) kind = 'triangle-ascending'
    else if (hs < -flat && Math.abs(ls) <= flat) kind = 'triangle-descending'
    if (kind) {
      const upper = { i1: highs[0].i, p1: highs[0].price, i2: highs[1].i, p2: highs[1].price }
      const lower = { i1: lows[0].i, p1: lows[0].price, i2: lows[1].i, p2: lows[1].price }
      const from = Math.max(highs[1].i, lows[1].i)
      const up = breakOf(upper, from, 1)
      const down = breakOf(lower, from, -1)
      const height = highs[0].price - lineAt(lower, highs[0].i)
      const first = up != null && (down == null || up < down) ? up : down
      const bias: 1 | -1 = kind === 'triangle-ascending' ? 1 : kind === 'triangle-descending' ? -1 : first === down && down != null ? -1 : 1
      const status: PatternStatus = first == null ? 'forming' : (first === up && bias === 1) || (first === down && bias === -1) ? 'confirmed' : 'failed'
      const brk = first ?? last
      out.push({
        kind,
        bias,
        status,
        from: s[Math.min(highs[0].i, lows[0].i)].date,
        to: s[Math.max(highs[1].i, lows[1].i)].date,
        breakDate: first != null ? s[first].date : undefined,
        line: upper,
        line2: lower,
        target: bias > 0 ? lineAt(upper, brk) + height : lineAt(lower, brk) - height,
        points: [],
      })
    }
  }

  // breakout above resistance / below support: the close crosses the highest high / lowest low of the turning
  // points of the past year (ignoring the last 10 sessions) within the last 10 sessions
  const older = pv.filter((p) => p.i < last - 10)
  const res = older.filter((p) => p.type === 'high').reduce<Pivot | null>((m, p) => (!m || p.price > m.price ? p : m), null)
  const sup = older.filter((p) => p.type === 'low').reduce<Pivot | null>((m, p) => (!m || p.price < m.price ? p : m), null)
  for (let i = Math.max(1, last - 9); i <= last; i++) {
    if (res && s[i - 1].close <= res.price && s[i].close > res.price && s[last].close > res.price) {
      const range = res.price - (sup?.price ?? res.price * 0.9)
      out.push({ kind: 'breakout-resistance', bias: 1, status: 'confirmed', from: res.date, to: s[i].date, breakDate: s[i].date, line: { i1: res.i, p1: res.price, i2: last, p2: res.price }, target: res.price + range * 0.5, points: [{ i: res.i, price: res.price, label: '' }] })
      break
    }
    if (sup && s[i - 1].close >= sup.price && s[i].close < sup.price && s[last].close < sup.price) {
      const range = (res?.price ?? sup.price * 1.1) - sup.price
      out.push({ kind: 'breakdown-support', bias: -1, status: 'confirmed', from: sup.date, to: s[i].date, breakDate: s[i].date, line: { i1: sup.i, p1: sup.price, i2: last, p2: sup.price }, target: sup.price - range * 0.5, points: [{ i: sup.i, price: sup.price, label: '' }] })
      break
    }
  }
  // newest first; keep only the latest pattern of each kind
  const seen = new Set<string>()
  return out
    .sort((x, y) => (y.breakDate ?? y.to).localeCompare(x.breakDate ?? x.to))
    .filter((p) => (seen.has(p.kind) ? false : (seen.add(p.kind), true)))
}

/** Support and resistance: turning-point prices of the past year grouped into levels (within 2 %), nearest first. */
export function levels(s: readonly Bar[], pct = pivotThreshold(s)): { support: { price: number; touches: number }[]; resistance: { price: number; touches: number }[] } {
  const last = s[s.length - 1]?.close ?? 0
  const pv = pivots(s.slice(-260), pct).slice(0, -1)
  const groups: { price: number; touches: number }[] = []
  for (const p of [...pv].sort((a, b) => a.price - b.price)) {
    const g = groups[groups.length - 1]
    if (g && p.price / g.price - 1 <= 0.02) {
      g.price = (g.price * g.touches + p.price) / (g.touches + 1)
      g.touches++
    } else groups.push({ price: p.price, touches: 1 })
  }
  const r2 = (x: { price: number; touches: number }) => ({ price: Math.round(x.price * 100) / 100, touches: x.touches })
  return {
    support: groups.filter((g) => g.price < last).sort((a, b) => b.price - a.price).slice(0, 3).map(r2),
    resistance: groups.filter((g) => g.price > last).sort((a, b) => a.price - b.price).slice(0, 3).map(r2),
  }
}

/** RSI divergence on the last two turning points of the same kind (within the last 30 sessions). */
export function divergence(s: readonly Bar[], r: readonly (number | null)[], pct = pivotThreshold(s)): { kind: 'bullish' | 'bearish'; date: string } | null {
  const pv = pivots(s, pct)
  const last = s.length - 1
  const lows = pv.filter((p) => p.type === 'low').slice(-2)
  const highs = pv.filter((p) => p.type === 'high').slice(-2)
  if (lows.length === 2 && last - lows[1].i <= 30) {
    const [a, b] = lows
    if (b.price < a.price && r[a.i] != null && r[b.i] != null && r[b.i]! > r[a.i]! + 2) return { kind: 'bullish', date: b.date }
  }
  if (highs.length === 2 && last - highs[1].i <= 30) {
    const [a, b] = highs
    if (b.price > a.price && r[a.i] != null && r[b.i] != null && r[b.i]! < r[a.i]! - 2) return { kind: 'bearish', date: b.date }
  }
  return null
}

/* ---------------- the report ---------------- */

export interface IndicatorVote {
  id: string
  group: 'ma' | 'osc'
  value: number | null
  vote: Vote
}

export interface TechReport {
  date: string
  last: number
  phase: Phase
  rating: { score: number; label: Rating; ma: Record<Vote, number>; osc: Record<Vote, number> }
  votes: IndicatorVote[]
  rsi: number | null
  macd: { macd: number | null; signal: number | null; cross: { kind: 'bullish' | 'bearish'; date: string } | null }
  bollinger: { pctB: number | null; width: number | null; squeeze: boolean }
  trend: { slopeYear: number; r2: number } | null
  high52: number
  low52: number
  fromHigh52: number
  fromLow52: number
  divergence: { kind: 'bullish' | 'bearish'; date: string } | null
  patterns: Pattern[]
  levels: ReturnType<typeof levels>
  /** too little history for the long indicators (fewer than 200 sessions) */
  short: boolean
}

/** price against a level, ignoring floating-point noise */
const cmp = (price: number, level: number | null): Vote => (level == null ? 'neutral' : price > level * (1 + 1e-9) ? 'buy' : price < level * (1 - 1e-9) ? 'sell' : 'neutral')

export function rate(score: number): Rating {
  if (score > 0.5) return 'strong-buy'
  if (score > 0.1) return 'buy'
  if (score >= -0.1) return 'neutral'
  if (score >= -0.5) return 'sell'
  return 'strong-sell'
}

export function technicalReport(s: readonly Bar[]): TechReport {
  if (s.length < 2) throw new Error('too little data')
  const last = s[s.length - 1]
  const c = closes(s)
  const votes: IndicatorVote[] = []
  for (const n of [10, 20, 50, 100, 200]) {
    const v = sma(s, n).at(-1) ?? null
    votes.push({ id: `sma${n}`, group: 'ma', value: v, vote: cmp(last.close, v) })
  }
  for (const n of [10, 20, 50, 100, 200]) {
    const v = c.length >= n ? (ema(c, n).at(-1) ?? null) : null
    votes.push({ id: `ema${n}`, group: 'ma', value: v, vote: cmp(last.close, v) })
  }
  const r = rsiSeries(s)
  const rNow = r.at(-1) ?? null
  const rPrev = r.at(-2) ?? null
  votes.push({ id: 'rsi', group: 'osc', value: rNow, vote: rNow == null || rPrev == null ? 'neutral' : rNow < 30 && rNow > rPrev ? 'buy' : rNow > 70 && rNow < rPrev ? 'sell' : 'neutral' })
  const m = macd(s)
  const mNow = m.macd.at(-1) ?? null
  const sNow = m.signal.at(-1) ?? null
  votes.push({ id: 'macd', group: 'osc', value: mNow, vote: mNow == null || sNow == null ? 'neutral' : mNow > sNow ? 'buy' : mNow < sNow ? 'sell' : 'neutral' })
  const mom = roc(s, 10)
  votes.push({ id: 'roc10', group: 'osc', value: mom, vote: cmp(1 + (mom ?? 0), mom == null ? null : 1) })
  const mom12 = s.length > 252 ? s[s.length - 22].close / s[s.length - 253].close - 1 : null
  votes.push({ id: 'mom12', group: 'osc', value: mom12, vote: mom12 == null ? 'neutral' : mom12 > 0 ? 'buy' : 'sell' })
  const bb = bollinger(s)
  const pb = bb.pctB.at(-1) ?? null
  votes.push({ id: 'bb', group: 'osc', value: pb, vote: pb == null ? 'neutral' : pb < 0 ? 'buy' : pb > 1 ? 'sell' : 'neutral' })

  const count = (g: 'ma' | 'osc') => {
    const vs = votes.filter((v) => v.group === g && v.value != null)
    const rec: Record<Vote, number> = { buy: 0, sell: 0, neutral: 0 }
    for (const v of vs) rec[v.vote]++
    const score = vs.length ? (rec.buy - rec.sell) / vs.length : 0
    return { rec, score }
  }
  const ma = count('ma')
  const osc = count('osc')
  const score = (ma.score + osc.score) / 2

  // MACD cross within the last 10 sessions
  let cross: TechReport['macd']['cross'] = null
  for (let i = s.length - 1; i >= Math.max(1, s.length - 10); i--) {
    const a0 = m.macd[i - 1]
    const b0 = m.signal[i - 1]
    const a1 = m.macd[i]
    const b1 = m.signal[i]
    if (a0 == null || b0 == null || a1 == null || b1 == null) break
    if (a0 <= b0 && a1 > b1) cross = { kind: 'bullish', date: s[i].date }
    else if (a0 >= b0 && a1 < b1) cross = { kind: 'bearish', date: s[i].date }
    if (cross) break
  }
  const widths = bb.width.slice(-126).filter((v): v is number => v != null)
  const wNow = bb.width.at(-1) ?? null
  const squeeze = wNow != null && widths.length > 60 && wNow <= Math.min(...widths) * 1.05
  const year = s.slice(-252)
  const high52 = Math.max(...year.map((b) => b.close))
  const low52 = Math.min(...year.map((b) => b.close))
  const reg = regression(s, Math.min(100, s.length))
  const pct = pivotThreshold(s)
  return {
    date: last.date,
    last: last.close,
    phase: marketPhase(s),
    rating: { score, label: rate(score), ma: ma.rec, osc: osc.rec },
    votes,
    rsi: rNow,
    macd: { macd: mNow, signal: sNow, cross },
    bollinger: { pctB: pb, width: wNow, squeeze },
    trend: reg ? { slopeYear: reg.slopeYear, r2: reg.r2 } : null,
    high52,
    low52,
    fromHigh52: last.close / high52 - 1,
    fromLow52: last.close / low52 - 1,
    divergence: divergence(s, r, pct),
    patterns: findPatterns(s, 260, pct),
    levels: levels(s, pct),
    short: s.length < 200,
  }
}

/** Equal-weight basket of several instruments (daily returns averaged over the members that traded both days). */
export function basket(members: readonly (readonly Bar[])[], base = 1000): Bar[] {
  const series = members.filter((m) => m.length > 1).map((m) => new Map(m.map((b) => [b.date, b.close])))
  const dates = [...new Set(members.flatMap((m) => m.map((b) => b.date)))].sort()
  const out: Bar[] = []
  const lastSeen: (number | undefined)[] = series.map(() => undefined)
  let level = base
  for (const d of dates) {
    let sum = 0
    let n = 0
    series.forEach((m, k) => {
      const c = m.get(d)
      if (c == null) return
      const prev = lastSeen[k]
      if (prev != null && prev > 0) {
        sum += c / prev - 1
        n++
      }
      lastSeen[k] = c
    })
    if (n) level *= 1 + sum / n
    // the basket starts once at least two members have a price
    if (lastSeen.filter((v) => v != null).length >= Math.min(2, series.length)) out.push({ date: d, close: Math.round(level * 100) / 100 })
  }
  return out
}

import type { Bar } from '../core/stats'
import { signalReport, type SignalReport } from '../core/signals'
import { plSentiment, worldSentiment, breadth, type Sentiment, type Series } from '../core/sentiment'

/** Indices that get buy/sell signals (broad market, size segments, total-return variants and all sectors). */
export const SIGNAL_INDICES = ['WIG', 'WIG20', 'MWIG40', 'SWIG80', 'WIG20TR', 'MWIG40TR', 'WIG-BANKI', 'WIG-BUDOW', 'WIG-CHEMIA', 'WIG-ENERG', 'WIG-GORNIC', 'WIG-GRY', 'WIG-INFO', 'WIG-LEKI', 'WIG-MEDIA', 'WIG-MOTO', 'WIG-NRCHOM', 'WIG-ODZIEZ', 'WIG-PALIWA', 'WIG-SPOZYW']

export interface MarketAnalysis {
  signals: { code: string; report: SignalReport }[]
  sentiment: { pl?: Sentiment; world?: Sentiment }
  world?: { vix: number; vixDate: string; sp500Signal?: SignalReport }
}

export interface AnalysisInput {
  indices: ReadonlyMap<string, readonly Bar[]>
  /** daily closes of every GPW share (for market breadth) */
  shares: readonly (readonly Bar[])[]
  vix: Series
  sp500: Series
  hySpread: Series
}

export function analyzeMarket(i: AnalysisInput): MarketAnalysis {
  const signals = SIGNAL_INDICES.flatMap((code) => {
    const s = i.indices.get(code)
    return s && s.length >= 30 ? [{ code, report: signalReport(s) }] : []
  })
  const g = (c: string) => i.indices.get(c) ?? []
  let pl: Sentiment | undefined
  if (g('WIG').length > 150 && g('WIG20').length > 150 && g('SWIG80').length > 150 && g('TBSP.INDEX').length > 150) {
    const b = i.shares.length ? breadth(i.shares) : undefined
    pl = plSentiment({ wig: g('WIG'), wig20: g('WIG20'), swig80: g('SWIG80'), tbsp: g('TBSP.INDEX'), breadth: b?.above50, highsLows: b?.highsLows })
  }
  const spBars = i.sp500.map((p) => ({ date: p.date, close: p.value }))
  const world = i.vix.length > 150 && spBars.length > 150 && i.hySpread.length > 150 ? worldSentiment({ vix: i.vix, sp500: spBars, hySpread: i.hySpread }) : undefined
  const lastVix = i.vix.at(-1)
  return {
    signals,
    sentiment: { pl, world },
    world: lastVix ? { vix: lastVix.value, vixDate: lastVix.date, sp500Signal: spBars.length >= 30 ? signalReport(spBars) : undefined } : undefined,
  }
}

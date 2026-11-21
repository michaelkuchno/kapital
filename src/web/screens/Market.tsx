import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { Card, Pct } from '../components/ui'
import { LineChart, Gauge } from '../components/charts'
import { percent, rate as fmtRate } from '../i18n'
import type { Signal } from '@core/signals'
import type { Sentiment } from '@core/sentiment'
import { loadInstitutions, loadInstrument, type Institutions } from '../market'
import { SECTOR_NAMES, type IndexSummary } from '@data/summaries'
import { daysBetween } from '@core/dates'
import { dateFmt } from '../i18n'
import { technicalReport, type TechReport } from '@core/technical'
import { analyzeTrend, rankSectors } from '@core/trends'
import { BrokerChip, PhaseChip, RatingChip, TechModal } from '../components/TechAnalysis'

const STATE_COLOR = { up: 'bg-emerald-100 text-emerald-800', down: 'bg-red-100 text-red-800', sideways: 'bg-amber-100 text-amber-800', unknown: 'bg-stone-100 text-stone-600' }
const SIG: Record<Signal, string> = { buy: 'bg-emerald-100 text-emerald-800', sell: 'bg-red-100 text-red-800', neutral: 'bg-stone-100 text-stone-700' }
const BASKET = 'KAP-BIOTECH'
const BASKET_NAMES = { pl: 'Biotechnologia (koszyk Kapitał)', en: 'Biotech (Kapitał basket)', de: 'Biotech (Kapitał-Korb)' }
const pathOf = (code: string) => (code === BASKET ? `basket/${BASKET}` : `indices/${code}`)

/** Technical reports of every sector and index (and the biotech basket), computed in the browser from the daily files. */
function useTechAll(codes: readonly string[]) {
  const { market } = useApp()
  const [state, setState] = useState<{ tech: Map<string, TechReport>; basket?: IndexSummary } | null>(null)
  const key = codes.join(',')
  useEffect(() => {
    let live = true
    void (async () => {
      const all = [...new Set([...codes, BASKET, 'WIG'])]
      const series = await Promise.all(all.map((c) => loadInstrument(pathOf(c), market)))
      const tech = new Map<string, TechReport>()
      all.forEach((c, i) => {
        if (series[i].length >= 30) tech.set(c, technicalReport(series[i]))
      })
      const b = series[all.indexOf(BASKET)]
      const wig = series[all.indexOf('WIG')]
      const basket = b.length >= 30 ? { code: BASKET, report: analyzeTrend(b, wig) } : undefined
      if (live) setState({ tech, basket })
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, market])
  return state
}

const nameOf = (code: string, lang: 'pl' | 'en' | 'de') => (code === BASKET ? BASKET_NAMES[lang] : (SECTOR_NAMES[code]?.[lang] ?? code))

function Table({ rows, ranked, onOpen, testId, tech }: { rows: IndexSummary[]; ranked?: boolean; onOpen: (c: string) => void; testId: string; tech?: Map<string, TechReport> }) {
  const { t, lang } = useApp()
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[900px] text-sm" data-testid={testId}>
        <thead className="text-left text-xs text-stone-500">
          <tr>
            {ranked && <th className="py-1">{t('col.rank')}</th>}
            <th>{t('col.name')}</th>
            <th className="text-right">{t('col.1m')}</th>
            <th className="text-right">{t('col.3m')}</th>
            <th className="text-right">{t('col.12m')}</th>
            <th className="text-right">{t('col.vs200')}</th>
            <th className="text-right">{t('col.dd')}</th>
            <th className="text-right">{t('col.vol')}</th>
            <th className="pl-3">{t('col.trend')}</th>
            <th className="pl-2">{t('col.phase')}</th>
            <th className="pl-2">{t('col.rating')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tr = tech?.get(r.code)
            return (
              <tr key={r.code} className="cursor-pointer border-t border-stone-100 hover:bg-mint/40" onClick={() => onOpen(r.code)} data-testid={`row-${r.code}`}>
                {ranked && <td className="py-2 font-bold text-stone-400">{r.rank ?? i + 1}</td>}
                <td className="py-2 font-semibold">
                  {nameOf(r.code, lang)}
                  <div className="text-xs font-normal text-stone-400">{r.code === BASKET ? '9 × GPW' : r.code}</div>
                </td>
                <td className="text-right">
                  <Pct v={r.report.ret1m} />
                </td>
                <td className="text-right">
                  <Pct v={r.report.ret3m} />
                </td>
                <td className="text-right">
                  <Pct v={r.report.ret12m} />
                </td>
                <td className="text-right">
                  <Pct v={r.report.vs200} />
                </td>
                <td className="text-right">
                  <Pct v={r.report.drawdown} />
                </td>
                <td className="text-right">
                  <Pct v={r.report.vol} sign={false} digits={0} />
                </td>
                <td className="pl-3">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_COLOR[r.report.state]}`} data-testid={`state-${r.code}`}>
                    {t(`trend.${r.report.state}`)}
                  </span>
                </td>
                <td className="pl-2">{tr ? <PhaseChip k={tr.phase.kind} testId={`phase-${r.code}`} /> : '…'}</td>
                <td className="pl-2">{tr ? <RatingChip r={tr.rating.label} testId={`rating-${r.code}`} /> : '…'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Search any GPW share, ETF, index, the biotech basket or gold, and open its technical analysis. */
function Search({ onOpen }: { onOpen: (o: { path: string; name: string; shareName?: string }) => void }) {
  const { t, lang, market } = useApp()
  const [q, setQ] = useState('')
  const options = useMemo(() => {
    const idx = Object.keys(SECTOR_NAMES).map((c) => ({ path: pathOf(c), name: `${SECTOR_NAMES[c][lang]} (${c})`, key: `${c} ${SECTOR_NAMES[c][lang]}` }))
    const extra = [
      { path: pathOf(BASKET), name: BASKET_NAMES[lang], key: `biotech biotechnologia ${BASKET_NAMES[lang]}` },
      { path: 'gold', name: t('search.gold'), key: `gold złoto zloto ${t('search.gold')}` },
    ]
    const shares = (market?.shares ?? []).map((s) => ({ path: `shares/${s.isin}`, name: `${s.name}${s.type === 'etf' ? ' (ETF)' : ''}`, key: `${s.name} ${s.isin}`, shareName: s.type === 'etf' ? undefined : s.name }))
    return [...extra, ...idx, ...shares]
  }, [market, lang, t])
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const hits = q.trim().length >= 2 ? options.filter((o) => norm(o.key).includes(norm(q.trim()))).slice(0, 8) : []
  return (
    <Card title={t('search.title')} testId="ta-search">
      <input className="input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.ph')} aria-label={t('search.title')} data-testid="ta-search-input" />
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-stone-100" data-testid="ta-search-results">
          {hits.length ? (
            hits.map((h) => (
              <li key={h.path}>
                <button type="button" className="w-full py-2 text-left text-sm hover:bg-mint/40" onClick={() => onOpen(h)} data-testid={`ta-hit-${h.path}`}>
                  📈 {h.name}
                </button>
              </li>
            ))
          ) : (
            <li className="py-2 text-sm text-stone-500">{t('search.none')}</li>
          )}
        </ul>
      )}
    </Card>
  )
}

/** Sector proposals from the technical rules (strongest / possible turn / careful). */
function Picks({ sectors, tech, onOpen }: { sectors: IndexSummary[]; tech: Map<string, TechReport>; onOpen: (code: string) => void }) {
  const { t, lang } = useApp()
  const last = [...tech.values()][0]?.date ?? ''
  const recent = (d?: string) => !!d && daysBetween(d, last) <= 45
  const rows = sectors.map((s) => ({ s, r: tech.get(s.code) })).filter((x): x is { s: IndexSummary; r: TechReport } => !!x.r)
  const score = (x: { s: IndexSummary }) => x.s.report.score ?? -Infinity
  const strong = rows.filter(({ s, r }) => r.phase.kind === 'bull' && s.report.state === 'up' && (r.rating.label === 'buy' || r.rating.label === 'strong-buy')).sort((a, b) => score(b) - score(a))
  const turnReason = (r: TechReport) => {
    const p = r.patterns.find((x) => x.bias > 0 && x.status === 'confirmed' && recent(x.breakDate))
    if (p) return t(`ta.p.${p.kind}`)
    if (r.divergence?.kind === 'bullish') return t('ta.s.div.bullish', { date: dateFmt(lang, r.divergence.date) }).split(':')[0]
    return null
  }
  // a divergence alone is too weak against a strong sell rating: then it is not called a possible turn
  const turn = rows.filter(({ r }) => (r.phase.kind === 'bear' || r.phase.kind === 'rebound' || r.phase.kind === 'correction') && turnReason(r) && (r.rating.label !== 'strong-sell' || r.patterns.some((x) => x.bias > 0 && x.status === 'confirmed' && recent(x.breakDate)))).sort((a, b) => score(b) - score(a))
  const weak = rows.filter(({ r }) => r.phase.kind === 'bear' && (r.rating.label === 'sell' || r.rating.label === 'strong-sell')).sort((a, b) => score(a) - score(b))
  const group = (title: string, list: typeof rows, id: string, why: (x: { s: IndexSummary; r: TechReport }) => string) => (
    <div data-testid={`picks-${id}`}>
      <h3 className="font-bold text-sea">{title}</h3>
      {list.length ? (
        <ul className="mt-1 space-y-1">
          {list.slice(0, 5).map((x) => (
            <li key={x.s.code}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-mint/40" onClick={() => onOpen(x.s.code)} data-testid={`pick-${id}-${x.s.code}`}>
                <b>{nameOf(x.s.code, lang)}</b>
                <PhaseChip k={x.r.phase.kind} />
                <RatingChip r={x.r.rating.label} />
                <span className="text-xs text-stone-600">{why(x)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">{t('picks.none')}</p>
      )}
    </div>
  )
  return (
    <Card title={t('picks.title')} testId="picks">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {group(t('picks.strong'), strong, 'strong', (x) => `${t('col.12m')}: ${percent(lang, x.s.report.ret12m, 0, true)}`)}
        {group(t('picks.turn'), turn, 'turn', (x) => turnReason(x.r) ?? '')}
        {group(t('picks.weak'), weak, 'weak', (x) => `${t('ta.fromHigh')} ${percent(lang, x.r.fromHigh52, 0, true)}`)}
      </div>
      <p className="mt-3 text-xs text-stone-600">{t('picks.explain')}</p>
      <p className="mt-2 text-xs text-stone-600">{t('picks.how')}</p>
      <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs text-stone-700">{t('picks.disclaimer')}</p>
    </Card>
  )
}

/** NBP, GUS, Ministry of Finance, GPW analysts (GPWPA) and the KNF warning list. */
function InstitutionsCard() {
  const { t, lang, market } = useApp()
  const [inst, setInst] = useState<Institutions | null>(null)
  const [q, setQ] = useState('')
  const [knf, setKnf] = useState('')
  const [more, setMore] = useState(false)
  useEffect(() => {
    void loadInstitutions().then(setInst)
  }, [])
  const ref = market?.ref
  const hist = ref?.history ?? []
  const lastChange = hist.length > 1 ? { d: hist[hist.length - 1].rate - hist[hist.length - 2].rate, date: hist[hist.length - 1].from } : null
  const cpi = market?.cpi.at(-1)
  const edo = market?.offer.find((o) => o.code === 'EDO')
  const tos = market?.offer.find((o) => o.code === 'TOS')
  const reports = inst?.pwpa.reports ?? []
  const lastDate = reports[0]?.date ?? ''
  const rated = reports.filter((r) => r.rating && lastDate && daysBetween(r.date, lastDate) <= 90)
  const cnt = (k: string) => rated.filter((r) => r.rating === k).length
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const shown = reports.filter((r) => /aktualizuj|inicjuj/i.test(r.type) && (!q.trim() || norm(`${r.code} ${r.company} ${r.broker}`).includes(norm(q.trim()))))
  const knfHits = knf.trim().length >= 3 && inst ? inst.knf.warnings.filter((w) => norm(`${w.name} ${w.id}`).includes(norm(knf.trim()))) : []
  return (
    <Card title={t('inst.title')} testId="institutions">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <section data-testid="inst-nbp">
          <h3 className="font-bold text-sea">{t('inst.nbp')}</h3>
          {ref && <p className="text-sm">{t('inst.nbpRate', { rate: fmtRate(lang, ref.ref), date: dateFmt(lang, ref.from) })}</p>}
          {lastChange && lastChange.d !== 0 && <p className="mt-1 text-xs text-stone-600">{t(lastChange.d < 0 ? 'inst.cycle.cut' : 'inst.cycle.hike', { d: Math.abs(lastChange.d), date: dateFmt(lang, lastChange.date) })}</p>}
          {ref && cpi && (
            <p className="mt-1 text-sm">
              {t('inst.real', { v: `${(ref.ref - cpi.yoy).toLocaleString(lang === 'en' ? 'en-GB' : lang === 'de' ? 'de-DE' : 'pl-PL', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })} p.p.` })}
            </p>
          )}
          <p className="mt-1 text-xs text-stone-500">{t('inst.realExplain')}</p>
        </section>
        <section data-testid="inst-gus-mf">
          {cpi && <p className="text-sm">{t('inst.gus', { v: fmtRate(lang, cpi.yoy, 1), month: cpi.month })}</p>}
          <h3 className="mt-2 font-bold text-sea">{t('inst.mf')}</h3>
          {edo && <p className="text-sm">{t('inst.mfEdo', { first: edo.firstRate, margin: edo.margin })}</p>}
          {tos && <p className="text-sm">{t('inst.mfTos', { first: tos.firstRate })}</p>}
        </section>
        <section data-testid="inst-knf">
          <h3 className="font-bold text-sea">{t('inst.knf')}</h3>
          <input className="input mt-1 w-full" value={knf} onChange={(e) => setKnf(e.target.value)} placeholder={t('inst.knfPh')} aria-label={t('inst.knf')} data-testid="knf-input" />
          {knf.trim().length >= 3 && inst && (
            <div className="mt-2 text-sm" data-testid="knf-result" data-hits={knfHits.length}>
              {knfHits.length ? (
                <>
                  <p className="font-bold text-down">{t('inst.knfHit', { n: knfHits.length })}</p>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-auto text-xs">
                    {knfHits.slice(0, 10).map((w, i) => (
                      <li key={i} className="rounded bg-red-50 p-1 whitespace-pre-line">
                        {w.name}
                        <span className="block text-stone-500">{w.info}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-stone-700">{t('inst.knfNone', { n: inst.knf.warnings.length })}</p>
              )}
            </div>
          )}
          <p className="mt-1 text-xs text-stone-500">{t('inst.knfExplain')}</p>
        </section>
      </div>
      <section className="mt-4" data-testid="inst-gpwpa">
        <h3 className="font-bold text-sea">{t('inst.gpwpa')}</h3>
        {inst ? (
          <>
            <p className="text-sm" data-testid="gpwpa-summary">
              {t('inst.gpwpaSummary', { n: rated.length, buy: cnt('buy'), accumulate: cnt('accumulate'), hold: cnt('hold'), reduce: cnt('reduce'), sell: cnt('sell') })}
            </p>
            <input className="input mt-2 w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inst.filter')} aria-label={t('inst.filter')} data-testid="gpwpa-filter" />
            <div className="-mx-4 mt-2 overflow-x-auto px-4">
              <table className="w-full min-w-[560px] text-sm" data-testid="gpwpa-table">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-1 pr-3">{t('inst.col.company')}</th>
                    <th className="pr-3">{t('inst.col.rating')}</th>
                    <th className="pr-3">{t('inst.col.date')}</th>
                    <th className="pr-3">{t('inst.col.broker')}</th>
                    <th>{t('inst.col.report')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, more ? 60 : 10).map((r) => (
                    <tr key={r.pdf} className="border-t border-stone-100 align-top">
                      <td className="py-1 pr-3">
                        <b>{r.code}</b>
                        <span className="block text-xs text-stone-500">{r.company}</span>
                      </td>
                      <td className="py-1 pr-3">{r.rating ? <BrokerChip r={r.rating} /> : <span className="text-xs text-stone-500">{t('inst.rating.none')}</span>}</td>
                      <td className="py-1 pr-3 text-xs whitespace-nowrap">{dateFmt(lang, r.date)}</td>
                      <td className="py-1 pr-3 text-xs">{r.broker}</td>
                      <td className="py-1">
                        <a className="text-sea-2 underline" href={`https://www.gpw.pl${r.pdf}`} target="_blank" rel="noreferrer noopener">
                          PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!more && shown.length > 10 && (
              <button type="button" className="btn-ghost mt-2 !py-1 text-sm" onClick={() => setMore(true)}>
                {t('inst.more')}
              </button>
            )}
            <p className="mt-2 text-xs text-stone-500">{t('inst.gpwpaExplain')}</p>
          </>
        ) : (
          <p className="text-sm text-stone-500">…</p>
        )}
      </section>
      <p className="mt-3 text-xs text-stone-500">{t('inst.source')}</p>
    </Card>
  )
}

function Sentiments() {
  const { t, market, lang } = useApp()
  const a = market?.analysis
  const one = (s: Sentiment | undefined, key: 'pl' | 'world') =>
    s ? (
      <div className="flex flex-col items-center" data-testid={`fg-${key}`}>
        <Gauge value={s.score} label={t(`fg.${key}`)} sub={t(`mood.${s.mood}`)} testId={`gauge-${key}`} />
        <ul className="mt-2 w-full max-w-xs space-y-1 text-xs">
          {s.components.map((c) => (
            <li key={c.id} className="flex items-center gap-2" data-testid={`fg-comp-${key}-${c.id}`}>
              <span className="w-36 text-stone-600">{t(`fgc.${c.id}`)}</span>
              <span className="h-2 flex-1 rounded bg-stone-100">
                <span className="block h-2 rounded" style={{ width: `${c.score}%`, background: c.score < 45 ? '#c0392b' : c.score > 55 ? '#1f8a4c' : '#a8a29e' }} />
              </span>
              <span className="w-8 text-right num">{Math.round(c.score)}</span>
            </li>
          ))}
        </ul>
        {s.history.length > 20 && (
          <div className="mt-2 w-full">
            <LineChart x={s.history.map((h) => h.date)} height={110} lines={[{ values: s.history.map((h) => h.score), color: '#0f3d3e', label: t(`fg.${key}`) }, { values: s.history.map(() => 50), color: '#d6d3d1', dash: '3 3' }]} format={(v) => v.toFixed(0)} />
          </div>
        )}
      </div>
    ) : null
  return (
    <Card title={t('fg.title')} testId="sentiment">
      <p className="mb-3 text-xs text-stone-500">{t('fg.explain')}</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {one(a?.sentiment.pl, 'pl')}
        {one(a?.sentiment.world, 'world')}
      </div>
      {a?.world && (
        <p className="mt-3 text-center text-sm" data-testid="vix">
          <b>VIX</b> {a.world.vix.toFixed(1)} ({dateFmt(lang, a.world.vixDate)}) · {t(a.world.vix >= 30 ? 'vix.high' : a.world.vix >= 20 ? 'vix.elevated' : 'vix.calm')}
          {a.world.sp500Signal && (
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${SIG[a.world.sp500Signal.signal]}`}>
              S&P 500: {t(`sig.${a.world.sp500Signal.signal}`)}
            </span>
          )}
        </p>
      )}
      {!a?.sentiment.pl && !a?.sentiment.world && <p className="text-sm text-stone-500">{t('dataMissing')}</p>}
    </Card>
  )
}

function Signals() {
  const { t, market, lang } = useApp()
  const rows = market?.analysis?.signals ?? []
  if (!rows.length) return null
  return (
    <Card title={t('sig.title')} testId="signals">
      <p className="mb-3 text-xs text-stone-500">{t('sig.explain')}</p>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[760px] text-sm" data-testid="signal-table">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th>{t('col.name')}</th>
              <th>{t('sig.col.signal')}</th>
              <th>{t('sig.col.since')}</th>
              <th className="text-right">RSI</th>
              <th className="text-right">{t('sig.col.fromHigh')}</th>
              <th className="text-right">{t('sig.col.rule')}</th>
              <th className="text-right">{t('sig.col.bh')}</th>
              <th className="text-right">{t('sig.col.dd')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ code, report: r }) => (
              <tr key={code} className="border-t border-stone-100" data-testid={`sig-${code}`} data-signal={r.signal}>
                <td className="py-2 font-semibold">
                  {SECTOR_NAMES[code]?.[lang] ?? code}
                  <div className="text-[11px] font-normal text-stone-500">{r.reasons.map((x) => t(`why.${x}`)).join(' · ')}</div>
                </td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${SIG[r.signal]}`}>{t(`sig.${r.signal}`)}</span>
                </td>
                <td className="text-xs">{dateFmt(lang, r.since)}</td>
                <td className="text-right num">{r.rsi != null ? r.rsi.toFixed(0) : '–'}</td>
                <td className="text-right">
                  <Pct v={r.fromHigh} />
                </td>
                <td className="text-right">{r.backtest ? <Pct v={r.backtest.rule} /> : '–'}</td>
                <td className="text-right">{r.backtest ? <Pct v={r.backtest.buyHold} /> : '–'}</td>
                <td className="text-right text-xs">{r.backtest ? `${percent(lang, r.backtest.ruleMaxDD, 0)} / ${percent(lang, r.backtest.buyHoldMaxDD, 0)}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-stone-500">{t('sig.note', { from: rows[0]?.report.backtest ? dateFmt(lang, rows[0].report.backtest.from) : '–' })}</p>
    </Card>
  )
}

export function Market() {
  const { t, lang, market, asOf } = useApp()
  const [open, setOpen] = useState<{ path: string; name: string; shareName?: string; code?: string } | null>(null)
  const base = useMemo(() => market?.summary.sectors ?? [], [market])
  const indices = (market?.summary.indices ?? []).filter((x) => !x.code.startsWith('WIG-'))
  const codes = useMemo(() => [...(market?.summary.sectors ?? []), ...(market?.summary.indices ?? [])].map((s) => s.code), [market])
  const all = useTechAll(codes)
  // sectors ranked again together with the biotech basket
  const sectors = useMemo(() => (all?.basket ? rankSectors([...base, all.basket].map((s) => ({ code: s.code, report: s.report }))) : base), [base, all])
  const recent = base.flatMap((s) => s.report.events.filter((e) => daysBetween(e.date, market?.meta.lastTradingDay ?? asOf) <= 14).map((e) => ({ code: s.code, e })))
  const openCode = (code: string) => setOpen({ path: pathOf(code), name: nameOf(code, lang), code })
  if (!market?.meta.lastTradingDay) return <p className="card" data-testid="market">{t('dataMissing')}</p>
  return (
    <div className="space-y-4" data-testid="market">
      <h1 className="text-2xl font-extrabold text-sea">{t('market.title')}</h1>
      <p className="text-xs text-stone-500">{t('dataAsOf', { date: dateFmt(lang, market.meta.lastTradingDay) })}</p>
      <Search onOpen={setOpen} />
      {all && <Picks sectors={sectors} tech={all.tech} onOpen={openCode} />}
      <InstitutionsCard />
      <Sentiments />
      <Signals />
      <Card title={t('market.recent')} testId="recent-events">
        {recent.length ? (
          <ul className="space-y-1 text-sm">
            {recent.map(({ code, e }) => (
              <li key={`${code}-${e.kind}-${e.date}`} className="flex flex-wrap gap-x-2" data-testid={`event-${code}`}>
                <b>{SECTOR_NAMES[code]?.[lang] ?? code}</b>
                <span>{t(`ev.${e.kind}`)}</span>
                <span className="text-stone-500">{dateFmt(lang, e.date)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">{t('market.none')}</p>
        )}
      </Card>
      <Card title={t('market.sectors')} testId="sectors">
        <p className="mb-3 text-xs text-stone-500">{t('market.explain')}</p>
        <Table rows={sectors} ranked onOpen={openCode} testId="sector-table" tech={all?.tech} />
        <p className="mt-2 text-xs text-stone-500">{t(`basket.${BASKET}`)}</p>
      </Card>
      <Card title={t('market.indices')} testId="indices">
        <Table rows={indices} onOpen={openCode} testId="index-table" tech={all?.tech} />
      </Card>
      {open && <TechModal path={open.path} name={open.name} shareName={open.shareName} onClose={() => setOpen(null)} testId={open.code ? 'index-chart' : 'tech-modal'} priceTestId={open.code ? 'index-line' : 'ta-price'} />}
    </div>
  )
}

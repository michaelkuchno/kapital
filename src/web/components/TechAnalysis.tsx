import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { LineChart, PhaseBar, type Line, type Marker } from './charts'
import { Modal, Pct } from './ui'
import { bollinger, macd, rsiSeries, technicalReport, type Pattern, type Rating, type TechReport, type Vote } from '@core/technical'
import { sma, type Bar } from '@core/stats'
import { dateFmt, locale, percent } from '../i18n'
import { loadInstitutions, loadInstrument, type Institutions } from '../market'

/** Colours of the five ratings (strong buy … strong sell). */
export const RATING_STYLE: Record<Rating, string> = {
  'strong-buy': 'bg-emerald-600 text-white',
  buy: 'bg-emerald-100 text-emerald-800',
  neutral: 'bg-stone-100 text-stone-700',
  sell: 'bg-red-100 text-red-800',
  'strong-sell': 'bg-red-600 text-white',
}
export const PHASE_STYLE: Record<TechReport['phase']['kind'], string> = {
  bull: 'bg-emerald-100 text-emerald-800',
  correction: 'bg-amber-100 text-amber-800',
  bear: 'bg-red-100 text-red-800',
  rebound: 'bg-sky-100 text-sky-800',
  unknown: 'bg-stone-100 text-stone-600',
}
const VOTE_STYLE: Record<Vote, string> = { buy: 'text-emerald-700', sell: 'text-red-700', neutral: 'text-stone-500' }
const STATUS_STYLE: Record<Pattern['status'], string> = { confirmed: 'bg-sea text-white', forming: 'bg-amber-100 text-amber-800', failed: 'bg-stone-200 text-stone-600' }
const PERIODS = { '6m': 126, '1y': 252, '2y': 504, max: Infinity } as const
type Period = keyof typeof PERIODS

export function RatingChip({ r, testId }: { r: Rating; testId?: string }) {
  const { t } = useApp()
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${RATING_STYLE[r]}`} data-testid={testId} data-rating={r}>
      {t(`ta.rating.${r}`)}
    </span>
  )
}
export function PhaseChip({ k, testId }: { k: TechReport['phase']['kind']; testId?: string }) {
  const { t } = useApp()
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PHASE_STYLE[k]}`} data-testid={testId} data-phase={k}>
      {t(`ta.ph.${k}`)}
    </span>
  )
}

/** Match a GPW share name (e.g. "SELVITA", "CLNPHARMA") with the company names of the GPWPA reports. */
export function reportsFor(name: string | undefined, reports: Institutions['pwpa']['reports']) {
  if (!name) return []
  const n = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (n.length < 3) return []
  return reports.filter((r) => {
    const c = r.company.toUpperCase().replace(/S\.A\.|SPÓŁKA AKCYJNA/g, '').replace(/[^A-Z0-9]/g, '')
    return c.startsWith(n) || n.startsWith(c) || r.code.toUpperCase() === n
  })
}

/** Plain-language reasons behind the verdict, newest/most important first. */
function reasons(r: TechReport, t: (k: string, v?: Record<string, string | number>) => string, lang: Parameters<typeof percent>[0]): string[] {
  const out: string[] = []
  const v = (id: string) => r.votes.find((x) => x.id === id)?.value ?? null
  const s50 = v('sma50')
  const s200 = v('sma200')
  if (s50 != null && s200 != null) out.push(t(r.last > s200 && s50 > s200 ? 'ta.s.trend.up' : r.last < s200 && s50 < s200 ? 'ta.s.trend.down' : 'ta.s.trend.mixed'))
  const mom = v('mom12')
  if (mom != null) out.push(t(mom > 0 ? 'ta.s.mom.up' : 'ta.s.mom.down', { v: percent(lang, mom, 1, true) }))
  if (r.rsi != null) out.push(t(r.rsi > 70 ? 'ta.s.rsi.ob' : r.rsi < 30 ? 'ta.s.rsi.os' : 'ta.s.rsi.mid', { v: Math.round(r.rsi) }))
  if (r.macd.cross) out.push(t(`ta.s.macd.${r.macd.cross.kind}`, { date: dateFmt(lang, r.macd.cross.date) }))
  if (r.divergence) out.push(t(`ta.s.div.${r.divergence.kind}`, { date: dateFmt(lang, r.divergence.date) }))
  const p = r.patterns.find((x) => x.status !== 'failed')
  if (p) out.push(t('ta.s.pattern', { name: t(`ta.p.${p.kind}`), status: t(`ta.st.${p.status}`) }))
  if (r.bollinger.squeeze) out.push(t('ta.s.squeeze'))
  return out
}

/** Everything about one instrument: verdict, phase, charts, indicators, patterns, levels, analysts. */
export function TechAnalysis({ path, name, shareName, priceTestId = 'ta-price' }: { path: string; name: string; shareName?: string; priceTestId?: string }) {
  const { t, lang, market } = useApp()
  const [bars, setBars] = useState<Bar[] | null>(null)
  const [period, setPeriod] = useState<Period>('1y')
  const [inst, setInst] = useState<Institutions | null>(null)
  useEffect(() => {
    let live = true
    setBars(null)
    void loadInstrument(path, market).then((b) => live && setBars(b))
    return () => {
      live = false
    }
  }, [path, market])
  useEffect(() => {
    if (shareName) void loadInstitutions().then(setInst)
  }, [shareName])
  const rep = useMemo(() => (bars && bars.length >= 30 ? technicalReport(bars) : null), [bars])
  const full = useMemo(() => {
    if (!bars || bars.length < 30) return null
    const bb = bollinger(bars)
    const m = macd(bars)
    return { s50: sma(bars, 50), s200: sma(bars, 200), bb, rsi: rsiSeries(bars), macd: m }
  }, [bars])
  // numbers with a fixed number of decimals (2, or 0 above 100 000) so that columns and axes line up
  const num = (v: number | null | undefined, d = 2) => {
    if (v == null || !Number.isFinite(v)) return '–'
    const digits = Math.abs(v) >= 100_000 ? 0 : d
    return v.toLocaleString(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: digits })
  }
  const axisNum = (v: number) => num(v, Math.abs(v) >= 1000 ? 0 : 2)

  if (!bars) return <p className="text-sm text-stone-500">{t('ta.loading')}</p>
  if (!rep || !full) return <p className="text-sm text-stone-500" data-testid="ta-short">{t('ta.tooShort')}</p>

  const n = Math.min(bars.length, PERIODS[period])
  const off = bars.length - n
  const w = <T,>(a: readonly T[]) => a.slice(off)
  const x = w(bars).map((b) => b.date)
  const idx = new Map(bars.map((b, i) => [b.date, i]))
  const sup = rep.levels.support[0]?.price
  const res = rep.levels.resistance[0]?.price
  // the most relevant pattern on the chart: newest not failed one, else the newest
  const pat = rep.patterns.find((p) => p.status !== 'failed') ?? rep.patterns[0]
  const patLines: Line[] = []
  const markers: Marker[] = []
  if (pat) {
    const from = Math.min(pat.line.i1, ...pat.points.map((p) => p.i), pat.line2?.i1 ?? Infinity)
    const to = pat.breakDate ? (idx.get(pat.breakDate) ?? bars.length - 1) : bars.length - 1
    const lineVals = (l: Pattern['line']) => bars.map((_b, i) => (i >= from && i <= to ? l.p1 + ((l.p2 - l.p1) * (i - l.i1)) / (l.i2 - l.i1 || 1) : null))
    patLines.push({ values: w(lineVals(pat.line)), color: '#7a4fb3', width: 2, dash: '6 3', label: t('ta.lg.pattern') })
    if (pat.line2) patLines.push({ values: w(lineVals(pat.line2)), color: '#7a4fb3', width: 2, dash: '6 3' })
    // L / H / R of a head and shoulders are translated (e.g. LR / G / PR); "1" / "2" of a double top stay
    for (const p of pat.points) markers.push({ i: p.i - off, value: p.price, label: ['L', 'H', 'R'].includes(p.label) ? t(`ta.pt.${p.label}`) : p.label, color: '#7a4fb3' })
  }
  const priceLines: Line[] = [
    { values: w(bars.map((b) => b.close)), color: '#0f3d3e', width: 2, label: t('ta.lg.close') },
    { values: w(full.s50), color: '#c99a2e', width: 1.5, label: t('ta.lg.sma50') },
    { values: w(full.s200), color: '#2563eb', width: 1.5, dash: '5 4', label: t('ta.lg.sma200') },
    ...(sup ? [{ values: x.map(() => sup), color: '#1f8a4c', width: 1, dash: '2 3', label: t('ta.lg.support') }] : []),
    ...(res ? [{ values: x.map(() => res), color: '#c0392b', width: 1, dash: '2 3', label: t('ta.lg.resistance') }] : []),
    ...patLines,
  ]
  const why = reasons(rep, t, lang)
  const scorePct = Math.round(rep.rating.score * 100)
  const counts = { buy: rep.rating.ma.buy + rep.rating.osc.buy, sell: rep.rating.ma.sell + rep.rating.osc.sell, neutral: rep.rating.ma.neutral + rep.rating.osc.neutral }
  const voteValue = (id: string, v: number | null) => (v == null ? '–' : id === 'rsi' ? num(v, 0) : id === 'roc10' || id === 'mom12' ? percent(lang, v, 1, true) : id === 'bb' ? num(v, 2) : num(v, Math.abs(v) < 10 ? 3 : 2))
  const voteName = (id: string) => (id.startsWith('sma') ? t('ta.v.sma', { n: Number(id.slice(3)) }) : id.startsWith('ema') ? t('ta.v.ema', { n: Number(id.slice(3)) }) : t(`ta.v.${id}`))
  const analysts = shareName && inst ? reportsFor(shareName, inst.pwpa.reports).slice(0, 8) : []

  return (
    <div className="space-y-5" data-testid="tech-analysis" data-path={path}>
      {/* verdict */}
      <section className="rounded-2xl bg-mint/40 p-4" data-testid="ta-verdict">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-sea">{t('ta.verdict')}</h3>
          <RatingChip r={rep.rating.label} testId="ta-rating" />
          <PhaseChip k={rep.phase.kind} testId="ta-phase-chip" />
          <span className="ml-auto text-xs text-stone-500">{name}</span>
        </div>
        <div className="mt-3" aria-label={t('ta.score', { score: scorePct })}>
          <div className="relative h-3 rounded-full bg-gradient-to-r from-red-500 via-stone-200 to-emerald-600">
            <span className="absolute -top-1 h-5 w-1.5 rounded bg-ink" style={{ left: `calc(${(scorePct + 100) / 2}% - 3px)` }} data-testid="ta-score" data-value={scorePct} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-stone-500">
            <span>{(-100).toLocaleString(locale(lang))}</span>
            <span>{t('ta.score', { score: scorePct })}</span>
            <span>{(100).toLocaleString(locale(lang), { signDisplay: 'always' })}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-600">{t('ta.ratingExplain', counts)}</p>
        <p className="mt-3 text-sm font-semibold">{t('ta.why')}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" data-testid="ta-reasons">
          {rep.short && <li>{t('ta.s.short', { n: bars.length })}</li>}
          {why.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {/* period */}
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('ta.title')}>
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={period === p} className={`rounded-full px-3 py-1 text-xs font-semibold ${period === p ? 'bg-sea text-white' : 'bg-stone-100 text-stone-700'}`} onClick={() => setPeriod(p)} data-testid={`ta-period-${p}`}>
            {t(`ta.period.${p}`)}
          </button>
        ))}
      </div>

      {/* phase */}
      <section data-testid="ta-phase">
        <h3 className="font-bold text-sea">{t('ta.phase')}</h3>
        <p className="mt-1 text-sm">
          <PhaseChip k={rep.phase.kind} />{' '}
          {rep.phase.since ? t(rep.phase.kind === 'bull' || rep.phase.kind === 'correction' ? 'ta.ph.since.bull' : 'ta.ph.since.bear', { date: dateFmt(lang, rep.phase.since), chg: percent(lang, rep.phase.sinceStart, 1, true) }) : t('ta.ph.none')}
        </p>
        <p className="text-xs text-stone-600">
          {t('ta.ph.peak', { v: percent(lang, rep.phase.fromPeak, 1, true) })} · {t('ta.ph.trough', { v: percent(lang, rep.phase.fromTrough, 1, true) })}
        </p>
        <p className="mt-2 text-xs text-stone-500">{t('ta.ph.bar')}</p>
        <PhaseBar x={x} segments={rep.phase.segments} labels={{ bull: t('ta.ph.bull'), bear: t('ta.ph.bear') }} testId="ta-phasebar" />
        <p className="mt-1 text-xs text-stone-500">{t('ta.ph.explain')}</p>
      </section>

      {/* price */}
      <section>
        <h3 className="font-bold text-sea">{t('ta.chart.price')}</h3>
        <LineChart x={x} height={240} axis lines={priceLines} band={{ lo: w(full.bb.lower), hi: w(full.bb.upper), color: '#93c5fd' }} markers={markers} format={axisNum} testId={priceTestId} />
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600">
          <li>
            <span className="text-sea">━</span> {t('ta.lg.close')}
          </li>
          <li>
            <span style={{ color: '#c99a2e' }}>━</span> {t('ta.lg.sma50')}
          </li>
          <li>
            <span style={{ color: '#2563eb' }}>╍</span> {t('ta.lg.sma200')}
          </li>
          <li>
            <span style={{ color: '#93c5fd' }}>█</span> {t('ta.lg.bb')}
          </li>
          {sup && (
            <li>
              <span className="text-up">┄</span> {t('ta.lg.support')}
            </li>
          )}
          {res && (
            <li>
              <span className="text-down">┄</span> {t('ta.lg.resistance')}
            </li>
          )}
          {pat && (
            <li>
              <span style={{ color: '#7a4fb3' }}>╍</span> {t('ta.lg.pattern')}: {t(`ta.p.${pat.kind}`)}
            </li>
          )}
        </ul>
        <p className="mt-1 text-xs text-stone-500">{t('ta.chart.priceExplain')}</p>
      </section>

      {/* RSI and MACD */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <h3 className="font-bold text-sea">{t('ta.chart.rsi')}</h3>
          <LineChart x={x} height={130} range={[0, 100]} axis lines={[{ values: w(full.rsi), color: '#7a4fb3', label: t('ta.lg.rsi') }, { values: x.map(() => 70), color: '#c0392b', width: 1, dash: '3 3' }, { values: x.map(() => 30), color: '#1f8a4c', width: 1, dash: '3 3' }]} format={(v) => num(v, 0)} testId="ta-rsi" />
          <p className="mt-1 text-xs text-stone-500">{t('ta.chart.rsiExplain')}</p>
        </section>
        <section>
          <h3 className="font-bold text-sea">{t('ta.chart.macd')}</h3>
          <LineChart x={x} height={130} axis lines={[{ values: w(full.macd.macd), color: '#0f3d3e', label: t('ta.lg.macd') }, { values: w(full.macd.signal), color: '#c99a2e', label: t('ta.lg.signal') }, { values: x.map(() => 0), color: '#d6d3d1', width: 1 }]} format={(v) => num(v)} testId="ta-macd" />
          <p className="mt-1 text-xs text-stone-500">{t('ta.chart.macdExplain')}</p>
        </section>
      </div>

      {/* patterns */}
      <section data-testid="ta-patterns">
        <h3 className="font-bold text-sea">{t('ta.patterns')}</h3>
        {rep.patterns.length ? (
          <ul className="mt-2 space-y-3">
            {rep.patterns.map((p) => (
              <li key={p.kind} className="rounded-xl border border-stone-200 p-3" data-testid={`ta-pattern-${p.kind}`} data-status={p.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <b>{t(`ta.p.${p.kind}`)}</b>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}>{t(`ta.st.${p.status}`)}</span>
                  <span className={`text-xs font-semibold ${p.bias > 0 ? 'text-up' : 'text-down'}`}>
                    {p.bias > 0 ? '▲' : '▼'} {t(p.bias > 0 ? 'ta.p.bias.up' : 'ta.p.bias.down')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-700">{t(`ta.pd.${p.kind}`)}</p>
                <p className="mt-1 text-xs text-stone-600">
                  {t('ta.p.period', { from: dateFmt(lang, p.from), to: dateFmt(lang, p.to) })}
                  {p.breakDate && <> · {t('ta.p.break', { date: dateFmt(lang, p.breakDate) })}</>} · {t('ta.p.line', { v: num(p.line.p2) })} · {t('ta.p.target', { v: num(p.target) })}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-stone-500">{t('ta.noPatterns')}</p>
        )}
        <p className="mt-2 text-xs text-stone-500">{t('ta.p.targetExplain')}</p>
      </section>

      {/* indicator votes */}
      <section data-testid="ta-votes">
        <h3 className="font-bold text-sea">{t('ta.votes')}</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(['ma', 'osc'] as const).map((g) => (
            <table key={g} className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-1">{t(`ta.g.${g}`)}</th>
                  <th className="text-right">{t('ta.col.value')}</th>
                  <th className="pl-2 text-right">{t('ta.col.vote')}</th>
                </tr>
              </thead>
              <tbody>
                {rep.votes
                  .filter((v) => v.group === g)
                  .map((v) => (
                    <tr key={v.id} className="border-t border-stone-100" data-testid={`ta-vote-${v.id}`} data-vote={v.vote}>
                      <td className="py-1 pr-2">{voteName(v.id)}</td>
                      <td className="text-right num">{voteValue(v.id, v.value)}</td>
                      <td className={`pl-2 text-right font-semibold ${VOTE_STYLE[v.vote]}`}>{v.value == null ? '–' : t(`ta.vote.${v.vote}`)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">{t('ta.votesExplain')}</p>
      </section>

      {/* levels and other numbers */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section data-testid="ta-levels">
          <h3 className="font-bold text-sea">{t('ta.levels')}</h3>
          <dl className="mt-1 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 text-stone-500">{t('ta.resistance')}</dt>
              <dd>{rep.levels.resistance.length ? rep.levels.resistance.map((l) => `${num(l.price)} (${t('ta.touches', { n: l.touches })})`).join(' · ') : t('ta.noResistance')}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 text-stone-500">{t('ta.support')}</dt>
              <dd>{rep.levels.support.length ? rep.levels.support.map((l) => `${num(l.price)} (${t('ta.touches', { n: l.touches })})`).join(' · ') : t('ta.noSupport')}</dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-stone-500">{t('ta.levelsExplain')}</p>
        </section>
        <section data-testid="ta-stats">
          <h3 className="font-bold text-sea">{t('ta.stats')}</h3>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-stone-500">{t('ta.high52')}</dt>
            <dd className="num">{num(rep.high52)}</dd>
            <dt className="text-stone-500">{t('ta.low52')}</dt>
            <dd className="num">{num(rep.low52)}</dd>
            <dt className="text-stone-500">{t('ta.fromHigh')}</dt>
            <dd>
              <Pct v={rep.fromHigh52} />
            </dd>
            <dt className="text-stone-500">{t('ta.fromLow')}</dt>
            <dd>
              <Pct v={rep.fromLow52} />
            </dd>
            {rep.trend && (
              <>
                <dt className="text-stone-500">{t('ta.channel')}</dt>
                <dd>{t('ta.channelV', { slope: percent(lang, rep.trend.slopeYear, 0, true), r2: num(rep.trend.r2, 2) })}</dd>
              </>
            )}
          </dl>
          <p className="mt-1 text-xs text-stone-500">{t('ta.channelExplain')}</p>
        </section>
      </div>

      {/* analysts (shares covered by the GPW programme) */}
      {analysts.length > 0 && (
        <section data-testid="ta-analysts">
          <h3 className="font-bold text-sea">{t('ta.analysts')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {analysts.map((r) => (
              <li key={r.pdf} className="flex flex-wrap items-center gap-2">
                <span className="text-stone-500">{dateFmt(lang, r.date)}</span>
                <span>{r.broker}</span>
                <span className="text-stone-500">· {r.type}</span>
                {r.rating && <BrokerChip r={r.rating} />}
                <a className="text-sea-2 underline" href={`https://www.gpw.pl${r.pdf}`} target="_blank" rel="noreferrer noopener">
                  PDF
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-stone-500">{t('ta.analystsExplain')}</p>
        </section>
      )}

      <p className="text-xs text-stone-500">{t('ta.source', { date: dateFmt(lang, rep.date) })}</p>
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-stone-700" data-testid="ta-disclaimer">
        {t('ta.disclaimer')}
      </p>
    </div>
  )
}

const BROKER_STYLE: Record<string, string> = { buy: 'bg-emerald-600 text-white', accumulate: 'bg-emerald-100 text-emerald-800', hold: 'bg-stone-100 text-stone-700', reduce: 'bg-red-100 text-red-800', sell: 'bg-red-600 text-white' }
export function BrokerChip({ r }: { r: string }) {
  const { t } = useApp()
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${BROKER_STYLE[r] ?? 'bg-stone-100'}`}>{t(`inst.rating.${r}`)}</span>
}

/** The analysis in a wide dialog, with a "technical analysis" title. */
export function TechModal({ path, name, shareName, onClose, testId = 'tech-modal', priceTestId }: { path: string; name: string; shareName?: string; onClose: () => void; testId?: string; priceTestId?: string }) {
  const { t } = useApp()
  return (
    <Modal title={`${name} – ${t('ta.title')}`} onClose={onClose} testId={testId} wide>
      <TechAnalysis path={path} name={name} shareName={shareName} priceTestId={priceTestId} />
    </Modal>
  )
}

/** A small button that opens the analysis of an instrument. */
export function TechButton({ path, name, shareName, testId }: { path: string; name: string; shareName?: string; testId?: string }) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn-ghost !px-3 !py-1 text-sm" onClick={() => setOpen(true)} data-testid={testId ?? 'ta-open'}>
        📈 {t('ta.open')}
      </button>
      {open && <TechModal path={path} name={name} shareName={shareName} onClose={() => setOpen(false)} />}
    </>
  )
}

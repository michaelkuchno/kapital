import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../state'
import { Card } from '../components/ui'
import { LineChart } from '../components/charts'
import { rate } from '../i18n'
import { PILLAR3A_2026 } from '@core/products'
import { mulberry32, normal } from '@core/montecarlo'
import { sma } from '@core/stats'
import { loadSeries } from '../market'
import { futureValue } from '@core/goals'
import { BELKA } from '@core/money'

/** Animate a value from `from` to `to` (respects "reduce motion"). */
function useAnimate(to: number, setter: (v: number) => void, ms = 2400) {
  const raf = useRef(0)
  return () => {
    cancelAnimationFrame(raf.current)
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return setter(to)
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      setter(Math.round(to * p))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }
}

function Lesson({ id, title, lead, children, years, setYears, max, label }: { id: string; title: string; lead: string; children: ReactNode; years: number; setYears: (n: number) => void; max: number; label: string }) {
  const { t } = useApp()
  const play = useAnimate(max, setYears)
  return (
    <Card title={title} testId={`lesson-${id}`}>
      <p className="mb-3 text-sm leading-relaxed text-stone-700">{lead}</p>
      {children}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn-primary !py-1" onClick={() => (setYears(0), setTimeout(play, 50))} data-testid={`play-${id}`}>
          ▶ {t('learn.play')}
        </button>
        <input type="range" min={0} max={max} value={years} onChange={(e) => setYears(Number(e.target.value))} className="flex-1 accent-[#0f3d3e]" aria-label={label} data-testid={`slider-${id}`} />
        <span className="num w-20 text-right text-sm font-semibold">{label}</span>
      </div>
    </Card>
  )
}

/** 1. Compound interest: the same money with and without interest on interest */
function Compound() {
  const { t, fmtCur } = useApp()
  const [y, setY] = useState(30)
  const r = 0.06
  const start = 10_000
  const simple = start * (1 + r * y)
  const comp = start * Math.pow(1 + r, y)
  const max = start * Math.pow(1 + r, 30)
  const bar = (v: number, color: string, testId: string) => <div className="w-full rounded-t-xl transition-all duration-300" style={{ height: `${(v / max) * 100}%`, background: color }} data-testid={testId} data-value={Math.round(v)} />
  return (
    <Lesson id="compound" title={t('learn.compound.title')} lead={t('learn.compound.lead', { amount: fmtCur(start) })} years={y} setYears={setY} max={30} label={t('learn.years', { n: y })}>
      <div className="flex h-48 items-end gap-6 px-6">
        {[
          [start, '#a8a29e', 'learn.compound.none', 'bar-none'],
          [simple, '#c99a2e', 'learn.compound.simple', 'bar-simple'],
          [comp, '#0f3d3e', 'learn.compound.compound', 'bar-compound'],
        ].map(([v, c, k, id]) => (
          <div key={k as string} className="flex h-full flex-1 flex-col justify-end text-center">
            <div className="num mb-1 text-sm font-bold">{fmtCur(v as number)}</div>
            {bar(v as number, c as string, id as string)}
            <div className="mt-1 text-xs text-stone-600">{t(k as string)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm">{t('learn.compound.result', { years: y, extra: fmtCur(comp - simple) })}</p>
    </Lesson>
  )
}

/** 2. Inflation: what 100 zł buys after n years */
function Inflation() {
  const { t, fmtCur, market, settings } = useApp()
  // Swiss families: Swiss inflation (SNB), otherwise Polish (GUS)
  const cpi = settings.country === 'CH' ? (market?.ch?.cpi ?? 1) : (market?.cpi.at(-1)?.yoy ?? 3.5)
  const [y, setY] = useState(10)
  const left = 100 / Math.pow(1 + cpi / 100, y)
  return (
    <Lesson id="inflation" title={t('learn.inflation.title')} lead={t('learn.inflation.lead', { cpi })} years={y} setYears={setY} max={30} label={t('learn.years', { n: y })}>
      <div className="flex items-center justify-center gap-8 py-2">
        <svg viewBox="0 0 120 120" className="h-36 w-36">
          <circle cx="60" cy="60" r="56" fill="#f4f1ea" stroke="#d6d3d1" strokeDasharray="4 4" />
          <circle cx="60" cy="60" r={56 * Math.sqrt(left / 100)} fill="#c99a2e" className="transition-all duration-300" data-testid="coin" />
          <text x="60" y="66" textAnchor="middle" fontSize="18" fontWeight="800" fill="#12201f">
            {fmtCur(left)}
          </text>
        </svg>
        <p className="max-w-xs text-sm">{t('learn.inflation.result', { years: y, value: fmtCur(left, 2), hundred: fmtCur(100) })}</p>
      </div>
    </Lesson>
  )
}

/** 3. How an EDO bond grows, year by year (offer of the month, assumed inflation) */
function Edo() {
  const { t, lang, market, settings, fmtCur } = useApp()
  const edo = market?.offer.find((o) => o.code === 'EDO') ?? { firstRate: 5.35, margin: 2 }
  const [y, setY] = useState(10)
  const vals: number[] = [100]
  for (let k = 1; k <= 10; k++) vals.push(vals[k - 1] * (1 + (k === 1 ? edo.firstRate : settings.assumeCpi + edo.margin) / 100))
  const net = 100 + (vals[10] - 100) * (1 - BELKA)
  return (
    <Lesson id="edo" title={t('learn.edo.title')} lead={t('learn.edo.lead', { first: rate(lang, edo.firstRate), margin: rate(lang, edo.margin) })} years={y} setYears={setY} max={10} label={t('learn.years', { n: y })}>
      <div className="flex h-40 items-end gap-1">
        {vals.slice(1).map((v, k) => (
          <div key={k} className="flex flex-1 flex-col items-center justify-end">
            <div className={`w-full rounded-t-md transition-all duration-300 ${k < y ? 'bg-sea' : 'bg-stone-200'}`} style={{ height: `${((v - 90) / (vals[10] - 90)) * 100}%` }} />
            <span className="mt-1 text-[10px] text-stone-500">{k + 1}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm">{t('learn.edo.result', { cpi: settings.assumeCpi, amount: fmtCur(10_000), gross: fmtCur(vals[10] * 100), net: fmtCur(net * 100) })}</p>
    </Lesson>
  )
}

/** 4. Diversification: one share vs a basket of n shares (simulated, same expected return) */
function Diversify() {
  const { t } = useApp()
  const [n, setN] = useState(1)
  const paths = useMemo(() => {
    const rng = mulberry32(7)
    const days = 250
    const market = Array.from({ length: days }, () => normal(rng) * 0.008)
    return Array.from({ length: 30 }, () => market.map((m) => m + normal(rng) * 0.025))
  }, [])
  const series = (k: number) => {
    let v = 100
    const out = [100]
    for (let d = 0; d < paths[0].length; d++) {
      let r = 0
      for (let i = 0; i < k; i++) r += paths[i][d]
      v *= 1 + r / k
      out.push(v)
    }
    return out
  }
  const one = series(1)
  const basket = series(Math.max(1, n))
  const x = one.map((_, i) => String(i))
  return (
    <Lesson id="diversify" title={t('learn.div.title')} lead={t('learn.div.lead')} years={n} setYears={(v) => setN(Math.max(1, v))} max={30} label={t('learn.stocks', { n })}>
      <LineChart x={x} height={170} lines={[{ values: one, color: '#c0392b', width: 1.5, label: t('learn.div.one') }, { values: basket, color: '#0f3d3e', width: 2.5, label: t('learn.div.many', { n }) }]} format={(v) => v.toFixed(0)} />
      <p className="mt-1 text-xs text-stone-500">
        <span className="text-down">━</span> {t('learn.div.one')} · <span className="text-sea">━</span> {t('learn.div.many', { n })}
      </p>
    </Lesson>
  )
}

/** 5. Trend: the real WIG with its 200-session average, drawn step by step */
function Trend() {
  const { t } = useApp()
  const [bars, setBars] = useState<{ date: string; close: number }[]>([])
  const [p, setP] = useState(100)
  useEffect(() => {
    void loadSeries('indices/WIG').then(setBars)
  }, [])
  const a200 = useMemo(() => sma(bars, 200), [bars])
  const shown = Math.max(2, Math.round((bars.length * p) / 100))
  return (
    <Lesson id="trend" title={t('learn.trend.title')} lead={t('learn.trend.lead')} years={p} setYears={setP} max={100} label={`${p}%`}>
      {bars.length > 2 ? (
        <LineChart x={bars.map((b) => b.date)} height={180} lines={[{ values: bars.map((b, i) => (i < shown ? b.close : null)), color: '#0f3d3e', label: 'WIG' }, { values: a200.map((v, i) => (i < shown ? v : null)), color: '#7a4fb3', dash: '5 4', label: 'SMA200' }]} format={(v) => v.toFixed(0)} />
      ) : (
        <p className="text-sm text-stone-500">…</p>
      )}
    </Lesson>
  )
}

/** 6. Tax wrappers: the same saving with and without Belka tax (IKE) */
function Wrapper() {
  const { t, fmtCur, settings, cur, market } = useApp()
  const [y, setY] = useState(20)
  const ch = settings.country === 'CH'
  // Poland: IKE vs 19 % tax on gains; Switzerland: pillar 3a with ~25 % income-tax refund invested as well
  const yearly = ch ? (cur === 'CHF' ? PILLAR3A_2026 : PILLAR3A_2026 * (market?.fx?.rates.CHF ?? 4.8)) : 10_000
  const r = ch ? 0.04 : 0.06
  const ike = ch ? futureValue(0, (yearly * 1.25) / 12, y, r) : futureValue(0, yearly / 12, y, r)
  const taxed = ch ? futureValue(0, yearly / 12, y, r) : futureValue(0, yearly / 12, y, r * (1 - BELKA))
  const k = ch ? 'learn.p3a' : 'learn.ike'
  return (
    <Lesson id="ike" title={t(`${k}.title`)} lead={t(`${k}.lead`, { amount: fmtCur(yearly), refund: fmtCur(yearly * 0.25) })} years={y} setYears={setY} max={30} label={t('learn.years', { n: y })}>
      <div className="space-y-2">
        {[
          [ike, '#0f3d3e', t(`${k}.with`), 'ike-with'],
          [taxed, '#a8a29e', t(`${k}.without`), 'ike-without'],
        ].map(([v, c, l, id]) => (
          <div key={id as string}>
            <div className="flex text-sm">
              <span className="flex-1">{l as string}</span>
              <b className="num" data-testid={id as string} data-value={Math.round(v as number)}>
                {fmtCur(v as number)}
              </b>
            </div>
            <div className="h-4 rounded bg-stone-100">
              <div className="h-4 rounded transition-all duration-300" style={{ width: `${((v as number) / (ch ? futureValue(0, (yearly * 1.25) / 12, 30, r) : futureValue(0, yearly / 12, 30, r))) * 100}%`, background: c as string }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm">{t(`${k}.result`, { years: y, diff: fmtCur(ike - taxed) })}</p>
    </Lesson>
  )
}

export function Learn() {
  const { t } = useApp()
  return (
    <div className="space-y-4" data-testid="learn">
      <h1 className="text-2xl font-extrabold text-sea">{t('nav.learn')}</h1>
      <p className="text-sm text-stone-600">{t('learn.intro')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Compound />
        <Inflation />
        <Edo />
        <Wrapper />
        <Diversify />
        <Trend />
      </div>
      <p className="text-xs text-stone-500">{t('disclaimer')}</p>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../state'
import { Card, Field, Num, Pct } from '../components/ui'
import { CountUp, Flow, Gauge, LineChart, Radar } from '../components/charts'
import { buildPlan, type PlanInput, type Plan, type Bucket, type PlanItem } from '@core/planner'
import { productFor, liveMetrics, type LiveMetrics } from '@core/products'
import { fitAr1 } from '@core/montecarlo'
import { EVIDENCE } from '@core/evidence'
import { latestCpi } from '@core/inflation'
import { DEFAULT_PLANNER, type PlannerState } from '../planner-state'
import { loadSeries } from '../market'
import { yearlyCpi } from './Plan'
import { dateFmt, money, percent } from '../i18n'
import type { Signal } from '@core/signals'

const BUCKET_COLOR: Record<Bucket, string> = { safe: '#3f8f8a', balanced: '#0f3d3e', growth: '#c99a2e' }
const STEPS = ['family', 'money', 'now', 'risk', 'goals'] as const

function Choice<T extends string | number>({ value, options, onChange, testId }: { value: T; options: { v: T; label: string; icon?: string }[]; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={`rounded-2xl border-2 p-3 text-left text-sm font-semibold transition ${value === o.v ? 'border-sea bg-mint/60 text-sea shadow' : 'border-stone-200 bg-white hover:border-sea-2'}`} onClick={() => onChange(o.v)} data-testid={`${testId}-${o.v}`}>
          {o.icon && <span className="mr-1 text-lg">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Dots({ n, of = 5, color = '#0f3d3e', testId }: { n: number; of?: number; color?: string; testId?: string }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n}/${of}`} data-testid={testId} data-value={n}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: i < n ? color : '#e7e5e4' }} />
      ))}
    </span>
  )
}

const SIG_STYLE: Record<Signal, string> = { buy: 'bg-emerald-100 text-emerald-800', sell: 'bg-red-100 text-red-800', neutral: 'bg-stone-100 text-stone-700' }

/** Indicator card of one proposed investment: what it is, the money, why, and every number that matters. */
function ProductCard({ item, residence }: { item: PlanItem; residence: PlanInput['residence'] }) {
  const { t, fmt, lang, market } = useApp()
  const p = productFor(item.id, residence)
  const [m, setM] = useState<LiveMetrics | null>(null)
  const [bars, setBars] = useState<{ date: string; close: number }[]>([])
  useEffect(() => {
    const isin = p.gpwTicker ? market?.shares.find((s) => s.name === p.gpwTicker)?.isin : undefined
    const path = p.series ?? (isin ? `shares/${isin}` : undefined)
    if (!path) return
    void loadSeries(path).then((b) => {
      setBars(b.slice(-252))
      setM(liveMetrics(b))
    })
  }, [p, market])
  return (
    <article className="rise rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5" style={{ borderTop: `5px solid ${BUCKET_COLOR[item.bucket]}` }} data-testid={`plan-item-${item.id}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-lg font-bold text-ink">{t(`prod.${productFor(item.id, residence).id}`)}</h3>
        {item.id.startsWith('planned-') && <span className="text-sm text-stone-500">„{String(item.params?.name ?? '')}”</span>}
        <span className="ml-auto text-xl font-extrabold">
          <CountUp value={item.amount} format={(v) => fmt(v)} testId={`plan-amount-${item.id}`} />
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-700">{t(item.why, item.params)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4" data-testid={`ind-${item.id}`}>
        <div>
          <dt className="text-stone-500">{t('ind.risk')}</dt>
          <dd>
            <Dots n={p.risk} color="#c0392b" testId={`ind-risk-${item.id}`} />
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">{t('ind.cost')}</dt>
          <dd>
            <Dots n={p.cost} color="#a8a29e" />
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">{t('ind.inflation')}</dt>
          <dd>
            <Dots n={p.inflationProtection} color="#1f8a4c" />
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">{t('ind.liquidity')}</dt>
          <dd className="font-semibold">{t(`ind.liq.${p.liquidity}`)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">{t('ind.expected')}</dt>
          <dd className="font-semibold">
            {p.expectedReal[0] === p.expectedReal[1] ? `${p.expectedReal[0]}%` : `${p.expectedReal[0]}…${p.expectedReal[1]}%`} {t('ind.real')}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">{t('ind.nominal')}</dt>
          <dd className="font-semibold">{p.canLoseNominal ? t('ind.canLose') : t('ind.cannotLose')}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-stone-500">{t('ind.tax')}</dt>
          <dd className="font-semibold">{t(p.taxKey)}</dd>
        </div>
        {m?.vol != null && (
          <>
            <div>
              <dt className="text-stone-500">{t('ind.vol')}</dt>
              <dd className="font-semibold">{percent(lang, m.vol, 0)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">{t('ind.maxDD', { from: m.from ? dateFmt(lang, m.from) : '–' })}</dt>
              <dd className="font-semibold text-down">{percent(lang, m.maxDrawdown, 0)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">{t('ind.ret1y')}</dt>
              <dd className="font-semibold">
                <Pct v={m.ret1y} />
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">{t('ind.signal')}</dt>
              <dd>
                <span className={`rounded-full px-2 py-0.5 font-bold ${SIG_STYLE[m.signal!]}`} data-testid={`ind-signal-${item.id}`}>
                  {t(`sig.${m.signal}`)}
                </span>
              </dd>
            </div>
          </>
        )}
      </dl>
      {bars.length > 30 && (
        <div className="mt-2">
          <LineChart x={bars.map((b) => b.date)} height={90} lines={[{ values: bars.map((b) => b.close), color: BUCKET_COLOR[item.bucket], width: 1.8 }]} format={(v) => money(lang, v, 2)} />
        </div>
      )}
      <details className="mt-2 text-xs text-stone-600">
        <summary className="cursor-pointer font-semibold text-sea-2">{t('ind.how')}</summary>
        <p className="mt-1">{t(p.howKey)}</p>
        <ul className="mt-1 list-disc pl-5">
          {item.evidence.map((e) => (
            <li key={e}>
              <a className="underline" href={EVIDENCE[e]?.url} target="_blank" rel="noreferrer">
                {EVIDENCE[e]?.cite}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
}

function Step({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="rise space-y-4">
      <div>
        <h2 className="text-2xl font-extrabold text-sea">{title}</h2>
        {lead && <p className="mt-1 text-stone-600">{lead}</p>}
      </div>
      {children}
    </div>
  )
}

export function Advisor() {
  const { t, settings, update, summary, market, asOf, fmt, lang, cur } = useApp()
  const [st, setSt] = useState<PlannerState>(() => settings.planner ?? DEFAULT_PLANNER(settings.country))
  const [step, setStepRaw] = useState<number>(settings.planner ? STEPS.length : 0)
  // settings arrive a moment after the screen opens: a saved plan is shown as soon as it is loaded,
  // unless the user has already started answering
  const touched = useRef(false)
  const setStep = (n: number) => {
    touched.current = true
    setStepRaw(n)
  }
  useEffect(() => {
    if (settings.planner && !touched.current) {
      setSt(settings.planner)
      setStepRaw(STEPS.length)
    }
  }, [settings.planner])
  const set = (p: Partial<PlannerState>) => {
    touched.current = true
    setSt((s) => ({ ...s, ...p }))
  }
  const save = (next: PlannerState) => void update({ planner: next })

  const input: PlanInput | null = useMemo(() => {
    if (!market) return null
    const chf = market.fx?.rates.CHF ?? 4.8
    const cpi = st.residence === 'CH' ? (market.ch?.cpi ?? 1) : (latestCpi(market.cpi)?.yoy ?? 3)
    const a = market.analysis
    const wig = a?.signals.find((s) => s.code === 'WIG')?.report.signal ?? 'neutral'
    const w20 = market.summary.indices.find((x) => x.code === 'WIG20TR')?.report.ret12m ?? undefined
    const sp = market.world?.sp500
    const spRet = sp && sp.length > 252 ? sp[sp.length - 1].value / sp[sp.length - 253].value - 1 : undefined
    const by = summary.byClass
    return {
      asOf,
      currency: st.currency,
      chfRate: chf,
      monthlyIncome: st.monthlyIncome,
      monthlyExpenses: st.monthlyExpenses,
      earners: st.earners,
      adults: st.adults,
      children: st.children.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.birth)),
      job: st.job,
      residence: st.residence,
      cash: st.cash,
      cashCurrency: st.cashCurrency,
      debtMonthly: st.debtMonthly,
      expensiveDebt: st.expensiveDebt,
      planned: st.planned.filter((p) => p.name && p.amount > 0),
      answers: st.answers,
      horizonYears: st.horizonYears,
      family800: settings.family800,
      usesIke: settings.usesIke,
      usesIkze: settings.usesIkze,
      existing: st.includeExisting ? { safe: by.deposits + by.cash, balanced: by['bonds-inflation'] + by['bonds-fixed'], growth: by.equities + by.other, largestStockShare: summary.largest?.share ?? 0, plnShare: summary.plnShare } : { safe: 0, balanced: 0, growth: 0, largestStockShare: 0 },
      market: {
        offer: market.offer,
        cpi,
        refRate: market.ref?.ref ?? 3.75,
        wigSignal: wig,
        worldSignal: a?.world?.sp500Signal?.signal ?? 'neutral',
        plMood: a?.sentiment.pl?.mood ?? 'neutral',
        worldMood: a?.sentiment.world?.mood ?? 'neutral',
        momentum: { world: spRet, poland: w20 },
      },
      cpiModel: st.residence === 'CH' ? { mean: 1, phi: 0.6, sigma: 1 } : yearlyCpi(market.cpi).length >= 4 ? fitAr1(yearlyCpi(market.cpi)) : undefined,
      childGoal: st.childGoal,
    }
  }, [st, market, summary, settings, asOf])
  const plan: Plan | null = useMemo(() => (input && step >= STEPS.length ? buildPlan(input) : null), [input, step])
  const done = new Set(settings.planDone ?? [])

  const next = () => {
    const n = Math.min(STEPS.length, step + 1)
    if (n === STEPS.length) save(st)
    setStep(n)
    window.scrollTo?.(0, 0)
  }
  const ccy = (c: 'PLN' | 'CHF') => c
  if (!plan)
    return (
      <div className="mx-auto max-w-3xl space-y-5" data-testid="advisor">
        <div className="rounded-3xl bg-gradient-to-br from-sea to-sea-2 p-5 text-white shadow-lg">
          <div className="text-sm opacity-80">✨ {t('adv.badge')}</div>
          <h1 className="text-2xl font-extrabold">{t('adv.title')}</h1>
          <p className="mt-1 text-sm opacity-90">{t('adv.lead')}</p>
          <div className="mt-3 h-2 rounded-full bg-white/20">
            <div className="h-2 rounded-full bg-gold transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} data-testid="adv-progress" />
          </div>
          <div className="mt-1 text-xs opacity-80">{t('adv.step', { n: step + 1, of: STEPS.length })}</div>
        </div>
        <section className="card">
          {STEPS[step] === 'family' && (
            <Step title={t('adv.family.title')} lead={t('adv.family.lead')}>
              <Field label={t('country.title')}>
                <Choice value={st.residence} onChange={(v) => set({ residence: v, currency: v === 'CH' ? 'CHF' : 'PLN', cashCurrency: v === 'CH' ? 'CHF' : 'PLN' })} options={[{ v: 'PL', label: t('country.PL') }, { v: 'CH', label: t('country.CH') }, { v: 'other', label: t('adv.otherCountry'), icon: '🌍' }]} testId="adv-residence" />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('adv.adults')}>
                  <Num value={st.adults} onChange={(v) => set({ adults: v })} testId="adv-adults" />
                </Field>
                <Field label={t('adv.earners')}>
                  <Num value={st.earners} onChange={(v) => set({ earners: v })} testId="adv-earners" />
                </Field>
              </div>
              <Field label={t('adv.job')}>
                <Choice value={st.job} onChange={(v) => set({ job: v })} options={[{ v: 'stable', label: t('adv.job.stable'), icon: '🏢' }, { v: 'variable', label: t('adv.job.variable'), icon: '🎢' }, { v: 'none', label: t('adv.job.none'), icon: '⏸' }]} testId="adv-job" />
              </Field>
              <div>
                <span className="label">{t('adv.children')}</span>
                {st.children.map((c, k) => (
                  <div key={k} className="mb-2 flex gap-2">
                    <input className="input" type="date" value={c.birth} onChange={(e) => set({ children: st.children.map((x, j) => (j === k ? { birth: e.target.value } : x)) })} data-testid={`adv-child-${k}`} aria-label={t('adv.childBirth')} />
                    <button type="button" className="btn-ghost" onClick={() => set({ children: st.children.filter((_, j) => j !== k) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-ghost" onClick={() => set({ children: [...st.children, { birth: '' }] })} data-testid="adv-add-child">
                  + {t('adv.addChild')}
                </button>
              </div>
            </Step>
          )}
          {STEPS[step] === 'money' && (
            <Step title={t('adv.money.title')} lead={t('adv.money.lead')}>
              <Field label={t('adv.currency')}>
                <Choice value={st.currency} onChange={(v) => set({ currency: v })} options={[{ v: 'PLN', label: 'PLN (zł)' }, { v: 'CHF', label: 'CHF (Fr.)' }]} testId="adv-currency" />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={`${t('adv.income')} (${ccy(st.currency)})`}>
                  <Num value={st.monthlyIncome} onChange={(v) => set({ monthlyIncome: v })} testId="adv-income" />
                </Field>
                <Field label={`${t('adv.expenses')} (${ccy(st.currency)})`}>
                  <Num value={st.monthlyExpenses} onChange={(v) => set({ monthlyExpenses: v })} testId="adv-expenses" />
                </Field>
                <Field label={`${t('adv.debtMonthly')} (${ccy(st.currency)})`}>
                  <Num value={st.debtMonthly} onChange={(v) => set({ debtMonthly: v })} testId="adv-debt-monthly" />
                </Field>
                <Field label={`${t('adv.expensiveDebt')} (PLN)`}>
                  <Num value={st.expensiveDebt} onChange={(v) => set({ expensiveDebt: v })} testId="adv-expensive-debt" />
                </Field>
              </div>
              {Number.isFinite(st.monthlyIncome) && Number.isFinite(st.monthlyExpenses) && st.monthlyIncome > 0 && (
                <p className={`rounded-xl p-3 text-sm font-semibold ${st.monthlyIncome - st.monthlyExpenses - st.debtMonthly >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`} data-testid="adv-surplus">
                  {t('adv.surplusPreview', { amount: money(lang, st.monthlyIncome - st.monthlyExpenses - (st.debtMonthly || 0), 0, st.currency) })}
                </p>
              )}
            </Step>
          )}
          {STEPS[step] === 'now' && (
            <Step title={t('adv.now.title')} lead={t('adv.now.lead')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('adv.cash')}>
                  <Num value={st.cash} onChange={(v) => set({ cash: v })} testId="adv-cash" />
                </Field>
                <Field label={t('adv.cashCurrency')}>
                  <Choice value={st.cashCurrency} onChange={(v) => set({ cashCurrency: v })} options={[{ v: 'PLN', label: 'PLN' }, { v: 'CHF', label: 'CHF' }]} testId="adv-cash-currency" />
                </Field>
              </div>
              <label className="flex items-center gap-2 rounded-xl bg-mint/40 p-3 text-sm">
                <input type="checkbox" checked={st.includeExisting} onChange={(e) => set({ includeExisting: e.target.checked })} data-testid="adv-include-existing" />
                {t('adv.includeExisting', { amount: fmt(summary.total) })}
              </label>
              <div>
                <span className="label">{t('adv.planned')}</span>
                {st.planned.map((p, k) => (
                  <div key={k} className="mb-2 grid grid-cols-[1fr_8rem_6rem_auto] gap-2">
                    <input className="input" value={p.name} placeholder={t('adv.plannedName')} onChange={(e) => set({ planned: st.planned.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} data-testid={`adv-planned-name-${k}`} />
                    <Num value={p.amount} onChange={(v) => set({ planned: st.planned.map((x, j) => (j === k ? { ...x, amount: v } : x)) })} testId={`adv-planned-amount-${k}`} />
                    <Num value={p.inMonths} onChange={(v) => set({ planned: st.planned.map((x, j) => (j === k ? { ...x, inMonths: v } : x)) })} testId={`adv-planned-months-${k}`} />
                    <button type="button" className="btn-ghost" onClick={() => set({ planned: st.planned.filter((_, j) => j !== k) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <p className="mb-2 text-xs text-stone-500">{t('adv.plannedHint', { cur: st.currency })}</p>
                <button type="button" className="btn-ghost" onClick={() => set({ planned: [...st.planned, { name: '', amount: 0, inMonths: 12 }] })} data-testid="adv-add-planned">
                  + {t('adv.addPlanned')}
                </button>
              </div>
            </Step>
          )}
          {STEPS[step] === 'risk' && (
            <Step title={t('adv.risk.title')} lead={t('adv.risk.lead')}>
              {[0, 1, 2, 3, 4].map((q) => (
                <Field key={q} label={t(`adv.q${q + 1}`)}>
                  <Choice value={st.answers[q]} onChange={(v) => set({ answers: st.answers.map((a, j) => (j === q ? v : a)) as PlannerState['answers'] })} options={[1, 2, 3, 4, 5].map((v) => ({ v, label: t(`adv.q${q + 1}.a${v}`) }))} testId={`adv-q${q + 1}`} />
                </Field>
              ))}
            </Step>
          )}
          {STEPS[step] === 'goals' && (
            <Step title={t('adv.goals.title')} lead={t('adv.goals.lead')}>
              <Field label={t('adv.horizon', { n: st.horizonYears })}>
                <input type="range" min={1} max={30} value={st.horizonYears} onChange={(e) => set({ horizonYears: Number(e.target.value) })} className="w-full accent-[#0f3d3e]" data-testid="adv-horizon" />
              </Field>
              {st.children.length > 0 && (
                <Field label={`${t('adv.childGoal')} (PLN)`}>
                  <Num value={st.childGoal} onChange={(v) => set({ childGoal: v })} testId="adv-child-goal" />
                </Field>
              )}
              <p className="text-sm text-stone-600">{t('adv.goalsHint')}</p>
            </Step>
          )}
          <div className="mt-6 flex gap-2">
            {step > 0 && (
              <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)} data-testid="adv-back">
                ← {t('adv.back')}
              </button>
            )}
            <button type="button" className="btn-primary ml-auto" onClick={next} disabled={!stepValid(STEPS[step], st)} data-testid="adv-next">
              {step === STEPS.length - 1 ? `✨ ${t('adv.show')}` : `${t('adv.next')} →`}
            </button>
          </div>
        </section>
        <p className="text-xs text-stone-500">{t('adv.disclaimer')}</p>
      </div>
    )

  const total = plan.totals.safe + plan.totals.balanced + plan.totals.growth
  const pl = market?.analysis?.sentiment.pl
  const wd = market?.analysis?.sentiment.world
  const years = plan.projection.plan.map((y) => String(new Date().getFullYear() + y.year))
  return (
    <div className="space-y-4" data-testid="advisor">
      <section className="rise rounded-3xl bg-gradient-to-br from-sea to-sea-2 p-5 text-white shadow-lg" data-testid="plan-hero">
        <div className="text-sm opacity-80">✨ {t('adv.badge')}</div>
        <h1 className="text-2xl font-extrabold">{t('plan.hero', { profile: t(`risk.label.${plan.riskLabel}`) })}</h1>
        <p className="mt-1 text-sm opacity-90">{t('plan.heroLead', { surplus: fmt(plan.surplusPln), rate: Math.round(plan.savingsRate * 100) })}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {(['safe', 'balanced', 'growth'] as Bucket[]).map((b) => (
            <div key={b} className="rounded-2xl bg-white/10 p-2">
              <div className="text-xs opacity-80">{t(`bucket.${b}`)}</div>
              <div className="text-lg font-extrabold">
                <CountUp value={plan.totals[b]} format={(v) => fmt(v)} testId={`bucket-${b}`} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-white/15 px-3 py-1 text-sm font-semibold" onClick={() => setStep(0)} data-testid="adv-edit">
            ✎ {t('adv.edit')}
          </button>
        </div>
      </section>

      {plan.warnings.length > 0 && (
        <Card title={t('plan.warnings')} testId="plan-warnings">
          <ul className="space-y-2 text-sm">
            {plan.warnings.map((w) => (
              <li key={w.key} className="rounded-xl bg-amber-50 p-2" data-testid={`warn-${w.key}`}>
                ⚠ {t(w.key, w.params)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {total > 0 && (
        <Card title={t('plan.flow')} testId="plan-flow">
          <Flow
            source={fmt(total)}
            parts={(['safe', 'balanced', 'growth'] as Bucket[]).filter((b) => plan.totals[b] > 0).map((b) => ({ label: t(`bucket.${b}`), value: plan.totals[b], color: BUCKET_COLOR[b] }))}
            testId="flow"
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="plan-items">
        {plan.items.map((it) => (
          <ProductCard key={it.id} item={it} residence={input!.residence} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('plan.market')} testId="plan-market">
          <div className="flex flex-wrap justify-around gap-2">
            {pl && <Gauge value={pl.score} label={t('fg.pl')} sub={t(`mood.${pl.mood}`)} size={170} testId="plan-gauge-pl" />}
            {wd && <Gauge value={wd.score} label={t('fg.world')} sub={t(`mood.${wd.mood}`)} size={170} testId="plan-gauge-world" />}
          </div>
          <p className="mt-2 rounded-xl bg-mint/50 p-3 text-sm" data-testid="plan-entry">
            <b>{t(`entry.${plan.entry.mode}`, { months: plan.entry.months })}</b> – {t(plan.entry.reason)}
          </p>
        </Card>
        <Card title={t('plan.scores')} testId="plan-scores">
          <Radar axes={(['safety', 'growth', 'liquidity', 'inflation', 'cost'] as const).map((k) => ({ label: t(`score.${k}`), value: plan.scores[k] }))} testId="radar" />
        </Card>
      </div>

      <Card title={t('plan.projection', { years: plan.projection.plan.length - 1 })} testId="plan-projection">
        <LineChart
          x={years}
          height={200}
          band={{ lo: plan.projection.plan.map((y) => y.p10), hi: plan.projection.plan.map((y) => y.p90), color: '#16595a' }}
          lines={[
            { values: plan.projection.plan.map((y) => y.p50), color: '#0f3d3e', width: 2.5, label: t('plan.withPlan') },
            { values: plan.projection.cash.map((y) => y.p50), color: '#a8a29e', dash: '5 4', label: t('plan.onlyDeposit') },
          ]}
          format={(v) => fmt(v)}
        />
        <p className="mt-2 text-sm" data-testid="plan-prob">
          {t('plan.prob', { plan: Math.round(plan.projection.probLoseReal * 100), cash: Math.round(plan.projection.probLoseRealCash * 100) })}
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('plan.stress')} testId="plan-stress">
          <p className="text-sm">{t('plan.stressText', { loss: fmt(plan.stress.crashLoss), pct: Math.round(plan.stress.crashPct * 100), years: plan.stress.recoveryYears })}</p>
          <div className="mt-3 h-4 rounded bg-stone-100">
            <div className="h-4 rounded bg-down transition-all duration-700" style={{ width: `${Math.min(100, plan.stress.crashPct * 100)}%` }} data-testid="stress-bar" />
          </div>
        </Card>
        <Card title={t('plan.monthlyTitle')} testId="plan-monthly">
          <p className="text-sm">
            {plan.monthly.toReserve > 0 ? t('plan.monthlyReserve', { amount: fmt(plan.monthly.toReserve), months: plan.monthly.monthsToFillReserve }) : plan.monthly.toInvest > 0 ? t('plan.monthlyInvest', { amount: fmt(plan.monthly.toInvest), safe: Math.round(plan.split.safe * 100), balanced: Math.round(plan.split.balanced * 100), growth: Math.round(plan.split.growth * 100) }) : t('plan.monthlyNone')}
          </p>
          {plan.child && (
            <p className="mt-2 rounded-xl bg-mint/40 p-2 text-sm" data-testid="plan-child">
              👶 {t('plan.child', { target: fmt(plan.child.target), years: Math.round(plan.child.years), monthly: fmt(plan.child.monthly) })}
            </p>
          )}
          <p className="mt-2 text-xs text-stone-500">{t('plan.reserveInfo', { months: plan.reserve.months, target: fmt(plan.reserve.target), currency: plan.reserve.currency })}</p>
        </Card>
      </div>

      <Card title={t('plan.checklist')} testId="plan-checklist">
        <ul className="space-y-2">
          {plan.checklist.map((c) => (
            <li key={c.id} className="flex items-start gap-3" data-testid={`check-${c.id}`}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={done.has(c.id)}
                onChange={(e) => {
                  const s = new Set(done)
                  if (e.target.checked) s.add(c.id)
                  else s.delete(c.id)
                  void update({ planDone: [...s] })
                }}
                aria-label={t(c.key, c.params)}
                data-testid={`check-box-${c.id}`}
              />
              <div className={done.has(c.id) ? 'text-stone-400 line-through' : ''}>
                <div className="text-xs font-bold text-sea-2">{dateFmt(lang, c.when)}</div>
                <div className="text-sm">{t(c.key, { ...c.params, ...(typeof c.params?.amount === 'number' ? { amount: fmt(Number(c.params.amount)) } : {}) })}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-stone-500" data-testid="adv-disclaimer">
        {t('adv.disclaimer')} {cur === 'CHF' ? t('adv.fxNote') : ''}
      </p>
    </div>
  )
}

export function stepValid(step: (typeof STEPS)[number], s: PlannerState): boolean {
  const ok = (n: number, min = 0) => Number.isFinite(n) && n >= min
  switch (step) {
    case 'family':
      return ok(s.adults, 1) && ok(s.earners, 0) && s.earners <= s.adults && s.children.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.birth))
    case 'money':
      return ok(s.monthlyIncome) && ok(s.monthlyExpenses) && ok(s.debtMonthly) && ok(s.expensiveDebt)
    case 'now':
      return ok(s.cash) && s.planned.every((p) => p.name.trim() && ok(p.amount, 1) && ok(p.inMonths, 1))
    case 'risk':
      return s.answers.every((a) => a >= 1 && a <= 5)
    case 'goals':
      return ok(s.horizonYears, 1) && ok(s.childGoal)
  }
}

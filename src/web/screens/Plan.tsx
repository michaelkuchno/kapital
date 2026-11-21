import { useMemo, useState } from 'react'
import { useApp } from '../state'
import { Card, Field, Money, Num } from '../components/ui'
import { LineChart } from '../components/charts'
import { project, fitAr1, DEFAULT_PARAMS } from '@core/montecarlo'
import { requiredMonthly } from '@core/goals'
import { latestCpi } from '@core/inflation'

/** yearly CPI values (December readings, or the latest month of each year) for the inflation model */
export function yearlyCpi(cpi: { month: string; yoy: number }[]): number[] {
  const by = new Map<string, number>()
  for (const p of [...cpi].sort((a, b) => a.month.localeCompare(b.month))) by.set(p.month.slice(0, 4), p.yoy)
  return [...by.values()]
}

export function Plan() {
  const { t, summary: s, market, fmt, rate, cur } = useApp()
  const [years, setYears] = useState(10)
  const [contribution, setContribution] = useState(0)
  const [goal, setGoal] = useState(3_000_000)
  const [goalYears, setGoalYears] = useState(10)
  const [goalRate, setGoalRate] = useState(2)
  const cpiNow = latestCpi(market?.cpi ?? [])?.yoy ?? 3
  const sim = useMemo(() => {
    const yrs = Math.max(1, Math.min(40, Math.round(years) || 1))
    // too few yearly points for a stable fit → the model falls back to a long-run Polish average (NBP target 2.5 % ± 1)
    const hist = yearlyCpi(market?.cpi ?? [])
    const ar = hist.length >= 4 ? fitAr1(hist) : { mean: 2.8, phi: 0.6, sigma: 1.5 }
    return project({
      start: { inflationBonds: s.byClass['bonds-inflation'], fixedBonds: s.byClass['bonds-fixed'], deposits: s.byClass.deposits + s.byClass.cash, equities: s.byClass.equities + s.byClass.other },
      contribution: Number.isFinite(contribution) ? contribution * rate : 0, // entered in the display currency
      years: yrs,
      cpi: ar,
      cpiStart: cpiNow,
      paths: 2000,
      seed: 2026,
    })
  }, [s, years, contribution, market, cpiNow, rate])
  const x = sim.years.map((y) => String(new Date().getFullYear() + y.year))
  const last = sim.years[sim.years.length - 1]
  const monthly = Number.isFinite(goal) && Number.isFinite(goalYears) && Number.isFinite(goalRate) ? requiredMonthly(goal * rate, s.total, goalYears, goalRate / 100) : NaN

  return (
    <div className="space-y-4" data-testid="plan">
      <h1 className="text-2xl font-extrabold text-sea">{t('plan.title')}</h1>
      <Card title={t('plan.mc')} testId="mc">
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('plan.years')}>
            <Num value={years} onChange={setYears} testId="p-years" />
          </Field>
          <Field label={`${t('plan.contribution')} (${cur})`}>
            <Num value={contribution} onChange={setContribution} testId="p-contribution" />
          </Field>
        </div>
        <LineChart
          x={x}
          testId="mc-chart"
          band={{ lo: sim.years.map((y) => y.p10), hi: sim.years.map((y) => y.p90), color: '#16595a' }}
          lines={[
            { values: sim.years.map((y) => y.p50), color: '#0f3d3e', width: 2.5, label: t('plan.p50') },
            { values: sim.years.map((y) => y.real50), color: '#c99a2e', dash: '5 4', label: t('plan.real') },
            { values: sim.years.map((y) => y.p10), color: '#16595a', width: 1, label: t('plan.p10') },
            { values: sim.years.map((y) => y.p90), color: '#16595a', width: 1, label: t('plan.p90') },
          ]}
          format={fmt}
        />
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="mc-result">
          <div>
            <div className="text-xs text-stone-500">{t('plan.p10')}</div>
            <Money v={last.p10} />
          </div>
          <div>
            <div className="text-xs text-stone-500">{t('plan.p50')}</div>
            <b>
              <Money v={last.p50} testId="mc-p50" />
            </b>
          </div>
          <div>
            <div className="text-xs text-stone-500">{t('plan.p90')}</div>
            <Money v={last.p90} />
          </div>
          <div>
            <div className="text-xs text-stone-500">{t('plan.real')}</div>
            <Money v={last.real50} />
          </div>
        </div>
        <p className="mt-2 text-sm" data-testid="mc-lose">
          {t('plan.lose', { p: Math.round(sim.probLoseReal * 100) })}
        </p>
        <p className="mt-1 text-xs text-stone-500">{t('plan.assumptions', { eq: DEFAULT_PARAMS.equityReal, vol: DEFAULT_PARAMS.equityVol, dep: DEFAULT_PARAMS.depositSpread, m: DEFAULT_PARAMS.inflationMargin })}</p>
      </Card>
      <Card title={t('plan.goal')} testId="goal">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={`${t('plan.goalAmount')} (${cur})`}>
            <Num value={goal} onChange={setGoal} testId="g-amount" />
          </Field>
          <Field label={t('plan.goalYears')}>
            <Num value={goalYears} onChange={setGoalYears} testId="g-years" />
          </Field>
          <Field label={t('plan.goalRate')}>
            <Num value={goalRate} onChange={setGoalRate} testId="g-rate" />
          </Field>
        </div>
        <p className="mt-3 text-lg" data-testid="g-result">
          {Number.isFinite(monthly) ? (
            monthly === 0 ? (
              t('plan.reached')
            ) : (
              <>
                {t('plan.monthly')}: <b><Money v={monthly} /></b>
              </>
            )
          ) : (
            '–'
          )}
        </p>
      </Card>
    </div>
  )
}

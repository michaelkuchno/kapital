import { useMemo, useState } from 'react'
import { useApp } from '../state'
import { Card, Field, Money, Num, Pct } from '../components/ui'
import { BOND_SPECS, type BondCode } from '@core/bonds'
import { compareBond, compareDeposit } from '@core/compare'
import { latestCpi } from '@core/inflation'
import { rate } from '../i18n'

export function Bonds() {
  const { t, lang, market, settings, asOf } = useApp()
  const offer = useMemo(() => market?.offer ?? [], [market])
  const cpiNow = latestCpi(market?.cpi ?? [])?.yoy
  const [amount, setAmount] = useState(100_000)
  const [years, setYears] = useState(10)
  const [cpi, setCpi] = useState(settings.assumeCpi)
  const [dep, setDep] = useState(5)
  const ref = market?.ref?.ref ?? 3.75
  const rows = useMemo(() => {
    if (!(amount > 0) || !(years >= 1) || !Number.isFinite(cpi)) return []
    const yrs = Math.min(30, Math.round(years))
    const out = offer
      .filter((o) => settings.family800 || !BOND_SPECS[o.code].family)
      .map((o) => ({ code: o.code as BondCode | 'deposit', series: o.series, ...compareBond(o, amount, yrs, asOf, cpi, ref) }))
    if (Number.isFinite(dep)) out.push({ code: 'deposit', series: `${dep}%`, ...compareDeposit(amount, dep, yrs, cpi) })
    return out.sort((a, b) => b.net - a.net)
  }, [offer, amount, years, cpi, dep, ref, asOf, settings.family800])
  return (
    <div className="space-y-4" data-testid="bonds">
      <h1 className="text-2xl font-extrabold text-sea">{t('bonds.title')}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="offer">
        {offer.map((o) => (
          <div key={o.code} className="card" data-testid={`offer-${o.code}`}>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-extrabold text-sea">{o.code}</span>
              <span className="text-xs text-stone-500">{o.series}</span>
            </div>
            <div className="mt-1 text-2xl font-bold">{rate(lang, o.firstRate)}</div>
            <p className="text-xs text-stone-600">{o.label}</p>
            {BOND_SPECS[o.code].family && <p className="mt-1 text-xs font-semibold text-gold">{t('bonds.family')}</p>}
          </div>
        ))}
      </div>
      {market?.offerMonth && <p className="text-xs text-stone-500">{t('bonds.offerSource', { month: market.offerMonth })}</p>}
      <Card title={t('bonds.compare')} testId="bond-compare">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('bonds.amount')}>
            <Num value={amount} onChange={setAmount} testId="c-amount" />
          </Field>
          <Field label={t('bonds.years')}>
            <Num value={years} onChange={setYears} testId="c-years" />
          </Field>
          <Field label={t('bonds.cpi')}>
            <Num value={cpi} onChange={setCpi} testId="c-cpi" />
            {cpiNow !== undefined && <span className="text-xs text-stone-500">{t('inflation')}: {cpiNow}%</span>}
          </Field>
          <Field label={t('bonds.deposit')}>
            <Num value={dep} onChange={setDep} testId="c-dep" />
          </Field>
        </div>
        <table className="mt-4 w-full text-sm" data-testid="compare-table">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th>#</th>
              <th />
              <th className="text-right">{t('bonds.after', { years: Math.round(years) || 0 })}</th>
              <th className="text-right">{t('bonds.real')}</th>
              <th className="text-right">%/r</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.code} className="border-t border-stone-100" data-testid={`cmp-${r.code}`}>
                <td className="py-2 text-stone-400">{i + 1}</td>
                <td className="font-semibold">
                  {r.code === 'deposit' ? t('kind.deposit') : r.code} <span className="text-xs font-normal text-stone-500">{r.series}</span>
                </td>
                <td className="text-right font-bold">
                  <Money v={r.net} testId={`cmp-net-${r.code}`} />
                </td>
                <td className="text-right">
                  <Money v={r.real} />
                </td>
                <td className="text-right">
                  <Pct v={r.annual} sign={false} digits={2} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-stone-500">{t('bonds.note')}</p>
      </Card>
    </div>
  )
}

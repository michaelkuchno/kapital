import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { Card, Pct, Modal } from '../components/ui'
import { LineChart, Gauge } from '../components/charts'
import { percent } from '../i18n'
import type { Signal } from '@core/signals'
import type { Sentiment } from '@core/sentiment'
import { loadSeries } from '../market'
import { SECTOR_NAMES, type IndexSummary } from '@data/summaries'
import { sma, type Bar } from '@core/stats'
import { daysBetween } from '@core/dates'
import { dateFmt } from '../i18n'

const STATE_COLOR = { up: 'bg-emerald-100 text-emerald-800', down: 'bg-red-100 text-red-800', sideways: 'bg-amber-100 text-amber-800', unknown: 'bg-stone-100 text-stone-600' }

function Chart({ code, onClose }: { code: string; onClose: () => void }) {
  const { lang, t } = useApp()
  const [bars, setBars] = useState<Bar[] | null>(null)
  useEffect(() => {
    void loadSeries(`indices/${code}`).then(setBars)
  }, [code])
  const data = useMemo(() => {
    if (!bars) return null
    const s50 = sma(bars, 50)
    const s200 = sma(bars, 200)
    return { x: bars.map((b) => b.date), close: bars.map((b) => b.close), s50, s200 }
  }, [bars])
  return (
    <Modal title={SECTOR_NAMES[code]?.[lang] ?? code} onClose={onClose} testId="index-chart">
      {data ? (
        <>
          <LineChart
            x={data.x}
            testId="index-line"
            lines={[
              { values: data.close, color: '#0f3d3e', label: code },
              { values: data.s50, color: '#c99a2e', width: 1.5, label: 'SMA50' },
              { values: data.s200, color: '#7a4fb3', width: 1.5, dash: '5 4', label: 'SMA200' },
            ]}
            format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          />
          <p className="mt-2 text-xs text-stone-500">
            <span className="text-sea">━</span> {code} · <span className="text-gold">━</span> SMA50 · <span className="text-[#7a4fb3]">╍</span> SMA200 · {t('dataAsOf', { date: dateFmt(lang, data.x[data.x.length - 1] ?? '') })}
          </p>
        </>
      ) : (
        <p>…</p>
      )}
    </Modal>
  )
}

function Table({ rows, ranked, onOpen, testId }: { rows: IndexSummary[]; ranked?: boolean; onOpen: (c: string) => void; testId: string }) {
  const { t, lang } = useApp()
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[720px] text-sm" data-testid={testId}>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.code} className="cursor-pointer border-t border-stone-100 hover:bg-mint/40" onClick={() => onOpen(r.code)} data-testid={`row-${r.code}`}>
              {ranked && <td className="py-2 font-bold text-stone-400">{r.rank ?? i + 1}</td>}
              <td className="py-2 font-semibold">
                {SECTOR_NAMES[r.code]?.[lang] ?? r.code}
                <div className="text-xs font-normal text-stone-400">{r.code}</div>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SIG: Record<Signal, string> = { buy: 'bg-emerald-100 text-emerald-800', sell: 'bg-red-100 text-red-800', neutral: 'bg-stone-100 text-stone-700' }

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
      <div className="grid gap-6 md:grid-cols-2">
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
  const [open, setOpen] = useState<string | null>(null)
  const sectors = market?.summary.sectors ?? []
  const indices = (market?.summary.indices ?? []).filter((x) => !x.code.startsWith('WIG-'))
  const recent = sectors.flatMap((s) => s.report.events.filter((e) => daysBetween(e.date, market?.meta.lastTradingDay ?? asOf) <= 14).map((e) => ({ code: s.code, e })))
  if (!market?.meta.lastTradingDay) return <p className="card" data-testid="market">{t('dataMissing')}</p>
  return (
    <div className="space-y-4" data-testid="market">
      <h1 className="text-2xl font-extrabold text-sea">{t('market.title')}</h1>
      <p className="text-xs text-stone-500">{t('dataAsOf', { date: dateFmt(lang, market.meta.lastTradingDay) })}</p>
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
        <Table rows={sectors} ranked onOpen={setOpen} testId="sector-table" />
      </Card>
      <Card title={t('market.indices')} testId="indices">
        <Table rows={indices} onOpen={setOpen} testId="index-table" />
      </Card>
      {open && <Chart code={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

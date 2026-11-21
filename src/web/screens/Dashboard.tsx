import { useApp } from '../state'
import { Card, Money, Pct, Stat, InsightCard } from '../components/ui'
import { Donut, LineChart, Gauge } from '../components/charts'
import { latestCpi } from '@core/inflation'
import type { AssetClass, Liquidity } from '@core/assets'
import { SECTOR_NAMES } from '@data/summaries'
import { dateFmt, rate } from '../i18n'

export const CLASS_COLORS: Record<AssetClass, string> = { 'bonds-inflation': '#0f3d3e', 'bonds-fixed': '#3f8f8a', deposits: '#c99a2e', cash: '#9fbfb3', equities: '#7a4fb3', other: '#a8a29e' }
const LIQ: Liquidity[] = ['now', 'days', 'fee', 'locked']

export function Dashboard() {
  const { t, lang, summary: s, insights, market, go, history, fmt, settings } = useApp()
  const cpi = latestCpi(market?.cpi ?? [])
  const gainPct = s.cost ? s.gain / s.cost : 0
  const wig = market?.summary.indices.find((x) => x.code === 'WIG')
  const leaders = (market?.summary.sectors ?? []).slice(0, 3)
  if (!s.items.length)
    return (
      <div className="space-y-4" data-testid="dashboard">
        <section className="card text-center" data-testid="quick-start">
          <h2 className="text-2xl font-extrabold text-sea">{t('start.title')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-stone-600">{t('start.lead')}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => go('assets')} data-testid="start-add">
              + {t('start.add')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => go('learn')} data-testid="start-learn">
              {t('start.learn')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => go('market')}>
              {t('nav.market')}
            </button>
          </div>
        </section>
        <p className="text-xs text-stone-500" data-testid="disclaimer">
          {t('disclaimer')}
        </p>
      </div>
    )
  return (
    <div className="space-y-4" data-testid="dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('netWorth')} testId="stat-total">
          <Money v={s.total} testId="total-value" />
        </Stat>
        <Stat label={t('netNow')} hint={t('netNowHint')} testId="stat-net">
          <Money v={s.netNow} />
        </Stat>
        <Stat label={t('gain')} testId="stat-gain">
          <Money v={s.gain} sign /> <span className="text-base">(<Pct v={gainPct} />)</span>
        </Stat>
        <Stat label={settings.country === 'CH' ? t('inflationCh') : t('inflation')} testId="stat-cpi">
          {settings.country === 'CH' ? (market?.ch ? <Pct v={market.ch.cpi / 100} sign={false} digits={2} /> : '–') : cpi ? <Pct v={cpi.yoy / 100} sign={false} /> : '–'}
          <div className="text-xs font-normal text-stone-500">
            {settings.country === 'CH' ? `${market?.ch?.cpiMonth ?? ''} · ${t('snbRate')}: ${market?.ch?.policy != null ? rate(lang, market.ch.policy) : '–'}` : `${cpi?.month ?? ''} · ${t('refRate')}: ${market?.ref ? rate(lang, market.ref.ref) : '–'}`}
          </div>
        </Stat>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t('allocation')} testId="allocation">
          <div className="flex items-center gap-4">
            <Donut parts={(Object.keys(s.byClass) as AssetClass[]).map((c) => ({ label: c, value: s.byClass[c], color: CLASS_COLORS[c] }))} size={140} testId="donut" />
            <ul className="flex-1 space-y-1 text-sm">
              {(Object.keys(s.byClass) as AssetClass[])
                .filter((c) => s.byClass[c] > 0)
                .map((c) => (
                  <li key={c} className="flex items-center gap-2" data-testid={`class-${c}`}>
                    <span className="h-3 w-3 rounded-full" style={{ background: CLASS_COLORS[c] }} />
                    <span className="flex-1">{t(`cls.${c}`)}</span>
                    <Pct v={s.total ? s.byClass[c] / s.total : 0} sign={false} digits={0} />
                  </li>
                ))}
            </ul>
          </div>
        </Card>
        <Card title={t('liquidity')} testId="liquidity">
          <ul className="space-y-2 text-sm">
            {LIQ.map((l) => (
              <li key={l}>
                <div className="flex">
                  <span className="flex-1">{t(`liq.${l}`)}</span>
                  <Money v={s.byLiquidity[l]} />
                </div>
                <div className="mt-1 h-2 rounded bg-stone-100">
                  <div className="h-2 rounded bg-sea-2" style={{ width: `${s.total ? (s.byLiquidity[l] / s.total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('nav.market')} testId="market-strip" action={<button type="button" className="text-sm font-semibold text-sea-2 underline" onClick={() => go('market')}>→</button>}>
          {market?.meta.lastTradingDay ? (
            <>
              <div className="text-xs text-stone-500">{t('dataAsOf', { date: dateFmt(lang, market.meta.lastTradingDay) })}</div>
              {wig && (
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-bold">{t('wig')}</span>
                  <span className="num ml-auto">{wig.report.last.toLocaleString()}</span>
                  <Pct v={wig.report.ret1m} />
                </div>
              )}
              <ol className="mt-3 space-y-1 text-sm">
                {leaders.map((x, i) => (
                  <li key={x.code} className="flex gap-2">
                    <span className="w-5 text-stone-400">{i + 1}.</span>
                    <span className="flex-1">{SECTOR_NAMES[x.code]?.[lang] ?? x.code}</span>
                    <Pct v={x.report.ret3m} />
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-stone-500">{t('dataMissing')}</p>
          )}
        </Card>
      </div>

      {(market?.analysis?.sentiment.pl || market?.analysis?.sentiment.world) && (
        <Card title={t('fg.title')} testId="dash-sentiment" action={<button type="button" className="text-sm font-semibold text-sea-2 underline" onClick={() => go('market')}>→</button>}>
          <div className="flex flex-wrap justify-around">
            {market.analysis.sentiment.pl && <Gauge value={market.analysis.sentiment.pl.score} label={t('fg.pl')} sub={t(`mood.${market.analysis.sentiment.pl.mood}`)} size={160} testId="dash-gauge-pl" />}
            {market.analysis.sentiment.world && <Gauge value={market.analysis.sentiment.world.score} label={t('fg.world')} sub={t(`mood.${market.analysis.sentiment.world.mood}`)} size={160} testId="dash-gauge-world" />}
          </div>
        </Card>
      )}
      <Card title={t('dash.history')} testId="history">
        {history.length >= 2 ? (
          <LineChart x={history.map((h) => h.date)} height={170} lines={[{ values: history.map((h) => h.total), color: '#0f3d3e', width: 2.5, label: t('netWorth') }, { values: history.map((h) => h.cost), color: '#a8a29e', dash: '5 4', label: t('cost') }]} format={(v) => fmt(v)} />
        ) : (
          <p className="text-sm text-stone-500" data-testid="history-empty">
            {t('dash.historyEmpty')}
          </p>
        )}
      </Card>
      <Card title={t('topInsights')} testId="top-insights" action={<button type="button" className="text-sm font-semibold text-sea-2 underline" onClick={() => go('insights')}>{t('allInsights')} →</button>}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {insights.slice(0, 4).map((i) => (
            <InsightCard key={i.id} i={i} />
          ))}
        </div>
      </Card>
      <p className="text-xs text-stone-500" data-testid="disclaimer">
        {t('disclaimer')}
      </p>
    </div>
  )
}

import { AppProvider, useApp, type Screen } from './state'
import { Dashboard } from './screens/Dashboard'
import { Assets } from './screens/Assets'
import { Market } from './screens/Market'
import { Bonds } from './screens/Bonds'
import { Plan } from './screens/Plan'
import { Insights } from './screens/Insights'
import { Settings } from './screens/Settings'
import { Learn } from './screens/Learn'
import { FAMILY } from './db'
import { dateFmt } from './i18n'

const NAV: { id: Screen; icon: string }[] = [
  { id: 'dashboard', icon: '◎' },
  { id: 'assets', icon: '▤' },
  { id: 'market', icon: '↗' },
  { id: 'bonds', icon: '§' },
  { id: 'plan', icon: '◷' },
  { id: 'learn', icon: '◈' },
  { id: 'insights', icon: '✦' },
  { id: 'settings', icon: '⚙' },
]

function Shell() {
  const { t, lang, screen, go, market, insights, people, active, setActive } = useApp()
  const warn = insights.filter((i) => i.severity === 'warn').length
  const body = { dashboard: <Dashboard />, assets: <Assets />, market: <Market />, bonds: <Bonds />, plan: <Plan />, learn: <Learn />, insights: <Insights />, settings: <Settings /> }[screen] ?? <Dashboard />
  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col">
      <header className="flex items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="h-9 w-9" />
        <div>
          <div className="text-xl font-extrabold leading-tight text-sea">{t('appName')}</div>
          <div className="text-xs text-stone-500">{t('tagline')}</div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <select className="rounded-xl border border-stone-300 bg-white px-2 py-1 text-sm font-semibold text-sea" value={active} onChange={(e) => setActive(e.target.value)} aria-label={t('people.title')} data-testid="person-switch">
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {people.length > 1 && <option value={FAMILY}>{t('people.family')}</option>}
          </select>
          <div className="text-right text-xs text-stone-500" data-testid="data-date">
            {market?.meta.lastTradingDay ? t('dataAsOf', { date: dateFmt(lang, market.meta.lastTradingDay) }) : ''}
          </div>
        </div>
      </header>
      <nav className="sticky top-0 z-30 border-b border-stone-200 bg-sand/95 px-2 backdrop-blur" aria-label="menu">
        <ul className="flex gap-1 overflow-x-auto py-2">
          {NAV.map((n) => (
            <li key={n.id}>
              <button type="button" className={`relative whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${screen === n.id ? 'bg-sea text-white' : 'text-sea hover:bg-mint'}`} onClick={() => go(n.id)} data-testid={`nav-${n.id}`} aria-current={screen === n.id ? 'page' : undefined}>
                <span aria-hidden className="mr-1">
                  {n.icon}
                </span>
                {t(`nav.${n.id}`)}
                {n.id === 'insights' && warn > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-down px-1.5 text-[10px] text-white">{warn}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 px-4 py-4 safe-b">{body}</main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

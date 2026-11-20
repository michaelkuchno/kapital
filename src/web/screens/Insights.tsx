import { useApp } from '../state'
import { InsightCard } from '../components/ui'

export function Insights() {
  const { t, insights } = useApp()
  return (
    <div className="space-y-3" data-testid="insights">
      <h1 className="text-2xl font-extrabold text-sea">{t('nav.insights')}</h1>
      {insights.map((i) => (
        <InsightCard key={i.id} i={i} />
      ))}
      <p className="text-xs text-stone-500">{t('disclaimer')}</p>
    </div>
  )
}

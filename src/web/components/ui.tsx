import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../state'
import { percent, dateFmt, type Lang } from '../i18n'
import { EVIDENCE } from '@core/evidence'
import type { Insight } from '@core/insights'

export function Card({ title, children, className = '', testId, action }: { title?: ReactNode; children: ReactNode; className?: string; testId?: string; action?: ReactNode }) {
  return (
    <section className={`card ${className}`} data-testid={testId}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h2 className="text-lg font-bold text-sea">{title}</h2>}
          <div className="ml-auto">{action}</div>
        </div>
      )}
      {children}
    </section>
  )
}

export function Money({ v, digits = 0, sign = false, testId }: { v: number; digits?: number; sign?: boolean; testId?: string }) {
  const { fmt } = useApp()
  const s = fmt(v, digits)
  return (
    <span className={`num ${sign ? (v > 0 ? 'text-up' : v < 0 ? 'text-down' : '') : ''}`} data-testid={testId} data-value={v}>
      {sign && v > 0 ? '+' : ''}
      {s}
    </span>
  )
}

export function Pct({ v, sign = true, digits = 1 }: { v: number | null | undefined; sign?: boolean; digits?: number }) {
  const { lang } = useApp()
  const color = v == null || !sign ? '' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : ''
  return <span className={`num ${color}`}>{percent(lang, v, digits, sign)}</span>
}

export function Stat({ label, children, hint, testId }: { label: string; children: ReactNode; hint?: string; testId?: string }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="text-sm text-stone-500" title={hint}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-ink">{children}</div>
      {hint && <div className="mt-1 text-xs text-stone-400">{hint}</div>}
    </div>
  )
}

export function Modal({ title, onClose, children, testId, wide = false }: { title: string; onClose: () => void; children: ReactNode; testId?: string; wide?: boolean }) {
  const { t } = useApp()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className={`max-h-[92vh] w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} overflow-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl`} onClick={(e) => e.stopPropagation()} data-testid={testId} role="dialog" aria-label={title}>
        <div className="mb-4 flex items-center">
          <h2 className="text-xl font-bold text-sea">{title}</h2>
          <button type="button" className="btn-ghost ml-auto !px-3" onClick={onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const SEV: Record<Insight['severity'], string> = { warn: 'border-l-down bg-red-50', tip: 'border-l-gold bg-amber-50', info: 'border-l-sea-2 bg-white', ok: 'border-l-up bg-emerald-50' }

/** dates → local format, decimal points → the language's separator (texts prepared by the engine) */
export function localParams(lang: Lang, p: Insight['params']): Insight['params'] {
  const out: Insight['params'] = {}
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'string') out[k] = v
    else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = dateFmt(lang, v)
    else out[k] = lang === 'en' ? v : v.replace(/(\d)\.(\d)/g, '$1,$2')
  }
  return out
}

export function InsightCard({ i }: { i: Insight }) {
  const { t, lang } = useApp()
  const body = i.key.startsWith('insight.trend.') ? 'insight.trend.body' : `${i.key}.body`
  const params = localParams(lang, i.params)
  return (
    <article className={`rounded-2xl border-l-4 p-4 shadow-sm ring-1 ring-black/5 ${SEV[i.severity]}`} data-testid={`insight-${i.id}`} data-severity={i.severity}>
      <div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t(`sev.${i.severity}`)}</div>
      <h3 className="mt-1 font-bold text-ink">{t(`${i.key}.title`, params)}</h3>
      <p className="mt-1 text-sm leading-relaxed text-stone-700">{t(body, params)}</p>
      {i.evidence.length > 0 && (
        <details className="mt-2 text-xs text-stone-500">
          <summary className="cursor-pointer font-semibold text-sea-2">{t('why')}</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {i.evidence.map((e) => (
              <li key={e}>
                <a href={EVIDENCE[e].url} target="_blank" rel="noreferrer" className="underline">
                  {EVIDENCE[e].cite}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

const show = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '' : String(v).replace('.', ','))

/** Number input that accepts "5,35", "1 234 567", an empty field while typing; reports NaN while empty/invalid. */
export function Num({ value, onChange, testId, min }: { value: number | undefined; onChange: (v: number) => void; testId?: string; min?: number }) {
  const [text, setText] = useState(show(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setText(show(value))
  }, [value, focus])
  return (
    <input
      className="input num"
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => setFocus(true)}
      onBlur={() => {
        setFocus(false)
        setText(show(value))
      }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d\s,.-]/g, '')
        setText(t)
        const raw = t.replace(/\s/g, '').replace(',', '.')
        const n = raw === '' ? NaN : Number(raw)
        onChange(Number.isFinite(n) && (min === undefined || n >= min) ? n : NaN)
      }}
      data-testid={testId}
    />
  )
}

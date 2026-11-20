import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { db } from '../db'
import { Card, Field, Num } from '../components/ui'
import { LANGS, type Lang } from '../i18n'
import { seal, open, type Vault } from '../vault'
import { serverAvailable } from '../market'
import type { Asset } from '@core/assets'

const LANG_NAMES: Record<Lang, string> = { pl: 'Polski', en: 'English', de: 'Deutsch' }

async function snapshot() {
  return { v: 1, assets: await db.assets.toArray(), settings: await db.settings.get('me') }
}
async function restore(p: { assets: Asset[]; settings?: unknown }) {
  await db.transaction('rw', db.assets, db.settings, async () => {
    await db.assets.clear()
    await db.assets.bulkPut(p.assets)
    if (p.settings) await db.settings.put(p.settings as never)
  })
}

export function Settings() {
  const { t, settings, update } = useApp()
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [server, setServer] = useState(false)
  useEffect(() => {
    void serverAvailable().then(setServer)
  }, [])
  const exportFile = async () => {
    const v = await seal(await snapshot(), pw)
    const blob = new Blob([JSON.stringify(v)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `kapital-${new Date().toISOString().slice(0, 10)}.kapital.json`
    a.click()
    setMsg('✓')
  }
  const importFile = async (f: File) => {
    try {
      const p = await open<{ assets: Asset[]; settings?: unknown }>(JSON.parse(await f.text()) as Vault, pw)
      await restore(p)
      location.reload()
      setMsg(t('settings.imported', { n: p.assets.length }))
    } catch {
      setMsg(t('settings.badPassword'))
    }
  }
  const push = async () => {
    const v = await seal(await snapshot(), pw)
    const r = await fetch(`${import.meta.env.BASE_URL}api/vault`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
    setMsg(r.ok ? '✓' : `✗ ${r.status}`)
  }
  const pull = async () => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/vault`)
      const p = await open<{ assets: Asset[]; settings?: unknown }>((await r.json()) as Vault, pw)
      await restore(p)
      location.reload()
    } catch {
      setMsg(t('settings.badPassword'))
    }
  }
  return (
    <div className="space-y-4" data-testid="settings">
      <h1 className="text-2xl font-extrabold text-sea">{t('settings.title')}</h1>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.lang')}>
            <select className="input" value={settings.lang} onChange={(e) => void update({ lang: e.target.value as Lang })} data-testid="s-lang">
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.expenses')}>
            <Num value={settings.monthlyExpenses} onChange={(v) => Number.isFinite(v) && void update({ monthlyExpenses: v })} testId="s-expenses" />
          </Field>
          <Field label={t('settings.risk')}>
            <select className="input" value={settings.risk} onChange={(e) => void update({ risk: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })} data-testid="s-risk">
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  {r} – {t(`risk.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.horizon')}>
            <Num value={settings.horizonYears} onChange={(v) => Number.isFinite(v) && void update({ horizonYears: v })} testId="s-horizon" />
          </Field>
          <Field label={t('settings.pit')}>
            <select className="input" value={settings.pitRate} onChange={(e) => void update({ pitRate: Number(e.target.value) as 12 | 19 | 32 })} data-testid="s-pit">
              <option value={12}>12%</option>
              <option value={32}>32%</option>
              <option value={19}>19% (liniowy)</option>
            </select>
          </Field>
          <Field label={t('settings.realized')}>
            <Num value={settings.realizedGainsThisYear} onChange={(v) => Number.isFinite(v) && void update({ realizedGainsThisYear: v })} testId="s-realized" />
          </Field>
          <Field label={t('bonds.cpi')}>
            <Num value={settings.assumeCpi} onChange={(v) => Number.isFinite(v) && void update({ assumeCpi: v })} testId="s-cpi" />
          </Field>
        </div>
        <div className="mt-4 space-y-2">
          {(
            [
              ['family800', 'settings.family800'],
              ['usesIke', 'settings.ike'],
              ['usesIkze', 'settings.ikze'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={settings[k]} onChange={(e) => void update({ [k]: e.target.checked })} data-testid={`s-${k}`} />
              {t(label)}
            </label>
          ))}
        </div>
      </Card>
      <Card title={t('settings.backup')} testId="backup">
        <p className="mb-3 text-sm text-stone-600">{t('settings.backupHint')}</p>
        <Field label={t('settings.password')}>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-testid="s-password" />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={pw.length < 8} onClick={() => void exportFile()} data-testid="s-export">
            {t('settings.export')}
          </button>
          <label className={`btn-ghost cursor-pointer ${pw.length < 8 ? 'pointer-events-none opacity-50' : ''}`}>
            {t('settings.import')}
            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0]
                // reset, so that choosing the same file again (e.g. after a wrong password) works
                e.target.value = ''
                if (file) void importFile(file)
              }} data-testid="s-import" />
          </label>
        </div>
        {server && (
          <div className="mt-4 border-t pt-3" data-testid="server-sync">
            <h3 className="font-bold">{t('settings.server')}</h3>
            <p className="text-sm text-stone-600">{t('settings.serverOn')}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-ghost" disabled={pw.length < 8} onClick={() => void push()} data-testid="s-push">
                {t('settings.push')}
              </button>
              <button type="button" className="btn-ghost" disabled={pw.length < 8} onClick={() => void pull()} data-testid="s-pull">
                {t('settings.pull')}
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className="mt-2 text-sm" data-testid="s-msg">
            {msg}
          </p>
        )}
      </Card>
      <Card title={t('settings.data')}>
        <p className="text-sm text-stone-600">{t('settings.dataText')}</p>
        <p className="mt-2 text-xs text-stone-500">{t('disclaimer')}</p>
        <p className="mt-2 text-xs text-stone-400">v{__APP_VERSION__}</p>
      </Card>
      <button
        type="button"
        className="btn-ghost text-down"
        onClick={() => {
          if (confirm(t('settings.wipe') + '?')) void db.delete().then(() => location.reload())
        }}
        data-testid="s-wipe"
      >
        {t('settings.wipe')}
      </button>
    </div>
  )
}

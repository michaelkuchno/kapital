import Dexie, { type Table } from 'dexie'
import type { Asset } from '@core/assets'
import { DEFAULT_PROFILE, type Profile } from '@core/insights'
import type { Lang } from './i18n'

/** Personal data stays on the device (IndexedDB). It never goes to GitHub; the home server gets only an encrypted copy. */
export interface Settings extends Profile {
  id: 'me'
  lang: Lang
  assumeCpi: number
}

class KapitalDb extends Dexie {
  assets!: Table<Asset, string>
  settings!: Table<Settings, string>
  constructor() {
    super('kapital')
    this.version(1).stores({ assets: 'id, kind', settings: 'id' })
  }
}
export const db = new KapitalDb()

export function defaultLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'pl').slice(0, 2)
  return l === 'de' ? 'de' : l === 'en' ? 'en' : 'pl'
}
export const DEFAULT_SETTINGS = (): Settings => ({ id: 'me', ...DEFAULT_PROFILE, lang: defaultLang(), assumeCpi: 2.5 })

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS(), ...((await db.settings.get('me')) ?? {}) }
}
export async function saveSettings(patch: Partial<Settings>) {
  const cur = await loadSettings()
  await db.settings.put({ ...cur, ...patch, id: 'me' })
}

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))

import Dexie, { type Table } from 'dexie'
import type { Asset } from '@core/assets'
import { DEFAULT_PROFILE, type Profile } from '@core/insights'
import type { Lang } from './i18n'

/**
 * Personal data stays on the device (IndexedDB). It never goes to GitHub; the home server gets only an encrypted copy.
 * Several people can use the app: every person (profile) has own assets and settings; "family" shows everybody together.
 */
export interface Person {
  id: string
  name: string
  color: string
  createdAt: number
}
export type StoredAsset = Asset & { profileId: string }
export interface Settings extends Profile {
  /** = person id */
  id: string
  lang: Lang
  assumeCpi: number
}
export interface HistoryPoint {
  profileId: string
  date: string
  total: number
  netNow: number
  cost: number
}

export const FAMILY = 'family'
export const COLORS = ['#0f3d3e', '#c99a2e', '#7a4fb3', '#3f8f8a', '#c0392b', '#2d6cdf']

class KapitalDb extends Dexie {
  assets!: Table<StoredAsset, string>
  settings!: Table<Settings, string>
  people!: Table<Person, string>
  history!: Table<HistoryPoint, [string, string]>
  constructor() {
    super('kapital')
    this.version(1).stores({ assets: 'id, kind', settings: 'id' })
    this.version(2)
      .stores({ assets: 'id, kind, profileId', settings: 'id', people: 'id, createdAt', history: '[profileId+date], profileId' })
      .upgrade(async (tx) => {
        // version 1 had one person: move everything to the first profile
        const first: Person = { id: 'p1', name: 'Ja', color: COLORS[0], createdAt: Date.now() }
        await tx.table('people').put(first)
        await tx.table('assets').toCollection().modify((a: StoredAsset) => {
          a.profileId = first.id
        })
        const me = await tx.table('settings').get('me')
        if (me) {
          await tx.table('settings').put({ ...me, id: first.id })
          await tx.table('settings').delete('me')
        }
      })
  }
}
export const db = new KapitalDb()

export function defaultLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'pl').slice(0, 2)
  return l === 'de' ? 'de' : l === 'en' ? 'en' : 'pl'
}
export const DEFAULT_SETTINGS = (id = 'p1'): Settings => ({ id, ...DEFAULT_PROFILE, lang: defaultLang(), assumeCpi: 2.5 })

export async function loadSettings(id: string): Promise<Settings> {
  return { ...DEFAULT_SETTINGS(id), ...((await db.settings.get(id)) ?? {}), id }
}
export async function saveSettings(id: string, patch: Partial<Settings>) {
  const cur = await loadSettings(id)
  await db.settings.put({ ...cur, ...patch, id })
}

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))

/** Make sure there is at least one person (first start). */
export async function ensurePeople(firstName: string): Promise<Person[]> {
  const people = await db.people.toArray()
  if (people.length) return people
  const p: Person = { id: 'p1', name: firstName, color: COLORS[0], createdAt: Date.now() }
  await db.people.put(p)
  return [p]
}

export async function addPerson(name: string): Promise<Person> {
  const n = await db.people.count()
  const p: Person = { id: newId(), name: name.trim() || `#${n + 1}`, color: COLORS[n % COLORS.length], createdAt: Date.now() }
  await db.people.put(p)
  return p
}

/** Delete a person with all their assets, settings and history. */
export async function removePerson(id: string) {
  await db.transaction('rw', db.people, db.assets, db.settings, db.history, async () => {
    await db.people.delete(id)
    await db.assets.where('profileId').equals(id).delete()
    await db.settings.delete(id)
    await db.history.where('profileId').equals(id).delete()
  })
}

/** One point per person (or the family) per day. */
export async function recordHistory(profileId: string, date: string, total: number, netNow: number, cost: number) {
  if (!(total > 0)) return
  await db.history.put({ profileId, date, total, netNow, cost })
}

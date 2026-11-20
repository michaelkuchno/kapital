import Database from 'better-sqlite3'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromCsv } from '../src/data/store'

export type Db = Database.Database

/** Free, file-based SQLite database: daily prices of all indices and shares + one encrypted family vault. */
export function openDb(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS bars (kind TEXT NOT NULL, key TEXT NOT NULL, date TEXT NOT NULL, close REAL NOT NULL, volume REAL, PRIMARY KEY (kind, key, date));
    CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  return db
}

/** Import all CSV series from the market folder (upsert). Returns the number of rows written. */
export function importSeries(db: Db, marketDir: string): number {
  const ins = db.prepare('INSERT INTO bars (kind, key, date, close, volume) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, key, date) DO UPDATE SET close = excluded.close, volume = excluded.volume')
  let n = 0
  const tx = db.transaction(() => {
    for (const kind of ['indices', 'shares']) {
      const dir = join(marketDir, kind)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
        const key = f.slice(0, -4)
        for (const b of fromCsv(readFileSync(join(dir, f), 'utf8'))) {
          ins.run(kind, key, b.date, b.close, b.volume ?? null)
          n++
        }
      }
    }
  })
  tx()
  return n
}

export function getSeries(db: Db, kind: string, key: string): { date: string; close: number }[] {
  return db.prepare('SELECT date, close FROM bars WHERE kind = ? AND key = ? ORDER BY date').all(kind, key) as { date: string; close: number }[]
}

export function getVault(db: Db): string | null {
  const r = db.prepare("SELECT json FROM vault WHERE id = 'family'").get() as { json: string } | undefined
  return r?.json ?? null
}
export function putVault(db: Db, json: string): void {
  db.prepare("INSERT INTO vault (id, json, updated_at) VALUES ('family', ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").run(json, new Date().toISOString())
}

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'kapital-'))
let app: Awaited<ReturnType<typeof import('../../server/index').buildServer>>

beforeAll(async () => {
  process.env.DATA_DIR = dir
  process.env.WEB_DIR = join(dir, 'web')
  mkdirSync(join(dir, 'market', 'indices'), { recursive: true })
  writeFileSync(join(dir, 'market', 'indices', 'WIG20.csv'), 'date,close\n2026-11-18,2500\n2026-11-19,2510.5\n')
  writeFileSync(join(dir, 'market', 'meta.json'), JSON.stringify({ lastTradingDay: '2026-11-19' }))
  mkdirSync(join(dir, 'web'), { recursive: true })
  writeFileSync(join(dir, 'web', 'index.html'), '<html>kapital</html>')
  const { buildServer } = await import('../../server/index')
  const { openDb, importSeries } = await import('../../server/db')
  importSeries(openDb(join(dir, 'kapital.sqlite')), join(dir, 'market'))
  app = await buildServer()
})
afterAll(async () => {
  await app?.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows keeps the SQLite file locked until the process ends
  }
})

describe('home server (Docker)', () => {
  it('health reports the data date', async () => {
    const r = await app.inject('/api/health')
    expect(r.json()).toMatchObject({ ok: true, meta: { lastTradingDay: '2026-11-19' } })
  })
  it('serves market files under /data and prices from SQLite', async () => {
    expect((await app.inject('/data/indices/WIG20.csv')).body).toContain('2510.5')
    expect((await app.inject('/api/series/indices/WIG20')).json()).toEqual([
      { date: '2026-11-18', close: 2500 },
      { date: '2026-11-19', close: 2510.5 },
    ])
    expect((await app.inject('/api/series/bad/WIG20')).statusCode).toBe(400)
  })
  it('stores only an encrypted vault and returns it', async () => {
    expect((await app.inject('/api/vault')).statusCode).toBe(404)
    expect((await app.inject({ method: 'PUT', url: '/api/vault', payload: { assets: [{ amount: 1 }] } })).statusCode).toBe(400)
    const v = { v: 1, salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ==' }
    expect((await app.inject({ method: 'PUT', url: '/api/vault', payload: v })).json()).toEqual({ ok: true })
    expect((await app.inject('/api/vault')).json()).toEqual(v)
  })
  it('the app is served for every other path (single-page app); unknown API → 404', async () => {
    expect((await app.inject('/')).body).toContain('kapital')
    expect((await app.inject('/settings')).body).toContain('kapital')
    expect((await app.inject('/api/nope')).statusCode).toBe(404)
    expect((await app.inject('/data/nope.json')).statusCode).toBe(404)
  })
})

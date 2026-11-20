/**
 * Home server (Docker): serves the app, keeps the market data up to date every evening (official GPW/GUS/NBP/MF
 * sources), stores daily prices in a free SQLite database and keeps an ENCRYPTED copy of the family's data so that
 * phones and computers at home can share it (the server never sees the password or the amounts).
 *   PORT (8080), DATA_DIR (/data), WEB_DIR (dist), FETCH_CRON ("30 18 * * 1-5", Europe/Warsaw)
 */
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import cron from 'node-cron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDb, importSeries, getSeries, getVault, putVault } from './db'

const PORT = Number(process.env.PORT ?? 8080)
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'server/db')
const WEB_DIR = resolve(process.env.WEB_DIR ?? 'dist')
const MARKET_DIR = join(DATA_DIR, 'market')
mkdirSync(MARKET_DIR, { recursive: true })
const db = openDb(join(DATA_DIR, 'kapital.sqlite'))

let running: Promise<void> | null = null
export function updateData(): Promise<void> {
  if (running) return running
  running = new Promise<void>((done) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/fetch-data.ts', '--out', MARKET_DIR], { stdio: 'inherit' })
    p.on('exit', () => {
      try {
        const n = importSeries(db, MARKET_DIR)
        console.log(`[kapital] imported ${n} prices into SQLite`)
      } catch (e) {
        console.error('[kapital] import failed', e)
      }
      running = null
      done()
    })
  })
  return running
}

export async function buildServer() {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 })
  app.get('/api/health', async () => {
    const metaFile = join(MARKET_DIR, 'meta.json')
    return { ok: true, updating: !!running, meta: existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null }
  })
  app.get<{ Params: { kind: string; key: string } }>('/api/series/:kind/:key', async (req, reply) => {
    if (!['indices', 'shares'].includes(req.params.kind)) return reply.code(400).send({ error: 'kind' })
    return getSeries(db, req.params.kind, req.params.key)
  })
  app.get('/api/vault', async (_req, reply) => {
    const v = getVault(db)
    return v ? reply.type('application/json').send(v) : reply.code(404).send({ error: 'empty' })
  })
  app.put<{ Body: { v: number; salt: string; iv: string; data: string } }>('/api/vault', async (req, reply) => {
    const b = req.body
    // only an encrypted vault is accepted (the server must never receive plain data)
    if (!b || b.v !== 1 || typeof b.salt !== 'string' || typeof b.iv !== 'string' || typeof b.data !== 'string') return reply.code(400).send({ error: 'expected an encrypted vault' })
    putVault(db, JSON.stringify(b))
    return { ok: true }
  })
  app.post('/api/update', async () => {
    void updateData()
    return { ok: true, started: true }
  })
  // market data (same paths as on GitHub Pages)
  await app.register(fastifyStatic, { root: MARKET_DIR, prefix: '/data/', decorateReply: false, cacheControl: false })
  if (existsSync(WEB_DIR)) await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', wildcard: true })
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') || req.url.startsWith('/data/') ? reply.code(404).send({ error: 'not found' }) : existsSync(join(WEB_DIR, 'index.html')) ? reply.sendFile('index.html') : reply.code(404).send('build the web app first')))
  return app
}

if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  const app = await buildServer()
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[kapital] http://localhost:${PORT}  data: ${DATA_DIR}`)
  if (!existsSync(join(MARKET_DIR, 'meta.json'))) void updateData()
  else importSeries(db, MARKET_DIR)
  cron.schedule(process.env.FETCH_CRON ?? '30 18 * * 1-5', () => void updateData(), { timezone: 'Europe/Warsaw' })
}

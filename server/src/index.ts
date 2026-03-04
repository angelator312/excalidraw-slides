import 'dotenv/config'
import express from 'express'
import http from 'http'
import { Server as IOServer } from 'socket.io'
import { MongoClient } from 'mongodb'
import bodyParser from 'body-parser'

import { storeThumbnail, getThumbnailStream } from './storage/thumbnail'
import { makeAuthRouter } from './api/auth'
import { makeTeamsRouter } from './api/teams'
import { makePresentationsRouter } from './api/presentations'
import { attachWs } from './ws'
import { schedulePruneVersions } from './jobs/pruneVersions'
import {
  ensureUserIndexes,
} from './models/user'

/* Diagnostic logger helpers --------------------------------------------------*/
function logReq(req: any) {
  // lightweight single-line request logging to diagnose high CPU / hung requests
  console.log(`[req] ${req.method} ${req.url} - pid:${process.pid}`)
}
function logInfo(...args: any[]) {
  console.log('[info]', ...args)
}
function logError(...args: any[]) {
  console.error('[error]', ...args)
}
import { ensureTeamIndexes } from './models/team'
import { ensurePresentationIndexes } from './models/presentation'
import { ensureSlideIndexes } from './models/slide'
import { ensureVersionIndexes } from './models/version'
import { ensureSnapshotIndexes } from './models/snapshot'
import { ensureShareLinkIndexes } from './models/sharelink'
import { ensureAuthTokenIndexes } from './models/authToken'

const MONGO = process.env.MONGO_URI || 'mongodb://mongo:27017'
const DBNAME = process.env.DB_NAME || 'excalidraw_slides'

async function main() {
  const app = express()

  // Simple request logger for diagnostics (keeps output minimal)
  app.use((req, _res, next) => {
    try { logReq(req) } catch (e) { /* ignore logging errors */ }
    next()
  })

  app.use(bodyParser.json({ limit: '10mb' }))

  const server = http.createServer(app)
  const io = new IOServer(server, { cors: { origin: '*' } })

  const client = new MongoClient(MONGO)
  await client.connect()
  const db = client.db(DBNAME)

  // Ensure all indexes
  await Promise.all([
    ensureUserIndexes(db),
    ensureTeamIndexes(db),
    ensurePresentationIndexes(db),
    ensureSlideIndexes(db),
    ensureVersionIndexes(db),
    ensureSnapshotIndexes(db),
    ensureShareLinkIndexes(db),
    ensureAuthTokenIndexes(db),
  ])

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => res.json({ ok: true }))

  // ── Thumbnail storage (GridFS) ──────────────────────────────────────────────
  app.post('/thumbnail', async (req, res) => {
    try {
      const { filename, data } = req.body as { filename?: string; data: string }
      const buf = Buffer.from(data.split(',').pop() || data, 'base64')
      const id = await storeThumbnail(db, buf, filename)
      res.json({ id })
    } catch (e) {
      res.status(500).json({ error: String(e) })
    }
  })

  app.get('/thumbnail/:id', async (req, res) => {
    const stream = await getThumbnailStream(db, req.params.id)
    if (!stream) return res.status(404).end()
    res.setHeader('Content-Type', 'image/png')
    stream.pipe(res)
  })

  // ── API routers ─────────────────────────────────────────────────────────────
  app.use('/auth', makeAuthRouter(db))
  app.use('/teams', makeTeamsRouter(db))
  app.use('/presentations', makePresentationsRouter(db))

  // ── WebSocket ───────────────────────────────────────────────────────────────
  attachWs(io, db)

  // ── Background jobs ─────────────────────────────────────────────────────────
  schedulePruneVersions(db)

  // Express error handler (must be registered after all routers/middleware)
  app.use((err: any, _req: any, res: any, _next: any) => {
    logError('[express][error]', err)
    try {
      res.status(500).json({ error: String(err) })
    } catch {
      // best-effort logging; nothing more we can do if response fails
    }
  })

  // Process-level handlers to surface uncaught issues during development
  process.on('uncaughtException', (err) => {
    logError('[process][uncaughtException]', err)
  })
  process.on('unhandledRejection', (reason) => {
    logError('[process][unhandledRejection]', reason)
  })

  // ── Start ───────────────────────────────────────────────────────────────────
  const port = process.env.PORT || 3000
  server.listen(port, () => logInfo(`Server listening on :${port} (pid:${process.pid})`))
}

main().catch((err) => {
  logError(err)
  // exit to make failures visible in CI / dev environment
  process.exit(1)
})

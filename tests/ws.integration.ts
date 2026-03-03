/// <reference types="jest" />
/**
 * WebSocket integration test — multi-client scenario
 *
 * Spins up a real in-process Express + Socket.IO server backed by a
 * MongoMemoryServer so the test is fully self-contained (no external deps).
 *
 * Scenarios covered:
 *   1. Two clients join the same room → each receives the peer list
 *   2. Presence (cursor) broadcast reaches the other client
 *   3. Diff broadcast reaches the other client and is persisted in Mongo
 *   4. slideChange is relayed correctly
 *   5. snapshot event triggers server-side snapshot and emits snapshot:saved
 *   6. A viewer share-token cannot emit diff (gets no echo back)
 *
 * Usage:  npx jest tests/ws.integration.ts --runInBand
 */

import http from 'http'
import { AddressInfo } from 'net'
import express from 'express'
import { Server as IOServer } from 'socket.io'
import { io as ioc, Socket as ClientSocket } from 'socket.io-client'
import { MongoClient, Db, ObjectId } from 'mongodb'
import jwt from 'jsonwebtoken'

// --- monkey-patch MongoMemoryServer if available, else skip -------
let MongoMemoryServer: any
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer
} catch {
  MongoMemoryServer = null
}

import { attachWs } from '../server/src/ws'
import { ensureUserIndexes } from '../server/src/models/user'
import { ensurePresentationIndexes, presentationCol } from '../server/src/models/presentation'
import { ensureSlideIndexes, slideCol } from '../server/src/models/slide'
import { ensureVersionIndexes, versionCol } from '../server/src/models/version'
import { ensureSnapshotIndexes, snapshotCol } from '../server/src/models/snapshot'
import { ensureShareLinkIndexes, shareLinkCol } from '../server/src/models/sharelink'
import { ensureAuthTokenIndexes } from '../server/src/models/authToken'

const JWT_SECRET = 'test-secret'

// Override module constant for tests
jest.mock('../server/src/api/auth', () => ({
  JWT_SECRET: 'test-secret',
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET)
}

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs)
    socket.once(event, (data: T) => { clearTimeout(t); resolve(data) })
  })
}

// ── Test setup ────────────────────────────────────────────────────────────────

let mongod: any
let mongoClient: MongoClient
let db: Db
let server: http.Server
let port: number
let userId1: string
let userId2: string
let presentationId: string
let slideId: string

async function setupServer(db: Db) {
  const app = express()
  server = http.createServer(app)
  const io = new IOServer(server, { cors: { origin: '*' } })
  attachWs(io, db)
  await new Promise<void>((res) => server.listen(0, res))
  port = (server.address() as AddressInfo).port
}

function clientSocket(token?: string, shareToken?: string) {
  return ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    auth: {},
    autoConnect: true,
  })
}

beforeAll(async () => {
  if (!MongoMemoryServer) {
    console.warn('mongodb-memory-server not installed — skipping WS integration tests')
    return
  }

  mongod = await MongoMemoryServer.create()
  mongoClient = await MongoClient.connect(mongod.getUri())
  db = mongoClient.db('test')

  // Ensure indexes
  await Promise.all([
    ensureUserIndexes(db),
    ensurePresentationIndexes(db),
    ensureSlideIndexes(db),
    ensureVersionIndexes(db),
    ensureSnapshotIndexes(db),
    ensureShareLinkIndexes(db),
    ensureAuthTokenIndexes(db),
  ])

  // Seed data
  userId1 = new ObjectId().toHexString()
  userId2 = new ObjectId().toHexString()

  const pres = await presentationCol(db).insertOne({
    title: 'Test Pres',
    ownerId: new ObjectId(userId1),
    visibility: 'private',
    slideIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  presentationId = pres.insertedId.toHexString()

  const slide = await slideCol(db).insertOne({
    presentationId: new ObjectId(presentationId),
    order: 0,
    elements: [],
    appState: {},
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  slideId = slide.insertedId.toHexString()
  await presentationCol(db).updateOne(
    { _id: pres.insertedId },
    { $set: { slideIds: [slide.insertedId] } }
  )

  await setupServer(db)
}, 30_000)

afterAll(async () => {
  if (!MongoMemoryServer) return
  server?.close()
  await mongoClient?.close()
  await mongod?.stop()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WS integration: multi-client', () => {
  let c1: ClientSocket, c2: ClientSocket

  beforeEach((done) => {
    if (!MongoMemoryServer) return done()
    let ready = 0
    c1 = clientSocket()
    c2 = clientSocket()
    const onConn = () => { if (++ready === 2) done() }
    c1.on('connect', onConn)
    c2.on('connect', onConn)
  })

  afterEach(() => {
    c1?.disconnect()
    c2?.disconnect()
  })

  test('1. Both clients receive joined + peer list', async () => {
    if (!MongoMemoryServer) return

    const t1 = makeToken(userId1)
    const t2 = makeToken(userId2)

    // Make user 2 a team member by making the presentation public for this test
    await presentationCol(db).updateOne(
      { _id: new ObjectId(presentationId) },
      { $set: { visibility: 'public' } }
    )

    const [j1, j2] = await Promise.all([
      waitFor<any>(c1, 'joined'),
      waitFor<any>(c2, 'joined').then(async (r) => r),
      new Promise<void>((res) => {
        c1.emit('joinRoom', { presentationId, token: t1, name: 'Alice', color: '#f00' })
        // Small delay so c1 is in room before c2
        setTimeout(() => {
          c2.emit('joinRoom', { presentationId, token: t2, name: 'Bob', color: '#00f' })
          res()
        }, 50)
      }),
    ])

    expect(j1.presentationId).toBe(presentationId)
    expect(j2.presentationId).toBe(presentationId)
    // c2 joins after c1, so c1 should appear in c2's peer list
    expect(j2.peers.length).toBeGreaterThanOrEqual(1)
  })

  test('2. Presence broadcast reaches peer', async () => {
    if (!MongoMemoryServer) return

    const t1 = makeToken(userId1)
    const t2 = makeToken(userId2)

    await Promise.all([
      waitFor(c1, 'joined'),
      waitFor(c2, 'joined'),
      new Promise<void>((res) => {
        c1.emit('joinRoom', { presentationId, token: t1, name: 'Alice' })
        setTimeout(() => { c2.emit('joinRoom', { presentationId, token: t2, name: 'Bob' }); res() }, 50)
      }),
    ])

    const presence = waitFor<any>(c2, 'presence')
    c1.emit('presence', { x: 42, y: 55 })
    const p = await presence
    expect(p.x).toBeCloseTo(42, 0)
    expect(p.y).toBeCloseTo(55, 0)
  })

  test('3. Diff broadcast reaches peer and is persisted', async () => {
    if (!MongoMemoryServer) return

    const t1 = makeToken(userId1)
    const t2 = makeToken(userId2)
    const patch = [{ type: 'rectangle', id: 'abc' }]

    await Promise.all([
      waitFor(c1, 'joined'),
      waitFor(c2, 'joined'),
      new Promise<void>((res) => {
        c1.emit('joinRoom', { presentationId, token: t1, name: 'Alice' })
        setTimeout(() => { c2.emit('joinRoom', { presentationId, token: t2, name: 'Bob' }); res() }, 50)
      }),
    ])

    const diffReceived = waitFor<any>(c2, 'diff')
    c1.emit('diff', { slideId, patch })
    const d = await diffReceived

    expect(d.slideId).toBe(slideId)
    expect(d.patch).toEqual(patch)

    // Check DB
    await new Promise((r) => setTimeout(r, 200))
    const versions = await versionCol(db).find({ slideId: new ObjectId(slideId) }).toArray()
    expect(versions.length).toBeGreaterThanOrEqual(1)
  })

  test('4. slideChange is relayed', async () => {
    if (!MongoMemoryServer) return

    const t1 = makeToken(userId1)
    const t2 = makeToken(userId2)

    await Promise.all([
      waitFor(c1, 'joined'),
      waitFor(c2, 'joined'),
      new Promise<void>((res) => {
        c1.emit('joinRoom', { presentationId, token: t1, name: 'Alice' })
        setTimeout(() => { c2.emit('joinRoom', { presentationId, token: t2, name: 'Bob' }); res() }, 50)
      }),
    ])

    const sc = waitFor<any>(c2, 'slideChange')
    c1.emit('slideChange', { slideIndex: 3 })
    const s = await sc
    expect(s.slideIndex).toBe(3)
  })

  test('5. snapshot event persists snapshot and emits snapshot:saved', async () => {
    if (!MongoMemoryServer) return

    const t1 = makeToken(userId1)
    await waitFor(c1, 'joined')
    c1.emit('joinRoom', { presentationId, token: t1, name: 'Alice' })
    await waitFor(c1, 'joined')  // second join event for c1 itself

    const saved = waitFor<any>(c1, 'snapshot:saved')
    c1.emit('snapshot', { name: 'v1-test' })
    const snap = await saved
    expect(snap.name).toBe('v1-test')

    const dbSnap = await snapshotCol(db).findOne({ _id: new ObjectId(snap.snapshotId) })
    expect(dbSnap?.name).toBe('v1-test')
  })

  test('6. view-only share-token cannot emit diff', async () => {
    if (!MongoMemoryServer) return

    // Create a view-only sharelink
    const tok = 'test-view-token-' + Date.now()
    await shareLinkCol(db).insertOne({
      token: tok,
      presentationId: new ObjectId(presentationId),
      permission: 'view',
      usedCount: 0,
      createdAt: new Date(),
    })

    await waitFor(c1, 'joined')
    c1.emit('joinRoom', { presentationId, shareToken: tok, name: 'Viewer' })
    await waitFor(c1, 'joined')

    // Join c2 as editor so it could receive diffs
    const t2 = makeToken(userId2)
    await waitFor(c2, 'joined')
    c2.emit('joinRoom', { presentationId, token: t2, name: 'Editor' })
    await waitFor(c2, 'joined')

    // c1 (viewer) emits a diff — c2 should NOT receive it
    let received = false
    c2.on('diff', () => { received = true })
    c1.emit('diff', { slideId, patch: [{ type: 'ellipse' }] })

    await new Promise((r) => setTimeout(r, 400))
    expect(received).toBe(false)
  })
})

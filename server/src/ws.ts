/**
 * WebSocket server (socket.io)
 *
 * Protocol events (client → server):
 *   joinRoom        { presentationId, token }      — join or authenticate into a room
 *   presence        { x, y, color, name }           — cursor position broadcast
 *   diff            { slideId, patch: unknown[] }   — element-level diff to broadcast + persist
 *   slideChange     { slideIndex }                  — active slide changed
 *   snapshot        { name }                        — trigger server-side named snapshot
 *
 * Protocol events (server → client):
 *   joined          { presentationId, peers }
 *   presence        { userId, x, y, color, name }
 *   diff            { userId, slideId, patch }
 *   slideChange     { userId, slideIndex }
 *   snapshot:saved  { snapshotId, name }
 *   error           { message }
 */

import { Server as IOServer, Socket } from 'socket.io'
import { Db, ObjectId } from 'mongodb'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { JWT_SECRET } from './api/auth'
import { presentationCol } from './models/presentation'
import { slideCol } from './models/slide'
import { versionCol } from './models/version'
import { snapshotCol } from './models/snapshot'
import { shareLinkCol } from './models/sharelink'
import { teamCol } from './models/team'

interface RoomPeer {
  socketId: string
  userId: string
  name: string
  color: string
}

const rooms = new Map<string, Map<string, RoomPeer>>()

function roomId(presentationId: string) {
  return `pres:${presentationId}`
}

async function canAccessPresentation(
  db: Db,
  presentationId: string,
  userId: string | null,
  shareToken: string | null
): Promise<'edit' | 'view' | null> {
  const oid = new ObjectId(presentationId)

  // Share-link auth
  if (shareToken) {
    const sl = await shareLinkCol(db).findOne({ token: shareToken, presentationId: oid })
    if (!sl) return null
    if (sl.expiresAt && sl.expiresAt < new Date()) return null
    return sl.permission
  }

  if (!userId) return null

  const pres = await presentationCol(db).findOne({ _id: oid })
  if (!pres) return null

  if (pres.ownerId.toHexString() === userId) return 'edit'
  if (pres.visibility === 'public') return 'view'

  if (pres.teamId) {
    const team = await teamCol(db).findOne({ _id: pres.teamId })
    if (team) {
      const member = team.members.find((m) => m.userId.toHexString() === userId)
      if (member) return member.role === 'viewer' ? 'view' : 'edit'
    }
  }
  return null
}

export function attachWs(io: IOServer, db: Db) {
  io.on('connection', (socket: Socket) => {
    let authedPresentationId: string | null = null
    let authedUserId: string = '__anonymous__'
    let peerPermission: 'view' | 'edit' | null = null

    // ── joinRoom ───────────────────────────────────────────────────────────────
    socket.on('joinRoom', async (payload: { presentationId: string; token?: string; shareToken?: string; name?: string; color?: string }) => {
      const { presentationId, token, shareToken, name = 'Anonymous', color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') } = payload

      // Resolve user
      let userId: string | null = null
      if (token) {
        try {
          const p = jwt.verify(token, JWT_SECRET) as JwtPayload
          if (p.sub) userId = p.sub as string
        } catch { /* ignore */ }
      }

      const perm = await canAccessPresentation(db, presentationId, userId, shareToken ?? null)
      if (!perm) {
        socket.emit('error', { message: 'access denied to presentation' })
        return
      }

      authedPresentationId = presentationId
      authedUserId = userId ?? '__sharelink__'
      peerPermission = perm

      const rid = roomId(presentationId)
      socket.join(rid)

      if (!rooms.has(rid)) rooms.set(rid, new Map())
      const room = rooms.get(rid)!
      room.set(socket.id, { socketId: socket.id, userId: authedUserId, name, color })

      const peers = Array.from(room.values()).filter((p) => p.socketId !== socket.id)
      socket.emit('joined', { presentationId, peers })
      socket.to(rid).emit('peerJoined', { socketId: socket.id, userId: authedUserId, name, color })
    })

    // ── presence (cursor) ──────────────────────────────────────────────────────
    socket.on('presence', (payload: { x: number; y: number }) => {
      if (!authedPresentationId) return
      const rid = roomId(authedPresentationId)
      const peer = rooms.get(rid)?.get(socket.id)
      socket.to(rid).emit('presence', {
        socketId: socket.id,
        userId: authedUserId,
        name: peer?.name,
        color: peer?.color,
        ...payload,
      })
    })

    // ── diff ───────────────────────────────────────────────────────────────────
    socket.on('diff', async (payload: { slideId: string; patch: unknown[] }) => {
      if (!authedPresentationId || peerPermission !== 'edit') return
      const rid = roomId(authedPresentationId)

      // Persist the diff elements as a new version entry
      try {
        const sid = new ObjectId(payload.slideId)
        const pid = new ObjectId(authedPresentationId)
        const now = new Date()
        await versionCol(db).insertOne({
          presentationId: pid,
          slideId: sid,
          elements: payload.patch,
          appState: {},
          authorId: new ObjectId(authedUserId === '__sharelink__' ? '000000000000000000000000' : authedUserId),
          createdAt: now,
        })
        // Update the live slide elements
        await slideCol(db).updateOne(
          { _id: sid, presentationId: pid },
          { $set: { elements: payload.patch, updatedAt: now } }
        )
      } catch (e) {
        console.error('diff persist error', e)
      }

      socket.to(rid).emit('diff', { socketId: socket.id, userId: authedUserId, ...payload })
    })

    // ── slideChange ────────────────────────────────────────────────────────────
    socket.on('slideChange', (payload: { slideIndex: number }) => {
      if (!authedPresentationId) return
      socket.to(roomId(authedPresentationId)).emit('slideChange', {
        socketId: socket.id,
        userId: authedUserId,
        slideIndex: payload.slideIndex,
      })
    })

    // ── snapshot ───────────────────────────────────────────────────────────────
    socket.on('snapshot', async (payload: { name?: string }) => {
      if (!authedPresentationId || peerPermission !== 'edit') return
      const pid = new ObjectId(authedPresentationId)
      const name = payload.name ?? `Snapshot ${new Date().toISOString()}`
      const currentSlides = await slideCol(db).find({ presentationId: pid }).sort({ order: 1 }).toArray()
      const result = await snapshotCol(db).insertOne({
        presentationId: pid,
        name,
        slides: currentSlides,
        authorId: new ObjectId(authedUserId === '__sharelink__' ? '000000000000000000000000' : authedUserId),
        createdAt: new Date(),
      })
      socket.emit('snapshot:saved', { snapshotId: result.insertedId, name })
      socket.to(roomId(authedPresentationId)).emit('snapshot:saved', { snapshotId: result.insertedId, name })
    })

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (!authedPresentationId) return
      const rid = roomId(authedPresentationId)
      rooms.get(rid)?.delete(socket.id)
      if (rooms.get(rid)?.size === 0) rooms.delete(rid)
      socket.to(rid).emit('peerLeft', { socketId: socket.id, userId: authedUserId })
    })
  })
}

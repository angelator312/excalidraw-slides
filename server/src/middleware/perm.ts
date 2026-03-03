/**
 * Permissions middleware
 *
 *  requireAuth       — validates JWT, attaches req.userId
 *  canRead(db)       — ensures caller can read a presentation (owner | team member | public | sharelink-view)
 *  canEdit(db)       — ensures caller can edit (owner | team editor/owner)
 *
 * Share-link resolution:
 *   Callers may pass  Authorization: Bearer <jwt>  OR
 *                     X-Share-Token: <sharelink-token>
 *   The share-token path enforces permission=edit for mutating routes.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { Db, ObjectId } from 'mongodb'
import { presentationCol } from '../models/presentation'
import { teamCol } from '../models/team'
import { shareLinkCol } from '../models/sharelink'
import { JWT_SECRET } from '../api/auth'

export interface AuthedRequest extends Request {
  userId: string
  sharePermission?: 'view' | 'edit'
}

// ── JWT helper ────────────────────────────────────────────────────────────────

function extractJwt(req: Request): string | null {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7)
  return null
}

function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

// ── requireAuth ───────────────────────────────────────────────────────────────

export const requireAuth: RequestHandler = (req, res, next) => {
  const tok = extractJwt(req)
  if (!tok) return res.status(401).json({ error: 'unauthenticated' }) as any
  const payload = verifyJwt(tok)
  if (!payload?.sub) return res.status(401).json({ error: 'invalid token' }) as any
  ;(req as AuthedRequest).userId = payload.sub as string
  next()
}

// ── resolvePresentation helper ────────────────────────────────────────────────

async function resolveAccess(
  req: Request,
  res: Response,
  db: Db,
  requiredPermission: 'view' | 'edit'
): Promise<boolean> {
  const ar = req as AuthedRequest
  const presentationId = req.params.id
  let oid: ObjectId
  try { oid = new ObjectId(presentationId) } catch {
    res.status(400).json({ error: 'bad presentation id' })
    return false
  }

  // 1. Try share-link token from header or query param
  const shareToken = (req.headers['x-share-token'] as string) ?? (req.query['share'] as string)
  if (shareToken) {
    const sharelinks = shareLinkCol(db)
    const sl = await sharelinks.findOne({ token: shareToken })
    if (!sl || sl.presentationId.toHexString() !== oid.toHexString()) {
      res.status(403).json({ error: 'invalid share token' })
      return false
    }
    if (sl.expiresAt && sl.expiresAt < new Date()) {
      res.status(410).json({ error: 'share link expired' })
      return false
    }
    if (requiredPermission === 'edit' && sl.permission !== 'edit') {
      res.status(403).json({ error: 'share link is view-only' })
      return false
    }
    ar.sharePermission = sl.permission
    // No userId for sharelink-only access — set anonymous marker
    if (!ar.userId) ar.userId = '__sharelink__'
    return true
  }

  // 2. Require JWT for all other access
  const tok = extractJwt(req)
  if (!tok) { res.status(401).json({ error: 'unauthenticated' }); return false }
  const payload = verifyJwt(tok)
  if (!payload?.sub) { res.status(401).json({ error: 'invalid token' }); return false }
  ar.userId = payload.sub as string

  const pres = await presentationCol(db).findOne({ _id: oid })
  if (!pres) { res.status(404).json({ error: 'presentation not found' }); return false }

  // 3. Owner always wins
  if (pres.ownerId.toHexString() === ar.userId) return true

  // 4. Public visibility allows reads
  if (requiredPermission === 'view' && pres.visibility === 'public') return true

  // 5. Team membership
  if (pres.teamId) {
    const team = await teamCol(db).findOne({ _id: pres.teamId })
    if (team) {
      const member = team.members.find((m) => m.userId.toHexString() === ar.userId)
      if (member) {
        if (requiredPermission === 'view') return true
        if (requiredPermission === 'edit' && (member.role === 'owner' || member.role === 'editor')) return true
      }
    }
  }

  // 6. Team-visibility allows reads for any team member even if not in team (via visibility flag)
  if (requiredPermission === 'view' && pres.visibility === 'team') {
    // Already handled above via team membership check
  }

  res.status(403).json({ error: 'forbidden' })
  return false
}

// ── canRead / canEdit factories ───────────────────────────────────────────────

export function canRead(db: Db): RequestHandler {
  return async (req, res, next) => {
    if (await resolveAccess(req, res, db, 'view')) next()
  }
}

export function canEdit(db: Db): RequestHandler {
  return async (req, res, next) => {
    if (await resolveAccess(req, res, db, 'edit')) next()
  }
}

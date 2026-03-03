/**
 * Auth routes
 *
 * POST /auth/register   — create account (email + password)
 * POST /auth/login      — password login → JWT
 * POST /auth/magic      — generate one-time magic link token for a user (owner only)
 * GET  /auth/magic/:tok — redeem magic link → JWT
 * POST /auth/logout     — (client-side: discard token; here for completeness)
 */

import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import { Db, ObjectId } from 'mongodb'
import { userCol } from '../models/user'
import { authTokenCol } from '../models/authToken'

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const JWT_TTL = '7d'
const MAGIC_TTL_MS = 15 * 60 * 1000 // 15 min

function signJwt(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_TTL })
}

export function makeAuthRouter(db: Db): Router {
  const router = Router()
  const users = userCol(db)
  const tokens = authTokenCol(db)

  // ── Register ────────────────────────────────────────────────────────────────
  router.post('/register', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' })

    const emailNorm = email.toLowerCase().trim()
    if (!emailNorm.includes('@'))
      return res.status(400).json({ error: 'invalid email' })

    const existing = await users.findOne({ email: emailNorm })
    if (existing) return res.status(409).json({ error: 'email already registered' })

    const passwordHash = await bcrypt.hash(password, 12)
    const result = await users.insertOne({
      email: emailNorm,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const token = signJwt(result.insertedId.toHexString())
    res.status(201).json({ token, userId: result.insertedId })
  })

  // ── Login ────────────────────────────────────────────────────────────────────
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' })

    const user = await users.findOne({ email: email.toLowerCase().trim() })
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'invalid credentials' })

    const token = signJwt(user._id!.toHexString())
    res.json({ token, userId: user._id })
  })

  // ── Generate magic link (owner action) ──────────────────────────────────────
  router.post('/magic', async (req: Request, res: Response) => {
    // The requesting user must already be authenticated
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ error: 'unauthenticated' })

    let payload: jwt.JwtPayload
    try {
      payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as jwt.JwtPayload
    } catch {
      return res.status(401).json({ error: 'invalid token' })
    }

    const { targetEmail } = req.body as { targetEmail?: string }
    if (!targetEmail)
      return res.status(400).json({ error: 'targetEmail required' })

    const target = await users.findOne({ email: targetEmail.toLowerCase().trim() })
    if (!target) return res.status(404).json({ error: 'user not found' })

    const tok = nanoid(32)
    await tokens.insertOne({
      token: tok,
      userId: target._id!,
      expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
      createdAt: new Date(),
    })

    // In production you'd email this link; here we return it for the owner to share.
    const link = `${req.protocol}://${req.get('host')}/auth/magic/${tok}`
    res.json({ link, token: tok })
  })

  // ── Redeem magic link ────────────────────────────────────────────────────────
  router.get('/magic/:tok', async (req: Request, res: Response) => {
    const { tok } = req.params
    const record = await tokens.findOne({ token: tok })
    if (!record) return res.status(404).json({ error: 'token not found' })
    if (record.usedAt) return res.status(410).json({ error: 'token already used' })
    if (record.expiresAt < new Date())
      return res.status(410).json({ error: 'token expired' })

    await tokens.updateOne({ _id: record._id }, { $set: { usedAt: new Date() } })

    const jwt_token = signJwt(record.userId.toHexString())
    res.json({ token: jwt_token, userId: record.userId })
  })

  router.post('/logout', (_req, res) => res.json({ ok: true }))

  return router
}

export { JWT_SECRET }

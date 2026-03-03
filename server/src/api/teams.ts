/**
 * Teams routes
 *
 * POST   /teams                        — create team (auto-adds caller as owner)
 * GET    /teams/:id                    — get team details
 * POST   /teams/:id/members            — add member by email (or trigger invite fallback)
 * DELETE /teams/:id/members/:userId    — remove member
 * GET    /users/search?q=<email>       — search users by email prefix (for invite UI)
 */

import { Router, Request, Response } from 'express'
import { Db, ObjectId } from 'mongodb'
import { teamCol } from '../models/team'
import { userCol } from '../models/user'
import { requireAuth, AuthedRequest } from '../middleware/perm'

export function makeTeamsRouter(db: Db): Router {
  const router = Router()
  const teams = teamCol(db)
  const users = userCol(db)

  // ── Create team ─────────────────────────────────────────────────────────────
  router.post('/', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req as AuthedRequest
    const { name } = req.body as { name?: string }
    if (!name?.trim()) return res.status(400).json({ error: 'name required' })

    const result = await teams.insertOne({
      name: name.trim(),
      members: [{ userId: new ObjectId(userId), role: 'owner' }],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const team = await teams.findOne({ _id: result.insertedId })
    res.status(201).json(team)
  })

  // ── Get team ─────────────────────────────────────────────────────────────────
  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req as AuthedRequest
    let oid: ObjectId
    try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'bad id' }) }

    const team = await teams.findOne({ _id: oid })
    if (!team) return res.status(404).json({ error: 'not found' })

    const isMember = team.members.some((m) => m.userId.equals(userId))
    if (!isMember) return res.status(403).json({ error: 'forbidden' })

    res.json(team)
  })

  // ── Add member ───────────────────────────────────────────────────────────────
  // POST /teams/:id/members  { email, role? }
  router.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req as AuthedRequest
    let oid: ObjectId
    try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'bad id' }) }

    const team = await teams.findOne({ _id: oid })
    if (!team) return res.status(404).json({ error: 'not found' })

    const caller = team.members.find((m) => m.userId.equals(userId))
    if (!caller || caller.role !== 'owner')
      return res.status(403).json({ error: 'only team owner can add members' })

    const { email, role = 'viewer' } = req.body as { email?: string; role?: string }
    if (!email) return res.status(400).json({ error: 'email required' })

    const target = await users.findOne({ email: email.toLowerCase().trim() })
    if (!target) {
      // Invite fallback: in production, queue an invite email. Here we indicate it.
      return res.status(202).json({ invited: true, email, message: 'User not found — invite email would be sent' })
    }

    const alreadyMember = team.members.some((m) => m.userId.equals(target._id!))
    if (alreadyMember) return res.status(409).json({ error: 'already a member' })

    const memberRole = (['owner', 'editor', 'viewer'].includes(role) ? role : 'viewer') as 'owner' | 'editor' | 'viewer'

    await teams.updateOne(
      { _id: oid },
      {
        $push: { members: { userId: target._id!, role: memberRole } },
        $set: { updatedAt: new Date() },
      }
    )
    res.status(201).json({ userId: target._id, role: memberRole })
  })

  // ── Remove member ────────────────────────────────────────────────────────────
  router.delete('/:id/members/:memberId', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req as AuthedRequest
    let oid: ObjectId, mid: ObjectId
    try {
      oid = new ObjectId(req.params.id)
      mid = new ObjectId(req.params.memberId)
    } catch { return res.status(400).json({ error: 'bad id' }) }

    const team = await teams.findOne({ _id: oid })
    if (!team) return res.status(404).json({ error: 'not found' })

    const caller = team.members.find((m) => m.userId.equals(userId))
    if (!caller || caller.role !== 'owner')
      return res.status(403).json({ error: 'only owner can remove members' })

    if (mid.equals(userId))
      return res.status(409).json({ error: 'cannot remove yourself' })

    await teams.updateOne(
      { _id: oid },
      { $pull: { members: { userId: mid } }, $set: { updatedAt: new Date() } }
    )
    res.json({ removed: mid })
  })

  // ── User search ───────────────────────────────────────────────────────────────
  router.get('/users/search', requireAuth, async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').toLowerCase().trim()
    if (!q) return res.status(400).json({ error: 'q required' })

    const results = await users
      .find({ email: { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' } })
      .project({ email: 1 })
      .limit(10)
      .toArray()

    res.json(results.map((u) => ({ userId: u._id, email: u.email })))
  })

  return router
}

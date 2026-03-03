/**
 * Presentations + slides + sharelink + snapshot + version-history routes
 *
 * POST   /presentations
 * GET    /presentations/:id
 * PUT    /presentations/:id
 * DELETE /presentations/:id
 *
 * GET    /presentations/:id/slides
 * POST   /presentations/:id/slides
 * PUT    /presentations/:id/slides/:sid
 * DELETE /presentations/:id/slides/:sid
 *
 * POST   /presentations/:id/sharelinks
 * GET    /presentations/share/:token       — resolve sharelink
 *
 * GET    /presentations/:id/history        — last N versions
 * GET    /presentations/:id/snapshots
 * POST   /presentations/:id/snapshots
 * POST   /presentations/:id/snapshots/:snid/restore
 */

import { Router, Request, Response } from 'express'
import { Db, ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'
import { presentationCol, Presentation } from '../models/presentation'
import { slideCol, Slide } from '../models/slide'
import { snapshotCol } from '../models/snapshot'
import { versionCol } from '../models/version'
import { shareLinkCol } from '../models/sharelink'
import { requireAuth, canRead, canEdit, AuthedRequest } from '../middleware/perm'

export function makePresentationsRouter(db: Db): Router {
  const router = Router()
  const presentations = presentationCol(db)
  const slides = slideCol(db)
  const snapshots = snapshotCol(db)
  const versions = versionCol(db)
  const sharelinks = shareLinkCol(db)

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function asOid(s: string, res: Response): ObjectId | null {
    try { return new ObjectId(s) } catch { res.status(400).json({ error: 'bad id' }); return null }
  }

  // ── Create presentation ──────────────────────────────────────────────────────
  router.post('/', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req as AuthedRequest
    const { title = 'Untitled', visibility = 'private', teamId } = req.body as Partial<Presentation> & { teamId?: string }

    const doc: Omit<Presentation, '_id'> = {
      title,
      ownerId: new ObjectId(userId),
      visibility: visibility as Presentation['visibility'],
      slideIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(teamId ? { teamId: new ObjectId(teamId) } : {}),
    }
    const result = await presentations.insertOne(doc)
    res.status(201).json({ ...doc, _id: result.insertedId })
  })

  // ── Get presentation ─────────────────────────────────────────────────────────
  router.get('/:id', canRead(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const p = await presentations.findOne({ _id: oid })
    res.json(p)
  })

  // ── Update presentation meta ─────────────────────────────────────────────────
  router.put('/:id', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const { title, visibility } = req.body as Partial<Presentation>
    const set: Partial<Presentation> = { updatedAt: new Date() }
    if (title) set.title = title
    if (visibility) set.visibility = visibility
    await presentations.updateOne({ _id: oid }, { $set: set })
    res.json({ ok: true })
  })

  // ── Delete presentation ──────────────────────────────────────────────────────
  router.delete('/:id', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    await presentations.deleteOne({ _id: oid })
    await slides.deleteMany({ presentationId: oid })
    await versions.deleteMany({ presentationId: oid })
    await snapshots.deleteMany({ presentationId: oid })
    await sharelinks.deleteMany({ presentationId: oid })
    res.json({ ok: true })
  })

  // ── List slides ───────────────────────────────────────────────────────────────
  router.get('/:id/slides', canRead(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const result = await slides.find({ presentationId: oid }).sort({ order: 1 }).toArray()
    res.json(result)
  })

  // ── Add slide ─────────────────────────────────────────────────────────────────
  router.post('/:id/slides', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const { userId } = req as AuthedRequest
    const { elements = [], appState = {}, notes = '', order } = req.body as Partial<Slide>

    const lastSlide = await slides.find({ presentationId: oid }).sort({ order: -1 }).limit(1).next()
    const slideOrder = order ?? ((lastSlide?.order ?? -1) + 1)
    const now = new Date()
    const ins = await slides.insertOne({
      presentationId: oid,
      order: slideOrder,
      elements,
      appState,
      notes,
      createdAt: now,
      updatedAt: now,
    })
    await presentations.updateOne({ _id: oid }, { $push: { slideIds: ins.insertedId }, $set: { updatedAt: now } })
    // Record initial version
    await versions.insertOne({
      presentationId: oid,
      slideId: ins.insertedId,
      elements,
      appState,
      authorId: new ObjectId(userId),
      createdAt: now,
    })
    res.status(201).json({ _id: ins.insertedId, presentationId: oid, order: slideOrder, elements, appState, notes })
  })

  // ── Update slide ──────────────────────────────────────────────────────────────
  router.put('/:id/slides/:sid', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    const sid = asOid(req.params.sid, res)
    if (!oid || !sid) return
    const { userId } = req as AuthedRequest
    const { elements, appState, notes, thumbnailId } = req.body as Partial<Slide>

    const now = new Date()
    const set: Partial<Slide> = { updatedAt: now }
    if (elements !== undefined) set.elements = elements
    if (appState !== undefined) set.appState = appState
    if (notes !== undefined) set.notes = notes
    if (thumbnailId !== undefined) set.thumbnailId = thumbnailId

    await slides.updateOne({ _id: sid, presentationId: oid }, { $set: set })
    // Append version if content changed
    if (elements !== undefined) {
      await versions.insertOne({
        presentationId: oid,
        slideId: sid,
        elements: elements!,
        appState: appState ?? {},
        authorId: new ObjectId(userId),
        createdAt: now,
      })
    }
    res.json({ ok: true })
  })

  // ── Delete slide ──────────────────────────────────────────────────────────────
  router.delete('/:id/slides/:sid', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    const sid = asOid(req.params.sid, res)
    if (!oid || !sid) return
    await slides.deleteOne({ _id: sid, presentationId: oid })
    await versions.deleteMany({ slideId: sid })
    await presentations.updateOne({ _id: oid }, { $pull: { slideIds: sid }, $set: { updatedAt: new Date() } })
    res.json({ ok: true })
  })

  // ── Create sharelink ─────────────────────────────────────────────────────────
  router.post('/:id/sharelinks', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const { permission = 'view', expiresInHours } = req.body as { permission?: string; expiresInHours?: number }
    const tok = nanoid(24)
    const doc = {
      token: tok,
      presentationId: oid,
      permission: (['view', 'edit'].includes(permission) ? permission : 'view') as 'view' | 'edit',
      usedCount: 0,
      createdAt: new Date(),
      ...(expiresInHours ? { expiresAt: new Date(Date.now() + expiresInHours * 3600_000) } : {}),
    }
    await sharelinks.insertOne(doc)
    res.status(201).json({ token: tok, link: `/presentations/share/${tok}` })
  })

  // ── Resolve sharelink (no auth needed) ──────────────────────────────────────
  router.get('/share/:token', async (req: Request, res: Response) => {
    const sl = await sharelinks.findOne({ token: req.params.token })
    if (!sl) return res.status(404).json({ error: 'not found' })
    if (sl.expiresAt && sl.expiresAt < new Date())
      return res.status(410).json({ error: 'link expired' })
    await sharelinks.updateOne({ _id: sl._id }, { $inc: { usedCount: 1 } })
    const p = await presentations.findOne({ _id: sl.presentationId })
    res.json({ presentation: p, permission: sl.permission })
  })

  // ── History (last N versions) ────────────────────────────────────────────────
  router.get('/:id/history', canRead(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const n = Math.min(Number(req.query.n ?? 50), 200)
    const hist = await versions
      .find({ presentationId: oid })
      .sort({ createdAt: -1 })
      .limit(n)
      .toArray()
    res.json(hist)
  })

  // ── Snapshots ─────────────────────────────────────────────────────────────────
  router.get('/:id/snapshots', canRead(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const list = await snapshots.find({ presentationId: oid }).sort({ createdAt: -1 }).toArray()
    res.json(list)
  })

  router.post('/:id/snapshots', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    if (!oid) return
    const { userId } = req as AuthedRequest
    const { name = 'Snapshot' } = req.body as { name?: string }

    const currentSlides = await slides.find({ presentationId: oid }).sort({ order: 1 }).toArray()
    const result = await snapshots.insertOne({
      presentationId: oid,
      name,
      slides: currentSlides,
      authorId: new ObjectId(userId),
      createdAt: new Date(),
    })
    res.status(201).json({ _id: result.insertedId, name })
  })

  router.post('/:id/snapshots/:snid/restore', canEdit(db), async (req: Request, res: Response) => {
    const oid = asOid(req.params.id, res)
    const snid = asOid(req.params.snid, res)
    if (!oid || !snid) return
    const { userId } = req as AuthedRequest

    const snap = await snapshots.findOne({ _id: snid, presentationId: oid })
    if (!snap) return res.status(404).json({ error: 'snapshot not found' })

    // Remove current slides and restore from snapshot
    await slides.deleteMany({ presentationId: oid })
    const now = new Date()
    const restored = (snap.slides as Omit<Slide, '_id'>[]).map((s) => ({
      ...s,
      _id: new ObjectId(),
      presentationId: oid,
      updatedAt: now,
    }))
    if (restored.length) {
      await slides.insertMany(restored as Slide[])
    }
    await presentations.updateOne(
      { _id: oid },
      { $set: { slideIds: restored.map((s) => s._id!), updatedAt: now } }
    )
    // Record restore as a version entry per restored slide
    const versionDocs = restored.map((s) => ({
      presentationId: oid,
      slideId: s._id!,
      elements: s.elements,
      appState: s.appState,
      authorId: new ObjectId(userId),
      createdAt: now,
    }))
    if (versionDocs.length) await versions.insertMany(versionDocs)

    res.json({ ok: true, restoredSlides: restored.length })
  })

  return router
}

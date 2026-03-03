/**
 * Prune versions job
 *
 * Keeps at most MAX_VERSIONS auto-history entries per presentation.
 * Named snapshots are never touched.
 *
 * Run on a schedule (e.g., setInterval in index.ts) or as a cron.
 */

import { Db, ObjectId } from 'mongodb'
import { versionCol } from '../models/version'
import { presentationCol } from '../models/presentation'

export const MAX_VERSIONS = 50

export async function pruneVersions(db: Db): Promise<{ pruned: number }> {
  const presentations = await presentationCol(db).find({}, { projection: { _id: 1 } }).toArray()
  let pruned = 0

  for (const p of presentations) {
    const pid: ObjectId = p._id!
    const versions = versionCol(db)

    // Count current entries per presentation
    const count = await versions.countDocuments({ presentationId: pid })
    if (count <= MAX_VERSIONS) continue

    // Find the _id of the MAX_VERSIONS-th newest entry so we can drop anything older
    const cutoffCursor = await versions
      .find({ presentationId: pid })
      .sort({ createdAt: -1 })
      .skip(MAX_VERSIONS - 1)
      .limit(1)
      .next()

    if (!cutoffCursor) continue

    const result = await versions.deleteMany({
      presentationId: pid,
      createdAt: { $lt: cutoffCursor.createdAt },
    })
    pruned += result.deletedCount
  }

  return { pruned }
}

/** Schedule the job to run every intervalMs (default: 5 minutes). */
export function schedulePruneVersions(db: Db, intervalMs = 5 * 60 * 1000) {
  setInterval(async () => {
    try {
      const { pruned } = await pruneVersions(db)
      if (pruned > 0) console.log(`[pruneVersions] removed ${pruned} stale version entries`)
    } catch (e) {
      console.error('[pruneVersions] error:', e)
    }
  }, intervalMs)
}

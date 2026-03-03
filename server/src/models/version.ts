import { Db, ObjectId } from 'mongodb'

/** Auto-history entry — bounded to N=50 per presentation (pruned by job). */
export interface Version {
  _id?: ObjectId
  presentationId: ObjectId
  /** Full snapshot of elements for a single slide */
  slideId: ObjectId
  elements: unknown[]
  appState: Record<string, unknown>
  authorId: ObjectId
  createdAt: Date
}

export const VERSIONS_COL = 'versions'

export async function ensureVersionIndexes(db: Db) {
  const col = db.collection(VERSIONS_COL)
  await col.createIndex({ presentationId: 1, createdAt: -1 })
  await col.createIndex({ slideId: 1, createdAt: -1 })
}

export function versionCol(db: Db) {
  return db.collection<Version>(VERSIONS_COL)
}

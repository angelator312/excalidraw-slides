import { Db, ObjectId } from 'mongodb'

/** Named snapshot — persisted by the user, never auto-pruned. */
export interface Snapshot {
  _id?: ObjectId
  presentationId: ObjectId
  name: string
  /** Full array of serialized slides at snapshot time */
  slides: unknown[]
  authorId: ObjectId
  createdAt: Date
}

export const SNAPSHOTS_COL = 'snapshots'

export async function ensureSnapshotIndexes(db: Db) {
  await db.collection(SNAPSHOTS_COL).createIndex({ presentationId: 1, createdAt: -1 })
}

export function snapshotCol(db: Db) {
  return db.collection<Snapshot>(SNAPSHOTS_COL)
}

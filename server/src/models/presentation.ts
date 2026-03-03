import { Db, ObjectId } from 'mongodb'

export type Visibility = 'private' | 'team' | 'public'

export interface Presentation {
  _id?: ObjectId
  title: string
  ownerId: ObjectId
  teamId?: ObjectId
  visibility: Visibility
  /** Ordered list of slide IDs */
  slideIds: ObjectId[]
  createdAt: Date
  updatedAt: Date
}

export const PRESENTATIONS_COL = 'presentations'

export async function ensurePresentationIndexes(db: Db) {
  const col = db.collection(PRESENTATIONS_COL)
  await col.createIndex({ ownerId: 1 })
  await col.createIndex({ teamId: 1 })
}

export function presentationCol(db: Db) {
  return db.collection<Presentation>(PRESENTATIONS_COL)
}

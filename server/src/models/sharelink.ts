import { Db, ObjectId } from 'mongodb'

export type SharePermission = 'view' | 'edit'

export interface ShareLink {
  _id?: ObjectId
  token: string
  presentationId: ObjectId
  permission: SharePermission
  expiresAt?: Date
  usedCount: number
  createdAt: Date
}

export const SHARELINKS_COL = 'sharelinks'

export async function ensureShareLinkIndexes(db: Db) {
  const col = db.collection(SHARELINKS_COL)
  await col.createIndex({ token: 1 }, { unique: true })
  await col.createIndex({ presentationId: 1 })
}

export function shareLinkCol(db: Db) {
  return db.collection<ShareLink>(SHARELINKS_COL)
}

import { Db, ObjectId } from 'mongodb'

/**
 * One-time auth token — owner generates a magic link, recipient redeems it once
 * and gets a session JWT in return.
 */
export interface AuthToken {
  _id?: ObjectId
  token: string
  userId: ObjectId
  /** UTC expiry (default: now + 15 min) */
  expiresAt: Date
  usedAt?: Date
  createdAt: Date
}

export const AUTH_TOKENS_COL = 'authtokens'

export async function ensureAuthTokenIndexes(db: Db) {
  const col = db.collection(AUTH_TOKENS_COL)
  await col.createIndex({ token: 1 }, { unique: true })
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export function authTokenCol(db: Db) {
  return db.collection<AuthToken>(AUTH_TOKENS_COL)
}

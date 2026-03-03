import { Db, ObjectId } from 'mongodb'

export interface User {
  _id?: ObjectId
  /** Email is the canonical username */
  email: string
  passwordHash: string
  createdAt: Date
  updatedAt: Date
}

export const USERS_COL = 'users'

export async function ensureUserIndexes(db: Db) {
  await db.collection(USERS_COL).createIndex({ email: 1 }, { unique: true })
}

export function userCol(db: Db) {
  return db.collection<User>(USERS_COL)
}

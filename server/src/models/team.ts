import { Db, ObjectId } from 'mongodb'

export interface TeamMember {
  userId: ObjectId
  role: 'owner' | 'editor' | 'viewer'
}

export interface Team {
  _id?: ObjectId
  name: string
  members: TeamMember[]
  createdAt: Date
  updatedAt: Date
}

export const TEAMS_COL = 'teams'

export async function ensureTeamIndexes(db: Db) {
  await db.collection(TEAMS_COL).createIndex({ 'members.userId': 1 })
}

export function teamCol(db: Db) {
  return db.collection<Team>(TEAMS_COL)
}

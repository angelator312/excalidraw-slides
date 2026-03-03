import { Db, ObjectId } from 'mongodb'

export interface Slide {
  _id?: ObjectId
  presentationId: ObjectId
  order: number
  /** Excalidraw JSON elements */
  elements: unknown[]
  /** Excalidraw appState */
  appState: Record<string, unknown>
  notes: string
  thumbnailId?: string
  createdAt: Date
  updatedAt: Date
}

export const SLIDES_COL = 'slides'

export async function ensureSlideIndexes(db: Db) {
  await db.collection(SLIDES_COL).createIndex({ presentationId: 1, order: 1 })
}

export function slideCol(db: Db) {
  return db.collection<Slide>(SLIDES_COL)
}

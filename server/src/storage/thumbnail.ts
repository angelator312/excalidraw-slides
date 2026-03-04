import { Db, GridFSBucket, ObjectId } from 'mongodb'

export async function storeThumbnail(db: Db, buffer: Buffer, filename = 'thumb.png') {
  const bucket = new GridFSBucket(db, { bucketName: 'thumbnails' })
  return new Promise<string>((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, { metadata: { createdAt: new Date() } })
    // Listen to stream events instead of using end(...callback) which has
    // a different callback signature in the GridFS types.
    upload.on('error', (err: Error) => {
      reject(err)
    })
    upload.on('finish', () => {
      // `upload.id` contains the file _id assigned by GridFS.
      // The type may be ObjectId; coerce to string for storage.
      resolve(String((upload as any).id))
    })
    upload.end(buffer)
  })
}

export async function getThumbnailStream(db: Db, id: string) {
  try {
    const bucket = new GridFSBucket(db, { bucketName: 'thumbnails' })
    const _id = new ObjectId(id)
    return bucket.openDownloadStream(_id)
  } catch (e) {
    return null
  }
}

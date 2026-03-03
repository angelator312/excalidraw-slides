import { Db, GridFSBucket, ObjectId } from 'mongodb'

export async function storeThumbnail(db: Db, buffer: Buffer, filename = 'thumb.png') {
  const bucket = new GridFSBucket(db, { bucketName: 'thumbnails' })
  return new Promise<string>((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, { metadata: { createdAt: new Date() } })
    upload.end(buffer, (err: Error | null, file) => {
      if (err) return reject(err)
      resolve(String(file._id))
    })
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

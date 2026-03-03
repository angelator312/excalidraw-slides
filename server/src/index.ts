import express from 'express'
import http from 'http'
import { Server as IOServer } from 'socket.io'
import { MongoClient } from 'mongodb'
import bodyParser from 'body-parser'
import { storeThumbnail, getThumbnailStream } from './storage/thumbnail'

const MONGO = process.env.MONGO_URI || 'mongodb://mongo:27017'
const DBNAME = process.env.DB_NAME || 'excalidraw_slides'

async function main() {
  const app = express()
  app.use(bodyParser.json({limit: '10mb'}))

  const server = http.createServer(app)
  const io = new IOServer(server, {cors: {origin: '*'}})

  const client = new MongoClient(MONGO)
  await client.connect()
  const db = client.db(DBNAME)

  app.get('/health', (_req, res) => res.json({ok: true}))

  app.post('/thumbnail', async (req, res) => {
    // expect { filename, data: base64 }
    try {
      const { filename, data } = req.body
      const buf = Buffer.from(data.split(',').pop() || data, 'base64')
      const id = await storeThumbnail(db, buf, filename)
      res.json({id})
    } catch (e) {
      res.status(500).json({error: String(e)})
    }
  })

  app.get('/thumbnail/:id', async (req, res) => {
    const id = req.params.id
    const stream = await getThumbnailStream(db, id)
    if (!stream) return res.status(404).end()
    stream.pipe(res)
  })

  io.on('connection', (socket) => {
    socket.on('join', (room) => socket.join(room))
    socket.on('cursor', (payload) => socket.to(payload.room).emit('cursor', payload))
    socket.on('diff', (payload) => socket.to(payload.room).emit('diff', payload))
  })

  const port = process.env.PORT || 3000
  server.listen(port, () => console.log('Server listening on', port))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

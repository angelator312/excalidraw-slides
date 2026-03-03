/**
 * Client-side RTC wrapper for the excalidraw-slides realtime protocol.
 *
 * Usage:
 *   const rtc = new RTCClient('http://localhost:3000')
 *   await rtc.joinRoom(presentationId, { token, name, color })
 *   rtc.on('presence', cb)
 *   rtc.on('diff', cb)
 *   rtc.sendPresence(x, y)
 *   rtc.sendDiff(slideId, patch)
 *   rtc.sendSlideChange(idx)
 *   rtc.requestSnapshot('v1')
 *   rtc.disconnect()
 */

import { io, Socket } from 'socket.io-client'

export type Peer = {
  socketId: string
  userId: string
  name: string
  color: string
}

export type PresencePayload = Peer & { x: number; y: number }

export type DiffPayload = {
  socketId: string
  userId: string
  slideId: string
  patch: unknown[]
}

export type SlideChangePayload = {
  socketId: string
  userId: string
  slideIndex: number
}

export type SnapshotSavedPayload = {
  snapshotId: string
  name: string
}

type RTCEvents = {
  joined: (payload: { presentationId: string; peers: Peer[] }) => void
  peerJoined: (peer: Peer) => void
  peerLeft: (payload: { socketId: string; userId: string }) => void
  presence: (payload: PresencePayload) => void
  diff: (payload: DiffPayload) => void
  slideChange: (payload: SlideChangePayload) => void
  'snapshot:saved': (payload: SnapshotSavedPayload) => void
  error: (payload: { message: string }) => void
  connect: () => void
  disconnect: (reason: string) => void
}

type Listener<T> = (payload: T) => void

export class RTCClient {
  private socket: Socket
  private smoothingBuffers = new Map<string, { x: number; y: number }>()
  private _listeners = new Map<string, Set<Function>>()

  constructor(serverUrl = '/') {
    this.socket = io(serverUrl, { autoConnect: false, transports: ['websocket'] })
    // relay all events
    const evts: Array<keyof RTCEvents> = [
      'joined', 'peerJoined', 'peerLeft', 'presence', 'diff',
      'slideChange', 'snapshot:saved', 'error', 'connect', 'disconnect',
    ]
    evts.forEach((ev) => {
      this.socket.on(ev as string, (p: any) => {
        if (ev === 'presence') {
          // Apply EMA smoothing to cursor positions
          const key = p.socketId
          const prev = this.smoothingBuffers.get(key) ?? p
          const α = 0.4
          const smoothed = { x: prev.x * (1 - α) + p.x * α, y: prev.y * (1 - α) + p.y * α }
          this.smoothingBuffers.set(key, smoothed)
          this._emit(ev, { ...p, ...smoothed })
        } else {
          this._emit(ev as string, p)
        }
      })
    })
  }

  connect() {
    this.socket.connect()
  }

  async joinRoom(
    presentationId: string,
    opts: { token?: string; shareToken?: string; name?: string; color?: string }
  ) {
    this.connect()
    return new Promise<{ presentationId: string; peers: Peer[] }>((resolve, reject) => {
      this.socket.once('joined', resolve)
      this.socket.once('error', (e) => reject(new Error(e.message)))
      this.socket.emit('joinRoom', { presentationId, ...opts })
    })
  }

  /** Broadcast cursor position (x/y in canvas coordinates) */
  sendPresence(x: number, y: number) {
    this.socket.emit('presence', { x, y })
  }

  /** Broadcast element-level diff patch for a slide */
  sendDiff(slideId: string, patch: unknown[]) {
    this.socket.emit('diff', { slideId, patch })
  }

  /** Broadcast active slide index change */
  sendSlideChange(slideIndex: number) {
    this.socket.emit('slideChange', { slideIndex })
  }

  /** Request the server to create a named snapshot */
  requestSnapshot(name?: string) {
    this.socket.emit('snapshot', { name })
  }

  on<K extends keyof RTCEvents>(event: K, listener: RTCEvents[K]) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event)!.add(listener as Function)
  }

  off<K extends keyof RTCEvents>(event: K, listener: RTCEvents[K]) {
    this._listeners.get(event)?.delete(listener as Function)
  }

  private _emit(event: string, payload: unknown) {
    this._listeners.get(event)?.forEach((fn) => fn(payload))
  }

  disconnect() {
    this.socket.disconnect()
  }
}

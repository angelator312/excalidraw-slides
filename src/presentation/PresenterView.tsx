/**
 * PresenterView — full-featured slide presenter with:
 *  - Slide canvas area + prev/next navigation
 *  - Realtime cursors from peers (smoothed via RTCClient)
 *  - Thumbnail sidebar (images loaded via /thumbnail/:id)
 *  - History panel toggle
 *  - Export to PNG
 */

import { h, Fragment } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { RTCClient, Peer, PresencePayload } from './rtc'
import HistoryPanel from './history'
import { exportElementToPNG, downloadPNG } from './export'

type SlideData = {
  _id: string
  order: number
  notes: string
  thumbnailId?: string
}

type Props = {
  presentationId?: string
  authToken?: string
  serverUrl?: string
}

const THROTTLE_MS = 50

export default function PresenterView({ presentationId = '', authToken = '', serverUrl = '/' }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [slides, setSlides] = useState<SlideData[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [cursors, setCursors] = useState<Map<string, PresencePayload>>(new Map())
  const [showHistory, setShowHistory] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const rtcRef = useRef<RTCClient | null>(null)
  const lastSentRef = useRef(0)

  // ── Load slides ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!presentationId || !authToken) return
    fetch(`/presentations/${presentationId}/slides`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((data: SlideData[]) => setSlides(data))
      .catch(console.error)
  }, [presentationId, authToken])

  // ── RTC setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!presentationId || !authToken) return
    const rtc = new RTCClient(serverUrl)
    rtcRef.current = rtc

    rtc.on('joined', ({ peers }) => setPeers(peers))
    rtc.on('peerJoined', (peer) => setPeers((ps) => [...ps, peer]))
    rtc.on('peerLeft', ({ socketId }) => {
      setPeers((ps) => ps.filter((p) => p.socketId !== socketId))
      setCursors((c) => { const m = new Map(c); m.delete(socketId); return m })
    })
    rtc.on('presence', (p) => setCursors((c) => new Map(c).set(p.socketId, p)))
    rtc.on('slideChange', ({ slideIndex }) => setCurrentIdx(slideIndex))

    rtc.joinRoom(presentationId, { token: authToken }).catch(console.error)

    return () => rtc.disconnect()
  }, [presentationId, authToken, serverUrl])

  // ── Pointer tracking ───────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const now = Date.now()
    if (now - lastSentRef.current < THROTTLE_MS) return
    lastSentRef.current = now
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    rtcRef.current?.sendPresence(x, y)
  }, [])

  // ── Navigation ─────────────────────────────────────────────────────────────
  function goPrev() {
    const idx = Math.max(0, currentIdx - 1)
    setCurrentIdx(idx)
    rtcRef.current?.sendSlideChange(idx)
  }

  function goNext() {
    const idx = Math.min(slides.length - 1, currentIdx + 1)
    setCurrentIdx(idx)
    rtcRef.current?.sendSlideChange(idx)
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!canvasRef.current) return
    const blob = await exportElementToPNG(canvasRef.current, 2)
    downloadPNG(blob, `slide-${currentIdx + 1}.png`)
  }

  const currentSlide = slides[currentIdx]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Thumbnail sidebar */}
      <nav
        aria-label="Slide thumbnails"
        style={{ width: '120px', overflowY: 'auto', borderRight: '1px solid #ddd', background: '#fafafa', padding: '8px' }}
      >
        {slides.map((s, i) => (
          <button
            key={s._id}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === currentIdx ? 'true' : undefined}
            onClick={() => { setCurrentIdx(i); rtcRef.current?.sendSlideChange(i) }}
            style={{
              display: 'block',
              width: '100%',
              marginBottom: '8px',
              padding: '4px',
              border: i === currentIdx ? '2px solid #007acc' : '2px solid transparent',
              borderRadius: '4px',
              cursor: 'pointer',
              background: 'white',
              textAlign: 'center',
            }}
          >
            {s.thumbnailId ? (
              <img
                src={`/thumbnail/${s.thumbnailId}`}
                alt={`Slide ${i + 1} thumbnail`}
                style={{ width: '100%', height: '60px', objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: '11px', color: '#999' }}>Slide {i + 1}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Main canvas area */}
      <section
        aria-label="Slide canvas"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        {/* Toolbar */}
        <div
          role="toolbar"
          aria-label="Presentation controls"
          style={{ display: 'flex', gap: '8px', padding: '8px', borderBottom: '1px solid #ddd', alignItems: 'center' }}
        >
          <button onClick={goPrev} aria-label="Previous slide" disabled={currentIdx === 0}>← Prev</button>
          <span aria-live="polite">{currentIdx + 1} / {slides.length || 1}</span>
          <button onClick={goNext} aria-label="Next slide" disabled={currentIdx >= slides.length - 1}>Next →</button>
          <button onClick={handleExport} aria-label="Export slide to PNG">Export PNG</button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
            aria-label="Toggle history panel"
          >
            History
          </button>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#666' }}>
            {peers.length} peer{peers.length !== 1 ? 's' : ''} connected
          </span>
        </div>

        {/* Canvas + peer cursors */}
        <div
          ref={canvasRef}
          onMouseMove={handleMouseMove as any}
          aria-label="Slide content"
          style={{ flex: 1, position: 'relative', background: '#fff', overflow: 'hidden' }}
        >
          <div style={{ padding: '40px', color: '#aaa', textAlign: 'center' }}>
            {currentSlide ? (
              <pre style={{ textAlign: 'left' }}>{JSON.stringify(currentSlide, null, 2)}</pre>
            ) : (
              <p>No slides loaded — create one via the API.</p>
            )}
          </div>

          {/* Peer cursors overlay */}
          {Array.from(cursors.values()).map((c) => (
            <div
              key={c.socketId}
              role="img"
              aria-label={`${c.name}'s cursor`}
              style={{
                position: 'absolute',
                left: `${c.x}%`,
                top: `${c.y}%`,
                pointerEvents: 'none',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill={c.color}>
                <path d="M0 0 L16 6 L8 8 L6 16 Z" />
              </svg>
              <span
                style={{
                  background: c.color,
                  color: '#fff',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  fontSize: '10px',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.name}
              </span>
            </div>
          ))}
        </div>

        {/* Speaker notes */}
        {currentSlide?.notes && (
          <footer
            aria-label="Speaker notes"
            style={{ padding: '8px', borderTop: '1px solid #ddd', fontSize: '13px', maxHeight: '100px', overflowY: 'auto' }}
          >
            <strong>Notes:</strong> {currentSlide.notes}
          </footer>
        )}
      </section>

      {/* History panel */}
      {showHistory && presentationId && authToken && (
        <HistoryPanel
          presentationId={presentationId}
          authToken={authToken}
          onRestored={() => {
            setShowHistory(false)
            fetch(`/presentations/${presentationId}/slides`, {
              headers: { Authorization: `Bearer ${authToken}` },
            })
              .then((r) => r.json())
              .then((data: SlideData[]) => { setSlides(data); setCurrentIdx(0) })
              .catch(console.error)
          }}
        />
      )}
    </div>
  )
}

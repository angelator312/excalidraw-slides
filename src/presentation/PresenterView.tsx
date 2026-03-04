import { h, Fragment } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'
import { RTCClient, Peer, PresencePayload } from './rtc'
import HistoryPanel from './history'
import { exportSlideToPNG, downloadPNG } from './export'
import { exportToCanvas } from '@excalidraw/excalidraw'

// ── Types ──────────────────────────────────────────────────────────────────────

type SlideState = {
  /** nanoid-style local id (also used as DB _id when synced) */
  id: string
  elements: readonly any[]
  appState: Record<string, any>
  notes: string
  /** data-URL of 4:3 thumbnail generated on slide-leave */
  thumb?: string
}

type Props = {
  /** If omitted the app works fully in localStorage-only demo mode */
  presentationId?: string
  authToken?: string
  serverUrl?: string
}

const LS_KEY = 'excalidraw-slides-demo'
const THROTTLE_MS = 50

function newSlide(): SlideState {
  return {
    id: Math.random().toString(36).slice(2),
    elements: [],
    appState: {},
    notes: '',
  }
}

function loadLocal(): SlideState[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return [newSlide()]

    // Guard against huge/malformed payloads that can block the main thread:
    // - refuse payloads that are unreasonably large
    // - ensure parsed value is an array and cap its length
    if (raw.length > 200_000) {
      console.warn('[client] loadLocal: stored data too large, ignoring')
      return [newSlide()]
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      console.warn('[client] loadLocal: stored data not an array, ignoring')
      return [newSlide()]
    }

    // Limit slides count to a safe upper bound to avoid huge in-memory arrays
    const safe = (parsed as SlideState[]).slice(0, 200)
    return safe.length ? safe : [newSlide()]
  } catch (e) {
    console.error('[client] loadLocal parse error', e)
  }
  return [newSlide()]
}

let __saveLocalTimer: ReturnType<typeof setTimeout> | null = null
function saveLocal(slides: SlideState[]) {
  try {
    // Debounce writes to avoid frequent JSON serialization on the main thread.
    if (__saveLocalTimer) clearTimeout(__saveLocalTimer)
    __saveLocalTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(slides))
      } catch (e) {
        console.error('[client] saveLocal error', e)
      } finally {
        __saveLocalTimer = null
      }
    }, 150)
  } catch (e) {
    console.error('[client] saveLocal scheduling error', e)
  }
}

// ── Thumbnail helper ──────────────────────────────────────────────────────────

async function makeThumb(elements: readonly any[], appState: Record<string, any>): Promise<string | undefined> {
  // Disabled: generating thumbnails with exportToCanvas is CPU-intensive and
  // can block the main thread. Return quickly during debugging. If you want
  // thumbnails re-enabled later, generate them off the main thread or remove
  // this short-circuit.
  console.debug('[client][thumb] generation disabled for responsiveness')
  return undefined
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PresenterView({ presentationId = '', authToken = '', serverUrl = '/' }: Props) {
  /* mount log moved to a useEffect so it runs once (prevents spamming on each render) */

  const [slides, setSlides] = useState<SlideState[]>(loadLocal)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [peers, setPeers] = useState<Peer[]>([])
  const [cursors, setCursors] = useState<Map<string, PresencePayload>>(new Map())
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast] = useState('')
  const [isSwitching, setIsSwitching] = useState(false)

  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const rtcRef = useRef<RTCClient | null>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const lastSentRef = useRef(0)
  // Throttle timestamp for sending diffs to the server (in ms)
  const lastDiffSentRef = useRef<number>(0)
  // Keep latest incoming elements to debounce UI updates and avoid frequent re-renders
  const latestElementsRef = useRef<readonly any[] | null>(null)
  const setSlidesTimerRef = useRef<number | null>(null)
  const SLIDES_UPDATE_DEBOUNCE = 150
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Run once on mount to log diagnostic information without spamming on every render
    console.log('[client] PresenterView mount', { presentationId: !!presentationId, serverUrl, pid: process?.pid || null })
  }, [])

  // ── Toast helper ─────────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }

  // ── Persist local on every slide change ──────────────────────────────────────
  useEffect(() => { saveLocal(slides) }, [slides])

  // ── Load slides from API (when connected) ──────────────────────────────────
  useEffect(() => {
    if (!presentationId || !authToken) return
    console.log('[client] fetching slides', { presentationId })
    fetch(`/presentations/${presentationId}/slides`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => {
        console.log('[client] slides fetch status', r.status)
        return r.json()
      })
      .then((data: any[]) => {
        console.log('[client] slides fetched', { presentationId, count: Array.isArray(data) ? data.length : 0 })
        if (!Array.isArray(data) || !data.length) return
        const loaded: SlideState[] = data.map((s) => ({
          id: s._id,
          elements: s.elements ?? [],
          appState: s.appState ?? {},
          notes: s.notes ?? '',
        }))
        setSlides(loaded)
        setCurrentIdx(0)
      })
      .catch((err) => {
        console.error('[client] slides fetch error', err)
      })
  }, [presentationId, authToken])

  // ── RTC ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!presentationId || !authToken) return
    console.log('[client][rtc] init', { presentationId, serverUrl })
    const rtc = new RTCClient(serverUrl)
    rtcRef.current = rtc

    rtc.on('joined', ({ peers }) => {
      console.log('[client][rtc] joined', { peersCount: peers.length })
      setPeers(peers)
    })
    rtc.on('peerJoined', (peer) => {
      console.log('[client][rtc] peerJoined', peer)
      setPeers((ps) => [...ps, peer])
    })
    rtc.on('peerLeft', ({ socketId }) => {
      console.log('[client][rtc] peerLeft', socketId)
      setPeers((ps) => ps.filter((p) => p.socketId !== socketId))
      setCursors((c) => { const m = new Map(c); m.delete(socketId); return m })
    })
    rtc.on('presence', (p) => {
      // small debug: show presence events in console
      // Do not spam when high-frequency; only log occasional samples
      if (Math.random() < 0.02) console.log('[client][rtc] presence sample', p)
      setCursors((c) => new Map(c).set(p.socketId, p))
    })
    rtc.on('diff', ({ slideId, patch }) => {
      console.log('[client][rtc] diff', { slideId, patchLen: Array.isArray(patch) ? patch.length : 'unknown' })
      setSlides((prev) => prev.map((s) => s.id === slideId ? { ...s, elements: patch as any[] } : s))
    })
    rtc.on('slideChange', ({ slideIndex }) => {
      console.log('[client][rtc] slideChange', slideIndex)
      switchTo(slideIndex, false)
    })

    rtc.joinRoom(presentationId, { token: authToken, name: 'Me' })
      .then(() => console.log('[client][rtc] joinRoom resolved'))
      .catch((err) => console.error('[client][rtc] joinRoom error', err))

    return () => {
      try { rtc.disconnect() } catch (e) { console.error('[client][rtc] disconnect err', e) }
    }
  }, [presentationId, authToken, serverUrl])

  // ── Throttled pointer broadcast ───────────────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const now = Date.now()
    if (now - lastSentRef.current < THROTTLE_MS) return
    lastSentRef.current = now
    const rect = canvasAreaRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    rtcRef.current?.sendPresence(x, y)
  }, [])

  // ── Save current slide state then switch ─────────────────────────────────────
  async function switchTo(idx: number, broadcast = true) {
    if (idx === currentIdx || isSwitching) return
    setIsSwitching(true)

    // Snapshot current slide state from Excalidraw API
    const api = excalidrawApiRef.current
    if (api) {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const thumb = await makeThumb(elements, appState)
      setSlides((prev) =>
        prev.map((s, i) => i === currentIdx ? { ...s, elements, appState, thumb } : s)
      )
    }

    setCurrentIdx(idx)
    if (broadcast) rtcRef.current?.sendSlideChange(idx)
    setIsSwitching(false)
  }

  // ── Load new slide into Excalidraw when currentIdx changes ───────────────────
  useEffect(() => {
    const api = excalidrawApiRef.current
    const slide = slides[currentIdx]
    if (!api || !slide) return
    api.updateScene({
      elements: slide.elements as any[],
      appState: { ...slide.appState, collaborators: new Map() } as any,
    })
    api.scrollToContent(slide.elements as any[], { fitToContent: true })
  }, [currentIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Excalidraw onChange — broadcast diff, update local state ─────────────────
  const handleChange = useCallback((elements: readonly any[], _appState: any) => {
    const slide = slides[currentIdx]
    if (!slide) return
    // Keep latest elements in a ref and debounce UI updates to avoid frequent re-renders
    latestElementsRef.current = elements
    if (setSlidesTimerRef.current) {
      clearTimeout(setSlidesTimerRef.current)
    }
    setSlidesTimerRef.current = window.setTimeout(() => {
      const latest = latestElementsRef.current ?? elements
      setSlides((prev) => prev.map((s, i) => i === currentIdx ? { ...s, elements: latest } : s))
      setSlidesTimerRef.current = null
    }, SLIDES_UPDATE_DEBOUNCE)

    // Throttle broadcast diffs to avoid tight update loop (max once per 200ms)
    try {
      const now = Date.now()
      if (now - lastDiffSentRef.current > 200) {
        lastDiffSentRef.current = now
        rtcRef.current?.sendDiff(slide.id, elements as any[])
      }
    } catch (e) {
      console.error('[client][rtc] sendDiff err', e)
    }
  }, [currentIdx])

  // ── Add slide ─────────────────────────────────────────────────────────────────
  async function addSlide() {
    // First persist current slide state
    const api = excalidrawApiRef.current
    let updated = slides
    if (api) {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const thumb = await makeThumb(elements, appState)
      updated = slides.map((s, i) => i === currentIdx ? { ...s, elements, appState, thumb } : s)
    }
    const fresh = newSlide()
    const next = [...updated, fresh]
    setSlides(next)
    const newIdx = next.length - 1
    setCurrentIdx(newIdx)

    // When server-connected create the slide there too
    if (presentationId && authToken) {
      fetch(`/presentations/${presentationId}/slides`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: [], appState: {}, notes: '' }),
      }).catch(console.error)
    }
  }

  // ── Delete current slide ──────────────────────────────────────────────────────
  async function deleteSlide() {
    if (slides.length <= 1) { showToast('Cannot delete the last slide'); return }
    if (!confirm(`Delete slide ${currentIdx + 1}?`)) return
    const removed = slides[currentIdx]
    const next = slides.filter((_, i) => i !== currentIdx)
    const nextIdx = Math.min(currentIdx, next.length - 1)
    setSlides(next)
    setCurrentIdx(nextIdx)

    if (presentationId && authToken && removed.id) {
      fetch(`/presentations/${presentationId}/slides/${removed.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(console.error)
    }
  }

  // ── Export current slide as PNG ───────────────────────────────────────────────
  async function handleExport() {
    const slide = slides[currentIdx]
    if (!slide) return
    const api = excalidrawApiRef.current
    const elements = api ? api.getSceneElements() : slide.elements
    const appState = api ? api.getAppState() : slide.appState
    try {
      const blob = await exportSlideToPNG({ elements, appState, files: {} })
      downloadPNG(blob, `slide-${currentIdx + 1}.png`)
      showToast('Exported!')
    } catch (e) {
      showToast('Export failed')
    }
  }

  // ── Update notes for current slide ───────────────────────────────────────────
  function handleNotesChange(val: string) {
    setSlides((prev) => prev.map((s, i) => i === currentIdx ? { ...s, notes: val } : s))
  }

  const currentSlide = slides[currentIdx]

  return (
    <div class="slides-app">
      {/* ── Sidebar: slide thumbnails ── */}
      <aside class="slides-sidebar">
        <div class="sidebar-header">
          <span class="sidebar-logo-icon">▶</span>
          Slides
        </div>

        <div class="slide-list" role="listbox" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={s.id}
              role="option"
              aria-selected={i === currentIdx}
              aria-label={`Slide ${i + 1}`}
              class={`slide-thumb-btn${i === currentIdx ? ' active' : ''}`}
              onClick={() => switchTo(i)}
            >
              {s.thumb
                ? <img src={s.thumb} alt={`Slide ${i + 1}`} />
                : <div class="slide-thumb-placeholder">✦</div>
              }
              <span class="slide-thumb-num">{i + 1}</span>
            </button>
          ))}
        </div>

        <div class="sidebar-footer">
          <button class="btn-add-slide" onClick={addSlide} aria-label="Add slide">
            <span>+</span> Add slide
          </button>
        </div>
      </aside>

      {/* ── Main panel ── */}
      <div class="slides-main">
        {/* Toolbar */}
        <div class="slide-toolbar" role="toolbar" aria-label="Presentation controls">
          <button
            class="icon-btn"
            onClick={() => switchTo(Math.max(0, currentIdx - 1))}
            disabled={currentIdx === 0}
            aria-label="Previous slide"
            title="Previous (←)"
          >
            ←
          </button>
          <span class="slide-counter" aria-live="polite">
            {currentIdx + 1} / {slides.length}
          </span>
          <button
            class="icon-btn"
            onClick={() => switchTo(Math.min(slides.length - 1, currentIdx + 1))}
            disabled={currentIdx >= slides.length - 1}
            aria-label="Next slide"
            title="Next (→)"
          >
            →
          </button>

          <span class="toolbar-divider" />

          <button class="icon-btn" onClick={addSlide} aria-label="Add slide" title="Add slide">
            + Slide
          </button>
          <button class="icon-btn danger" onClick={deleteSlide} aria-label="Delete slide" title="Delete current slide">
            🗑
          </button>

          <span class="toolbar-divider" />

          <button class="icon-btn" onClick={handleExport} aria-label="Export PNG" title="Export as PNG">
            ↓ PNG
          </button>

          <span class="toolbar-spacer" />

          {peers.length > 0 && (
            <span class="peers-badge" aria-label={`${peers.length} peer(s) connected`}>
              <span class="peer-dot" />
              {peers.length} live
            </span>
          )}

          <span class="toolbar-divider" />

          <button
            class={`icon-btn${showHistory ? ' primary' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            aria-pressed={showHistory}
            aria-label="Toggle history"
            title="History & snapshots"
          >
            History
          </button>
        </div>

        {/* Canvas */}
        <div
          class="canvas-area"
          ref={canvasAreaRef}
          onMouseMove={handleMouseMove as any}
        >
          {!isSwitching && (
            <Excalidraw
              excalidrawAPI={(api: ExcalidrawImperativeAPI) => { excalidrawApiRef.current = api }}
              initialData={{
                elements: (currentSlide?.elements ?? []) as any[],
                appState: { ...currentSlide?.appState, collaborators: new Map() } as any,
              }}
              onChange={handleChange}
              UIOptions={{
                canvasActions: {
                  saveToActiveFile: false,
                  loadScene: false,
                  saveAsImage: false,
                  export: false,
                },
              }}
            />
          )}

          {/* Peer cursors overlay */}
          {Array.from(cursors.values()).map((c) => (
            <div
              key={c.socketId}
              class="peer-cursor"
              style={{ left: `${c.x}%`, top: `${c.y}%`, '--cursor-color': c.color } as any}
              aria-hidden="true"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill={c.color} xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0 L16 6 L8 8 L6 16 Z" />
              </svg>
              <span class="peer-cursor-label">{c.name}</span>
            </div>
          ))}
        </div>

        {/* Notes bar */}
        <div class="notes-bar">
          <span class="notes-label">Notes</span>
          <textarea
            class="notes-input"
            placeholder="Speaker notes for this slide…"
            value={currentSlide?.notes ?? ''}
            onInput={(e) => handleNotesChange((e.target as HTMLTextAreaElement).value)}
            aria-label="Speaker notes"
          />
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <HistoryPanel
          presentationId={presentationId}
          authToken={authToken}
          onClose={() => setShowHistory(false)}
          // ↑ prop exists — lang-server may need reload
          onRestored={() => {
            setShowHistory(false)
            if (!presentationId || !authToken) return
            fetch(`/presentations/${presentationId}/slides`, {
              headers: { Authorization: `Bearer ${authToken}` },
            })
              .then((r) => r.json())
              .then((data: any[]) => {
                const loaded: SlideState[] = data.map((s) => ({
                  id: s._id, elements: s.elements ?? [], appState: s.appState ?? {}, notes: s.notes ?? '',
                }))
                setSlides(loaded)
                setCurrentIdx(0)
              })
              .catch(console.error)
          }}
        />
      )}

      {/* Toast */}
      {toast && <div class="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

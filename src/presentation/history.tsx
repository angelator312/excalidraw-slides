/**
 * History & Snapshots panel
 *
 * Shows:
 *   - Auto-history versions (last N=50, from GET /presentations/:id/history)
 *   - Named snapshots (from GET /presentations/:id/snapshots)
 *
 * Allows:
 *   - Creating a named snapshot
 *   - Restoring a snapshot
 */

import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'

export type VersionEntry = {
  _id: string
  slideId: string
  authorId: string
  createdAt: string
}

export type SnapshotEntry = {
  _id: string
  name: string
  authorId: string
  createdAt: string
}

type Props = {
  presentationId: string
  authToken: string
  onRestored?: () => void
  onClose?: () => void
}

async function apiFetch<T>(url: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export default function HistoryPanel({ presentationId, authToken, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([])
  const [newSnapshotName, setNewSnapshotName] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  async function load() {
    if (!presentationId || !authToken) return
    setLoading(true)
    try {
      const [v, s] = await Promise.all([
        apiFetch<VersionEntry[]>(`/presentations/${presentationId}/history`, authToken),
        apiFetch<SnapshotEntry[]>(`/presentations/${presentationId}/snapshots`, authToken),
      ])
      setVersions(v)
      setSnapshots(s)
    } catch {
      setStatus('Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [presentationId])

  async function createSnapshot() {
    if (!newSnapshotName.trim()) return
    try {
      await apiFetch(`/presentations/${presentationId}/snapshots`, authToken, {
        method: 'POST',
        body: JSON.stringify({ name: newSnapshotName.trim() }),
      })
      setNewSnapshotName('')
      setStatus('Snapshot saved!')
      load()
    } catch {
      setStatus('Failed to save snapshot')
    }
  }

  async function restoreSnapshot(snapshotId: string) {
    if (!confirm('Restore this snapshot? Current slides will be replaced.')) return
    try {
      await apiFetch(
        `/presentations/${presentationId}/snapshots/${snapshotId}/restore`,
        authToken,
        { method: 'POST' }
      )
      setStatus('Restored!')
      onRestored?.()
    } catch {
      setStatus('Restore failed')
    }
  }

  return (
    <aside class="history-panel" aria-label="Version history">
      <div class="history-panel-header">
        <span>History</span>
        {onClose && (
          <button class="icon-btn" onClick={onClose} aria-label="Close history panel">✕</button>
        )}
      </div>

      <div class="history-panel-body">
        {/* Snapshot create */}
        {presentationId && authToken ? (
          <section>
            <p class="history-section-title">Save snapshot</p>
            <div class="snap-create-row">
              <input
                class="snap-input"
                type="text"
                aria-label="Snapshot name"
                placeholder="Name…"
                value={newSnapshotName}
                onInput={(e) => setNewSnapshotName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && createSnapshot()}
              />
              <button class="icon-btn primary" onClick={createSnapshot} disabled={!newSnapshotName.trim()}>
                Save
              </button>
            </div>
            {status && <p aria-live="polite" style={{ color: 'var(--color-primary)', fontSize: '11px' }}>{status}</p>}
          </section>
        ) : (
          <p style={{ fontSize: '11px', color: 'var(--color-muted)' }}>
            Connect to a server to save named snapshots.
          </p>
        )}

        {/* Named snapshots */}
        <section>
          <p class="history-section-title">Snapshots</p>
          {loading && <p style={{ fontSize: '11px', color: 'var(--color-muted)' }}>Loading…</p>}
          {!loading && snapshots.length === 0 && (
            <p style={{ fontSize: '11px', color: 'var(--color-muted)' }}>No snapshots yet.</p>
          )}
          {snapshots.map((s) => (
            <div key={s._id} class="snap-item">
              <span class="snap-item-name">{s.name}</span>
              <span class="snap-item-date">{new Date(s.createdAt).toLocaleString()}</span>
              <button
                class="icon-btn snap-restore"
                onClick={() => restoreSnapshot(s._id)}
                aria-label={`Restore snapshot ${s.name}`}
              >
                ↩ Restore
              </button>
            </div>
          ))}
        </section>

        {/* Auto-history */}
        <section>
          <p class="history-section-title">Auto-history ({versions.length})</p>
          {versions.length === 0 && !loading && (
            <p style={{ fontSize: '11px', color: 'var(--color-muted)' }}>No auto-history yet.</p>
          )}
          {versions.map((v) => (
            <div key={v._id} style={{ fontSize: '11px', color: 'var(--color-muted)', padding: '3px 0', borderBottom: '1px solid var(--color-border)' }}>
              Slide …{v.slideId.slice(-5)} — {new Date(v.createdAt).toLocaleTimeString()}
            </div>
          ))}
        </section>
      </div>
    </aside>
  )
}

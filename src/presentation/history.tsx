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
}

async function apiFetch<T>(url: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export default function HistoryPanel({ presentationId, authToken, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([])
  const [newSnapshotName, setNewSnapshotName] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [v, s] = await Promise.all([
        apiFetch<VersionEntry[]>(`/presentations/${presentationId}/history`, authToken),
        apiFetch<SnapshotEntry[]>(`/presentations/${presentationId}/snapshots`, authToken),
      ])
      setVersions(v)
      setSnapshots(s)
    } catch (e) {
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
    <aside aria-label="Version history" style={{ width: '280px', padding: '12px', borderLeft: '1px solid #ddd', overflowY: 'auto' }}>
      <h3>History</h3>

      {/* Create snapshot */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        <input
          type="text"
          aria-label="Snapshot name"
          placeholder="Snapshot name…"
          value={newSnapshotName}
          onInput={(e) => setNewSnapshotName((e.target as HTMLInputElement).value)}
          style={{ flex: 1, padding: '4px' }}
        />
        <button onClick={createSnapshot} disabled={!newSnapshotName.trim()}>Save</button>
      </div>
      {status && <p aria-live="polite" style={{ color: 'green', margin: 0 }}>{status}</p>}

      {/* Named snapshots */}
      <section aria-label="Named snapshots">
        <h4 style={{ marginBottom: '4px' }}>Snapshots</h4>
        {snapshots.length === 0 && !loading && <p style={{ color: '#999', fontSize: '12px' }}>No snapshots yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {snapshots.map((s) => (
            <li key={s._id} style={{ marginBottom: '8px', padding: '6px', background: '#f9f9f9', borderRadius: '4px' }}>
              <strong>{s.name}</strong>
              <br />
              <small>{new Date(s.createdAt).toLocaleString()}</small>
              <br />
              <button
                style={{ marginTop: '4px', fontSize: '11px' }}
                onClick={() => restoreSnapshot(s._id)}
                aria-label={`Restore snapshot ${s.name}`}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Auto-history */}
      <section aria-label="Auto history">
        <h4 style={{ marginBottom: '4px' }}>Auto-history (last {versions.length})</h4>
        {loading && <p>Loading…</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {versions.map((v) => (
            <li key={v._id} style={{ marginBottom: '4px', fontSize: '12px', color: '#555' }}>
              Slide {v.slideId.slice(-6)} — {new Date(v.createdAt).toLocaleTimeString()}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

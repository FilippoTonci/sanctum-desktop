import { type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import type { Detection, DetectionStatus } from '../review/types'

const STATUS_LABEL: Record<DetectionStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

export function DetectionSidebar(): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const setFocused = useReviewStore((s) => s.setFocused)

  const counts = aggregate(detections)

  return (
    <aside className="detection-sidebar" aria-label="Detection list">
      <header className="sidebar-header">
        <h2>Detections</h2>
        <p className="sidebar-counts">
          <span>{String(counts.pending)} pending</span>
          {' · '}
          <span>{String(counts.accepted)} accepted</span>
          {' · '}
          <span>{String(counts.rejected)} rejected</span>
        </p>
      </header>
      {detections.length === 0 ? (
        <p className="sidebar-empty">No detections yet.</p>
      ) : (
        <ul className="sidebar-list">
          {detections.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={`sidebar-item sidebar-item-${d.status}${
                  d.id === focusedId ? ' sidebar-item-focused' : ''
                }`}
                onClick={() => {
                  setFocused(d.id)
                }}
                aria-pressed={d.id === focusedId}
              >
                <span className="sidebar-item-text">{d.text}</span>
                <span className="sidebar-item-meta">
                  <span className="sidebar-item-entity">{d.entityType}</span>
                  <span className={`sidebar-item-status sidebar-item-status-${d.status}`}>
                    {STATUS_LABEL[d.status]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

function aggregate(detections: readonly Detection[]): Record<DetectionStatus, number> {
  const out: Record<DetectionStatus, number> = { pending: 0, accepted: 0, rejected: 0 }
  for (const d of detections) out[d.status]++
  return out
}

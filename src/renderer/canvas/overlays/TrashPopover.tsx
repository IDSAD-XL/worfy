// The Trash button at the bottom centre of the Canvas and its popover (ticket 30): what was deleted
// from this Project's Canvas in the last three days, newest first, each with Restore. The entries
// live in main (src/main/layout/trash.ts); this asks for them when it mounts and again whenever
// main reports a change of the Project's trash.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from '@xyflow/react'
import type { TrashEntry } from '../../../shared/ipc/trash'
import { invoke, subscribe } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import './trash.css'

export const order = 30

const KIND_NAMES: Readonly<Record<string, string>> = { card: 'Card', note: 'Note', terminal: 'Terminal', session: 'Session' }

function ago(time: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - time) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/** The Project's trash, kept current by `trash.changed`. */
function useTrash(projectId: string | undefined): { entries: readonly TrashEntry[]; reload: () => void } {
  const [state, setState] = useState<{ projectId: string; entries: readonly TrashEntry[] }>()
  const reload = useCallback(() => {
    if (projectId === undefined) return
    void invoke('trash.list', { projectId }).then((result) => {
      if (result.ok) setState({ projectId, entries: result.value.entries })
      else console.error('trash.list failed:', result.error)
    })
  }, [projectId])
  useEffect(() => {
    reload()
    if (projectId === undefined) return
    try {
      return subscribe('trash.changed', (change) => {
        if (change.projectId === projectId) reload()
      })
    } catch (error) {
      console.error('trash.changed: cannot subscribe', error)
      return undefined
    }
  }, [projectId, reload])
  return { entries: state !== undefined && state.projectId === projectId ? state.entries : [], reload }
}

export default function TrashPopover() {
  const projectId = activeProject(useProjects())?.id
  const { entries } = useTrash(projectId)
  const [open, setOpen] = useState(false)
  /** The time the popover was opened at: the entries' ages are counted from it. */
  const [openedAt, setOpenedAt] = useState(0)
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement>(null)

  // A click elsewhere or Escape closes it.
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // The press that closes the popover does nothing else (the Esc of an active Node, of Focus mode).
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  if (projectId === undefined) return null

  const restore = (label: string) => {
    setError(undefined)
    void invoke('trash.restore', { projectId, label }).then((result) => {
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <Panel position="bottom-center" className="w-trash nodrag nopan nowheel">
      <div ref={root} className="w-trash__root">
        {open ? (
          <div className="w-trash__popover" role="dialog" aria-label="Trash" data-testid="trash-popover">
            <div className="w-trash__heading">Trash</div>
            {entries.length === 0 ? <div className="w-trash__empty">Nothing deleted in the last 3 days</div> : null}
            <ul className="w-trash__list">
              {entries.map((entry) => (
                <li key={entry.label} className="w-trash__entry" data-testid="trash-entry" data-node-id={entry.nodeId}>
                  <span className="w-trash__kind">{KIND_NAMES[entry.kind] ?? entry.kind}</span>
                  <span className="w-trash__title" title={entry.title ?? entry.nodeId}>
                    {entry.title ?? entry.nodeId}
                  </span>
                  <span className="w-trash__time">{ago(entry.trashedAt, openedAt)}</span>
                  <button type="button" className="w-trash__restore" onClick={() => restore(entry.label)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
            {error !== undefined ? (
              <div className="w-trash__error" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="w-trash__button"
          aria-expanded={open}
          title="Deleted Nodes of the last 3 days"
          onClick={() => {
            setError(undefined)
            setOpenedAt(Date.now())
            setOpen((value) => !value)
          }}
        >
          Trash{entries.length > 0 ? <span className="w-trash__count">{entries.length}</span> : null}
        </button>
      </div>
    </Panel>
  )
}

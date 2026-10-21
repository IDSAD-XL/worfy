import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ADR_DIR, type AdrEntry } from '../../../shared/ipc/docs'
import { useDocs, useDocText } from '../../docs/useDocs'
import { markAdrHandled, useCanvasRequests } from '../../find/canvas-requests'
import { invoke } from '../../ipc'
import { useFileElsewhere } from '../../machines/useFileElsewhere'
import { Markdown } from '../../markdown/Markdown'
import { activeProject, useProjects } from '../../projects/useProjects'
import { SidebarSection } from '../SidebarSection'

/** The ADRs of the active Project (docs/adr/NNNN-*.md), after its Epics (design F). */
export const order = 40

const styles = {
  count: { fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--text-muted)', overflowWrap: 'anywhere' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    height: 'var(--row-height)',
    padding: '0 8px',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-13)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  number: { flex: 'none', fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  status: { flex: 'none', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  panel: {
    position: 'fixed',
    top: 'calc(var(--toolbar-height) + var(--space-3))',
    right: 'var(--space-3)',
    bottom: 'var(--space-3)',
    width: 'min(680px, calc(100vw - var(--sidebar-width) - 2 * var(--space-3)))',
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-popover)',
    boxShadow: 'var(--shadow-node)',
    overflow: 'hidden',
  },
  panelHeader: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    minHeight: 40,
    padding: '0 var(--space-2) 0 var(--space-3)',
    background: 'var(--surface-raised)',
    borderBottom: '1px solid var(--border)',
  },
  panelTitle: { flex: 1, minWidth: 0, margin: 0, fontSize: 'var(--text-15)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  panelStatus: {
    flex: 'none',
    padding: '1px 6px',
    borderRadius: 'var(--radius-chip)',
    background: 'var(--done-bg)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-12)',
  },
  button: {
    flex: 'none',
    height: 24,
    padding: '0 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--surface)',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    cursor: 'pointer',
  },
  panelBody: { flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-13)', userSelect: 'text' },
} satisfies Record<string, CSSProperties>

interface AdrPanelProps {
  projectId: string
  adr: AdrEntry
  onClose: () => void
}

/** One ADR, read-only, over the Canvas; Esc or Close closes it. */
function AdrPanel({ projectId, adr, onClose }: AdrPanelProps) {
  const { text, error } = useDocText(projectId, adr.path, adr.version)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const file = useFileElsewhere()

  const openInEditor = () => {
    // In a window on a Linked machine the ADR file lies there: the toast instead of its editor.
    if (file.elsewhere) {
      file.show()
      return
    }
    void invoke('shell.openInEditor', { projectId, path: adr.path }).then((result) => {
      if (!result.ok) console.error('shell.openInEditor failed:', result.error)
    })
  }

  return createPortal(
    // A toast may go over the text of the ADR, never over its header with the buttons (toast/ToastRegion.tsx).
    <section role="dialog" aria-label={`ADR ${adr.number}`} style={styles.panel} data-testid="adr-panel" data-path={adr.path} data-toast-over="">
      <header style={styles.panelHeader} data-toast-keep-out="">
        <span className="w-mono" style={styles.number}>
          {adr.number}
        </span>
        <h2 style={styles.panelTitle} title={adr.title}>
          {adr.title}
        </h2>
        {adr.status !== null ? <span style={styles.panelStatus}>{adr.status}</span> : null}
        <button type="button" style={styles.button} onClick={openInEditor} title={adr.path}>
          Open in Editor
        </button>
        <button type="button" style={styles.button} onClick={onClose} aria-label="Close" title="Close (Esc)">
          Close
        </button>
      </header>
      <div style={styles.panelBody} data-testid="adr-panel-body">
        {text !== undefined ? (
          <Markdown text={text} projectId={projectId} baseDir={ADR_DIR} />
        ) : error !== undefined ? (
          <p style={styles.message}>The ADR could not be read: {error}</p>
        ) : null}
      </div>
    </section>,
    document.body,
  )
}

export default function AdrSection() {
  const project = activeProject(useProjects())
  const { state, error } = useDocs(project?.id)
  const [open, setOpen] = useState<{ projectId: string; path: string } | null>(null)
  // "Go to" an ADR in the command palette (ticket 31) opens it here, as a click on its row does.
  // A request not carried out yet; one made before the Projects are read waits for them, and one
  // for another Project is dropped.
  const request = useCanvasRequests((state) => (state.adr !== null && state.adr.seq > state.adrHandled ? state.adr : null))
  const pending = project !== undefined ? request : null
  const [taken, setTaken] = useState(0)
  if (pending !== null && pending.seq !== taken) {
    setTaken(pending.seq)
    if (pending.projectId === project?.id) setOpen({ projectId: pending.projectId, path: pending.path })
  }
  useEffect(() => {
    // Carried out: a sidebar shown again later must not open it a second time.
    if (pending !== null) markAdrHandled(pending.seq)
  }, [pending])
  if (!project) return null

  const adrs = state?.adrs ?? []
  // A panel of another Project, or of an ADR that is gone, is not shown.
  const openAdr = open?.projectId === project.id ? adrs.find((adr) => adr.path === open.path) : undefined

  let body
  if (error !== undefined) body = <p style={styles.message}>The ADRs could not be read: {error}</p>
  else if (state === undefined) body = null
  else if (!adrs.length) body = <p style={styles.message}>No ADRs in {ADR_DIR}/</p>
  else
    body = (
      <ul style={styles.list}>
        {adrs.map((adr) => (
          <li key={adr.path}>
            <button
              type="button"
              className="w-row"
              style={styles.row}
              data-testid="sidebar-adr"
              data-path={adr.path}
              title={adr.status === null ? adr.title : `${adr.title} — ${adr.status}`}
              aria-current={openAdr?.path === adr.path ? 'true' : undefined}
              onClick={() => setOpen({ projectId: project.id, path: adr.path })}
            >
              <span className="w-mono" style={styles.number}>
                {adr.number}
              </span>
              <span style={styles.title}>{adr.title}</span>
              {adr.status !== null ? <span style={styles.status}>{adr.status}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    )

  return (
    <SidebarSection
      id="AdrSection"
      title="ADR"
      trailing={
        state !== undefined ? (
          <span className="w-mono" style={styles.count} data-testid="adr-count">
            {adrs.length}
          </span>
        ) : null
      }
      overlay={openAdr !== undefined ? <AdrPanel projectId={project.id} adr={openAdr} onClose={() => setOpen(null)} /> : null}
    >
      {body}
    </SidebarSection>
  )
}

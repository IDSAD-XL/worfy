import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ADR_DIR, type AdrEntry } from '../../../shared/ipc/docs'
import type { ProjectView } from '../../../shared/ipc/projects'
import { useDocs, useDocText } from '../../docs/useDocs'
import { markAdrHandled, openAdr, useCanvasRequests } from '../../find/canvas-requests'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { useFileElsewhere } from '../../machines/useFileElsewhere'
import { Markdown } from '../../markdown/Markdown'
import { activeProject, openProject, useProjects } from '../../projects/useProjects'
import { showRevealed } from '../../toast/revealed'
import { projectsInScope, showSidebarSection, useSidebarScope } from '../sidebar-scope'
import { NoProjectSection, SidebarSection } from '../SidebarSection'

/**
 * The ADRs (docs/adr/NNNN-*.md) of the Projects the Project switcher shows (worfy-polish ticket 99,
 * sidebar-scope.ts), after the Epics (design F): the open Project's, kept current by its watcher in main
 * (`docs.open`, docs/useDocs.ts), or — under «All» with more than one Project — the open Project's first
 * and then those of every other Project of the window's Machine that has ADRs, each under its name. The
 * other Projects' ADRs are read once (`docs.adrs`, no watcher) each time the section comes into the panel.
 * A click on an ADR of another Project opens that Project first, then the ADR, as "Go to" of the command
 * palette does (find/canvas-requests.ts, openAdr).
 */
export const order = 40
export const railTitle = 'ADR'

export function RailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 1.8h5.5L12.5 5v9.2H4z" />
      <path d="M9.3 1.8V5h3.2M6 8.5h4.5M6 11h4.5" />
    </svg>
  )
}

const styles = {
  count: { fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  // The name of a Project above its ADRs, as in the Epics section.
  project: { padding: '6px 8px 2px', fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
      // A symlinked ADR that leads to anything but a document: main asked, and the user chose to see it in the file manager.
      else if (result.value.revealedIn !== undefined) showRevealed(result.value.revealedIn)
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

/** One ADR row; `projectId` marks a row of another Project. */
function AdrRow({ adr, current, projectId, onOpen }: { adr: AdrEntry; current: boolean; projectId?: string; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="w-row"
        style={styles.row}
        data-testid="sidebar-adr"
        data-path={adr.path}
        data-project={projectId}
        title={adr.status === null ? adr.title : `${adr.title} — ${adr.status}`}
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="w-mono" style={styles.number}>
          {adr.number}
        </span>
        <span style={styles.title}>{adr.title}</span>
        {adr.status !== null ? <span style={styles.status}>{adr.status}</span> : null}
      </button>
    </li>
  )
}

/**
 * The ADRs of `projects`, each read once through `docs.adrs` while `shown` — again each time it turns true
 * and whenever the list of Projects changes meanwhile. A Project whose ADRs could not be read is left out:
 * the open Project's section is where its errors are said.
 */
function useOtherAdrs(projects: readonly ProjectView[], shown: boolean): ReadonlyMap<string, readonly AdrEntry[]> {
  const [read, setRead] = useState<ReadonlyMap<string, readonly AdrEntry[]>>(new Map())
  const ids = projects.map((project) => project.id).join('\n')
  useEffect(() => {
    if (!shown || ids === '') return
    let live = true
    const wanted = ids.split('\n')
    void Promise.all(
      wanted.map(async (projectId) => {
        const result = await invoke('docs.adrs', { projectId })
        if (!result.ok) console.error(`docs.adrs ${projectId} failed:`, result.error)
        return [projectId, result.ok ? result.value.adrs : []] as const
      }),
    ).then((pairs) => {
      if (live) setRead(new Map(pairs))
    })
    return () => {
      live = false
    }
  }, [ids, shown])
  return read
}

export default function AdrSection() {
  const projectsState = useProjects()
  const project = activeProject(projectsState)
  const scope = useSidebarScope((store) => store.scope)
  const inPanel = useSidebarScope((store) => store.section === 'AdrSection')
  const { state, error } = useDocs(project?.id)
  const [open, setOpen] = useState<{ projectId: string; path: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const others = project === undefined ? [] : projectsInScope(projectsState?.projects ?? [], scope, project.id).filter((each) => each.id !== project.id)
  const otherAdrs = useOtherAdrs(others, inPanel)
  // "Go to" an ADR in the command palette (ticket 31) opens it here, as a click on its row does.
  // A request not carried out yet; one made before the Projects are read waits for them, and one
  // for another Project is dropped.
  const request = useCanvasRequests((state) => (state.adr !== null && state.adr.seq > state.adrHandled ? state.adr : null))
  const pending = project !== undefined ? request : null
  const projectId = project?.id
  const [taken, setTaken] = useState(0)
  if (pending !== null && pending.seq !== taken) {
    setTaken(pending.seq)
    if (pending.projectId === project?.id) setOpen({ projectId: pending.projectId, path: pending.path })
  }
  useEffect(() => {
    // Carried out: a sidebar shown again later must not open it a second time.
    if (pending === null) return
    markAdrHandled(pending.seq)
    // The panel of the ADR is over the window; the section comes into the sidebar's panel, its row marked.
    if (pending.projectId === projectId) showSidebarSection('AdrSection')
  }, [pending, projectId])
  if (!project) return <NoProjectSection id="AdrSection" title="ADR" what="ADRs" />

  const adrs = state?.adrs ?? []
  // A panel of another Project, or of an ADR that is gone, is not shown.
  const openAdrEntry = open?.projectId === project.id ? adrs.find((adr) => adr.path === open.path) : undefined
  const named = others.length > 0
  const elsewhere = others.flatMap((other) => {
    const list = otherAdrs.get(other.id) ?? []
    return list.length > 0 ? [{ project: other, adrs: list }] : []
  })

  // An ADR of another Project: that Project opens, then the ADR, as the palette's "Go to" opens it.
  const openElsewhere = (other: ProjectView, path: string) => {
    setFailure(null)
    void openProject(windowMachine(), other.id).then((refused) => {
      if (refused === undefined) openAdr(other.id, path)
      else setFailure(`${other.name} could not be opened: ${readableReason(refused)}`)
    })
  }

  let body
  if (error !== undefined) body = <p style={styles.message}>The ADRs could not be read: {error}</p>
  else if (state === undefined) body = null
  else if (!adrs.length) body = <p style={styles.message}>No ADRs in {ADR_DIR}/</p>
  else
    body = (
      <ul style={styles.list}>
        {adrs.map((adr) => (
          <AdrRow key={adr.path} adr={adr} current={openAdrEntry?.path === adr.path} onOpen={() => setOpen({ projectId: project.id, path: adr.path })} />
        ))}
      </ul>
    )
  const count = adrs.length + elsewhere.reduce((sum, each) => sum + each.adrs.length, 0)

  return (
    <SidebarSection
      id="AdrSection"
      title="ADR"
      scope="filtered"
      trailing={
        state !== undefined ? (
          <span className="w-mono" style={styles.count} data-testid="adr-count">
            {count}
          </span>
        ) : null
      }
      notice={failure === null ? null : <p style={styles.message} role="alert">{failure}</p>}
      overlay={openAdrEntry !== undefined ? <AdrPanel projectId={project.id} adr={openAdrEntry} onClose={() => setOpen(null)} /> : null}
    >
      <div data-testid="sidebar-adr-project" data-project={project.id}>
        {named ? (
          <div style={styles.project} title={project.path}>
            {project.name}
          </div>
        ) : null}
        {body}
      </div>
      {elsewhere.map((each) => (
        <div key={each.project.id} data-testid="sidebar-adr-project" data-project={each.project.id}>
          <div style={styles.project} title={each.project.path}>
            {each.project.name}
          </div>
          <ul style={styles.list}>
            {each.adrs.map((adr) => (
              <AdrRow key={adr.path} adr={adr} current={false} projectId={each.project.id} onOpen={() => openElsewhere(each.project, adr.path)} />
            ))}
          </ul>
        </div>
      ))}
    </SidebarSection>
  )
}

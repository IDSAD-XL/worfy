// "Remove project…" of a Project's menu (worfy-polish ticket 79): the dialog that says what the removal
// takes from the Harness of this Machine and what stays, then removes. Main does the removal
// (`projects.removeProject`, src/main/projects/remove.ts, through `project-connect --remove`); the
// dialog only reads the preview, asks, and shows the answer. "Remove from list" stays a choice here
// too: the Project leaves worfy's list only, as the menu row of that name does.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectsState, ProjectView, RemovalPreview } from '../../shared/ipc/projects'
import { invoke, readableReason } from '../ipc'

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 520,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-node)',
    fontSize: 'var(--text-13)',
    outline: 'none',
  },
  header: { padding: 'var(--space-4) var(--space-4) var(--space-3)', borderBottom: '1px solid var(--border)' },
  title: { margin: 0, fontSize: 'var(--text-20)', fontWeight: 600, overflowWrap: 'anywhere' },
  body: { padding: 'var(--space-3) var(--space-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  heading: { margin: 0, fontWeight: 600 },
  list: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2, overflowWrap: 'anywhere' },
  muted: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  error: { margin: 0, color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)', flexWrap: 'wrap' },
} satisfies Record<string, CSSProperties>

/** The file manager's name on this system, as the button says it. */
const showInFileManager = (): string => (navigator.userAgent.includes('Windows') ? 'Show in Explorer' : 'Show in Finder')

export interface RemoveProjectProps {
  project: ProjectView
  onCancel: () => void
  /** "Remove from list": the Project leaves worfy's list only, as the menu row of that name does. */
  onRemoveFromList: () => void
  /** The Project left the Harness and the list; `notes` — what the Harness said beside it. */
  onRemoved: (state: ProjectsState, notes: readonly string[]) => void
}

type Phase = { kind: 'reading' } | { kind: 'shown'; preview: RemovalPreview } | { kind: 'failed'; reason: string }

/** What leaves the Harness of this Machine. */
function goes(preview: Extract<RemovalPreview, { status: 'ready' }>): ReactNode[] {
  const items: ReactNode[] = [
    <>
      The Profile <code>{preview.profile}</code> ({preview.profileDir})
    </>,
    <>
      The gate registry {preview.paths.length === 1 ? 'entry' : 'entries'} for {preview.paths.join(', ')}: {preview.paths.length === 1 ? 'this folder' : 'these folders'} can be connected again
    </>,
    <>The agents&apos; marks in {preview.runs}</>,
  ]
  if (preview.qmd.length > 0) items.push(<>The qmd collections {preview.qmd.join(', ')} (one that another Profile names stays)</>)
  const folder = preview.workflowFolder
  if (folder !== null && folder.inside && !folder.holdsFiles) items.push(<>The empty Workflow folder {folder.path}</>)
  return items
}

/** What the removal never touches. */
function stays(project: ProjectView, preview: Extract<RemovalPreview, { status: 'ready' }>): ReactNode[] {
  const items: ReactNode[] = [<>The repositories in {project.path} and every file in them: worfy deletes no repository, branch or file of yours</>]
  if (preview.mode === 'full') items.push(<>The tickets, spec, ADRs and state file in the repository</>)
  const folder = preview.workflowFolder
  if (folder !== null && !folder.inside) items.push(<>Your Workflow folder {folder.path} and the tickets in it</>)
  items.push(<>worfy&apos;s own settings of the Project, as with Remove from list</>)
  return items
}

export function RemoveProject({ project, onCancel, onRemoveFromList, onRemoved }: RemoveProjectProps) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' })
  const [busy, setBusy] = useState(false)
  /** The refusal of the last try, and the Workflow folder it names when that folder holds the tickets. */
  const [refusal, setRefusal] = useState<{ reason: string; workflowFolder: string | null } | null>(null)

  useEffect(() => {
    dialog.current?.focus()
    let live = true
    void invoke('projects.removal.preview', { id: project.id }).then((result) => {
      if (!live) return
      setPhase(result.ok ? { kind: 'shown', preview: result.value } : { kind: 'failed', reason: readableReason(result.error) })
    })
    return () => {
      live = false
    }
  }, [project.id])

  const remove = async (): Promise<void> => {
    setBusy(true)
    setRefusal(null)
    const result = await invoke('projects.removeProject', { id: project.id })
    setBusy(false)
    if (!result.ok) return setRefusal({ reason: readableReason(result.error), workflowFolder: null })
    if (result.value.status === 'refused') return setRefusal({ reason: result.value.reason, workflowFolder: result.value.workflowFolder })
    onRemoved(result.value.state, result.value.notes)
  }

  const reveal = async (): Promise<void> => {
    const result = await invoke('projects.removal.reveal', { id: project.id })
    if (!result.ok) setRefusal((current) => ({ reason: readableReason(result.error), workflowFolder: current?.workflowFolder ?? null }))
  }

  const preview = phase.kind === 'shown' ? phase.preview : null
  const ready = preview?.status === 'ready' ? preview : null
  const held = ready?.workflowFolder?.inside === true && ready.workflowFolder.holdsFiles
  // A refusal of the preview or of the try that names the Workflow folder holding the tickets.
  const heldFolder = refusal?.workflowFolder ?? (held ? (ready?.workflowFolder?.path ?? null) : null)

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={styles.dialog}
        data-testid="remove-project"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div style={styles.header}>
          <h2 id={titleId} style={styles.title}>
            Remove {project.name}?
          </h2>
        </div>
        <div style={styles.body}>
          {phase.kind === 'reading' ? <p style={styles.muted}>Reading what the Harness of this Machine holds for it…</p> : null}
          {phase.kind === 'failed' ? (
            <p role="alert" style={styles.error} data-testid="remove-project-refused">
              {phase.reason}
            </p>
          ) : null}
          {preview?.status === 'refused' ? (
            <p role="alert" style={styles.error} data-testid="remove-project-refused">
              {preview.reason}
            </p>
          ) : null}
          {ready !== null ? (
            <>
              <p style={styles.heading}>Removed from the Harness of this Machine:</p>
              <ul style={styles.list} data-testid="remove-project-goes">
                {goes(ready).map((item, at) => (
                  <li key={at}>{item}</li>
                ))}
              </ul>
              <p style={styles.heading}>Stays:</p>
              <ul style={styles.list} data-testid="remove-project-stays">
                {stays(project, ready).map((item, at) => (
                  <li key={at}>{item}</li>
                ))}
              </ul>
              <p style={styles.muted}>worfy closes the Project&apos;s Orchestrator and Sessions first. Remove from list keeps all of the above and only takes the Project out of worfy&apos;s list.</p>
            </>
          ) : null}
          {held && refusal === null ? (
            <p role="alert" style={styles.error} data-testid="remove-project-refused">
              The Workflow folder {ready.workflowFolder?.path} holds the project&apos;s own files (its tickets). worfy never deletes them: move them out of {ready.profileDir}{' '}
              first, then remove the project.
            </p>
          ) : null}
          {refusal !== null ? (
            <p role="alert" style={styles.error} data-testid="remove-project-refused">
              {refusal.reason}
            </p>
          ) : null}
        </div>
        <div style={styles.footer}>
          {heldFolder !== null ? (
            <button type="button" className="w-action" data-testid="remove-project-reveal" onClick={() => void reveal()}>
              {showInFileManager()}
            </button>
          ) : null}
          <button type="button" className="w-action" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="w-action" disabled={busy} data-testid="remove-project-list-only" onClick={onRemoveFromList}>
            Remove from list
          </button>
          <button
            type="button"
            className="w-action w-action--primary"
            disabled={busy || ready === null || held}
            data-testid="remove-project-confirm"
            onClick={() => void remove()}
          >
            {busy ? 'Removing…' : 'Remove project'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

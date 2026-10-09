// Choosing a folder of a Linked machine inside worfy (worfy-link ticket 11; ADR-0052, Q10 and
// Q14): the system folder picker opens only on the screen of its own Machine, so "Add project" on a
// Linked machine walks that Machine's folders with `projects.browse`, one folder per call. It starts
// in the Machine's home folder; "Up" goes to the folder above, a row goes into its folder, "Choose"
// gives the folder shown.
//
// Paths are in the form of the other Machine's OS. This screen never parses, joins or rewrites one:
// it only goes on by `path` and `parent` of an answer and chooses `path` as it came, so it works
// with a Machine on another OS (`C:\Users\me` passes as it is).
//
// The look follows the "Add project" dialog (ConnectProject.tsx), one layer above it: a dialog on a
// backdrop of black at 25%, the shared rows of the sidebar, colours only from the token roles.
import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import type { BrowseAnswer } from '../../shared/ipc/projects'
import { invokeOn, readableReason } from '../ipc'
import { ListRow } from '../theme/primitives'

export interface FolderBrowserProps {
  /** The Machine whose folders are shown: null — this Machine, else a Linked machine's id. */
  machine: string | null
  /** Its name, for the title. */
  machineName: string
  /** What the folder is for: "Add project", "Workflow folder". */
  title: string
  /** One line under the title. */
  hint: string
  onChoose: (path: string) => void
  onCancel: () => void
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 560,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 48px)',
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
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-20)', fontWeight: 600 },
  hint: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  bar: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--border)' },
  path: { flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere', color: 'var(--text-secondary)' },
  body: { height: 320, overflowY: 'auto', padding: 'var(--space-2) var(--space-3)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  muted: { margin: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  error: { margin: 'var(--space-2)', color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  chip: { background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
  hidden: { flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
} satisfies Record<string, CSSProperties>

const folderIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
)

export function FolderBrowser({ machine, machineName, title, hint, onChoose, onCancel }: FolderBrowserProps) {
  /** The last answer of the Machine: a folder's list, or why the folder cannot be read. */
  const [answer, setAnswer] = useState<BrowseAnswer | null>(null)
  /** The call itself failed (the Machine went away, access went off): no folder to show. */
  const [failure, setFailure] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHidden, setShowHidden] = useState(false)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  // The folder the last click asked for: an older answer that comes later is dropped.
  const seq = useRef(0)

  /** Asks Machine `machine` for folder `path` (null: its home folder); the answer of the latest ask is shown. */
  const ask = (path: string | null): void => {
    const mine = ++seq.current
    void invokeOn(machine, 'projects.browse', { path }).then((result) => {
      if (mine !== seq.current) return
      setLoading(false)
      if (result.ok) {
        setAnswer(result.value)
        setFailure(null)
      } else {
        setFailure(readableReason(failureReason('projects.browse', result.error)))
      }
    })
  }

  const go = (path: string | null): void => {
    setLoading(true)
    ask(path)
  }

  // On opening: the home folder of the Machine (`loading` starts true).
  const open = useEffectEvent(() => ask(null))
  useEffect(() => {
    dialog.current?.focus()
    open()
  }, [])

  const folders = answer?.ok === true ? answer.folders.filter((folder) => showHidden || !folder.hidden) : []
  const hiddenCount = answer?.ok === true ? answer.folders.filter((folder) => folder.hidden).length : 0
  const canChoose = answer?.ok === true && failure === null && !loading
  const parent = failure === null ? (answer?.parent ?? null) : null

  let content
  if (failure !== null) {
    content = (
      <p role="alert" style={styles.error} data-testid="folder-browser-error">
        {failure}
      </p>
    )
  } else if (answer === null) {
    content = <p style={styles.muted}>Reading the folders of {machineName}…</p>
  } else if (!answer.ok) {
    content = (
      <p role="alert" style={styles.error} data-testid="folder-browser-error">
        {answer.reason}
      </p>
    )
  } else {
    content = (
      <>
        {folders.length === 0 ? (
          <p style={styles.muted} data-testid="folder-browser-empty">
            {hiddenCount > 0 ? 'Only hidden folders here' : 'No folders here'}
          </p>
        ) : (
          <ul style={styles.list} aria-label="Folders">
            {folders.map((folder) => (
              <li key={folder.path} data-testid="folder-row" data-hidden={folder.hidden ? 'yes' : 'no'} title={folder.path}>
                <ListRow
                  label={folder.name}
                  icon={folderIcon}
                  trailing={
                    folder.gitRepo ? (
                      <span className="w-chip" style={styles.chip}>
                        git
                      </span>
                    ) : undefined
                  }
                  onSelect={() => go(folder.path)}
                />
              </li>
            ))}
          </ul>
        )}
        {answer.truncated ? (
          <p style={styles.muted} data-testid="folder-browser-truncated">
            Only the first {answer.folders.length} folders are shown.
          </p>
        ) : null}
      </>
    )
  }

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={styles.dialog}
        data-testid="folder-browser"
        data-loading={loading ? 'yes' : 'no'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Only this layer: the "Add project" dialog under it stays open.
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div style={styles.header}>
          <h2 id={titleId} style={styles.title}>
            {title}
          </h2>
          <p style={styles.hint}>
            {hint} The folders of {machineName}.
          </p>
        </div>
        <div style={styles.bar}>
          <button type="button" className="w-action" disabled={parent === null || loading} onClick={() => parent !== null && go(parent)}>
            Up
          </button>
          <button type="button" className="w-action" disabled={loading} onClick={() => go(null)}>
            Home
          </button>
          <span style={styles.path} data-testid="folder-browser-path">
            {answer?.path ?? ''}
          </span>
        </div>
        <div style={styles.body}>{content}</div>
        <div style={styles.footer}>
          <label style={styles.hidden}>
            <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
            Show hidden folders
          </label>
          <button type="button" className="w-action" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="w-action w-action--primary" disabled={!canChoose} aria-disabled={canChoose ? undefined : 'true'} onClick={() => answer?.ok === true && canChoose && onChoose(answer.path)}>
            Choose
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

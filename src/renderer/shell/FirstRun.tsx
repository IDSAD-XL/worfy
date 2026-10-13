// The first-run screen (worfy-harness ticket 19, question Q22; docs/design/F-SPEC.md, "First run"):
// a dialog over the window with the checks main runs over this Mac and the buttons of their
// actions. The checks themselves — the rows, the actions, "Check again" — are FirstRunChecks.tsx,
// which Settings → Health shows too (worfy-ui ticket 6); this file is the dialog around them.
//
// It opens by itself once per window load when main says so (`firstRun.startup`), and from the
// command palette (openFirstRun, palette/commands.ts). Closing it tells main, which writes the mark.
import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { FirstRunChecks, type FirstRunChecksParts } from './FirstRunChecks'
import { askAtStartup, closeFirstRun, useFirstRun } from './first-run-store'

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 720,
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
  header: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-4) var(--space-3)', borderBottom: '1px solid var(--border)' },
  headerText: { flex: 1, minWidth: 0 },
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-20)', fontWeight: 600 },
  subtitle: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  body: { overflowY: 'auto', padding: '0 var(--space-4) var(--space-2)', flex: 1 },
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
} satisfies Record<string, CSSProperties>

/** The dialog around the parts of the checks; on screen only while First run is open. */
function FirstRunDialog({ summary, list, message, checkAgain, running, migrating }: FirstRunChecksParts) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
  }, [])

  const close = (): void => {
    if (!running) closeFirstRun()
  }

  return createPortal(
    <div style={styles.backdrop}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={styles.dialog}
        data-testid="first-run"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !migrating) {
            event.stopPropagation()
            close()
          }
        }}
      >
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 id={titleId} style={styles.title}>
              First run
            </h2>
            <p style={styles.subtitle} data-testid="first-run-subtitle">worfy checks this Mac for itself and the Harness. Nothing changes until you confirm it.</p>
          </div>
          {summary}
        </div>
        <div style={styles.body}>{list}</div>
        <div style={styles.footer}>
          {message}
          {checkAgain}
          <button type="button" className="w-action w-action--primary" aria-disabled={running ? 'true' : undefined} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function FirstRun() {
  const open = useFirstRun((state) => state.open)

  useEffect(askAtStartup, [])

  if (!open) return null
  return <FirstRunChecks onTerminalOpened={closeFirstRun}>{(parts) => <FirstRunDialog {...parts} />}</FirstRunChecks>
}

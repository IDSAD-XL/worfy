// The first-run screen (worfy-harness ticket 19, question Q22; docs/design/F-SPEC.md, "First run"):
// a dialog over the window with the checks main runs over this Mac and the buttons of their
// actions. The checks themselves — the rows, the actions, "Check again" — are FirstRunChecks.tsx,
// which Settings → Health shows too (worfy-ui ticket 6); this file is the dialog around them.
//
// It opens by itself once per window load when main says so (`firstRun.startup`), and from the
// command palette (openFirstRun, palette/commands.ts). Closing it tells main, which writes the mark.
//
// The way into Getting started (worfy-onboarding ticket 08): opened by itself on a new user's first
// start, it shows the three concepts first (FirstRunConcepts.tsx) while its checks run, and "Next"
// goes to them; under the checks a new user gets "Start Getting started" until step 6 is marked.
import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { openGettingStarted, useGettingStarted } from '../getting-started/store'
import { isMac } from '../platform'
import { showToast } from '../toast/toasts'
import { FirstRunChecks, type FirstRunChecksParts } from './FirstRunChecks'
import { CONCEPTS_LEAD, CONCEPTS_NOTE, CONCEPTS_TITLE, FirstRunConcepts } from './FirstRunConcepts'
import { askAtStartup, closeFirstRun, showFirstRunChecks, useFirstRun } from './first-run-store'

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
  lead: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  note: { flex: 1, minWidth: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  body: { overflowY: 'auto', padding: '0 var(--space-4) var(--space-2)', flex: 1 },
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
} satisfies Record<string, CSSProperties>

/**
 * "Start Getting started": for a new user (decision 7) while step 6 is not marked (decision 9). It
 * closes First run, the mark written as by "Close", and shows the section with the focus on it.
 */
function StartGettingStarted({ running }: { running: boolean }) {
  const snapshot = useGettingStarted()
  if (snapshot?.user !== 'new' || snapshot.steps['6'] !== undefined) return null
  const start = (): void => {
    if (running) return
    closeFirstRun()
    void openGettingStarted().then((failure) => {
      if (failure !== undefined) showToast({ kind: 'error', key: 'first-run-getting-started', text: failure })
    })
  }
  return (
    <button type="button" className="w-action" aria-disabled={running ? 'true' : undefined} onClick={start}>
      Start Getting started
    </button>
  )
}

/** The dialog around the parts of the checks, or around the concepts before them; on screen only while First run is open. */
function FirstRunDialog({ summary, list, message, checkAgain, running, migrating }: FirstRunChecksParts) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const page = useFirstRun((state) => state.page)
  const concepts = page === 'concepts'

  // Again on "Next": the button that had the focus is gone, and Escape needs the focus in the dialog.
  useEffect(() => {
    dialog.current?.focus()
  }, [page])

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
        data-page={page}
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
              {concepts ? CONCEPTS_TITLE : 'First run'}
            </h2>
            {concepts ? (
              <p style={styles.lead}>{CONCEPTS_LEAD}</p>
            ) : (
              <p style={styles.subtitle} data-testid="first-run-subtitle">
                worfy checks this {isMac() ? 'Mac' : 'PC'} for itself and the Harness. Nothing changes until you confirm it.
              </p>
            )}
          </div>
          {concepts ? null : summary}
        </div>
        <div style={styles.body}>{concepts ? <FirstRunConcepts /> : list}</div>
        {concepts ? (
          <div style={styles.footer}>
            <span style={styles.note}>{CONCEPTS_NOTE}</span>
            <button type="button" className="w-action" onClick={close}>
              Close
            </button>
            <button type="button" className="w-action w-action--primary" onClick={showFirstRunChecks}>
              Next
            </button>
          </div>
        ) : (
          <div style={styles.footer}>
            {message}
            {checkAgain}
            <StartGettingStarted running={running} />
            <button type="button" className="w-action w-action--primary" aria-disabled={running ? 'true' : undefined} onClick={close}>
              Close
            </button>
          </div>
        )}
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

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
//
// The welcome step offers the Assistant once (worfy-assistant ticket 16; owner's decision 10): between
// the concepts and the checks, while the offer stands, the page "Meet Assistant" (assistant/Offer.tsx)
// with "Turn on and meet" and "Not now"; either answer goes on to the checks. Closed there, First run
// closes as from the concepts, and the offer stays in the Assistant's section.
import { useEffect, useId, useRef, type CSSProperties, type ReactElement } from 'react'
import { OFFER_ACCEPT, OFFER_DECLINE, OFFER_FOOT, OFFER_LEAD, OFFER_TITLE, OfferDetails } from '../assistant/Offer'
import { answerOffer } from '../assistant/useAssistant'
import { openGettingStarted, useGettingStarted } from '../getting-started/store'
import { isMac } from '../platform'
import { Dialog } from '../theme/kit/Dialog'
import { showToast } from '../toast/toasts'
import { FirstRunChecks, type FirstRunChecksParts } from './FirstRunChecks'
import { CONCEPTS_LEAD, CONCEPTS_NOTE, CONCEPTS_TITLE, FirstRunConcepts } from './FirstRunConcepts'
import { askAtStartup, closeFirstRun, showFirstRunChecks, showFirstRunNext, useFirstRun, type FirstRunPage } from './first-run-store'

const styles = {
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

/**
 * The dialog around the parts of the checks, or around the concepts before them; on screen only while
 * First run is open. A modal Dialog of the kit (theme/kit/Dialog.tsx) on the dialog layer: Tab stays
 * in it, the focus goes back to what had it on closing, and a window of the kit opened over it later
 * (Settings by ⌘,, the Guide) is on top and gives the focus back to it. Esc closes it, except while a
 * check's action runs or the move form is open; a click outside does nothing.
 */
function FirstRunDialog({ summary, list, message, checkAgain, running, migrating }: FirstRunChecksParts) {
  const titleId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const page = useFirstRun((state) => state.page)

  // On "Next" the button that had the focus is gone: the focus goes to the window, not to the page.
  useEffect(() => {
    const frame = title.current?.closest<HTMLElement>('[role="dialog"]')
    if (frame !== null && frame !== undefined && !frame.contains(document.activeElement)) frame.focus()
  }, [page])

  const close = (): void => {
    if (!running) closeFirstRun()
  }
  const answer = (choice: 'accepted' | 'declined'): void => {
    void answerOffer(choice)
    showFirstRunChecks()
  }

  const parts: Record<FirstRunPage, { title: string; lead: ReactElement; body: ReactElement; footer: ReactElement }> = {
    concepts: {
      title: CONCEPTS_TITLE,
      lead: <p style={styles.lead}>{CONCEPTS_LEAD}</p>,
      body: <FirstRunConcepts />,
      footer: (
        <>
          <span style={styles.note}>{CONCEPTS_NOTE}</span>
          <button type="button" className="w-action" onClick={close}>
            Close
          </button>
          <button type="button" className="w-action w-action--primary" onClick={showFirstRunNext}>
            Next
          </button>
        </>
      ),
    },
    assistant: {
      title: OFFER_TITLE,
      lead: <p style={styles.lead}>{OFFER_LEAD}</p>,
      body: <OfferDetails />,
      footer: (
        <>
          <span style={styles.note}>{OFFER_FOOT}</span>
          <button type="button" className="w-action" onClick={() => answer('declined')}>
            {OFFER_DECLINE}
          </button>
          <button type="button" className="w-action w-action--primary" onClick={() => answer('accepted')}>
            {OFFER_ACCEPT}
          </button>
        </>
      ),
    },
    checks: {
      title: 'First run',
      lead: (
        <p style={styles.subtitle} data-testid="first-run-subtitle">
          worfy checks this {isMac() ? 'Mac' : 'PC'} for itself and the Harness. Nothing changes until you confirm it.
        </p>
      ),
      body: <>{list}</>,
      footer: (
        <>
          {message}
          {checkAgain}
          <StartGettingStarted running={running} />
          <button type="button" className="w-action w-action--primary" aria-disabled={running ? 'true' : undefined} onClick={close}>
            Close
          </button>
        </>
      ),
    },
  }
  const shown = parts[page]

  return (
    <Dialog
      open
      onClose={() => {
      if (!migrating) close()
      }}
      labelledBy={titleId}
      className="w-first-run"
      style={styles.dialog}
      closeOnBackdrop={false}
      data-testid="first-run"
      data-page={page}
    >
      <div style={styles.header}>
        <div style={styles.headerText}>
          <h2 ref={title} id={titleId} style={styles.title}>
            {shown.title}
          </h2>
          {shown.lead}
        </div>
        {page === 'checks' ? summary : null}
      </div>
      <div style={styles.body}>{shown.body}</div>
      <div style={styles.footer}>{shown.footer}</div>
    </Dialog>
  )
}

export function FirstRun() {
  const open = useFirstRun((state) => state.open)

  useEffect(askAtStartup, [])

  if (!open) return null
  return <FirstRunChecks onTerminalOpened={closeFirstRun}>{(parts) => <FirstRunDialog {...parts} />}</FirstRunChecks>
}

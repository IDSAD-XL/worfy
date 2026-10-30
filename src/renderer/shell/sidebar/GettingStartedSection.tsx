import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import '../../canvas/actions/actions.css'
import { failureReason } from '../../../shared/ipc/channels'
import { GETTING_STARTED_STEPS, type GettingStartedSnapshot, type GettingStartedStep } from '../../../shared/ipc/getting-started'
import { skipGettingStarted, useGettingStarted, useGettingStartedStore, GETTING_STARTED_SECTION_ID } from '../../getting-started/store'
import { invoke, subscribe } from '../../ipc'
import { requestAddProject } from '../../projects/add-project'
import { openProject } from '../../projects/useProjects'
import { openSession } from '../../session/navigation'
import { setPendingInput } from '../../session/pending-input'
import { openFirstRun } from '../first-run-store'
import { SidebarSection } from '../SidebarSection'

/**
 * Getting started (worfy-onboarding ticket 07): the guided demo, at the top of the sidebar while
 * main's state says `section: 'shown'`. Six steps that main marks by itself from what happened; the
 * first unmarked one is the current step, and only it has a button. A button is a shortcut, not a
 * gate: a step done another way is marked all the same. Below the steps, apart from the demo,
 * "Connect your own project" opens the same "Add project" as "+" of Projects; "Skip" hides the
 * section, and the Command palette's "Getting started" shows it again (store.ts). No dialogs here.
 *
 * Steps 3 and 4 open the demo's Orchestrator with a ready text in its input field
 * (session/pending-input.ts); the user sends it (decision 4 of the onboarding spec). Texts are those
 * of the spec, section "Texts (draft)".
 */
export const order = 5

/**
 * The section's rows are its steps, two to four lines each; at 42 px the body is 630 px high at
 * most, the whole demo with every line, and shrinks to 126 px when the sidebar is short.
 */
const ROW_HEIGHT = 42

const QUESTION = 'What is planned in this project?'
const SHIP = '/worfy:ship-ticket todo 01'

const styles = {
  intro: { margin: '0 8px 4px', fontSize: 'var(--text-12)', lineHeight: '15px', color: 'var(--text-secondary)' },
  steps: { margin: 0, padding: '0 8px', listStyle: 'none', display: 'flex', flexDirection: 'column' },
  step: { display: 'flex', gap: 8, padding: '4px 0 5px' },
  mark: {
    flex: 'none',
    width: 16,
    height: 16,
    marginTop: 0,
    boxSizing: 'border-box',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--text-11)',
    lineHeight: '14px',
    fontWeight: 600,
  },
  markDone: { background: 'var(--ready-bg)', color: 'var(--ready-text)' },
  markCurrent: { border: '1.5px solid var(--accent)', color: 'var(--accent)' },
  markLater: { border: '1px solid var(--border-strong)', color: 'var(--text-muted)' },
  body: { flex: 1, minWidth: 0 },
  title: { display: 'block', fontSize: 'var(--text-13)', lineHeight: '16px', fontWeight: 600, color: 'var(--text)' },
  titleDone: { fontWeight: 500, color: 'var(--text-secondary)' },
  line: { margin: '1px 0 0', fontSize: 'var(--text-12)', lineHeight: '15px', color: 'var(--text-secondary)', overflowWrap: 'anywhere' },
  note: { margin: '2px 0 0', fontSize: 'var(--text-11)', lineHeight: '14px', color: 'var(--text-muted)' },
  action: { marginTop: 6 },
  code: { fontSize: 'var(--text-11)' },
  progress: { margin: '4px 0 0', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--working-text)' },
  error: { margin: '4px 0 0', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
  connect: { margin: '6px 8px 0', padding: '8px 0 0', borderTop: '1px solid var(--border)' },
  footer: { display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 6px' },
  skip: {
    border: 0,
    padding: '2px 4px',
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-muted)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    textDecoration: 'underline',
  },
  hidden: { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

interface StepText {
  title: string
  line: ReactNode
}

const STEP_TEXTS: Record<GettingStartedStep, StepText> = {
  '1': { title: 'Check your setup', line: 'Make sure Claude Code, git, node and the Harness are ready.' },
  '2': { title: 'Open the demo project', line: 'worfy creates a small todo app in your home folder. No GitHub needed.' },
  '3': { title: 'Meet the Orchestrator', line: "Ask the project's main Session what is planned." },
  '4': {
    title: 'Ship the ticket',
    line: (
      <>
        An implementer agent adds <code className="w-mono" style={styles.code}>
          done &lt;n&gt;
        </code>. The Pipeline shows each Stage.
      </>
    ),
  },
  '5': { title: 'See the review', line: 'A reviewer checks the work. If it finds a problem, the implementer fixes it.' },
  '6': { title: 'Merge', line: 'The Orchestrator merges the ticket into main.' },
}

/** The first step main has not marked; null once all six are. */
function currentStep(snapshot: GettingStartedSnapshot): GettingStartedStep | null {
  return GETTING_STARTED_STEPS.find((step) => snapshot.steps[step] === undefined) ?? null
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

/** The tooltip of a marked step: when main marked it, in the user's own format. */
function doneTitle(at: string): string {
  const time = new Date(at)
  return Number.isNaN(time.getTime()) ? 'Done' : `Done ${time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

/** Brings the section into view and focuses its heading each time openGettingStarted() asks; an old request is not done again on a remount. */
let focusDone = 0

export default function GettingStartedSection() {
  const snapshot = useGettingStarted()
  const focusAsked = useGettingStartedStore((store) => store.focusAsked)
  const anchor = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<GettingStartedStep | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ step: GettingStartedStep; text: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // The steps of the demo's creation, for whichever window asked; shown only while this one waits.
  useEffect(() => {
    try {
      return subscribe('gettingStarted.createProgress', ({ step }) => setProgress(step))
    } catch (error) {
      console.error('gettingStarted.createProgress: cannot subscribe', error)
      return undefined
    }
  }, [])

  const shown = snapshot?.section === 'shown'
  useEffect(() => {
    if (!shown || focusAsked <= focusDone) return
    focusDone = focusAsked
    const section = anchor.current?.closest('section')
    section?.scrollIntoView?.({ block: 'nearest' })
    section?.querySelector<HTMLElement>('.w-sidebar-section__toggle')?.focus()
  }, [shown, focusAsked])

  if (snapshot === null || !shown) return null
  const current = currentStep(snapshot)
  const demo = snapshot.demo

  const run = async (step: GettingStartedStep, work: () => Promise<string | undefined>): Promise<void> => {
    setBusy(step)
    setFailure(null)
    setProgress(null)
    const text = await work()
    setBusy(null)
    setProgress(null)
    if (text !== undefined) setFailure({ step, text })
  }

  const createDemo = async (): Promise<string | undefined> => {
    const result = await invoke('gettingStarted.createDemo')
    const reason = !result.ok ? failureReason('gettingStarted.createDemo', result.error) : result.value.ok ? undefined : result.value.reason
    return reason === undefined ? undefined : `Could not create the demo project: ${reason}`
  }

  /** The demo becomes the window's Project; its Orchestrator opens with `text` ready in the field, not sent. */
  const openDemo = async (text: string): Promise<string | undefined> => {
    if (demo === null) return undefined
    const selected = await openProject(null, demo.projectId)
    if (selected !== undefined) return failureReason('projects.select', selected)
    const result = await invoke('orchestrator.open', { projectId: demo.projectId })
    if (!result.ok) return failureReason('orchestrator.open', result.error)
    setPendingInput(result.value.nodeId, text)
    openSession({ nodeId: result.value.nodeId, projectId: demo.projectId })
    return undefined
  }

  const actionOf = (step: GettingStartedStep): ReactNode => {
    const button = (label: string, onClick: () => void, disabled = false) => (
      <div style={styles.action}>
        <button type="button" className="w-action w-action--primary" disabled={disabled || busy !== null} onClick={onClick}>
          {label}
        </button>
      </div>
    )
    switch (step) {
      case '1':
        return button('Open checks', openFirstRun)
      case '2':
        return button('Create demo project', () => void run('2', createDemo))
      case '3':
        return button('Open the Orchestrator', () => void run('3', () => openDemo(QUESTION)), demo === null)
      case '4':
        return button('Ship the ticket', () => void run('4', () => openDemo(SHIP)), demo === null)
      default:
        return null
    }
  }

  const skip = async (): Promise<void> => {
    setMessage(null)
    const refused = await skipGettingStarted()
    if (refused !== undefined) setMessage(refused)
  }

  return (
    <SidebarSection
      id={GETTING_STARTED_SECTION_ID}
      title="Getting started"
      rowHeight={ROW_HEIGHT}
      testId="getting-started"
      notice={
        message !== null ? (
          <p role="alert" style={styles.message}>
            {message}
          </p>
        ) : null
      }
    >
      <div ref={anchor}>
        <p style={styles.intro}>A guided demo: one ticket from start to merge.</p>
        <ol style={styles.steps} aria-label="Steps">
          {GETTING_STARTED_STEPS.map((step) => {
            const at = snapshot.steps[step]
            const done = at !== undefined
            const isCurrent = step === current
            const text = STEP_TEXTS[step]
            return (
              <li key={step} style={styles.step} data-step={step} data-done={done ? 'true' : undefined} aria-current={isCurrent ? 'step' : undefined} data-testid="getting-started-step">
                <span
                  data-testid="getting-started-mark"
                  title={done ? doneTitle(at) : undefined}
                  style={{ ...styles.mark, ...(done ? styles.markDone : isCurrent ? styles.markCurrent : styles.markLater) }}
                >
                  {done ? <CheckIcon /> : <span aria-hidden="true">{step}</span>}
                </span>
                <div style={styles.body}>
                  <span style={{ ...styles.title, ...(done ? styles.titleDone : {}) }}>
                    {text.title}
                    {done ? (
                      <>
                        {' '}
                        <span style={styles.hidden}>done</span>
                      </>
                    ) : null}
                  </span>
                  <p style={styles.line}>{text.line}</p>
                  {step === '2' ? <p style={styles.note}>The agents work for real and use your Claude Code usage.</p> : null}
                  {isCurrent ? actionOf(step) : null}
                  {busy === step && step === '2' && progress !== null ? (
                    <p role="status" style={styles.progress}>
                      {progress}
                    </p>
                  ) : null}
                  {failure?.step === step ? (
                    <p role="alert" style={styles.error}>
                      {failure.text}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
        <div style={styles.connect}>
          <span style={styles.title}>Connect your own project</span>
          <p style={styles.line}>Add a repository you work on. Not part of the demo.</p>
          <div style={styles.action}>
            <button type="button" className="w-action" onClick={() => requestAddProject()}>
              Connect…
            </button>
          </div>
        </div>
        <div style={styles.footer}>
          <button type="button" style={styles.skip} onClick={() => void skip()}>
            Skip
          </button>
        </div>
      </div>
    </SidebarSection>
  )
}

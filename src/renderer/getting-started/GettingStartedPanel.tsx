import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import { GETTING_STARTED_STEPS, type GettingStartedStep } from '../../shared/ipc/getting-started'
import { invoke, subscribe } from '../ipc'
import { usePipeline } from '../pipeline/usePipeline'
import { requestAddProject } from '../projects/add-project'
import { openProject } from '../projects/useProjects'
import { openSession } from '../session/navigation'
import { setPendingInput, usePendingInput } from '../session/pending-input'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import { openFirstRun, useFirstRun } from '../shell/first-run-store'
import { showToast } from '../toast/toasts'
import CostSwitch from './CostSwitch'
import DoneScreen from './DoneScreen'
import { currentStep, highlightTarget, RING_ATTRIBUTE, targetSelector, targetValue, type HighlightInput, type HighlightTarget } from './highlight'
import './highlight.css'
import { stageHint, type StageHint } from './hints'
import ReviewExample from './ReviewExample'
import { GETTING_STARTED_COLLAPSED_KEY, skipGettingStarted, useGettingStarted, useGettingStartedStore } from './store'

/**
 * Getting started (worfy-onboarding tickets 07 and 13): the guided demo, a floating panel in the top
 * right corner of the window, under the toolbar, while main's state says `section: 'shown'`. Six
 * steps that main marks by itself from what happened; the first unmarked one is the current step, and
 * only it has a button. A button is a shortcut, not a gate: a step done another way is marked all the
 * same. Below the steps, apart from the demo, "Connect your own project" opens the same "Add project"
 * as "+" of Projects; "Skip" hides the panel, and the Command palette's "Getting started" shows it
 * again (store.ts).
 *
 * The panel is a layer of <body> (owner's decisions Q12–Q14 of 2026-10-31): above the Canvas, the
 * Sessions and the sidebar, below every dialog and menu (First run and the menus are at 90), and not
 * modal — no backdrop, it never holds the focus, and a click outside its box reaches what is under it.
 * Toasts keep out of it and of its pill (`data-toast-keep-out`, toast/placement.ts). Its height follows
 * the content up to 70 % of the window; only past that does its body scroll. "Collapse" leaves the
 * pill "Getting started · n/6" in the same corner, and the pill expands it again; collapsed or not is
 * `sidebar.collapsed.GettingStartedSection` of the app settings, the key of the sidebar section it
 * replaced, so it outlives a restart and is the same in every window of this Machine.
 *
 * Steps 3 and 4 open the demo's Orchestrator with a ready text in its input field
 * (session/pending-input.ts); the user sends it (decision 4 of the onboarding spec). Texts are those
 * of the spec, section "Texts (draft)".
 *
 * Ticket 09: while the demo Ticket stands on a Stage with a hint (hints.ts), the hint is a line under
 * the current step (under the last one once all are marked) and, once, an `info` toast of the Demo
 * project: main answers `first` to one call of `gettingStarted.hintSeen` only, so neither a second
 * window nor a restart shows it again. Under step 2, while there is a demo, the cost switch
 * (CostSwitch.tsx). Step 5, marked without a rework round seen, says the review found nothing in place
 * of its line and offers the recorded example of one (ReviewExample.tsx).
 *
 * Ticket 10: once step 6 is marked, the screen Done (DoneScreen.tsx) stands in place of the steps,
 * with "Connect your own project" and "Remove the demo project"; "Show steps" brings the list back
 * until the panel mounts again. A removal takes steps 2–6 back, so the list returns by itself.
 *
 * Ticket 14: while the panel is expanded, a ring marks the one element to press next (highlight.ts):
 * the current step's button, "Check again" of First run, or Send of the demo Orchestrator's field
 * while the text a step's button put there lies in it. The ring is only visual: a screen reader hears
 * the current step from `aria-current="step"`, as before.
 */

const QUESTION = 'What is planned in this project?'
const SHIP = '/worfy:ship-ticket todo 01'

/** Where the panel and its pill stand: the top right corner under the toolbar, where the toasts start (toast.css). */
const corner: CSSProperties = {
  position: 'fixed',
  top: 'calc(var(--toolbar-height) + var(--space-3))',
  right: 'var(--space-4)',
  // Below First run and the menus (90), Add project and Connect (95), the Command palette (100) and Settings (110).
  zIndex: 80,
  fontFamily: 'var(--font-ui)',
}

/**
 * The top of the panel and its pill while the window shows the Session view (owner's decision Q22):
 * under the Session's header (44 px, session.css `.w-session__header`) and under the place of its ⌘F
 * find bar (8 px below the header, 32 px high, session.css `.w-session-find`), so Hide tools,
 * Interrupt and the find bar stay uncovered. The panel stays there while the find bar is closed: it
 * does not jump when ⌘F opens it.
 */
const TOP_IN_SESSION = 'calc(var(--toolbar-height) + 44px + var(--space-2) + 32px + var(--space-2))'

const styles = {
  panel: {
    ...corner,
    width: 'min(320px, calc(100vw - 2 * var(--space-4)))',
    maxHeight: '70vh',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-popover)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
    color: 'var(--text)',
  },
  header: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 2px 12px' },
  heading: { flex: 1, minWidth: 0, margin: 0, fontSize: 'var(--text-13)', lineHeight: '18px', fontWeight: 600, color: 'var(--text)' },
  // Only a window too short for the whole content makes this scroll.
  body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 4px 4px' },
  pill: {
    ...corner,
    height: 28,
    padding: '0 12px',
    border: '1px solid var(--border)',
    borderRadius: 14,
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
    color: 'var(--text)',
    fontSize: 'var(--text-12)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  intro: { margin: '0 8px 4px', fontSize: 'var(--text-12)', lineHeight: '15px', color: 'var(--text-secondary)' },
  steps: { margin: 0, padding: '0 8px', listStyle: 'none', display: 'flex', flexDirection: 'column' },
  step: { display: 'flex', gap: 8, padding: '3px 0 4px' },
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
  stepBody: { flex: 1, minWidth: 0 },
  title: { display: 'block', fontSize: 'var(--text-13)', lineHeight: '16px', fontWeight: 600, color: 'var(--text)' },
  titleDone: { fontWeight: 500, color: 'var(--text-secondary)' },
  line: { margin: '1px 0 0', fontSize: 'var(--text-12)', lineHeight: '15px', color: 'var(--text-secondary)', overflowWrap: 'anywhere' },
  note: { margin: '2px 0 0', fontSize: 'var(--text-11)', lineHeight: '14px', color: 'var(--text-muted)' },
  action: { marginTop: 6 },
  hint: {
    margin: '6px 0 0',
    padding: '3px 6px',
    borderLeft: '2px solid var(--accent)',
    fontSize: 'var(--text-12)',
    lineHeight: '15px',
    color: 'var(--text-secondary)',
    overflowWrap: 'anywhere',
  },
  progress: { margin: '4px 0 0', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--working-text)' },
  error: { margin: '4px 0 0', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
  connect: { margin: '6px 8px 0', padding: '8px 0 0', borderTop: '1px solid var(--border)' },
  footer: { display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 2px' },
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
  message: { flex: 'none', margin: '0 12px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

interface StepText {
  title: string
  line: string
}

const STEP_TEXTS: Record<GettingStartedStep, StepText> = {
  '1': { title: 'Check your setup', line: 'Make sure Claude Code, git, node and the Harness are ready.' },
  '2': { title: 'Open the demo project', line: 'worfy creates a small todo app in your home folder. No GitHub needed.' },
  '3': { title: 'Meet the Orchestrator', line: "Ask the project's main Session what is planned." },
  '4': { title: 'Ship the ticket', line: 'The Orchestrator implements the ticket in its own branch. The Pipeline shows each Stage.' },
  '5': { title: 'See the review', line: 'A reviewer checks the work. If it finds a problem, the Orchestrator fixes it.' },
  '6': { title: 'Merge', line: 'The Orchestrator merges the ticket into main.' },
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M3.5 8h9" />
    </svg>
  )
}

/** The tooltip of a marked step: when main marked it, in the user's own format. */
function doneTitle(at: string): string {
  const time = new Date(at)
  return Number.isNaN(time.getTime()) ? 'Done' : `Done ${time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

/** Expands the panel and focuses its heading each time openGettingStarted() asks; an old request is not done again on a remount. */
let focusDone = 0

/** The hints this window has told main about; a remount or a Stage met again asks no more. */
const hintsTold = new Set<string>()

/** Tells main the hint was shown; the one call main answers `first` shows the toast, in the Demo project only. */
function announceHint(hint: StageHint, projectId: string): void {
  if (hintsTold.has(hint.id)) return
  hintsTold.add(hint.id)
  void invoke('gettingStarted.hintSeen', { id: hint.id }).then((result) => {
    if (!result.ok) {
      // Asked again at the next mount: a hint is better shown twice than never.
      hintsTold.delete(hint.id)
      console.error('gettingStarted.hintSeen failed:', result.error)
    } else if (result.value.first) {
      showToast({ kind: 'info', text: hint.text, projectId, key: `getting-started-hint-${hint.id}`, testId: 'getting-started-hint-toast' })
    }
  })
}

/**
 * Collapsed or not: `sidebar.collapsed.GettingStartedSection` of the app settings, and the way to
 * change it. What the last choice asked for is shown at once, while its write is on its way to main
 * or was refused (app-settings.json cannot be written): the pill and "Collapse" never go dead.
 */
function useCollapsed(): [boolean, (next: boolean) => void] {
  const saved = useAppSettings((settings) => settings.sidebar.collapsed[GETTING_STARTED_COLLAPSED_KEY])
  const [chosen, setChosen] = useState<boolean | null>(null)
  const choices = useRef(0)
  const choose = useCallback((next: boolean) => {
    const choice = ++choices.current
    setChosen(next)
    void setAppSettings({ sidebar: { collapsed: { [GETTING_STARTED_COLLAPSED_KEY]: next } } }).then((refused) => {
      // The answer to an earlier choice: a later one decides.
      if (choice !== choices.current) return
      // Saved: the settings say it now, and a change made in another window is followed again.
      if (refused === undefined) setChosen(null)
      else console.error(`appSettings.set failed, Getting started stays ${next ? 'collapsed' : 'expanded'} in this window only:`, refused)
    })
  }, [])
  return [chosen ?? saved ?? false, choose]
}

/** On screen: not disabled, and laid out — an element inside `hidden` or `display: none` has no client rects. */
function isOnScreen(element: Element): boolean {
  if (element instanceof HTMLButtonElement && element.disabled) return false
  return element.getClientRects().length > 0
}

/** The element of `target` that is on screen; null when there is none. */
function findTarget(target: HighlightTarget): Element | null {
  return [...document.querySelectorAll(targetSelector(target, CSS.escape))].find(isOnScreen) ?? null
}

/** Puts the ring on `element` alone; null takes it off everywhere. */
function ringOnly(element: Element | null): void {
  for (const ringed of document.querySelectorAll(`[${RING_ATTRIBUTE}]`)) if (ringed !== element) ringed.removeAttribute(RING_ATTRIBUTE)
  if (element !== null && !element.hasAttribute(RING_ATTRIBUTE)) element.setAttribute(RING_ATTRIBUTE, '')
}

/** Puts the ring on the target of `input` as the DOM is now. */
function ring(input: Omit<HighlightInput, 'onScreen'>): void {
  const target = highlightTarget({ ...input, onScreen: (each) => findTarget(each) !== null })
  ringOnly(target === null ? null : findTarget(target))
}

/**
 * Keeps the ring of ticket 14 on the target of `input` (highlight.ts): again after each render and at
 * each change of the DOM that can move it — a node added or removed, `hidden` or `disabled` changed (a
 * Session view shown, Send enabled, First run opened). The DOM is read at most once a frame, and not
 * at all while the panel is not expanded.
 */
function useHighlightRing(input: Omit<HighlightInput, 'onScreen'>): void {
  const latest = useRef(input)
  const active = input.snapshot?.section === 'shown' && input.expanded

  // After each render: the state of this render, then the ring for it (a step marked, the text sent).
  useEffect(() => {
    latest.current = input
    if (active) ring(input)
  })

  useEffect(() => {
    if (!active) return undefined
    let frame = 0
    const observer = new MutationObserver(() => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0
          ring(latest.current)
        })
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled'] })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      ringOnly(null)
    }
  }, [active])
}

/** `sessionView`: the window shows the Session view, and the panel stands under its header (TOP_IN_SESSION). */
export function GettingStartedPanel({ sessionView = false }: { sessionView?: boolean } = {}) {
  const snapshot = useGettingStarted()
  const focusAsked = useGettingStartedStore((store) => store.focusAsked)
  const [collapsed, choose] = useCollapsed()
  const heading = useRef<HTMLHeadingElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  // Where the focus goes once a click of the pill or of "Collapse" has replaced the button it was on.
  const focusNext = useRef<'heading' | 'pill' | null>(null)
  const [busy, setBusy] = useState<GettingStartedStep | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ step: GettingStartedStep; text: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showSteps, setShowSteps] = useState(false)
  // The demo Orchestrator's field that the button of step 3 or 4 filled last, and what became of its text.
  const [filled, setFilled] = useState<{ step: GettingStartedStep; nodeId: string } | null>(null)
  const fieldPhase = usePendingInput((state) => (filled === null ? undefined : state.fields[filled.nodeId]))
  const firstRunOpen = useFirstRun((state) => state.open)

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
  // The demo's Stages are read only while Getting started shows, as the panel or as its pill.
  const demoRecord = snapshot !== null && shown ? snapshot.demo : null
  const pipeline = usePipeline(demoRecord?.path)
  const hint = snapshot === null ? null : stageHint({ demo: demoRecord, steps: snapshot.steps, pipeline: pipeline.snapshot })
  useEffect(() => {
    if (hint !== null && demoRecord !== null) announceHint(hint, demoRecord.projectId)
  }, [hint, demoRecord])

  // openGettingStarted(): a pill is expanded first, then the heading takes the focus.
  useEffect(() => {
    if (!shown || focusAsked <= focusDone) return
    if (collapsed) {
      choose(false)
      return
    }
    focusDone = focusAsked
    heading.current?.focus()
  }, [shown, focusAsked, collapsed, choose])

  useEffect(() => {
    const target = focusNext.current === 'pill' && collapsed ? pill.current : focusNext.current === 'heading' && !collapsed ? heading.current : null
    if (target === null) return
    focusNext.current = null
    target.focus()
  }, [collapsed])

  useHighlightRing({
    snapshot,
    expanded: !collapsed,
    firstRunOpen,
    creating: busy === '2',
    field: filled === null || fieldPhase === undefined ? null : { ...filled, phase: fieldPhase },
  })

  if (snapshot === null || !shown) return null
  const place: CSSProperties | undefined = sessionView ? { top: TOP_IN_SESSION } : undefined

  const toggle = (next: boolean): void => {
    focusNext.current = next ? 'pill' : 'heading'
    choose(next)
  }

  if (collapsed) {
    const marked = GETTING_STARTED_STEPS.filter((step) => snapshot.steps[step] !== undefined).length
    return createPortal(
      <button ref={pill} type="button" style={{ ...styles.pill, ...place }} data-testid="getting-started-pill" data-toast-keep-out="true" onClick={() => toggle(false)}>
        Getting started · {marked}/{GETTING_STARTED_STEPS.length}
      </button>,
      document.body,
    )
  }

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

  /** The demo becomes the window's Project; its Orchestrator opens with `text` of `step` ready in the field, not sent. */
  const openDemo = async (step: GettingStartedStep, text: string): Promise<string | undefined> => {
    if (demo === null) return undefined
    const selected = await openProject(null, demo.projectId)
    if (selected !== undefined) return failureReason('projects.select', selected)
    const result = await invoke('orchestrator.open', { projectId: demo.projectId })
    if (!result.ok) return failureReason('orchestrator.open', result.error)
    setPendingInput(result.value.nodeId, text)
    setFilled({ step, nodeId: result.value.nodeId })
    openSession({ nodeId: result.value.nodeId, projectId: demo.projectId })
    return undefined
  }

  const actionOf = (step: GettingStartedStep): ReactNode => {
    const button = (label: string, onClick: () => void, disabled = false) => (
      <div style={styles.action}>
        <button
          type="button"
          className="w-action w-action--primary"
          disabled={disabled || busy !== null}
          data-getting-started-target={targetValue({ kind: 'step', step })}
          onClick={onClick}
        >
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
        return button('Open the Orchestrator', () => void run('3', () => openDemo('3', QUESTION)), demo === null)
      case '4':
        return button('Ship the ticket', () => void run('4', () => openDemo('4', SHIP)), demo === null)
      default:
        return null
    }
  }

  const skip = async (): Promise<void> => {
    setMessage(null)
    const refused = await skipGettingStarted()
    if (refused !== undefined) setMessage(refused)
  }

  return createPortal(
    <div role="region" aria-label="Getting started" style={{ ...styles.panel, ...place }} data-testid="getting-started" data-toast-keep-out="true">
      <div style={styles.header}>
        <h2 ref={heading} tabIndex={-1} style={styles.heading}>
          Getting started
        </h2>
        <button type="button" className="w-action w-action--icon" title="Collapse" aria-label="Collapse" onClick={() => toggle(true)}>
          <CollapseIcon />
        </button>
      </div>
      {message !== null ? (
        <p role="alert" style={styles.message}>
          {message}
        </p>
      ) : null}
      <div style={styles.body} data-testid="getting-started-body">
        {snapshot.steps['6'] !== undefined && !showSteps ? (
          <DoneScreen hasDemo={demo !== null} onShowSteps={() => setShowSteps(true)} onMessage={setMessage} />
        ) : (
          <>
            <p style={styles.intro}>A guided demo: one ticket from start to merge.</p>
            <ol style={styles.steps} aria-label="Steps">
              {GETTING_STARTED_STEPS.map((step) => {
                const at = snapshot.steps[step]
                const done = at !== undefined
                const isCurrent = step === current
                const text = STEP_TEXTS[step]
                // The review ended without a rework round: step 5 says so in place of what it was to show.
                const fallback = step === '5' && done && !snapshot.reworkSeen
                return (
                  <li key={step} style={styles.step} data-step={step} data-done={done ? 'true' : undefined} aria-current={isCurrent ? 'step' : undefined} data-testid="getting-started-step">
                    <span
                      data-testid="getting-started-mark"
                      title={done ? doneTitle(at) : undefined}
                      style={{ ...styles.mark, ...(done ? styles.markDone : isCurrent ? styles.markCurrent : styles.markLater) }}
                    >
                      {done ? <CheckIcon /> : <span aria-hidden="true">{step}</span>}
                    </span>
                    <div style={styles.stepBody}>
                      <span style={{ ...styles.title, ...(done ? styles.titleDone : {}) }}>
                        {text.title}
                        {done ? (
                          <>
                            {' '}
                            <span style={styles.hidden}>done</span>
                          </>
                        ) : null}
                      </span>
                      {fallback ? <ReviewExample /> : <p style={styles.line}>{text.line}</p>}
                      {step === '2' ? <p style={styles.note}>The agents work for real and use your Claude Code usage.</p> : null}
                      {step === '2' && demo !== null ? <CostSwitch cost={demo.cost} /> : null}
                      {isCurrent ? actionOf(step) : null}
                      {hint !== null && step === (current ?? '6') ? (
                        <p style={styles.hint} data-testid="getting-started-hint" data-hint={hint.id}>
                          {hint.text}
                        </p>
                      ) : null}
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
          </>
        )}
        <div style={styles.footer}>
          <button type="button" style={styles.skip} onClick={() => void skip()}>
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

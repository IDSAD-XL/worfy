// The checks of First run, for the two places that show them (worfy-ui ticket 6): the First run
// dialog (FirstRun.tsx) and Settings → Health (settings/HealthSection.tsx). The checks main runs
// over this Machine, grouped, each with its status, what was found and what to do, and the buttons
// of the actions; the look is docs/design/F-SPEC.md, "First run". main asks before each action in a
// dialog with "Confirm"; this file only calls `firstRun.run` and shows what came back. Two actions
// are its own: "Move…" opens the move form of the old Harness (src/renderer/harness/MigrationForm.tsx),
// and a confirmed GitHub sign-in puts a Terminal Node on the active Project's Canvas with
// `gh auth login` typed in. Without a Project there is no Canvas for it: the row shows the command
// to copy instead.
//
// The checks and whether one is running are the store's (first-run-store.ts); the action that is
// running is kept here, outside React. So both places show the same thing, and a section that left
// the screen and came back finds its action still running.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import type { Check, CheckGroup, CheckStatus, FirstRunAction } from '../../shared/ipc/first-run'
import { applyLayoutOp } from '../canvas/useLayout'
import { focusCanvasNode } from '../find/canvas-requests'
import MigrationForm from '../harness/MigrationForm'
import { invoke } from '../ipc'
import { activeProject, useProjects } from '../projects/useProjects'
import { setView } from '../session/navigation'
import { showToast } from '../toast/toasts'
import { checkAgain, useFirstRun } from './first-run-store'

/** The size of the Terminal Node the GitHub sign-in opens: the default of the Terminal Node type. */
const TERMINAL_SIZE = { w: 560, h: 340 }
// Windows has rows only on Windows (worfy-windows ticket 13); a group without rows is not shown.
const GROUPS: readonly CheckGroup[] = ['Claude Code', 'Windows', 'Command-line tools', 'GitHub', 'Harness', 'qmd']

type ChipState = CheckStatus | 'running'
const CHIP_LABEL: Record<ChipState, string> = { ok: 'OK', warn: 'Warning', fail: 'Failed', running: 'Running…' }

const styles = {
  group: { margin: 'var(--space-3) 0 0' },
  groupTitle: { margin: '0 0 var(--space-1)', color: 'var(--text-muted)', fontSize: 'var(--text-11)', fontWeight: 600 },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  row: { padding: '4px 0', borderBottom: '1px solid var(--border)' },
  line: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 'var(--row-height)' },
  name: { flex: 'none', width: 190, fontSize: 'var(--text-13)' },
  detail: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-secondary)',
  },
  buttons: { flex: 'none', display: 'flex', gap: 'var(--space-1)' },
  hint: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', margin: '0 0 2px', paddingLeft: 72, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  command: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', color: 'var(--text)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-chip)', padding: '0 6px' },
  message: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' },
  error: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--blocked-text)', whiteSpace: 'pre-wrap' },
} satisfies Record<string, CSSProperties>

/** The status chip: the shared chip's shape (F-SPEC "Shape"), the colors of the status roles, and always a label. */
const CHIP_STYLE: Record<ChipState, CSSProperties> = {
  ok: { background: 'var(--ready-bg)', color: 'var(--ready-text)', borderColor: 'transparent' },
  warn: { background: 'var(--surface-raised)', color: 'var(--blocked-text)', borderColor: 'var(--border)' },
  fail: { background: 'var(--blocked-bg)', color: 'var(--blocked-text)', borderColor: 'var(--blocked-ring)' },
  running: { background: 'var(--working-bg)', color: 'var(--working-text)', borderColor: 'transparent' },
}

function StatusChip({ state }: { state: ChipState }) {
  return (
    <span className="w-chip w-chip--bordered" data-chip={state} style={{ ...CHIP_STYLE[state], flex: 'none', width: 64, justifyContent: 'center' }}>
      {CHIP_LABEL[state]}
    </span>
  )
}

/** Copies a command; a `success` toast of the window says what was copied, the label stays "Copy". */
function CopyButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="w-action"
      aria-label={`Copy ${text}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => showToast({ kind: 'success', key: 'copied', text: `Copied ${text}` }))
      }}
    >
      Copy
    </button>
  )
}

interface RowProps {
  check: Check
  running: boolean
  locked: boolean
  /** The active Project's name: where a GitHub sign-in opens its Terminal; undefined with none. */
  projectName: string | undefined
  onAction: (action: FirstRunAction) => void
}

function CheckRow({ check, running, locked, projectName, onAction }: RowProps) {
  // Without a Project the sign-in has no Canvas to open a Terminal on: the command is copied instead.
  const actions = check.actions.filter((action) => action.id !== 'gh-login' || projectName !== undefined)
  const noCanvas = check.actions.some((action) => action.id === 'gh-login') && projectName === undefined
  const hint = noCanvas ? `${check.hint}. No Project is connected yet, so run it in a terminal` : check.hint
  return (
    <li style={styles.row} data-check={check.id} data-status={check.status} aria-label={check.title}>
      <div style={styles.line}>
        <StatusChip state={running ? 'running' : check.status} />
        <span style={styles.name}>{check.title}</span>
        <span style={styles.detail} title={check.detail}>
          {check.detail}
        </span>
        <span style={styles.buttons}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="w-action"
              aria-disabled={locked ? 'true' : undefined}
              title={action.id === 'gh-login' && projectName !== undefined ? `Opens a Terminal on the Canvas of ${projectName}` : undefined}
              onClick={() => {
                if (!locked) onAction(action.id)
              }}
            >
              {action.label}
            </button>
          ))}
        </span>
      </div>
      {hint !== '' || check.command !== null ? (
        <p style={styles.hint}>
          {hint !== '' ? <span>{hint}</span> : null}
          {check.command !== null ? (
            <>
              <code style={styles.command}>{check.command}</code>
              <CopyButton text={check.command} />
            </>
          ) : null}
        </p>
      ) : null}
    </li>
  )
}

/** Puts a Terminal Node on the Project's Canvas and has main type `gh auth login` into its new shell. */
async function openSignInTerminal(projectId: string): Promise<string | undefined> {
  // The camera this machine saved for the Canvas (worfy-link ticket 06): the Terminal lands in sight.
  const camera = await invoke('viewport.get', { projectId })
  // null only for a Project of a Linked machine with no camera saved here (worfy-link ticket 09).
  const viewport = (camera.ok ? camera.value : null) ?? { x: 0, y: 0, zoom: 1 }
  const id = `terminal-${crypto.randomUUID()}`
  // Hidden until its shell runs: the Canvas does not draw a hidden Node, so the Node's own view
  // cannot start a shell without the command first. main moves it off any Node it would cover.
  const created = await applyLayoutOp(projectId, {
    op: 'create',
    node: { id, kind: 'terminal', x: Math.round(-viewport.x / viewport.zoom) + 40, y: Math.round(-viewport.y / viewport.zoom) + 40, ...TERMINAL_SIZE, hidden: true },
  })
  if (created !== undefined) return created
  const opened = await invoke('terminal.open', { projectId, nodeId: id, cols: 80, rows: 24, command: 'gh auth login' })
  if (!opened.ok) {
    await applyLayoutOp(projectId, { op: 'remove', id })
    return failureReason('terminal.open', opened.error)
  }
  const shown = await applyLayoutOp(projectId, { op: 'hide', id, hidden: false })
  if (shown !== undefined) return shown
  setView('canvas')
  focusCanvasNode(projectId, id)
  return undefined
}

/**
 * The action main is running now, wherever it was pressed: one at a time. The First run dialog
 * cannot close while it runs, but Settings can, and the Health section leaves the screen with it.
 */
const useAction = create<{ running: FirstRunAction | null }>(() => ({ running: null }))

/** How many places show the checks now: the dialog, the Health section, or both. */
let views = 0
let stopWaiting: (() => void) | null = null

const watched = (): boolean => views > 0 || useFirstRun.getState().open

function forgetNow(): void {
  const { report, failure } = useFirstRun.getState()
  if (!watched() && (report !== null || failure !== null)) useFirstRun.setState({ report: null, failure: null })
}

/**
 * The store keeps checks only while something shows them: openFirstRun (first-run-store.ts) checks
 * afresh only when it finds none, and the dialog's own Close leaves none. The Health section leaves
 * the screen without that Close, so its checks are dropped here — once the check that is running
 * has ended; an action that is running keeps them, and calls this again when it ends.
 */
function forgetWhenUnwatched(): void {
  stopWaiting?.()
  stopWaiting = null
  if (watched() || useAction.getState().running !== null) return
  if (!useFirstRun.getState().checking) {
    forgetNow()
    return
  }
  const stop = useFirstRun.subscribe((state) => {
    if (!watched() && state.checking) return
    stop()
    forgetNow()
  })
  stopWaiting = stop
}

/** What Tab stops at inside the move form. */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const focusablesOf = (element: HTMLElement): HTMLElement[] => [...element.querySelectorAll<HTMLElement>(FOCUSABLE)]

/**
 * The move form over a modal window (Settings → Health). The form is drawn in a layer above that
 * window, and the window's guard (settings/settings-window.ts) leaves the keys and the focus of
 * such a layer alone — but only while the focus is in it: with the focus on the page or on the
 * window under the form, Esc would close the window and Tab would walk its controls, unseen. So
 * the focus goes into the form when it opens and is brought back whenever the form loses it to
 * nothing: a press on text of the form, the control that had it gone (the form draws itself anew
 * when main answers) or switched off ("Move" while main moves). Tab turns round at the form's
 * ends, and the focus returns to where it was when the form closes. Keys pressed in the form stop
 * here: React passes them on to the window the form was opened from, which would take Tab and Esc
 * for its own.
 */
function KeyboardInForm({ children }: { children: ReactNode }) {
  const layer = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // The form draws itself into document.body: its backdrop is the layer.
    const element = document.querySelector<HTMLElement>('[data-testid="migration-form"]')?.parentElement ?? null
    layer.current = element
    if (element === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    /** The control of the form that had the focus last. */
    let held: HTMLElement | null = null
    /** The focus is on its way from a control of the form to another element: a focus() now would cancel that move. */
    let moving = false

    /** A control of the form that can hold the focus: in the layer, and not switched off. */
    const holds = (node: Element | null): node is HTMLElement => node instanceof HTMLElement && node !== element && element.contains(node) && !node.matches(':disabled')

    /** Puts the focus into the form: on the control that had it, else on the first one. */
    const enter = (options?: FocusOptions): void => {
      const control = holds(held) ? held : focusablesOf(element)[0]
      if (control !== undefined) {
        control.focus(options)
        return
      }
      // Every control is off (main is moving): the layer itself holds the focus, so the keys still come here.
      element.tabIndex = -1
      element.style.outline = 'none'
      element.focus()
    }

    /**
     * Brings the focus back when the form lost it to nothing: to the page (a press on text, or the
     * control that had it is gone), to the layer itself, or to a control of the form that is off.
     * The focus on anything else is not this form's to take. The form stays where it is scrolled to:
     * a press on text far down a long plan must not jump back to the control that has the focus.
     */
    const keep = (): void => {
      if (moving) return
      const active = document.activeElement
      if (active === null || active === document.body || (element.contains(active) && !holds(active))) enter({ preventScroll: true })
    }

    // Capture: before a handler of the control itself can redraw the form in the middle of the move.
    const onBlur = (event: FocusEvent): void => {
      moving = event.relatedTarget !== null
      // To nothing: a press on text. (The app window losing the focus looks the same; the control still has it then.)
      if (!moving) queueMicrotask(keep)
    }
    const onFocusIn = (event: FocusEvent): void => {
      moving = false
      if (event.target instanceof Element && holds(event.target)) held = event.target
      // On the layer itself (a press on text once the layer takes the focus): on to a control.
      else queueMicrotask(keep)
    }

    const observer = new MutationObserver(keep)
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] })
    element.addEventListener('blur', onBlur, true)
    document.addEventListener('focusin', onFocusIn, true)
    enter()
    return () => {
      observer.disconnect()
      element.removeEventListener('blur', onBlur, true)
      document.removeEventListener('focusin', onFocusIn, true)
      layer.current = null
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    event.stopPropagation()
    const element = layer.current
    if (event.key !== 'Tab' || element === null) return
    const focusable = focusablesOf(element)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) {
      // Nothing to stop at: Tab must not leave for the window under the form.
      event.preventDefault()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // The form's own elements are in document.body; this one only stands in React's tree above them.
  return (
    <div style={{ display: 'contents' }} onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}

/** The parts of the checks, for the place that shows them to lay out. */
export interface FirstRunChecksParts {
  /** The chip that sums the checks up: "Checking…", "2 failed · 1 warning", "Everything is ready"; null before the first checks. */
  summary: ReactNode
  /** The groups with their rows. */
  list: ReactNode
  /** What the last action came to, or why the checks could not run; an alert when it is an error. Fills its line. */
  message: ReactNode
  /** The "Check again" button. */
  checkAgain: ReactNode
  /** An action is running: the place does not close until it ends. */
  running: boolean
  /** The move form is open over the place. */
  migrating: boolean
}

export interface FirstRunChecksProps {
  /** A confirmed GitHub sign-in opened its Terminal on the Canvas: the place gets out of its way. */
  onTerminalOpened: () => void
  /**
   * The place asks for the checks itself: when it comes on screen and whenever there are none
   * (Settings → Health). Without it the checks are asked for by whoever opened the place
   * (openFirstRun for the dialog).
   */
  checkOnShow?: boolean
  /**
   * The z-index for the move form when the place is a modal window above the form's own layer
   * (Settings). The form then also takes the keyboard while it is open.
   */
  formLayer?: number
  children: (parts: FirstRunChecksParts) => ReactNode
}

/** The checks and their actions; `children` lays the parts out. */
export function FirstRunChecks({ onTerminalOpened, checkOnShow = false, formLayer, children }: FirstRunChecksProps) {
  const report = useFirstRun((state) => state.report)
  const checking = useFirstRun((state) => state.checking)
  const failure = useFirstRun((state) => state.failure)
  const running = useAction((state) => state.running)
  const project = activeProject(useProjects())
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [migrating, setMigrating] = useState(false)
  const shown = useRef(false)

  useEffect(() => {
    views += 1
    shown.current = true
    return () => {
      views -= 1
      shown.current = false
      forgetWhenUnwatched()
    }
  }, [])

  // Coming on screen checks, except under an action: main checks again itself when the action ends.
  useEffect(() => {
    if (checkOnShow && useAction.getState().running === null) void checkAgain()
  }, [checkOnShow])
  // No checks and nothing running: the check asked for the dialog was dropped when the dialog
  // closed (first-run-store.ts). A check that could not run is not asked again by itself.
  useEffect(() => {
    if (checkOnShow && report === null && !checking && failure === null && running === null) void checkAgain()
  }, [checkOnShow, report, checking, failure, running])

  const act = async (action: FirstRunAction): Promise<void> => {
    if (action === 'migration-form') {
      setMigrating(true)
      return
    }
    if (useAction.getState().running !== null) return
    useAction.setState({ running: action })
    setMessage(null)
    const result = await invoke('firstRun.run', { action, projectName: project?.name })
    // The checks before the lock opens, so nothing asks for them in between.
    if (result.ok) useFirstRun.setState({ report: result.value.report })
    useAction.setState({ running: null })
    // Pressed in a section that has left the screen since: nothing shows these checks.
    forgetWhenUnwatched()
    if (!result.ok) {
      setMessage({ error: true, text: failureReason('firstRun.run', result.error) })
      return
    }
    if (result.value.outcome === 'failed') setMessage({ error: true, text: result.value.message ?? 'The action failed' })
    else if (result.value.outcome === 'done' && result.value.message !== null) setMessage({ error: false, text: result.value.message })
    else if (result.value.outcome === 'confirmed' && project !== undefined) {
      const failed = await openSignInTerminal(project.id)
      if (failed !== undefined) setMessage({ error: true, text: failed })
      else if (shown.current) onTerminalOpened()
    }
  }

  const rowAction = (check: Check): FirstRunAction | null => check.actions.find((each) => each.id === running)?.id ?? null
  const checks = report?.checks ?? []
  const failed = checks.filter((each) => each.status === 'fail').length
  const warned = checks.filter((each) => each.status === 'warn').length
  const summary = checking ? 'Checking…' : report === null ? '' : failed + warned === 0 ? 'Everything is ready' : [failed > 0 ? `${failed} failed` : null, warned > 0 ? `${warned} ${warned === 1 ? 'warning' : 'warnings'}` : null].filter(Boolean).join(' · ')
  const locked = running !== null || checking
  const isError = message?.error || failure !== null

  const form = migrating ? (
    <MigrationForm
      layer={formLayer}
      onClose={() => {
        setMigrating(false)
        void checkAgain()
      }}
      onMoved={() => void checkAgain()}
    />
  ) : null

  return (
    <>
      {children({
        summary:
          summary !== '' ? (
            <span className="w-chip w-chip--bordered" data-testid="first-run-summary" style={checking ? CHIP_STYLE.running : failed > 0 ? CHIP_STYLE.fail : warned > 0 ? CHIP_STYLE.warn : CHIP_STYLE.ok}>
              {summary}
            </span>
          ) : null,
        list: GROUPS.map((group) => {
          const rows = checks.filter((each) => each.group === group)
          if (rows.length === 0) return null
          return (
            <section key={group} style={styles.group} aria-label={group}>
              <h3 style={styles.groupTitle}>{group}</h3>
              <ul style={styles.list}>
                {rows.map((each) => (
                  <CheckRow key={each.id} check={each} running={rowAction(each) !== null} locked={locked} projectName={project?.name} onAction={(action) => void act(action)} />
                ))}
              </ul>
            </section>
          )
        }),
        message: (
          <span style={isError ? styles.error : styles.message} role={isError ? 'alert' : undefined}>
            {message?.text ?? failure ?? ''}
          </span>
        ),
        checkAgain: (
          // A target of the Getting started ring in First run (worfy-onboarding ticket 14, getting-started/highlight.ts).
          <button type="button" className="w-action" aria-disabled={locked ? 'true' : undefined} data-getting-started-target="check-again" onClick={() => !locked && void checkAgain()}>
            Check again
          </button>
        ),
        running: running !== null,
        migrating,
      })}
      {form !== null && formLayer !== undefined ? <KeyboardInForm>{form}</KeyboardInForm> : form}
    </>
  )
}

// The checks of First run, for the two places that show them (worfy-ui ticket 6): the First run
// dialog (FirstRun.tsx) and Settings → Health (settings/HealthSection.tsx). The checks main runs
// over this Machine, grouped, each with its status, what was found and what to do, and the buttons
// of the actions; the look is docs/design/F-SPEC.md, "First run". main asks before each action in a
// dialog with "Confirm"; this file only calls `firstRun.run` and shows what came back. Three actions
// are its own: "Move…" opens the move form of the old Harness (src/renderer/harness/MigrationForm.tsx),
// "Show log" of "worfy version" asks main for `update.showLog`, and a confirmed GitHub sign-in puts
// a Terminal Node on the active Project's Canvas with `gh auth login` typed in. Without a Project
// there is no Canvas for it: the row shows the command to copy instead. The rows "Harness on Claude Code"
// (worfy-harness-guarantees ticket 09) have three more of its own: "Run again" asks `firstRun.harnessClaude`, "Copy
// details" copies the row's details, and "Changelog" opens its link in the browser.
//
// The checks and whether one is running are the store's (first-run-store.ts); the action that is
// running is kept here, outside React. So both places show the same thing, and a section that left
// the screen and came back finds its action still running.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import { checkState, type Check, type CheckGroup, type CheckStatus, type FirstRunAction } from '../../shared/ipc/first-run'
import { applyLayoutOp } from '../canvas/useLayout'
import { focusCanvasNode } from '../find/canvas-requests'
import MigrationForm from '../harness/MigrationForm'
import { invoke } from '../ipc'
import { LinkMachineDialog } from '../machines/LinkMachineDialog'
import { activeProject, openProject, useProjects } from '../projects/useProjects'
import { setView } from '../session/navigation'
import { Chip, type Status } from '../theme/Chip'
import { showToast } from '../toast/toasts'
import { elapsedText, useTicking } from '../update/store'
import { checkAgain, useFirstRun } from './first-run-store'
import './shell.css'

/** The size of the Terminal Node the GitHub sign-in opens: the default of the Terminal Node type. */
const TERMINAL_SIZE = { w: 560, h: 340 }
// Windows has rows only on Windows (worfy-windows ticket 13); a group without rows is not shown. The
// last three are worfy-auth-check's (ticket 03): the rows of each Project, the Codex sign-in, a Linked machine.
const GROUPS: readonly CheckGroup[] = ['Claude Code', 'Windows', 'Command-line tools', 'GitHub', 'worfy', 'Harness', 'qmd', 'Projects', 'Codex', 'Linked machines']

/**
 * Where a row stands (worfy-auth-check ticket 04; spec, the solution, point 2): 0 — a critical row
 * that is not `ok`, 1 — any other row that is not `ok`, 2 — `ok`. A row that could not be checked
 * (`unknown`) is never critical (Q2), whatever its `severity` says.
 */
function rowRank(check: Pick<Check, 'status' | 'severity'>): 0 | 1 | 2 {
  if (check.status === 'ok') return 2
  return check.status !== 'unknown' && check.severity === 'critical' ? 0 : 1
}

/** A block of rows under one heading: a group, or for the Projects group one block per Project (Q4). */
interface CheckBlock {
  key: string
  title: string
  rows: Check[]
}

/**
 * The rows in the order Health check shows them: the critical rows that are not `ok` first, then the
 * other rows that are not, then the `ok` ones. Rows keep their group, so the groups go by the first
 * row each holds; groups and rows of one rank keep the order of GROUPS and of the report.
 */
function checkBlocks(checks: readonly Check[]): CheckBlock[] {
  const blocks: CheckBlock[] = []
  for (const group of GROUPS) {
    const rows = checks.filter((each) => each.group === group)
    if (group !== 'Projects') {
      if (rows.length > 0) blocks.push({ key: group, title: group, rows })
      continue
    }
    const projects = new Map<string, CheckBlock>()
    for (const row of rows) {
      const key = `Projects:${row.project?.id ?? ''}`
      const block = projects.get(key) ?? { key, title: row.project === undefined ? 'Projects' : `Projects · ${row.project.name}`, rows: [] }
      block.rows.push(row)
      projects.set(key, block)
    }
    blocks.push(...projects.values())
  }
  const first = (block: CheckBlock): number => Math.min(...block.rows.map(rowRank))
  for (const block of blocks) block.rows.sort((a, b) => rowRank(a) - rowRank(b))
  return blocks.sort((a, b) => first(a) - first(b))
}

/** The level a row not in `ok` says by its name (CONTEXT.md, Health check). */
const LEVEL_LABEL = { critical: 'Critical', 'non-critical': 'Non-critical' } as const

type ChipState = CheckStatus | 'running' | 'checking'

/**
 * What a pressed button says while its action runs (worfy-polish ticket 77), in place of its label.
 * The Harness button is labelled by its state (Install, Update, Replace, Retry): only Update reads
 * as "Updating…".
 */
const BUSY_LABEL: Record<FirstRunAction, string> = {
  'harness-install': 'Installing…',
  'migration-form': 'Moving…',
  'qmd-install': 'Installing…',
  'qmd-models-download': 'Downloading…',
  'qmd-models-skip': 'Skipping…',
  'qmd-collections': 'Setting up…',
  'gh-login': 'Signing in…',
  'limits-bridge': 'Setting up…',
  'update-log': 'Opening…',
  'use-login': 'Saving…',
  'open-link': 'Opening…',
  'codex-sign-in': 'Signing in…',
  'open-browser': 'Opening…',
  'link-machine': 'Opening…',
  'integration-sign-in': 'Signing in…',
  'harness-claude-run': 'Running…',
  'copy-details': 'Copying…',
}
const busyLabel = (action: Check['actions'][number]): string => (action.id === 'harness-install' && action.label === 'Update' ? 'Updating…' : BUSY_LABEL[action.id])

/**
 * The step a long action names under its row, with the time it has taken: the actions that can run
 * for minutes (npm, `qmd pull`, `qmd-collections`, the Harness with its dependencies). main sends no
 * output of them while they run, so the line has the step and the time only.
 */
const PROGRESS: Partial<Record<FirstRunAction, string>> = {
  'harness-install': 'Installing the Harness…',
  'qmd-install': 'Installing qmd with npm…',
  'qmd-models-download': 'Downloading models…',
  'qmd-collections': 'Setting up collections…',
  'harness-claude-run': 'Running the Harness checks on Claude Code…',
}
const progressText = (action: Check['actions'][number]): string | undefined =>
  action.id === 'harness-install' && action.label === 'Update' ? 'Updating the Harness…' : PROGRESS[action.id]

/**
 * Why a button is off while another one works. A button that is off is `aria-disabled` (muted, no
 * fill: F-SPEC "First run") and ignores the click, but is not `disabled`: a `disabled` button drops
 * the focus to the page, and the focus must stay on the button that was pressed with the keyboard
 * and come back to "Move…" when the move form closes while the checks run again.
 */
const BUSY_REASON = 'Another check is running'

/** The ring that turns before the words of a busy button; it stands still with reduced motion (shell.css). */
function BusyLabel({ text }: { text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="w-update-spinner" aria-hidden="true" />
      {text}
    </span>
  )
}

const styles = {
  group: { margin: 'var(--space-3) 0 0' },
  groupTitle: { margin: '0 0 var(--space-1)', color: 'var(--text-muted)', fontSize: 'var(--text-11)', fontWeight: 600 },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  row: { padding: '4px 0', borderBottom: '1px solid var(--border)' },
  line: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 'var(--row-height)' },
  name: { flex: 'none', width: 190, fontSize: 'var(--text-13)' },
  level: { flex: 'none', width: 78, fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  critical: { flex: 'none', width: 78, fontSize: 'var(--text-11)', fontWeight: 600, color: 'var(--blocked-text)' },
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
  hint: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', margin: '0 0 2px', paddingLeft: 80, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  command: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', color: 'var(--text)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-chip)', padding: '0 6px' },
  progress: { margin: '0 0 2px', paddingLeft: 80, color: 'var(--working-text)', fontSize: 'var(--text-12)' },
  time: { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' },
  message: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' },
  error: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--blocked-text)', whiteSpace: 'pre-wrap' },
} satisfies Record<string, CSSProperties>

/**
 * The status chips of F-SPEC ("First run", "Status chips"): the shared chip's shape, each a word alone, all
 * with a 1 px border (transparent where the status has no ring), so a row's chips are one size.
 */
const FIRST_RUN_CHIP: Record<ChipState, { variant: Status; label: string; bordered?: true; quiet?: true }> = {
  ok: { variant: 'ready', label: 'OK', bordered: true },
  warn: { variant: 'blocked', label: 'Warning', quiet: true },
  fail: { variant: 'blocked', label: 'Failed', bordered: true },
  // Could not be checked (worfy-auth-check, Q2): not a failure, so not the blocked look of one.
  unknown: { variant: 'done', label: 'Unknown', quiet: true },
  running: { variant: 'working', label: 'Running…', bordered: true },
  checking: { variant: 'working', label: 'Checking…', bordered: true },
}

const CHIP_FACE = { flex: 'none', width: 72, justifyContent: 'center' } satisfies CSSProperties

function StatusChip({ state }: { state: ChipState }) {
  return <Chip {...FIRST_RUN_CHIP[state]} icon={null} data-chip={state} style={CHIP_FACE} />
}

/**
 * Copies a command; a `success` toast of the window says what was copied, the label is "Copy" again
 * once the clipboard took it. It does not wait for a check: copying changes nothing main checks.
 */
function CopyButton({ text }: { text: string }) {
  const [copying, setCopying] = useState(false)
  return (
    <button
      type="button"
      className="w-action"
      aria-label={`Copy ${text}`}
      aria-disabled={copying ? 'true' : undefined}
      onClick={() => {
        const clipboard = navigator.clipboard
        if (copying || clipboard === undefined) return
        setCopying(true)
        void clipboard
          .writeText(text)
          .then(() => showToast({ kind: 'success', key: 'copied', text: `Copied ${text}` }))
          .finally(() => setCopying(false))
      }}
    >
      {copying ? <BusyLabel text="Copying…" /> : 'Copy'}
    </button>
  )
}

/** The step of a long action and the time since it was pressed, m:ss; it counts each second. */
function Progress({ text, since }: { text: string; since: number }) {
  const now = useTicking(true, Date.now)
  return (
    <p style={styles.progress} data-testid="first-run-progress">
      {text} <span style={styles.time}>{elapsedText(new Date(since).toISOString(), now)}</span>
    </p>
  )
}

interface RowProps {
  check: Check
  /** The action of this row that is running now, if any. */
  busy: FirstRunAction | null
  /** When `busy` was pressed, in ms since the epoch. */
  since: number | null
  /** "Check again" is running: the row waits for its new check. */
  checking: boolean
  locked: boolean
  /** The active Project's name: where a GitHub sign-in opens its Terminal; undefined with none. */
  projectName: string | undefined
  onAction: (action: FirstRunAction) => void
}

function CheckRow({ check, busy, since, checking, locked, projectName, onAction }: RowProps) {
  // Without a Project the sign-in has no Canvas to open a Terminal on: the command is copied instead.
  const actions = check.actions.filter((action) => action.id !== 'gh-login' || projectName !== undefined)
  const noCanvas = check.actions.some((action) => action.id === 'gh-login') && projectName === undefined
  const hint = noCanvas ? `${check.hint}. No Project is connected yet, so run it in a terminal` : check.hint
  const pressed = actions.find((action) => action.id === busy)
  const progress = pressed === undefined ? undefined : progressText(pressed)
  // A row a `safe` button repairs (spec: the repair) offers it as "Fix"; the tooltip names what it does.
  const fixable = checkState(check) === 'fixable'
  const rank = rowRank(check)
  // What could not be checked says why (Q2), in place of what was found.
  const detail = check.status === 'unknown' ? `Couldn't check: ${check.detail === '' ? 'no answer' : check.detail}` : check.detail
  return (
    <li
      style={styles.row}
      data-check={check.id}
      data-status={check.status}
      data-severity={check.severity}
      aria-label={check.project === undefined ? check.title : `${check.title}, ${check.project.name}`}
      aria-busy={busy !== null || checking ? 'true' : undefined}
    >
      <div style={styles.line}>
        <StatusChip state={busy !== null ? 'running' : checking ? 'checking' : check.status} />
        <span style={styles.name}>{check.title}</span>
        {/* The level of a row not in `ok`; an `ok` row keeps the room empty, so the columns stay in line. */}
        <span style={rank === 0 ? styles.critical : styles.level} data-testid="check-level">
          {rank === 2 ? '' : LEVEL_LABEL[rank === 0 ? 'critical' : 'non-critical']}
        </span>
        <span style={styles.detail} title={detail}>
          {detail}
        </span>
        <span style={styles.buttons}>
          {actions.map((action) => {
            const working = action.id === busy
            const off = locked || working
            const fix = fixable && action.safe === true
            const title = locked && !working ? BUSY_REASON : action.id === 'gh-login' && projectName !== undefined ? `Opens a Terminal on the Canvas of ${projectName}` : fix ? action.label : undefined
            return (
              <button
                key={action.id}
                type="button"
                className={fix ? 'w-action w-action--primary' : 'w-action'}
                aria-disabled={off ? 'true' : undefined}
                aria-label={fix && !working ? `Fix: ${action.label}` : undefined}
                data-fix={fix ? '' : undefined}
                title={title}
                onClick={() => {
                  if (!off) onAction(action.id)
                }}
              >
                {working ? <BusyLabel text={busyLabel(action)} /> : fix ? 'Fix' : action.label}
              </button>
            )
          })}
        </span>
      </div>
      {progress !== undefined && since !== null ? <Progress text={progress} since={since} /> : null}
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
const useAction = create<{
  running: FirstRunAction | null
  /**
   * The row whose button started it (rowKey): two rows may offer the same action (the Harness and its
   * dependencies), and the GitHub access rows of two Projects share one id.
   */
  row: string | null
  /** When it was pressed, in ms since the epoch. */
  since: number | null
}>(() => ({ running: null, row: null, since: null }))
const idle = { running: null, row: null, since: null }

/** A row among the rows: its id, and the Project of a row of the group Projects (worfy-auth-check ticket 05). */
const rowKey = (check: Pick<Check, 'id' | 'project' | 'subject'>): string => `${check.id}:${check.project?.id ?? ''}:${check.subject?.id ?? ''}`

/** Starts `action` pressed on `row`: the lock of every button and the clock of its progress line. */
const startAction = (action: FirstRunAction, row: string): void => useAction.setState({ running: action, row, since: Date.now() })

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

/** The parts of the checks, for the place that shows them to lay out. */
export interface FirstRunChecksParts {
  /**
   * The chip that sums the checks up: "2 failed · 1 warning", "Everything is ready". Null before the first checks
   * and while a check runs: "Check again" says "Checking…" then, and the place shows it once (worfy-polish ticket 134).
   */
  summary: ReactNode
  /** The groups with their rows. */
  list: ReactNode
  /** What the last action came to, or why the checks could not run; an alert when it is an error. Fills its line. */
  message: ReactNode
  /** The "Check again" button. */
  checkAgain: ReactNode
  /** An action is running: the place does not close until it ends. */
  running: boolean
  /** A form is open over the place: the move form, or the dialog of "Link a machine…". */
  migrating: boolean
}

export interface FirstRunChecksProps {
  /**
   * A confirmed GitHub sign-in opened its Terminal on the Canvas, or "Open Browser" showed a Browser
   * there: the place gets out of its way.
   */
  onTerminalOpened: () => void
  /**
   * The place asks for the checks itself: when it comes on screen and whenever there are none
   * (Settings → Health). Without it the checks are asked for by whoever opened the place
   * (openFirstRun for the dialog).
   */
  checkOnShow?: boolean
  children: (parts: FirstRunChecksParts) => ReactNode
}

/** The checks and their actions; `children` lays the parts out. */
export function FirstRunChecks({ onTerminalOpened, checkOnShow = false, children }: FirstRunChecksProps) {
  const report = useFirstRun((state) => state.report)
  const checking = useFirstRun((state) => state.checking)
  const failure = useFirstRun((state) => state.failure)
  const running = useAction((state) => state.running)
  const pressedRow = useAction((state) => state.row)
  const since = useAction((state) => state.since)
  const project = activeProject(useProjects())
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [linking, setLinking] = useState(false)
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

  const act = async (action: FirstRunAction, check: Check): Promise<void> => {
    const row = rowKey(check)
    if (action === 'migration-form') {
      setMigrating(true)
      return
    }
    // "Link a machine…" of the Linked machine row (worfy-auth-check ticket 08): its dialog, over this place.
    if (action === 'link-machine') {
      setLinking(true)
      return
    }
    // "Copy details" of a row "Harness on Claude Code" (worfy-harness-guarantees ticket 09): the whole answer behind
    // its short line, for a bug report. Copying changes nothing main checks, so it takes no lock.
    if (action === 'copy-details') {
      const clipboard = navigator.clipboard
      if (check.details === undefined || clipboard === undefined) return
      void clipboard.writeText(check.details).then(
        () => showToast({ kind: 'success', key: 'copied', text: `Copied the details of ${check.title}` }),
        () => setMessage({ error: true, text: 'The details could not be copied' }),
      )
      return
    }
    // A link of a row ("Changelog" of the terminal's Claude Code, ticket 09) opens in the browser. Without a `url`
    // it is the SSO link, which worfy-auth-check ticket 06 wires.
    if (action === 'open-link') {
      const url = check.actions.find((each) => each.id === 'open-link')?.url
      if (url === undefined) return
      const opened = await invoke('shell.openExternal', { url })
      if (!opened.ok) setMessage({ error: true, text: failureReason('shell.openExternal', opened.error) })
      return
    }
    if (useAction.getState().running !== null) return
    // "Open Browser" of a Browser profile row (ticket 08): the Browser where the sign-in expired, on its
    // Project's Canvas; the place gets out of the way, as for the GitHub sign-in's Terminal.
    if (action === 'open-browser') {
      const node = check.actions.find((each) => each.id === 'open-browser')?.node
      const target = check.project
      if (node === undefined || target === undefined) return
      const failed = await openProject(null, target.id)
      if (failed !== undefined) {
        setMessage({ error: true, text: failed })
        return
      }
      setView('canvas')
      focusCanvasNode(target.id, node)
      if (shown.current) onTerminalOpened()
      return
    }
    // "Sign in to Codex…" (ticket 08): the sign-in of Settings → Vendors, in the browser. It may take
    // minutes, so it holds no lock; the checks run again once it is over.
    if (action === 'codex-sign-in') {
      setMessage({ error: false, text: 'Sign in to Codex in the page it opened in your browser' })
      const result = await invoke('vendors.startLogin', { vendor: 'codex' })
      if (!result.ok) setMessage({ error: true, text: failureReason('vendors.startLogin', result.error) })
      else {
        setMessage(null)
        void checkAgain()
      }
      return
    }
    // "Sign in" of an Integration's row (worfy-integrations ticket 09): its sign-in window, through the Project of the
    // row; only a person presses it. Like the Codex sign-in it may take minutes and holds no lock.
    if (action === 'integration-sign-in') {
      const integration = check.actions.find((each) => each.id === 'integration-sign-in')?.integration
      const target = check.project
      if (integration === undefined || target === undefined) return
      setMessage({ error: false, text: 'Sign in in the window worfy opened' })
      const result = await invoke('integrations.signIn', { projectId: target.id, id: integration })
      if (!result.ok) setMessage({ error: true, text: failureReason('integrations.signIn', result.error) })
      else {
        setMessage(null)
        void checkAgain()
      }
      return
    }
    startAction(action, row)
    // "Show log" of a failed Update build (worfy-update ticket 08): main opens build.log, no dialog.
    if (action === 'update-log') {
      const opened = await invoke('update.showLog')
      useAction.setState(idle)
      forgetWhenUnwatched()
      setMessage(opened.ok ? null : { error: true, text: failureReason('update.showLog', opened.error) })
      return
    }
    setMessage(null)
    // "Run again" of a row "Harness on Claude Code" (ticket 09): main runs the contract set anew on that row's copy of
    // Claude Code, with no dialog — it changes nothing but worfy's own cache — and answers the checks.
    if (action === 'harness-claude-run') {
      const result = await invoke('firstRun.harnessClaude', { id: check.id === 'harness-claude-terminal' ? 'harness-claude-terminal' : 'harness-claude' })
      if (result.ok) useFirstRun.setState({ report: result.value })
      useAction.setState(idle)
      forgetWhenUnwatched()
      if (!result.ok) setMessage({ error: true, text: failureReason('firstRun.harnessClaude', result.error) })
      return
    }
    // "Use <login>" sends the Project of its row and the login it showed: main writes exactly that one.
    const login = check.actions.find((each) => each.id === 'use-login')?.login
    const target = action === 'use-login' ? { projectId: check.project?.id, login } : {}
    const result = await invoke('firstRun.run', { action, projectName: project?.name, ...target })
    // The checks before the lock opens, so nothing asks for them in between.
    if (result.ok) useFirstRun.setState({ report: result.value.report })
    useAction.setState(idle)
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

  // The move form is the action of "Move…" while it is open; it runs nothing in main by itself.
  const rowAction = (check: Check): FirstRunAction | null =>
    check.actions.find((each) => (each.id === running && rowKey(check) === pressedRow) || (migrating && each.id === 'migration-form'))?.id ?? null
  const checks = report?.checks ?? []
  const failed = checks.filter((each) => each.status === 'fail').length
  const warned = checks.filter((each) => each.status === 'warn').length
  const unchecked = checks.filter((each) => each.status === 'unknown').length
  const counts = [failed > 0 ? `${failed} failed` : null, warned > 0 ? `${warned} ${warned === 1 ? 'warning' : 'warnings'}` : null, unchecked > 0 ? `${unchecked} not checked` : null]
  const summary = checking || report === null ? '' : failed + warned + unchecked === 0 ? 'Everything is ready' : counts.filter(Boolean).join(' · ')
  const locked = running !== null || checking
  const isError = message?.error || failure !== null

  const form = migrating ? (
    <MigrationForm
      onClose={() => {
        setMigrating(false)
        void checkAgain()
      }}
      onMoved={() => void checkAgain()}
    />
  ) : linking ? (
    <LinkMachineDialog onClose={() => setLinking(false)} />
  ) : null

  return (
    <>
      {children({
        summary:
          summary !== '' ? (
            <Chip {...FIRST_RUN_CHIP[failed > 0 ? 'fail' : warned > 0 ? 'warn' : unchecked > 0 ? 'unknown' : 'ok']} icon={null} data-testid="first-run-summary" label={summary} />
          ) : null,
        list: checkBlocks(checks).map(({ key, title, rows }) => {
          return (
            <section key={key} style={styles.group} aria-label={title}>
              <h3 style={styles.groupTitle}>{title}</h3>
              <ul style={styles.list}>
                {rows.map((each) => (
                  <CheckRow
                    key={rowKey(each)}
                    check={each}
                    busy={rowAction(each)}
                    since={since}
                    checking={checking}
                    locked={locked}
                    projectName={project?.name}
                    onAction={(action) => void act(action, each)}
                  />
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
          <button
            type="button"
            className="w-action"
            aria-disabled={locked ? 'true' : undefined}
            title={locked && !checking ? BUSY_REASON : undefined}
            data-getting-started-target="check-again"
            onClick={() => !locked && void checkAgain()}
          >
            {checking ? <BusyLabel text="Checking…" /> : 'Check again'}
          </button>
        ),
        running: running !== null,
        migrating: migrating || linking,
      })}
      {form}
    </>
  )
}

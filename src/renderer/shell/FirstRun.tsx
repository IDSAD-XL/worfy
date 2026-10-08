// The first-run screen (worfy-harness ticket 19, question Q22; docs/design/F-SPEC.md, "First run"):
// the checks main runs over this Mac, grouped, each with its status, what was found and what to do,
// and the buttons of the actions. main asks before each action in a dialog with "Confirm"; this
// screen only calls `firstRun.run` and shows what came back. Two actions are the screen's own:
// "Move…" opens the move form of ticket 14 (src/renderer/harness/MigrationForm.tsx), and a confirmed
// GitHub sign-in puts a Terminal Node on the active Project's Canvas with `gh auth login` typed in.
// Without a Project there is no Canvas for it: the row shows the command to copy instead.
//
// It opens by itself once per window load when main says so (`firstRun.startup`), and from the
// command palette (openFirstRun, palette/commands.ts). Closing it tells main, which writes the mark.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import type { Check, CheckGroup, CheckStatus, FirstRunAction } from '../../shared/ipc/first-run'
import { applyLayoutOp } from '../canvas/useLayout'
import { focusCanvasNode } from '../find/canvas-requests'
import MigrationForm from '../harness/MigrationForm'
import { invoke } from '../ipc'
import { activeProject, useProjects } from '../projects/useProjects'
import { setView } from '../session/navigation'
import { askAtStartup, checkAgain, closeFirstRun, useFirstRun } from './first-run-store'

/** The size of the Terminal Node the GitHub sign-in opens: the default of the Terminal Node type. */
const TERMINAL_SIZE = { w: 560, h: 340 }
const GROUPS: readonly CheckGroup[] = ['Claude Code', 'Command-line tools', 'GitHub', 'Harness', 'qmd']

type ChipState = CheckStatus | 'running'
const CHIP_LABEL: Record<ChipState, string> = { ok: 'OK', warn: 'Warning', fail: 'Failed', running: 'Running…' }

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
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
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
    <span className="w-chip" data-chip={state} style={{ ...CHIP_STYLE[state], flex: 'none', width: 64, justifyContent: 'center', borderWidth: 1, borderStyle: 'solid' }}>
      {CHIP_LABEL[state]}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="w-action"
      aria-label={`Copy ${text}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true))
      }}
    >
      {copied ? 'Copied' : 'Copy'}
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
  const viewport = camera.ok ? camera.value : { x: 0, y: 0, zoom: 1 }
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

export function FirstRun() {
  const { open, report, checking, failure } = useFirstRun()
  const project = activeProject(useProjects())
  const [running, setRunning] = useState<FirstRunAction | null>(null)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [migrating, setMigrating] = useState(false)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(askAtStartup, [])
  useEffect(() => {
    if (open) dialog.current?.focus()
  }, [open])

  if (!open) return null

  const close = (): void => {
    if (running !== null) return
    setMessage(null)
    closeFirstRun()
  }

  const act = async (action: FirstRunAction): Promise<void> => {
    if (action === 'migration-form') {
      setMigrating(true)
      return
    }
    setRunning(action)
    setMessage(null)
    const result = await invoke('firstRun.run', { action, projectName: project?.name })
    setRunning(null)
    if (!result.ok) {
      setMessage({ error: true, text: failureReason('firstRun.run', result.error) })
      return
    }
    useFirstRun.setState({ report: result.value.report })
    if (result.value.outcome === 'failed') setMessage({ error: true, text: result.value.message ?? 'The action failed' })
    else if (result.value.outcome === 'done' && result.value.message !== null) setMessage({ error: false, text: result.value.message })
    else if (result.value.outcome === 'confirmed' && project !== undefined) {
      const failure = await openSignInTerminal(project.id)
      if (failure !== undefined) setMessage({ error: true, text: failure })
      else close()
    }
  }

  const rowAction = (check: Check): FirstRunAction | null => check.actions.find((each) => each.id === running)?.id ?? null
  const checks = report?.checks ?? []
  const failed = checks.filter((each) => each.status === 'fail').length
  const warned = checks.filter((each) => each.status === 'warn').length
  const summary = checking ? 'Checking…' : report === null ? '' : failed + warned === 0 ? 'Everything is ready' : [failed > 0 ? `${failed} failed` : null, warned > 0 ? `${warned} ${warned === 1 ? 'warning' : 'warnings'}` : null].filter(Boolean).join(' · ')
  const locked = running !== null || checking

  return createPortal(
    <>
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
            {summary !== '' ? (
              <span className="w-chip" data-testid="first-run-summary" style={{ ...(checking ? CHIP_STYLE.running : failed > 0 ? CHIP_STYLE.fail : warned > 0 ? CHIP_STYLE.warn : CHIP_STYLE.ok), borderWidth: 1, borderStyle: 'solid' }}>
                {summary}
              </span>
            ) : null}
          </div>
          <div style={styles.body}>
            {GROUPS.map((group) => {
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
            })}
          </div>
          <div style={styles.footer}>
            <span style={message?.error || failure !== null ? styles.error : styles.message} role={message?.error || failure !== null ? 'alert' : undefined}>
              {message?.text ?? failure ?? ''}
            </span>
            <button type="button" className="w-action" aria-disabled={locked ? 'true' : undefined} onClick={() => !locked && void checkAgain()}>
              Check again
            </button>
            <button type="button" className="w-action w-action--primary" aria-disabled={running !== null ? 'true' : undefined} onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
      {migrating ? (
        <MigrationForm
          onClose={() => {
            setMigrating(false)
            void checkAgain()
          }}
          onMoved={() => void checkAgain()}
        />
      ) : null}
    </>,
    document.body,
  )
}

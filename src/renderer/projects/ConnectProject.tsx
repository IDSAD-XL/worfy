// "Add project" for a folder the Harness does not know yet (worfy-harness ticket 24): one dialog in
// steps over the folder the user picked. The mode — Silent by default, Full not offered for a folder
// above several repositories — and the Workflow folder of Silent mode; then the Harness check and the
// draft Session (`projects.connect.draft`) with its last action and Stop; then the form over the
// draft, checked by the Harness on every edit (`projects.connect.check`), and "Connect", which has
// bin/project-connect write the Profile (`projects.connect.write`). Nothing is written before
// "Connect"; the folder was read in step 1 (ProjectsSection.tsx, `projects.connect.inspect`).
//
// The look follows the first-run screen (docs/design/F-SPEC.md, "First run"): a dialog over the
// window on a backdrop of black at 25%, header, scrolling body, footer with the shared action
// buttons; colours only from the token roles.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../canvas/actions/actions.css'
import './connect-project.css'
import { failureReason } from '../../shared/ipc/channels'
import type { ConnectFolder, ConnectMode, DraftIssue, ProfileDraft, ProjectsState, ProjectView } from '../../shared/ipc/projects'
import { invoke, invokeOn, subscribe } from '../ipc'

export interface ConnectedProject {
  project: ProjectView
  notice: string | null
  state: ProjectsState
}

export interface ConnectProjectProps {
  folder: ConnectFolder
  /** Where the Harness keeps its state: the default Workflow folder is under it. */
  harnessHome: string
  onClose: () => void
  onConnected: (connected: ConnectedProject) => void
  /** "Choose another folder…": the picker again. */
  onPickAnother: () => void
  /** The Harness stops the connection: the first-run screen sets it up. */
  onFirstRun: () => void
}

type Step =
  | { kind: 'mode' }
  | { kind: 'drafting'; draftId: string; activity: string; stopping: boolean }
  | { kind: 'harness'; reason: string }
  | { kind: 'failed'; reason: string; issues: DraftIssue[] }
  | { kind: 'form' }

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 640,
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
  steps: { display: 'flex', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  stepCurrent: { color: 'var(--text)', fontWeight: 600 },
  body: { overflowY: 'auto', padding: 'var(--space-3) var(--space-4)', flex: 1 },
  section: { margin: '0 0 var(--space-4)' },
  sectionTitle: { margin: '0 0 var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-11)', fontWeight: 600 },
  mono: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
  secondary: { color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  folderLine: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' },
  repos: { margin: 'var(--space-1) 0 0', padding: 0, listStyle: 'none' },
  modes: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' },
  modeCard: {
    display: 'flex',
    gap: 'var(--space-2)',
    alignItems: 'flex-start',
    padding: 'var(--space-2) var(--space-3)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--surface)',
  },
  modeCardOn: { borderColor: 'var(--accent)', background: 'var(--selected)' },
  modeName: { fontWeight: 600 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-2)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-3)' },
  label: { fontSize: 'var(--text-12)', fontWeight: 600 },
  input: {
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
    minWidth: 0,
  },
  textarea: {
    minHeight: 140,
    padding: 'var(--space-2)',
    borderRadius: 'var(--radius-button)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
    resize: 'vertical',
  },
  readOnly: { padding: '4px var(--space-2)', borderRadius: 'var(--radius-button)', border: '1px solid var(--border)', background: 'var(--surface-raised)' },
  fieldError: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)' },
  /** An input whose value the Harness refused: the blocked colour on its border (the focus ring is connect-project.css). */
  invalid: { borderColor: 'var(--blocked-text)' },
  issues: { margin: '0 0 var(--space-3)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-raised)', listStyle: 'none' },
  json: { margin: 'var(--space-2) 0 0', padding: 'var(--space-2)', maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-raised)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-11)', whiteSpace: 'pre-wrap' },
  status: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: '0 0 var(--space-2)' },
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
  footerMessage: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' },
  footerError: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
  chipWorking: { background: 'var(--working-bg)', color: 'var(--working-text)' },
  chipBlocked: { background: 'var(--blocked-bg)', color: 'var(--blocked-text)', border: '1px solid var(--blocked-ring)' },
  chipNeutral: { background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
} satisfies Record<string, CSSProperties>

const STEPS = ['Folder', 'Mode', 'Harness', 'Draft', 'Review'] as const

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value at a dotted path of the profile. */
function getAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((at, key) => (isJson(at) ? at[key] : undefined), value)
}

/** A copy of `value` with `path` set to `next`. */
function setAt(value: Json, path: readonly string[], next: unknown): Json {
  const [key, ...rest] = path
  if (key === undefined) return value
  return { ...value, [key]: rest.length === 0 ? next : setAt(isJson(value[key]) ? value[key] : {}, rest, next) }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const list = (value: unknown, separator: string): string => (Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(separator) : '')
const words = (input: string, split: RegExp): string[] =>
  input
    .split(split)
    .map((word) => word.trim())
    .filter((word) => word !== '')

/** The problems of one field: its own path, or a path below it. */
const issuesAt = (issues: readonly DraftIssue[], path: string): DraftIssue[] =>
  issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`))

const COMMANDS = ['install', 'lint', 'typecheck', 'test', 'test_one', 'contract', 'e2e', 'build', 'verify', 'prepare_tree'] as const

/** The fields of the form, by their draft path; every other path is shown in the list above the form. */
function formPaths(draft: ProfileDraft): string[] {
  return [
    'profile.name',
    ...COMMANDS.map((command) => `profile.commands.${command}`),
    ...draft.gate.flatMap((_entry, index) => [`gate[${index}].root.fast`, `gate[${index}].root.full`, `gate[${index}].key`, `gate[${index}].match`, `gate[${index}].profile`]),
    'profile.tickets.branch',
    'profile.review.lenses',
    'profile.mcp.allowed',
    'profile.language.reports',
    'profile.language.team',
    'profile.language.docs',
    'profile.attribution',
    'profile.workflow.finish',
    'rules',
  ]
}

function Chip({ tone, children }: { tone: 'working' | 'blocked' | 'neutral'; children: ReactNode }) {
  const style = tone === 'working' ? styles.chipWorking : tone === 'blocked' ? styles.chipBlocked : styles.chipNeutral
  return (
    <span className="w-chip" style={style}>
      {children}
    </span>
  )
}

interface FieldProps {
  label: string
  path: string
  issues: readonly DraftIssue[]
  children: (props: { id: string; invalid: boolean; describedBy: string | undefined }) => ReactNode
}

/** A labelled field with its problems under it. */
function Field({ label, path, issues, children }: FieldProps) {
  const id = useId()
  const errorId = useId()
  const own = issuesAt(issues, path)
  return (
    <div style={styles.field} data-field={path}>
      <label htmlFor={id} style={styles.label}>
        {label}
      </label>
      {children({ id, invalid: own.length > 0, describedBy: own.length > 0 ? errorId : undefined })}
      {own.length > 0 ? (
        <span id={errorId} role="alert" style={styles.fieldError} data-testid="connect-field-error">
          {own.map((issue) => issue.message).join('; ')}
        </span>
      ) : null}
    </div>
  )
}

/** How long an edit waits for the next one before the Harness checks the draft. */
const CHECK_DELAY_MS = 350

export function ConnectProject({ folder, harnessHome, onClose, onConnected, onPickAnother, onFirstRun }: ConnectProjectProps) {
  const multi = folder.kind === 'multi-repo'
  const [step, setStep] = useState<Step>({ kind: 'mode' })
  const [mode, setMode] = useState<ConnectMode>('silent')
  const [workflowFolder, setWorkflowFolder] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [issues, setIssues] = useState<DraftIssue[]>([])
  const [checking, setChecking] = useState(false)
  /** Why the last check could not run: Connect waits for a check that ran. */
  const [checkError, setCheckError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const drafting = step.kind === 'drafting' ? step.draftId : null
  // The edit the last check was asked for: an older answer that arrives later is dropped.
  const checkSeq = useRef(0)

  useEffect(() => {
    dialog.current?.focus()
  }, [])

  // The last action of the draft Session, while it runs.
  useEffect(() => {
    if (drafting === null) return
    return subscribe('projects.connect.activity', ({ draftId, text }) => {
      setStep((current) => (current.kind === 'drafting' && current.draftId === draftId ? { ...current, activity: text } : current))
    })
  }, [drafting])

  const name = draft ? text(draft.profile.name) : ''
  const defaultFolder = multi ? folder.root : `${harnessHome}/projects/${name || '<name>'}/workflow/`
  const shownFolder = mode === 'full' ? null : (workflowFolder ?? defaultFolder)

  const stop = (): void => {
    if (step.kind !== 'drafting') return
    setStep({ ...step, stopping: true })
    void invoke('projects.connect.stop', { draftId: step.draftId })
  }

  const close = (): void => {
    if (writing) return
    if (step.kind === 'drafting') void invoke('projects.connect.stop', { draftId: step.draftId })
    onClose()
  }

  const startDraft = async (): Promise<void> => {
    setMessage(null)
    const draftId = crypto.randomUUID()
    setStep({ kind: 'drafting', draftId, activity: 'Checking the Harness…', stopping: false })
    const result = await invoke('projects.connect.draft', { draftId, root: folder.root, mode, workflowFolder })
    if (!result.ok) {
      setStep({ kind: 'failed', reason: failureReason('projects.connect.draft', result.error), issues: [] })
      return
    }
    const answer = result.value
    switch (answer.status) {
      case 'draft':
        setDraft(answer.draft)
        setIssues(answer.issues)
        setStep({ kind: 'form' })
        return
      case 'harness':
        setStep({ kind: 'harness', reason: answer.reason })
        return
      case 'refused':
        setStep({ kind: 'failed', reason: answer.reason, issues: [] })
        return
      case 'stopped':
        setStep({ kind: 'mode' })
        setMessage({ error: false, text: 'Stopped: no draft was written.' })
        return
      case 'failed':
        setStep({ kind: 'failed', reason: answer.reason, issues: answer.issues })
    }
  }

  const check = async (next: ProfileDraft): Promise<void> => {
    const seq = ++checkSeq.current
    setChecking(true)
    await new Promise((resolve) => setTimeout(resolve, CHECK_DELAY_MS))
    if (seq !== checkSeq.current) return
    const result = await invoke('projects.connect.check', { draft: next })
    if (seq !== checkSeq.current) return
    setChecking(false)
    if (result.ok) {
      setIssues(result.value.issues)
      setCheckError(null)
    } else setCheckError(failureReason('projects.connect.check', result.error))
  }

  const edit = (path: readonly string[], value: unknown): void => {
    if (draft === null) return
    const profile = setAt(draft.profile, path.slice(1), value)
    let gate = draft.gate
    if (path.join('.') === 'profile.name') {
      // Every gate entry names the profile; the entry of one repository is called after it too.
      const previous = text(draft.profile.name)
      gate = gate.map((entry) => ({ ...entry, profile: value, ...(gate.length === 1 && entry.key === previous ? { key: value } : {}) }))
    }
    const next = path[0] === 'rules' ? { ...draft, rules: String(value) } : { ...draft, profile, gate }
    setDraft(next)
    // An edit makes the last write's failure stale: what the footer says next is this draft's check.
    setMessage(null)
    void check(next)
  }

  const editGate = (index: number, key: 'fast' | 'full', input: string): void => {
    if (draft === null) return
    const gate = draft.gate.map((entry, at) => (at === index ? { ...entry, root: { ...(isJson(entry.root) ? entry.root : {}), [key]: words(input, /\s+/) } } : entry))
    const next = { ...draft, gate }
    setDraft(next)
    setMessage(null)
    void check(next)
  }

  const connect = async (): Promise<void> => {
    if (draft === null || writing || checking || checkError !== null || issues.length > 0) return
    setWriting(true)
    setMessage(null)
    const result = await invoke('projects.connect.write', { root: folder.root, draft })
    setWriting(false)
    if (!result.ok) {
      setMessage({ error: true, text: failureReason('projects.connect.write', result.error) })
      return
    }
    const answer = result.value
    if (answer.status === 'added') onConnected({ project: answer.project, notice: answer.notice, state: answer.state })
    else if (answer.status === 'refused') setIssues(answer.issues)
    else setMessage({ error: true, text: answer.reason })
  }

  const chooseWorkflowFolder = async (): Promise<void> => {
    const picked = await invokeOn(null, 'projects.pickFolder', { purpose: 'workflow-folder' })
    if (!picked.ok) setMessage({ error: true, text: picked.error })
    else if (picked.value.path !== null) setWorkflowFolder(picked.value.path)
  }

  const current = step.kind === 'mode' ? 'Mode' : step.kind === 'harness' ? 'Harness' : step.kind === 'form' ? 'Review' : 'Draft'
  const paths = draft ? formPaths(draft) : []
  const general = draft ? issues.filter((issue) => !paths.some((path) => issuesAt([issue], path).length > 0)) : []
  const canConnect = draft !== null && !checking && !writing && checkError === null && issues.length === 0

  const folderSection = (
    <section style={styles.section} aria-label="Folder">
      <h3 style={styles.sectionTitle}>Folder</h3>
      <div style={styles.folderLine}>
        <Chip tone="neutral">{multi ? `${folder.repos.length} repositories` : 'Git repository'}</Chip>
        <span style={styles.mono} data-testid="connect-folder">
          {folder.root}
        </span>
      </div>
      {multi ? (
        <ul style={styles.repos} aria-label="Repositories">
          {folder.repos.map((repo) => (
            <li key={repo.path} style={{ ...styles.mono, color: 'var(--text-secondary)' }}>
              {repo.name}
            </li>
          ))}
        </ul>
      ) : null}
      {folder.notice ? <p style={{ ...styles.secondary, margin: 'var(--space-1) 0 0' }}>{folder.notice}</p> : null}
    </section>
  )

  const modeCard = (value: ConnectMode, title: string, about: string, disabledReason: string | null) => (
    <label style={{ ...styles.modeCard, ...(mode === value ? styles.modeCardOn : {}), ...(disabledReason ? { color: 'var(--text-muted)' } : {}) }} data-testid={`connect-mode-${value}`}>
      <input type="radio" name="connect-mode" value={value} checked={mode === value} disabled={disabledReason !== null || step.kind !== 'mode'} onChange={() => setMode(value)} />
      <span>
        <span style={styles.modeName}>{title}</span>
        <br />
        <span style={styles.secondary}>{disabledReason ?? about}</span>
      </span>
    </label>
  )

  const modeSection = (
    <section style={styles.section} aria-label="Mode">
      <h3 style={styles.sectionTitle}>Mode</h3>
      <div style={styles.modes} role="radiogroup" aria-label="Mode">
        {modeCard('silent', 'Silent mode', 'Tickets, specs, ADRs and the state file live in a Workflow folder outside the repository. The repository gets no trace of the workflow.', null)}
        {modeCard(
          'full',
          'Full mode',
          'The workflow files live in the repository and travel in its branches.',
          multi ? 'Not for a project over several repositories: it is always Silent.' : null,
        )}
      </div>
      {mode === 'silent' ? (
        <div style={{ ...styles.field, marginTop: 'var(--space-3)' }}>
          <span style={styles.label}>Workflow folder</span>
          <div style={styles.folderLine}>
            <span style={{ ...styles.mono, ...styles.readOnly, flex: 1 }} data-testid="connect-workflow-folder">
              {shownFolder}
            </span>
            {step.kind === 'mode' ? (
              <>
                <button type="button" className="w-action" onClick={() => void chooseWorkflowFolder()}>
                  Choose…
                </button>
                {workflowFolder !== null ? (
                  <button type="button" className="w-action" onClick={() => setWorkflowFolder(null)}>
                    Use default
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          <span style={styles.secondary}>{workflowFolder === null ? (multi ? 'Default: the folder itself, where its .scratch/ and HANDOFF.md stay.' : 'Default: a new folder with its own git history, in the Harness state.') : 'Taken as it is.'}</span>
        </div>
      ) : null}
    </section>
  )

  let body: ReactNode
  let footer: ReactNode
  const shownMessage = message ?? (step.kind === 'form' && checkError !== null && !checking ? { error: true, text: `The draft could not be checked: ${checkError}` } : null)
  const footerText = shownMessage ? (
    <span style={shownMessage.error ? styles.footerError : styles.footerMessage} role={shownMessage.error ? 'alert' : 'status'} data-testid="connect-message">
      {shownMessage.text}
    </span>
  ) : (
    <span style={styles.footerMessage}>{step.kind === 'form' ? (checking ? 'Checking the draft…' : issues.length > 0 ? `${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} to fix` : 'Nothing is written until Connect.') : 'Nothing is written until Connect.'}</span>
  )

  switch (step.kind) {
    case 'mode':
      body = (
        <>
          {folderSection}
          {modeSection}
        </>
      )
      footer = (
        <>
          {footerText}
          <button type="button" className="w-action" onClick={onPickAnother}>
            Choose another folder…
          </button>
          <button type="button" className="w-action" onClick={close}>
            Cancel
          </button>
          <button type="button" className="w-action w-action--primary" onClick={() => void startDraft()}>
            Write draft
          </button>
        </>
      )
      break
    case 'drafting':
      body = (
        <>
          {folderSection}
          <section style={styles.section} aria-label="Draft">
            <h3 style={styles.sectionTitle}>Draft</h3>
            <div style={styles.status}>
              <Chip tone="working">{step.stopping ? 'Stopping…' : 'Running…'}</Chip>
              <span style={styles.secondary}>Claude reads the project and drafts its Profile. It changes nothing.</span>
            </div>
            <p style={{ ...styles.mono, margin: 0, color: 'var(--text-secondary)' }} data-testid="connect-activity" aria-live="polite">
              {step.activity}
            </p>
          </section>
        </>
      )
      footer = (
        <>
          {footerText}
          <button type="button" className="w-action" aria-disabled={step.stopping ? 'true' : undefined} onClick={stop}>
            Stop
          </button>
        </>
      )
      break
    case 'harness':
      body = (
        <>
          {folderSection}
          <section style={styles.section} aria-label="Harness">
            <h3 style={styles.sectionTitle}>Harness</h3>
            <div style={styles.status}>
              <Chip tone="blocked">Failed</Chip>
              <span role="alert" data-testid="connect-harness">
                {step.reason}
              </span>
            </div>
          </section>
        </>
      )
      footer = (
        <>
          {footerText}
          <button type="button" className="w-action" onClick={() => setStep({ kind: 'mode' })}>
            Back
          </button>
          <button type="button" className="w-action w-action--primary" onClick={onFirstRun}>
            First-run checks…
          </button>
        </>
      )
      break
    case 'failed':
      body = (
        <>
          {folderSection}
          <section style={styles.section} aria-label="Draft">
            <h3 style={styles.sectionTitle}>Draft</h3>
            <div style={styles.status}>
              <Chip tone="blocked">Failed</Chip>
              <span role="alert" data-testid="connect-failed">
                {step.reason}
              </span>
            </div>
            {step.issues.length > 0 ? (
              <ul style={styles.issues}>
                {step.issues.map((issue, index) => (
                  <li key={index} style={styles.mono}>
                    {issue.path || 'draft'}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )
      footer = (
        <>
          {footerText}
          <button type="button" className="w-action" onClick={() => setStep({ kind: 'mode' })}>
            Back
          </button>
          <button type="button" className="w-action w-action--primary" onClick={() => void startDraft()}>
            Try again
          </button>
        </>
      )
      break
    case 'form': {
      const at = (path: string): string[] => path.split('.')
      const input = (path: string, label: string) => (
        <Field key={path} label={label} path={path} issues={issues}>
          {({ id, invalid, describedBy }) => (
            <input
              id={id}
              className="w-connect-input"
              style={invalid ? { ...styles.input, ...styles.invalid } : styles.input}
              value={text(getAt(draft, at(path)))}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              disabled={writing}
              onChange={(event) => edit(at(path), event.target.value === '' ? null : event.target.value)}
            />
          )}
        </Field>
      )
      const listInput = (path: string, label: string) => (
        <Field key={path} label={label} path={path} issues={issues}>
          {({ id, invalid, describedBy }) => (
            <input
              id={id}
              className="w-connect-input"
              style={invalid ? { ...styles.input, ...styles.invalid } : styles.input}
              defaultValue={list(getAt(draft, at(path)), ', ')}
              aria-invalid={invalid ? 'true' : undefined}
              aria-describedby={describedBy}
              disabled={writing}
              onChange={(event) => edit(at(path), words(event.target.value, /,/))}
            />
          )}
        </Field>
      )
      const select = (path: string, label: string, options: readonly string[]) => (
        <Field key={path} label={label} path={path} issues={issues}>
          {({ id, invalid, describedBy }) => (
            <select id={id} className="w-connect-input" style={invalid ? { ...styles.input, ...styles.invalid } : styles.input} value={text(getAt(draft, at(path)))} aria-invalid={invalid ? 'true' : undefined} aria-describedby={describedBy} disabled={writing} onChange={(event) => edit(at(path), event.target.value)}>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
      )
      body = draft ? (
        <>
          {general.length > 0 ? (
            <ul style={styles.issues} role="alert" aria-label="Problems">
              {general.map((issue, index) => (
                <li key={index} style={{ ...styles.mono, color: 'var(--blocked-text)' }} data-testid="connect-issue">
                  {issue.path || 'draft'}: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <section style={styles.section} aria-label="Profile">
            <h3 style={styles.sectionTitle}>Profile</h3>
            <div style={styles.grid}>
              {input('profile.name', 'Name')}
              <div style={styles.field}>
                <span style={styles.label}>Mode</span>
                <span style={{ ...styles.mono, ...styles.readOnly }} data-testid="connect-form-mode">
                  {text(draft.profile.mode)}
                </span>
              </div>
            </div>
            <div style={styles.field}>
              <span style={styles.label}>Workflow folder</span>
              <span style={{ ...styles.mono, ...styles.readOnly }} data-testid="connect-form-folder">
                {mode === 'full' ? 'none: the files live in the repository' : shownFolder}
              </span>
            </div>
          </section>
          <section style={styles.section} aria-label="Commands">
            <h3 style={styles.sectionTitle}>Commands</h3>
            <div style={styles.grid}>{COMMANDS.map((command) => input(`profile.commands.${command}`, command))}</div>
          </section>
          <section style={styles.section} aria-label="Gate">
            <h3 style={styles.sectionTitle}>Gate</h3>
            {draft.gate.map((entry, index) => (
              <div key={index}>
                <p style={{ ...styles.mono, margin: '0 0 var(--space-1)', color: 'var(--text-secondary)' }}>
                  {text(entry.key)} · {text(entry.match)}
                </p>
                {issuesAt(issues, `gate[${index}].match`)
                  .concat(issuesAt(issues, `gate[${index}].key`), issuesAt(issues, `gate[${index}].profile`))
                  .map((issue, at) => (
                    <p key={at} role="alert" style={{ ...styles.fieldError, margin: '0 0 var(--space-1)' }} data-testid="connect-field-error">
                      {issue.message}
                    </p>
                  ))}
                <div style={styles.grid}>
                  {(['fast', 'full'] as const).map((key) => (
                    <Field key={key} label={`Gate ${key}`} path={`gate[${index}].root.${key}`} issues={issues}>
                      {({ id, invalid, describedBy }) => (
                        <input
                          id={id}
                          className="w-connect-input"
                          style={invalid ? { ...styles.input, ...styles.invalid } : styles.input}
                          defaultValue={list(getAt(entry, ['root', key]), ' ')}
                          aria-invalid={invalid ? 'true' : undefined}
                          aria-describedby={describedBy}
                          disabled={writing}
                          onChange={(event) => editGate(index, key, event.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <section style={styles.section} aria-label="Workflow">
            <h3 style={styles.sectionTitle}>Workflow</h3>
            <div style={styles.grid}>
              {input('profile.tickets.branch', 'Ticket branch')}
              {select('profile.workflow.finish', 'Finish', ['pr-green-ci', 'local-green'])}
              {listInput('profile.review.lenses', 'Review lenses')}
              {listInput('profile.mcp.allowed', 'MCP servers')}
            </div>
          </section>
          <section style={styles.section} aria-label="Language">
            <h3 style={styles.sectionTitle}>Language and attribution</h3>
            <div style={{ ...styles.grid, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
              {select('profile.language.reports', 'Reports', ['ru', 'en'])}
              {select('profile.language.team', 'Team', ['ru', 'en'])}
              {select('profile.language.docs', 'Documents', ['ru', 'en'])}
              {select('profile.attribution', 'Attribution', ['on', 'off'])}
            </div>
          </section>
          <section style={styles.section} aria-label="rules.md">
            <h3 style={styles.sectionTitle}>rules.md</h3>
            <Field label="rules.md" path="rules" issues={issues}>
              {({ id, invalid, describedBy }) => (
                <textarea id={id} className="w-connect-input" style={invalid ? { ...styles.textarea, ...styles.invalid } : styles.textarea} value={draft.rules} aria-invalid={invalid ? 'true' : undefined} aria-describedby={describedBy} disabled={writing} onChange={(event) => edit(['rules'], event.target.value)} />
              )}
            </Field>
          </section>
          <details style={styles.section}>
            <summary style={styles.sectionTitle}>All profile fields (read-only)</summary>
            <pre style={styles.json} data-testid="connect-json">
              {JSON.stringify(draft.profile, null, 2)}
            </pre>
          </details>
        </>
      ) : null
      footer = (
        <>
          {footerText}
          <button type="button" className="w-action" aria-disabled={writing ? 'true' : undefined} onClick={() => !writing && close()}>
            Cancel
          </button>
          <button type="button" className="w-action w-action--primary" disabled={!canConnect} aria-disabled={canConnect ? undefined : 'true'} onClick={() => void connect()}>
            {writing ? 'Connecting…' : 'Connect'}
          </button>
        </>
      )
      break
    }
  }

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && step.kind === 'mode') close()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={styles.dialog}
        data-testid="connect-project"
        data-step={step.kind}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }}
      >
        <div style={styles.header}>
          <h2 id={titleId} style={styles.title}>
            Add project
          </h2>
          <ol style={styles.steps} aria-label="Steps">
            {STEPS.map((name, index) => (
              <li key={name} style={name === current ? styles.stepCurrent : undefined} aria-current={name === current ? 'step' : undefined}>
                {index + 1} {name}
              </li>
            ))}
          </ol>
        </div>
        <div style={styles.body}>{body}</div>
        <div style={styles.footer}>{footer}</div>
      </div>
    </div>,
    document.body,
  )
}

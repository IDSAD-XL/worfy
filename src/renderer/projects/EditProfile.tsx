// "Edit profile" of Project settings (worfy-polish ticket 78): the fields of a connected Project's Profile,
// those the Review step of "Add project" sets once and those it does not show, in one form with the same
// fields (profile-fields.tsx). The form reads them through `profileEdit.read`, has the Harness check every
// edit by the draft schema's rules (`profileEdit.check`, `bin/profile-set --check`) and shows a refusal
// under its field, and Save writes them through `bin/profile-set` (`profileEdit.write`) only while the
// Profile still has what the form read: a Profile changed in between is refused, and the form reads it
// again. worfy never writes `profile.json` itself (ADR-0002, ADR-0005, ADR-0073).
//
// The GitHub account changes through the "GitHub account" step of "Add project" (GithubAccount.tsx),
// which checks the push access of each account and sets the finish it allows. `mode` and the Workflow
// folder are shown, not edited: they change by moving the workflow files (ticket 81); the name holds the
// Profile's folder and stays.
//
// The look follows the "Add project" dialog: a dialog over Project settings on a backdrop, header,
// scrolling body, footer with the shared action buttons; colours only from the token roles.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import { PROFILE_CHANGED, PROFILE_COMMANDS, PROFILE_EDIT_FIELDS, type ProfileEditIssue, type ProfileEditRead, type ProfileEditValues } from '../../shared/ipc/profile-edit'
import type { GithubChoice } from '../../shared/ipc/projects'
import { invoke, invokeOn } from '../ipc'
import { GithubAccount } from './GithubAccount'
import { fieldStyles, issuesAt, text } from './profile-fields'
import { ListField, SelectField, TextField } from './ProfileFields'

export interface EditProfileProps {
  project: { name: string; path: string }
  /** The Machine of the Project, as ProjectSettingsProps.machine: the calls go there. */
  machine?: string | null
  /** The Project is shared read-only by its Linked machine: the form shows, Save is off; the reason. */
  readOnly: string | null
  onClose: () => void
  /** Written: `warning` is why the change was not committed in the Harness home's git (the write stays). */
  onSaved: (warning: string | null) => void
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
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
  subtitle: { margin: 0, color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  body: { overflowY: 'auto', padding: 'var(--space-3) var(--space-4)', flex: 1 },
  issues: { margin: '0 0 var(--space-3)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-raised)', listStyle: 'none' },
  account: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', margin: '0 0 var(--space-2)' },
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
  footerMessage: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' },
  footerError: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

type Load = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'form'; read: Extract<ProfileEditRead, { available: true }> }

/** How long an edit waits for the next one before the Harness checks the values, as on "Add project". */
const CHECK_DELAY_MS = 350
/** Under `mode` and the Workflow folder: why the form does not edit them. */
const FIXED_NOTE = 'Changed by moving the workflow files'

const FIELD_SET = new Set<string>(PROFILE_EDIT_FIELDS)

export function EditProfile({ project, machine, readOnly, onClose, onSaved }: EditProfileProps) {
  const call: typeof invoke = machine === undefined ? invoke : (channel, ...args) => invokeOn(machine, channel, ...args)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  /** Bumped to read the Profile again (after a refused fingerprint). */
  const [reads, setReads] = useState(0)
  const [values, setValues] = useState<ProfileEditValues>({})
  const [issues, setIssues] = useState<ProfileEditIssue[]>([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  /** The "GitHub account" step is open, and its accounts are being read. */
  const [changingAccount, setChangingAccount] = useState(false)
  const [readingAccounts, setReadingAccounts] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const checkSeq = useRef(0)

  useEffect(() => {
    dialog.current?.focus()
  }, [])

  useEffect(() => {
    let active = true
    const root = { root: project.path }
    void (machine === undefined ? invoke('profileEdit.read', root) : invokeOn(machine, 'profileEdit.read', root)).then((result) => {
      if (!active) return
      if (!result.ok) setLoad({ kind: 'failed', reason: failureReason('profileEdit.read', result.error) })
      else if (!result.value.available) setLoad({ kind: 'failed', reason: `The profile cannot be edited here: ${result.value.reason}.` })
      else {
        setLoad({ kind: 'form', read: result.value })
        setValues(result.value.values)
        setIssues([])
      }
    })
    return () => {
      active = false
    }
  }, [project.path, machine, reads])

  const read = load.kind === 'form' ? load.read : null
  const edited = read !== null && JSON.stringify(values) !== JSON.stringify(read.values)
  const locked = saving || readOnly !== null

  const check = async (next: ProfileEditValues): Promise<void> => {
    const seq = ++checkSeq.current
    setChecking(true)
    await new Promise((resolve) => setTimeout(resolve, CHECK_DELAY_MS))
    if (seq !== checkSeq.current) return
    const result = await call('profileEdit.check', { root: project.path, values: next })
    if (seq !== checkSeq.current) return
    setChecking(false)
    if (result.ok) setIssues(result.value)
    else setMessage({ error: true, text: failureReason('profileEdit.check', result.error) })
  }

  const edit = (changes: ProfileEditValues): void => {
    const next = { ...values, ...changes }
    setValues(next)
    setMessage(null)
    void check(next)
  }

  const chooseAccount = (choice: GithubChoice): void => edit({ 'github.account': choice.account, 'workflow.finish': choice.finish })

  const save = async (): Promise<void> => {
    if (read === null || !edited || checking || readingAccounts || locked || issues.length > 0) return
    setSaving(true)
    setMessage(null)
    const result = await call('profileEdit.write', { root: project.path, values, expected: read.fingerprint })
    setSaving(false)
    if (!result.ok) {
      setMessage({ error: true, text: failureReason('profileEdit.write', result.error) })
      return
    }
    const answer = result.value
    switch (answer.status) {
      case 'saved':
        onSaved(answer.warning)
        return
      case 'conflict':
        // The form shows the Profile as it is now; the edits made over the old one are dropped.
        setChangingAccount(false)
        setReads((count) => count + 1)
        setMessage({ error: true, text: PROFILE_CHANGED })
        return
      case 'busy':
        setMessage({ error: true, text: 'Another change of this profile is being written. Save again in a moment.' })
        return
      case 'invalid':
        setIssues(answer.issues)
        setMessage({ error: true, text: answer.issues.some((issue) => FIELD_SET.has(fieldOf(issue.path))) ? 'The Harness refused a value: see the field.' : answer.reason })
    }
  }

  const field = (name: string, label: string, hint?: string): ReactNode => (
    <TextField key={name} path={name} label={label} hint={hint} value={values[name]} issues={issues} disabled={locked} onChange={(value) => edit({ [name]: value })} />
  )
  const listField = (name: string, label: string, hint?: string): ReactNode => (
    <ListField key={name} path={name} label={label} hint={hint} value={values[name]} issues={issues} disabled={locked} separator=", " onChange={(value) => edit({ [name]: value })} />
  )
  const choice = (name: string, label: string, options: readonly string[], empty?: string): ReactNode => (
    <SelectField key={name} path={name} label={label} value={values[name]} issues={issues} disabled={locked} options={options} empty={empty} onChange={(value) => edit({ [name]: value })} />
  )
  const fixed = (name: 'mode' | 'workflow.folder', label: string, shown: string): ReactNode => (
    <div style={fieldStyles.field}>
      <span style={fieldStyles.label}>{label}</span>
      <span style={{ ...fieldStyles.mono, ...fieldStyles.readOnly }} data-testid={`edit-profile-${name === 'mode' ? 'mode' : 'folder'}`}>
        {shown}
      </span>
      <span style={fieldStyles.hint}>{FIXED_NOTE}</span>
    </div>
  )
  const section = (label: string, children: ReactNode, columns = 2): ReactNode => (
    <section style={fieldStyles.section} aria-label={label}>
      <h3 style={fieldStyles.sectionTitle}>{label}</h3>
      <div style={{ ...fieldStyles.grid, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{children}</div>
    </section>
  )

  let body: ReactNode
  if (load.kind === 'loading') body = <p style={styles.subtitle}>Loading…</p>
  else if (load.kind === 'failed')
    body = (
      <p role="alert" style={fieldStyles.fieldError} data-testid="edit-profile-failed">
        {load.reason}
      </p>
    )
  else {
    const mode = text(load.read.fixed.mode)
    const folder = load.read.fixed['workflow.folder']
    const general = issues.filter((issue) => !FIELD_SET.has(fieldOf(issue.path)))
    const account = values['github.account']
    body = (
      // Keyed by the fingerprint: a Profile read again starts the list inputs from its values.
      <div key={load.read.fingerprint}>
        {general.length > 0 ? (
          <ul style={styles.issues} role="alert" aria-label="Problems">
            {general.map((issue, index) => (
              <li key={index} style={{ ...fieldStyles.mono, color: 'var(--blocked-text)' }} data-testid="edit-profile-issue">
                {issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`}
              </li>
            ))}
          </ul>
        ) : null}
        {section(
          'Profile',
          <>
            <div style={fieldStyles.field}>
              <span style={fieldStyles.label}>Name</span>
              <span style={{ ...fieldStyles.mono, ...fieldStyles.readOnly }} data-testid="edit-profile-name">
                {load.read.name}
              </span>
            </div>
            {field('title', 'Title')}
            {fixed('mode', 'Mode', mode || 'full')}
            {fixed('workflow.folder', 'Workflow folder', typeof folder === 'string' ? folder : mode === 'silent' ? 'the default folder of the Harness' : 'none: the files live in the repository')}
          </>,
        )}
        <section style={fieldStyles.section} aria-label="GitHub account">
          <h3 style={fieldStyles.sectionTitle}>GitHub account</h3>
          <div style={styles.account}>
            <span style={{ ...fieldStyles.mono, ...fieldStyles.readOnly }} data-testid="edit-profile-account">
              {typeof account === 'string' ? account : 'No account'}
            </span>
            {changingAccount || locked ? null : (
              <button type="button" className="w-action" onClick={() => setChangingAccount(true)}>
                Change account…
              </button>
            )}
          </div>
          {issuesAt(issues, 'github.account').map((issue, index) => (
            <p key={index} role="alert" style={{ ...fieldStyles.fieldError, margin: '0 0 var(--space-2)' }} data-testid="connect-field-error">
              {issue.message}
            </p>
          ))}
          {changingAccount ? (
            <GithubAccount
              root={project.path}
              machine={machine}
              disabled={locked}
              initial={typeof account === 'string' ? account : null}
              onChoose={chooseAccount}
              onBusy={setReadingAccounts}
              onFirstRun={() => setMessage({ error: true, text: 'gh is not installed on this machine: the first-run checks of worfy say how to install it.' })}
            />
          ) : null}
        </section>
        {section('Commands', PROFILE_COMMANDS.map((command) => field(`commands.${command}`, command)))}
        {section(
          'Tickets',
          <>
            {field('tickets.path', 'Ticket path', 'NN is where the ticket number goes')}
            {field('tickets.spec', 'Epic spec')}
            {field('tickets.trail_section', 'Files section')}
            {field('tickets.done_section', 'Done section')}
            {field('tickets.branch', 'Ticket branch')}
          </>,
        )}
        {section(
          'Workflow',
          <>
            {choice('workflow.finish', 'Finish', ['pr-green-ci', 'local-green'])}
            {choice('parallel', 'Parallel', ['worktrees', 'single'])}
            {listField('review.lenses', 'Review lenses')}
            {listField('review.ticket_lenses', 'Ticket lenses')}
            {listField('mcp.allowed', 'MCP servers')}
            {listField('skills.allowed', 'Skills allowed', 'Empty and never set: all of them')}
          </>,
        )}
        {section(
          'Document paths',
          <>
            {field('docs.adr_dir', 'ADR folder')}
            {field('docs.adr_status_label', 'ADR status label')}
            {field('docs.feature_pages', 'Feature pages')}
            {field('docs.context.path', 'Glossary')}
            {field('docs.handoff.path', 'State file')}
          </>,
        )}
        {section(
          'Language and attribution',
          <>
            {choice('language.reports', 'Reports', ['ru', 'en'], 'default')}
            {choice('language.team', 'Team', ['ru', 'en'], 'default')}
            {choice('language.docs', 'Documents', ['ru', 'en'], 'default')}
            {choice('attribution', 'Attribution', ['on', 'off'], 'default')}
          </>,
          4,
        )}
        {section(
          'Worktrees',
          <>
            {field('worktree.root', 'Root')}
            {field('worktree.base', 'Base')}
            {field('worktree.implementer', 'Implementer command')}
            {field('worktree.reviewer', 'Reviewer command')}
          </>,
        )}
      </div>
    )
  }

  const canSave = read !== null && edited && !checking && !saving && !readingAccounts && readOnly === null && issues.length === 0
  const footerText =
    readOnly !== null ? (
      <span className="w-read-only-note" style={styles.footerMessage} data-testid="edit-profile-read-only">
        {readOnly}
      </span>
    ) : message !== null ? (
      <span role={message.error ? 'alert' : 'status'} style={message.error ? styles.footerError : styles.footerMessage} data-testid="edit-profile-message">
        {message.text}
      </span>
    ) : (
      <span role="status" style={styles.footerMessage}>
        {checking ? 'Checking with the Harness…' : saving ? 'Saving…' : read !== null && !edited ? 'No changes yet.' : ''}
      </span>
    )

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={styles.dialog}
        data-testid="edit-profile"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Project settings under it stays open.
            event.stopPropagation()
            if (!saving) onClose()
          }
        }}
      >
        <div style={styles.header}>
          <h2 id={titleId} style={styles.title}>
            Edit profile
          </h2>
          <p style={styles.subtitle}>
            {project.name} · the Harness checks each value and writes the profile on Save, with a commit in its own history.
          </p>
        </div>
        <div style={styles.body}>{body}</div>
        <div style={styles.footer}>
          {footerText}
          <button type="button" className="w-action" aria-disabled={saving ? 'true' : undefined} onClick={() => !saving && onClose()}>
            Cancel
          </button>
          <button type="button" className="w-action w-action--primary" disabled={!canSave} aria-disabled={canSave ? undefined : 'true'} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The field a refusal is at: the longest field of the form its path starts with ("review.lenses[1]" → "review.lenses"). */
function fieldOf(path: string): string {
  let found = ''
  for (const field of PROFILE_EDIT_FIELDS) {
    if ((path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`)) && field.length > found.length) found = field
  }
  return found
}

// "Edit profile" of Project settings (worfy-polish ticket 78): the fields of a connected Project's Profile,
// those the Review step of "Add project" sets once and those it does not show, in one form with the same
// fields (profile-fields.tsx). The form reads them through `profileEdit.read`, has the Harness check every
// edit by the draft schema's rules (`profileEdit.check`, `bin/profile-set --check`) and shows a refusal
// under its field, and Save writes them through `bin/profile-set` (`profileEdit.write`) only while the
// Profile still has what the form read: a Profile changed in between is refused, and the form reads it
// again. worfy never writes `profile.json` itself (ADR-0002, ADR-0005, ADR-0073).
//
// The GitHub account changes through the "GitHub account" step of "Add project" (GithubAccount.tsx),
// which checks the push access of each account and sets the finish it allows; only the person's pick there
// changes the form, never the load of the accounts, and Save waits while they load. `mode` and the Workflow
// folder are shown, not edited: they change by moving the workflow files, the action beside them
// (MoveWorkflow.tsx, `profileEdit.move`, ticket 81), after which the form reads the Profile again; the name
// holds the Profile's folder and stays.
//
// Beside the MCP servers list stands the status of each name in the newest Session of the Project on this
// Machine (session/McpChip.tsx, McpProfileStatus; worfy-mcp-live ticket 04); without one, no status.
//
// The look follows the "Add project" dialog: a dialog over Project settings on a backdrop, header,
// scrolling body, footer with the shared action buttons; colours only from the token roles.
//
// A modal window of the kit (theme/kit/Dialog.tsx, worfy-ui-kit ticket 05): its focus trap, its Esc
// and its backdrop. It is drawn inside Project settings and over it: Esc closes this one alone, and
// the focus goes back to "Edit profile…" there. While a save or a move runs, neither Esc nor the
// backdrop closes it.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import {
  PROFILE_CHANGED,
  PROFILE_COMMANDS,
  PROFILE_EDIT_FIELDS,
  type ProfileEditIssue,
  type ProfileEditRead,
  type ProfileEditValues,
  type ProfileMode,
} from '../../shared/ipc/profile-edit'
import type { GithubChoice } from '../../shared/ipc/projects'
import { invoke, invokeOn, windowMachine } from '../ipc'
import { McpProfileStatus } from '../session/McpChip'
import { Dialog } from '../theme/kit/Dialog'
import { GithubAccount } from './GithubAccount'
import { MoveWorkflow } from './MoveWorkflow'
import { fieldStyles, issuesAt, text } from './profile-fields'
import { ListField, SelectField, TextField } from './ProfileFields'

export interface EditProfileProps {
  project: { name: string; path: string }
  /** The Machine of the Project, as ProjectSettingsProps.machine: the calls go there. */
  machine?: string | null
  /** The Project is shared read-only by its Linked machine: the form shows, without Save; the reason. */
  readOnly: string | null
  onClose: () => void
  /** Written: `warning` is why the change was not committed in the Harness home's git (the write stays). */
  onSaved: (warning: string | null) => void
}

const styles = {
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
/**
 * The Profile of a Linked machine's Project is read from here and written only on that machine, as its Pipeline is
 * (`profileEdit.write` is a `local` channel): its commands are the ones the gate runs there.
 */
const LINKED_NOTE = 'This profile belongs to a Project of a Linked machine: edit it in worfy on that machine.'
/**
 * The text fields the Harness requires a text in: cleared, they are sent as `""`, which it refuses at the field.
 * As null they would pass its check and be written: commands.verify null is "no check", tickets.path null "no tickets".
 */
const TEXT_REQUIRED = new Set(['commands.verify', 'tickets.path'])

export function EditProfile({ project, machine, readOnly, onClose, onSaved }: EditProfileProps) {
  const call: typeof invoke = machine === undefined ? invoke : (channel, ...args) => invokeOn(machine, channel, ...args)
  /** The Project is of this Machine, not of a Linked machine: its Sessions are the ones this window has. */
  const thisMachine = (machine === undefined ? windowMachine() : machine) === null
  /** Why the form is only shown, without Save: the Project is shared read-only, or it is of a Linked machine; null — editable. */
  const viewOnly = readOnly ?? (thisMachine ? null : LINKED_NOTE)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  /** Bumped to read the Profile again (after a refused fingerprint). */
  const [reads, setReads] = useState(0)
  const [values, setValues] = useState<ProfileEditValues>({})
  const [issues, setIssues] = useState<ProfileEditIssue[]>([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  /** A move of the workflow files runs. */
  const [moving, setMoving] = useState(false)
  /** The "GitHub account" step is open, and its accounts are being read. */
  const [changingAccount, setChangingAccount] = useState(false)
  /** The account step's read of the accounts runs: true from the moment the step opens until they came. */
  const [readingAccounts, setReadingAccounts] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const titleId = useId()
  const checkSeq = useRef(0)

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
  const locked = saving || moving || viewOnly !== null

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
  // The step reads the accounts as it opens: Save waits from the first moment, not from its first answer.
  const openAccountStep = (): void => {
    setReadingAccounts(true)
    setChangingAccount(true)
  }
  // A closed step's read is dropped unanswered, so its wait ends with it.
  const closeAccountStep = (): void => {
    setChangingAccount(false)
    setReadingAccounts(false)
  }

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
        closeAccountStep()
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

  const move = async (to: ProfileMode, folder: string | null): Promise<void> => {
    if (read === null || locked || edited) return
    setMoving(true)
    setMessage(null)
    const result = await call('profileEdit.move', { root: project.path, to, folder, expected: read.fixedFingerprint })
    setMoving(false)
    if (!result.ok) {
      setMessage({ error: true, text: failureReason('profileEdit.move', result.error) })
      return
    }
    const answer = result.value
    switch (answer.status) {
      case 'moved': {
        const files = answer.files === 1 ? '1 file' : `${answer.files} files`
        const where = answer.mode === 'silent' ? 'Moved to Silent mode' : 'Moved to Full mode'
        const notes = [
          answer.recovered === 'rolled-back' ? 'A move stopped half-way before was rolled back first.' : null,
          answer.recovered === 'finished' ? 'A move stopped half-way before had finished; only its marker was left.' : null,
          answer.ignored.length > 0 ? `${answer.ignored.length === 1 ? '1 file is' : `${answer.ignored.length} files are`} ignored by the .gitignore at the new place and committed all the same: ${answer.ignored.join(', ')}.` : null,
          answer.qmd.length > 0 ? `The qmd collections ${answer.qmd.join(', ')} still index the old place: remove them with qmd collection remove, reset the profile's qmd field with bin/profile-set --field qmd --reset, then run bin/qmd-collections.` : null,
          answer.warning ? `The profile change is not in the Harness history: ${answer.warning}` : null,
        ].filter((note): note is string => note !== null)
        setMessage({ error: false, text: [`${where}: ${files}, committed in the repository and in the Workflow folder.`, ...notes].join(' ') })
        setReads((count) => count + 1)
        return
      }
      case 'conflict':
        setReads((count) => count + 1)
        setMessage({ error: true, text: PROFILE_CHANGED })
        return
      case 'busy':
        setMessage({ error: true, text: 'Another change of this profile is being written. Move again in a moment.' })
        return
      case 'refused':
        setMessage({ error: true, text: `Not moved: ${answer.reason}` })
        return
      case 'failed':
        setReads((count) => count + 1)
        setMessage({ error: true, text: `The move failed and was not fully rolled back: ${answer.reason}. Put right by hand: ${answer.left.join('; ')}` })
    }
  }

  const field = (name: string, label: string, hint?: string): ReactNode => (
    <TextField
      key={name}
      path={name}
      label={label}
      hint={hint}
      value={values[name]}
      issues={issues}
      disabled={locked}
      emptyAs={TEXT_REQUIRED.has(name) ? '' : null}
      onChange={(value) => edit({ [name]: value })}
    />
  )
  const listField = (name: string, label: string, hint?: string): ReactNode => (
    <ListField
      key={name}
      path={name}
      label={label}
      hint={hint}
      value={values[name]}
      issues={issues}
      disabled={locked}
      separator=", "
      emptyAs={read === null || read.values[name] === null || read.values[name] === undefined ? null : []}
      onChange={(value) => edit({ [name]: value })}
    />
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
            {viewOnly === null ? (
              <>
                {load.read.interrupted ? (
                  <span style={fieldStyles.hint} data-testid="move-workflow-interrupted">
                    A move of the workflow files was stopped half-way. The next move rolls it back first, then moves.
                  </span>
                ) : null}
                <MoveWorkflow
                  mode={mode === 'silent' ? 'silent' : 'full'}
                  repository={project.path}
                  folder={typeof folder === 'string' ? folder : null}
                  severalRepos={load.read.severalRepos}
                  moving={moving}
                  blocked={edited ? 'Save or cancel your edits first: the move reads the profile again.' : null}
                  onMove={move}
                />
              </>
            ) : null}
          </>,
        )}
        <section style={fieldStyles.section} aria-label="GitHub account">
          <h3 style={fieldStyles.sectionTitle}>GitHub account</h3>
          <div style={styles.account}>
            <span style={{ ...fieldStyles.mono, ...fieldStyles.readOnly }} data-testid="edit-profile-account">
              {typeof account === 'string' ? account : 'No account'}
            </span>
            {changingAccount || locked ? null : (
              <button type="button" className="w-action" onClick={openAccountStep}>
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
              pickOnly
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
            {/* One cell of the grid: the list, and under it the status of each name in the newest Session of the
                Project, on this Machine only (worfy-mcp-live ticket 04). */}
            <div key="mcp.allowed">
              {listField('mcp.allowed', 'MCP servers')}
              {thisMachine ? <McpProfileStatus path={project.path} names={values['mcp.allowed']} /> : null}
            </div>
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

  const canSave = read !== null && edited && !checking && !saving && !readingAccounts && viewOnly === null && issues.length === 0
  const footerText =
    viewOnly !== null ? (
      <span className="w-read-only-note" style={styles.footerMessage} data-testid="edit-profile-read-only">
        {viewOnly}
      </span>
    ) : message !== null ? (
      <span role={message.error ? 'alert' : 'status'} style={message.error ? styles.footerError : styles.footerMessage} data-testid="edit-profile-message">
        {message.text}
      </span>
    ) : (
      <span role="status" style={styles.footerMessage}>
        {checking ? 'Checking with the Harness…' : saving ? 'Saving…' : moving ? 'Moving the workflow files…' : read !== null && !edited ? 'No changes yet.' : ''}
      </span>
    )

  return (
    <Dialog
      open
      // Not while a save or a move runs.
      onClose={() => !saving && !moving && onClose()}
      labelledBy={titleId}
      className=""
      style={styles.dialog}
      data-testid="edit-profile"
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
        <button type="button" className="w-action" aria-disabled={saving || moving ? 'true' : undefined} onClick={() => !saving && !moving && onClose()}>
          {viewOnly === null ? 'Cancel' : 'Close'}
        </button>
        {viewOnly === null ? (
          <button type="button" className="w-action w-action--primary" disabled={!canSave} aria-disabled={canSave ? undefined : 'true'} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      </div>
    </Dialog>
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

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  MigrationChoice,
  MigrationFileDiff,
  MigrationGroup,
  MigrationPlan,
  MigrationProfile,
  MigrationResult,
  MigrationRow,
  MigrationSelection,
  ProfileFields,
} from '../../shared/ipc/harness-migration'
import { invoke } from '../ipc'
import { Button } from '../theme/Button'
import { Dialog } from '../theme/kit/Dialog'
import { SegmentedControl } from '../theme/primitives'
import { Select } from '../theme/Select'

// The form that moves the old Harness out of ~/.claude (worfy-harness ticket 14): a row for each
// file, CLAUDE.md section, hook record, the status line, the qmd group, the machine state and each
// Profile, each with "Remove" or "Keep" (for what moves: "Move" or "Keep"). CLAUDE.md and the files of
// the Profiles show as a diff. Move asks main (harnessMigration.apply), which shows the consent
// dialog, makes the backup and moves; the form then shows the backup and the command that undoes it.
//
// The form is a modal window of the kit (theme/kit/Dialog.tsx, worfy-ui-kit ticket 07): the focus
// trap, Esc, the backdrop and the focus given back are the kit's. Opened from a section of Settings
// (Pipeline, Health), it is drawn inside the layer of the Settings window, above it, and is the top
// window of the kit, so its keys are its own: Esc closes the form and leaves Settings open.

const GROUPS: { group: MigrationGroup; title: string; hint: string }[] = [
  { group: 'files', title: 'Harness files', hint: 'The plugin worfy carries these now.' },
  { group: 'hooks', title: 'Hooks in settings.json', hint: 'The plugin runs the same hooks; with both, each runs twice.' },
  { group: 'status-line', title: 'Status line', hint: '' },
  { group: 'qmd', title: 'qmd', hint: 'The scripts, the hook and the MCP record go or stay together.' },
  { group: 'state', title: 'Machine state', hint: 'Moves into the Harness home.' },
]

const LABELS: Record<MigrationGroup, Record<MigrationChoice, string>> = {
  files: { remove: 'Remove', keep: 'Keep' },
  'claude-md': { remove: 'Remove', keep: 'Keep' },
  hooks: { remove: 'Remove', keep: 'Keep' },
  'status-line': { remove: 'Replace', keep: 'Keep' },
  qmd: { remove: 'Remove', keep: 'Keep' },
  state: { remove: 'Move', keep: 'Keep' },
  profiles: { remove: 'Move', keep: 'Keep' },
}

const styles = {
  dialog: {
    width: 760,
    // The window itself takes the focus on opening; the ring would mark the whole window.
    outline: 'none',
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
  },
  header: { padding: 'var(--space-4) var(--space-4) var(--space-2)' },
  body: { overflowY: 'auto', padding: '0 var(--space-4)', flex: 1 },
  outcome: { padding: 'var(--space-3) var(--space-4) 0', borderTop: '1px solid var(--border)' },
  footer: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-15)', fontWeight: 600 },
  hint: { margin: 0, color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  section: { margin: 'var(--space-3) 0' },
  sectionTitle: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-13)', fontWeight: 600 },
  row: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', padding: '4px 0', borderBottom: '1px solid var(--border)' },
  rowText: { flex: 1, minWidth: 0 },
  mono: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  note: { color: 'var(--text-muted)', fontSize: 'var(--text-11)' },
  warning: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)', margin: '0 0 var(--space-1)' },
  detail: { margin: '2px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-11)', color: 'var(--text-secondary)' },
  diff: {
    margin: '4px 0 0',
    padding: 'var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-11)',
    whiteSpace: 'pre-wrap',
    maxHeight: 260,
    overflowY: 'auto',
  },
  removed: { color: 'var(--blocked-text)', background: 'var(--blocked-bg)', display: 'block' },
  added: { color: 'var(--ready-text)', background: 'var(--ready-bg)', display: 'block' },
  same: { display: 'block' },
  fields: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', margin: '4px 0', alignItems: 'center' },
} satisfies Record<string, CSSProperties>

interface DiffLine {
  kind: ' ' | '-' | '+'
  text: string
}

/** A line diff (longest common subsequence) of two texts. */
function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: ' ', text: a[i]! })
      i += 1
      j += 1
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: '-', text: a[i]! })
      i += 1
    } else {
      out.push({ kind: '+', text: b[j]! })
      j += 1
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: '-', text: a[i]! })
  for (; j < b.length; j += 1) out.push({ kind: '+', text: b[j]! })
  return out
}

/** profile.json after the move with the fields the owner set (main's text carries the proposed ones). */
function profileJsonWith(after: string, fields: ProfileFields): string {
  const json = JSON.parse(after) as Record<string, unknown>
  json.mode = fields.mode
  json.attribution = fields.attribution
  const language = typeof json.language === 'object' && json.language !== null ? (json.language as Record<string, unknown>) : {}
  json.language = { ...language, docs: fields.languageDocs }
  return `${JSON.stringify(json, null, 2)}\n`
}

/** Every row of a plan with the choice it starts with. */
function initialChoices(plan: MigrationPlan): Record<string, MigrationChoice> {
  const rows = [...plan.rows, ...(plan.claudeMd?.sections ?? []), ...plan.profiles]
  return Object.fromEntries(rows.map((row) => [row.id, row.defaultChoice]))
}

function Diff({ lines, testId }: { lines: DiffLine[]; testId: string }) {
  return (
    <pre style={styles.diff} data-testid={testId}>
      {lines.map((line, index) => (
        <span key={index} style={line.kind === '-' ? styles.removed : line.kind === '+' ? styles.added : styles.same} data-diff={line.kind === ' ' ? 'same' : line.kind === '-' ? 'removed' : 'added'}>
          {`${line.kind} ${line.text}`}
        </span>
      ))}
    </pre>
  )
}

function Choice({ row, value, onChange }: { row: MigrationRow; value: MigrationChoice; onChange: (choice: MigrationChoice) => void }) {
  return (
    <SegmentedControl
      label={`${row.label}: ${LABELS[row.group].remove} or ${LABELS[row.group].keep}`}
      options={row.choices.map((choice) => ({ value: choice, label: LABELS[row.group][choice] }))}
      value={value}
      onChange={onChange}
    />
  )
}

function Row({ row, value, onChange, children }: { row: MigrationRow; value: MigrationChoice; onChange: (choice: MigrationChoice) => void; children?: ReactNode }) {
  return (
    <div style={styles.row} data-testid="migration-row" data-row={row.id} data-choice={value}>
      <div style={styles.rowText}>
        <div style={styles.mono}>{row.label}</div>
        {row.note === null ? null : <div style={styles.note}>{row.note}</div>}
        {row.detail === null ? null : <pre style={styles.detail}>{row.detail}</pre>}
        {children}
      </div>
      <Choice row={row} value={value} onChange={onChange} />
    </div>
  )
}

function ProfileRow({
  profile,
  value,
  fields,
  onChange,
  onFields,
}: {
  profile: MigrationProfile
  value: MigrationChoice
  fields: ProfileFields
  onChange: (choice: MigrationChoice) => void
  onFields: (fields: ProfileFields) => void
}) {
  const id = useId()
  const select = <K extends keyof ProfileFields>(key: K, label: string, options: readonly ProfileFields[K][]) => (
    <label htmlFor={`${id}-${key}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {label}
      <Select
        id={`${id}-${key}`}
        mono
        value={fields[key]}
        options={options.map((option) => ({ value: option, label: option }))}
        disabled={value === 'keep'}
        data-testid={`profile-${key}`}
        onChange={(next) => onFields({ ...fields, [key]: next })}
      />
    </label>
  )
  const files: MigrationFileDiff[] = profile.files.map((file) => (file.path.endsWith('profile.json') ? { ...file, after: profileJsonWith(file.after, fields) } : file))
  return (
    <Row row={profile} value={value} onChange={onChange}>
      <div style={styles.fields} data-testid="profile-fields" data-profile={profile.name}>
        {select('mode', 'mode', ['full', 'silent'] as const)}
        {select('languageDocs', 'language.docs', ['ru', 'en'] as const)}
        {select('attribution', 'attribution', ['on', 'off'] as const)}
      </div>
      <div style={styles.note}>{profile.modeReason}</div>
      {profile.carried.length > 0 ? <div style={styles.note}>Moved as they are: {profile.carried.join(', ')}</div> : null}
      {value === 'remove'
        ? files.map((file) => (
            <div key={file.path}>
              <div style={{ ...styles.mono, marginTop: 4 }}>{file.path}</div>
              <Diff lines={lineDiff(file.before, file.after)} testId="profile-diff" />
            </div>
          ))
        : null}
    </Row>
  )
}

/** What the form shows once main answered Move. */
function Outcome({ result }: { result: MigrationResult }) {
  switch (result.outcome) {
    case 'done':
      return (
        <div data-testid="migration-done">
          <p style={{ margin: '0 0 var(--space-1)' }}>
            Moved. The backup is in <span style={styles.mono} data-testid="migration-backup">{result.backupDir}</span>
          </p>
          <p style={styles.hint}>To undo the move, run in a terminal:</p>
          <pre style={styles.diff} data-testid="migration-restore-command">
            {result.restoreCommand}
          </pre>
          <p style={styles.hint}>Claude Code sessions already running keep the old hooks: restart them.</p>
        </div>
      )
    case 'declined':
      return null
    case 'refused':
      return (
        <p role="alert" style={styles.warning} data-testid="migration-error">
          Not moved: {result.reason}
        </p>
      )
    case 'failed':
      return (
        <p role="alert" style={styles.warning} data-testid="migration-error">
          The step “{result.step}” failed: {result.reason}.{' '}
          {result.rolledBack
            ? result.backupDir === null
              ? 'The move was undone; ~/.claude is as it was.'
              : `The move was undone. Files changed while it ran are kept in ${result.backupDir}/after/.`
            : `Undoing it failed too (${result.rollbackError ?? ''}); the backup is in ${result.backupDir ?? '?'}.`}
        </p>
      )
  }
}

export interface MigrationFormViewProps {
  plan: MigrationPlan
  busy: boolean
  result: MigrationResult | undefined
  onMove: (selection: MigrationSelection) => void
  onClose: () => void
}

/** The form for a given plan, in its window; exported for tests. */
export function MigrationFormView(props: MigrationFormViewProps) {
  return <MigrationWindow {...props} />
}

/**
 * The window of the form: while main reads the plan, what it is doing (or why it could not), then the
 * form. One window for both, so the focus and the place in the kit's stack of windows stay when the
 * plan comes.
 */
function MigrationWindow({ plan, failure, busy, result, onMove, onClose }: Omit<MigrationFormViewProps, 'plan'> & { plan: MigrationPlan | undefined; failure?: string }) {
  const titleId = useId()
  return (
    <Dialog
      open
      // Nothing closes the form while main moves: neither Esc nor a press on the backdrop.
      onClose={() => {
        if (!busy) onClose()
      }}
      closeOnBackdrop={!busy}
      label={plan === undefined ? 'Move the old Harness' : undefined}
      labelledBy={plan === undefined ? undefined : titleId}
      className=""
      style={plan === undefined ? { ...styles.dialog, padding: 'var(--space-4)' } : styles.dialog}
      data-testid="migration-form"
    >
      {plan === undefined ? (
        <>
          <p style={failure === undefined ? styles.hint : styles.warning}>{failure ?? 'Reading ~/.claude…'}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={onClose} data-testid="migration-close">
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <PlanForm titleId={titleId} plan={plan} busy={busy} result={result} onMove={onMove} onClose={onClose} />
      )}
    </Dialog>
  )
}

/** The rows of a plan, what the move came to, Cancel and Move. */
function PlanForm({ titleId, plan, busy, result, onMove, onClose }: MigrationFormViewProps & { titleId: string }) {
  const [choices, setChoices] = useState(() => initialChoices(plan))
  const [fields, setFields] = useState<Record<string, ProfileFields>>(() => Object.fromEntries(plan.profiles.map((profile) => [profile.name, profile.fields])))
  const choose = (id: string) => (choice: MigrationChoice) => setChoices((current) => ({ ...current, [id]: choice }))
  const done = result?.outcome === 'done'
  const sections = plan.claudeMd?.sections ?? []
  // The whole file: lines of a removed section are marked, everything else (text outside sections included) stays.
  const claudeMdDiff: DiffLine[] = (plan.claudeMd?.text.split('\n') ?? []).map((text, index) => ({
    kind: sections.some((section) => choices[section.id] === 'remove' && index >= section.start && index < section.end) ? '-' : ' ',
    text,
  }))

  return (
    <>
      <div style={styles.header}>
        <h2 id={titleId} style={styles.title}>
          Move the old Harness out of ~/.claude
        </h2>
        <p style={styles.hint}>
          Everything removed or changed is copied first to {plan.harnessHome}/backup-&lt;date&gt;/, with a command that undoes the move.
        </p>
      </div>
      <div style={styles.body} data-testid="migration-body">
        {plan.missing.map((line) => (
          <p key={line} style={styles.warning} data-testid="migration-missing">
            {line}
          </p>
        ))}
        {plan.warnings.map((line) => (
          <p key={line} style={styles.warning} data-testid="migration-warning">
            {line}
          </p>
        ))}
        {GROUPS.map(({ group, title, hint }) => {
          const rows = plan.rows.filter((row) => row.group === group)
          if (rows.length === 0) return null
          return (
            <section key={group} style={styles.section} data-testid="migration-group" data-group={group}>
              <h3 style={styles.sectionTitle}>{title}</h3>
              {hint === '' ? null : <p style={styles.hint}>{hint}</p>}
              {rows.map((row) => (
                <Row key={row.id} row={row} value={choices[row.id] ?? row.defaultChoice} onChange={choose(row.id)} />
              ))}
            </section>
          )
        })}
        {plan.claudeMd === null ? null : (
          <section style={styles.section} data-testid="migration-group" data-group="claude-md">
            <h3 style={styles.sectionTitle}>{plan.claudeMd.path}</h3>
            <p style={styles.hint}>The rules the plugin now gives every session leave; what is yours stays.</p>
            {sections.map((section) => (
              <Row key={section.id} row={section} value={choices[section.id] ?? section.defaultChoice} onChange={choose(section.id)} />
            ))}
            <Diff lines={claudeMdDiff} testId="claude-md-diff" />
          </section>
        )}
        {plan.profiles.length === 0 ? null : (
          <section style={styles.section} data-testid="migration-group" data-group="profiles">
            <h3 style={styles.sectionTitle}>Profiles</h3>
            <p style={styles.hint}>Into {plan.harnessHome}/projects/ as schema 2; paths of the old Harness are rewritten.</p>
            {plan.profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                value={choices[profile.id] ?? profile.defaultChoice}
                fields={fields[profile.name] ?? profile.fields}
                onChange={choose(profile.id)}
                onFields={(value) => setFields((current) => ({ ...current, [profile.name]: value }))}
              />
            ))}
          </section>
        )}
      </div>
      {result === undefined ? null : (
        <div style={styles.outcome}>
          <Outcome result={result} />
        </div>
      )}
      <div style={styles.footer} data-testid="migration-actions">
        <span style={{ flex: 1 }} />
        <Button onClick={onClose} disabled={busy} data-testid="migration-close">
          {done ? 'Close' : 'Cancel'}
        </Button>
        {done ? null : (
          <Button variant="primary" disabled={!plan.available || busy} onClick={() => onMove({ choices, profiles: fields })}>
            {busy ? 'Moving…' : 'Move'}
          </Button>
        )}
      </div>
    </>
  )
}

export interface MigrationFormProps {
  onClose: () => void
  /** Called once a move is done (the toolbar reads its offer again). */
  onMoved: () => void
}

/** The form over the app: reads the plan from main and moves through it. */
export default function MigrationForm({ onClose, onMoved }: MigrationFormProps) {
  const [plan, setPlan] = useState<MigrationPlan>()
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MigrationResult>()

  useEffect(() => {
    let active = true
    void invoke('harnessMigration.plan').then((answer) => {
      if (!active) return
      if (answer.ok) setPlan(answer.value)
      else setFailure(answer.error)
    })
    return () => {
      active = false
    }
  }, [])

  const move = (selection: MigrationSelection): void => {
    setBusy(true)
    void invoke('harnessMigration.apply', selection).then((answer) => {
      setBusy(false)
      if (!answer.ok) {
        setResult({ outcome: 'refused', reason: answer.error })
        return
      }
      setResult(answer.value)
      if (answer.value.outcome === 'done') onMoved()
    })
  }

  return <MigrationWindow plan={plan} failure={failure} busy={busy} result={result} onMove={move} onClose={onClose} />
}

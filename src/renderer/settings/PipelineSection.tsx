// Settings → Pipeline (worfy-pipeline ticket 08; ADR-0067, ADR-0073): the Pipeline of the active
// Project — the Stages its Tickets go through — edited within the catalogue of Stage kinds: a kind is
// turned on or off, moved, renamed (`label`), given `stuck_after`, a Check its `name` and a Deploy its
// `environment`. No kinds or expressions of its own.
//
// The section never writes the Profile: main reads it and writes it through the Harness's
// `bin/profile-set` (`pipeline.read`, `pipeline.write`; src/main/ipc/pipeline.ts). The decisions of
// the owner of 2026-10-20:
// - Q2: every field is checked before the write by the rules of the Harness (pipelineStageSchema and
//   pipelineSchema, which follow harness/lib/pipeline.cjs); the script's own reason shows when it
//   still refuses.
// - Q3: a change is never blocked. A line under Save says that every Stage is computed again; removing
//   a Check that Tickets in work passed or stand on asks first and says how many.
// - Q4: Reset to default asks first, then removes the field.
// - Q6: the write goes ahead only over the Pipeline the section read; otherwise a line and Reload.
// - Q7: a commit that failed in the Harness home's git leaves the write: a warning with its reason.
// - Q8: a Harness without bin/profile-set: a line and the Harness item of the toolbar with its Update.
// - Q5: only this Machine writes. A window that shows a Linked machine shows its Pipeline read-only
//   and says where to edit it.
import { useEffect, useState, type CSSProperties } from 'react'
import type { PipelineEditorRead } from '../../shared/ipc/pipeline'
import { DEFAULT_PIPELINE, pipelineSchema, pipelineStageSchema, stageId, stageLabel, STAGE_KINDS, type PipelineStage, type StageKind } from '../../shared/workflow/pipeline'
import { invoke, readableReason, windowMachine } from '../ipc'
import { useMachineName } from '../machines/useMachines'
import { inWork } from '../pipeline/board'
import { usePipeline } from '../pipeline/usePipeline'
import { activeProject, useProjects } from '../projects/useProjects'
import HarnessStatus from '../shell/toolbar/HarnessStatus'
import { Select, type SelectOption } from '../theme/Select'

export const order = 70
export const title = 'Pipeline'

/** The line under Save (Q3). */
export const RECOMPUTE_NOTE = 'The Stage of every Ticket will be computed again.'
/** What a Harness without bin/profile-set gets (Q8). */
export const HARNESS_TOO_OLD = 'The Harness is too old for the Pipeline editor.'
/** The line of a conflict (Q6). */
export const CHANGED_SINCE_READ = 'The Pipeline has changed since it was read. Reload it.'

/** The fields of a Stage the form edits as text; an empty one is not set. */
type TextField = 'name' | 'label' | 'stuck_after' | 'environment'

/** One Stage as the form holds it: the text of each field as typed. */
interface Row {
  key: number
  kind: StageKind
  name: string
  label: string
  stuck_after: string
  environment: string
}

let nextKey = 1
const rowOf = (stage: PipelineStage): Row => ({
  key: nextKey++,
  kind: stage.kind,
  name: stage.name ?? '',
  label: stage.label ?? '',
  stuck_after: stage.stuck_after ?? '',
  environment: stage.environment ?? '',
})

/** The Stage a row stands for: the fields left empty are not set. */
function stageOf(row: Row): PipelineStage {
  const stage: PipelineStage = { kind: row.kind }
  if (row.name !== '') stage.name = row.name
  if (row.label !== '') stage.label = row.label
  if (row.stuck_after !== '') stage.stuck_after = row.stuck_after
  if (row.environment !== '') stage.environment = row.environment
  return stage
}

/** The Stage's name in the catalogue, the Profile's label left out: `Check «windows»`, `Gate & merge`. */
const kindTitle = (row: Row): string => (row.kind === 'check' && row.name === '' ? 'Check' : stageLabel({ kind: row.kind, name: row.name }))

/** Why each field of `row` breaks the rules of the Harness; a field that is fine is absent. */
function fieldErrors(row: Row): Partial<Record<TextField, string>> {
  const errors: Partial<Record<TextField, string>> = {}
  const shape = pipelineStageSchema.shape
  const check = (field: TextField, schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }) => {
    if (row[field] === '') return
    const parsed = schema.safeParse(row[field])
    if (!parsed.success) errors[field] = parsed.error?.issues[0]?.message ?? 'not valid'
  }
  if (row.kind === 'check' && row.name === '') errors.name = 'a Check needs a name: the mark check/<name> it waits for'
  else check('name', shape.name)
  check('label', shape.label)
  check('stuck_after', shape.stuck_after)
  check('environment', shape.environment)
  return errors
}

/** The kinds a row of the middle can be added as: not there yet, a Check always (one per name). */
function addableKinds(rows: readonly Row[]): StageKind[] {
  const present = new Set(rows.map((row) => row.kind))
  return STAGE_KINDS.filter((kind) => kind !== 'queued' && kind !== 'done' && (kind === 'check' || !present.has(kind)))
}

/** The rows with the one at `from` moved to `to`. */
function moved(rows: readonly Row[], from: number, to: number): Row[] {
  const next = [...rows]
  const [row] = next.splice(from, 1)
  if (row !== undefined) next.splice(to, 0, row)
  return next
}

/** A row that must stay where it is: Queued first, Done last (the rules of a Pipeline). */
const fixed = (row: Row): boolean => row.kind === 'queued' || row.kind === 'done'

const styles = {
  lead: { margin: '0 0 var(--space-3)', color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  row: { border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', padding: 'var(--space-2)' },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  kind: { flex: 1, fontSize: 'var(--text-12)', fontWeight: 600, color: 'var(--text)' },
  fields: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' },
  field: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--text-11)', color: 'var(--text-secondary)' },
  input: {
    width: 140,
    height: 'var(--row-height)',
    boxSizing: 'border-box',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 'var(--text-12)',
  },
  error: { color: 'var(--blocked-text)', fontSize: 'var(--text-11)', maxWidth: 220, overflowWrap: 'anywhere' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' },
  note: { margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  problem: { margin: 'var(--space-2) 0 0', color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  warning: { margin: 'var(--space-2) 0 0', color: 'var(--text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  confirm: { marginTop: 'var(--space-3)', padding: 'var(--space-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-button)', fontSize: 'var(--text-12)' },
  readOnly: { margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-12)', color: 'var(--text)' },
} satisfies Record<string, CSSProperties>

/** A confirmation the section waits for: removing a Check with marks, or the reset. */
type Confirm = { kind: 'remove'; key: number; title: string; tickets: number } | { kind: 'reset' }

/** What came back from the last write, shown under the buttons. */
type Outcome = { kind: 'saved'; warning: string | null } | { kind: 'conflict' } | { kind: 'invalid'; reason: string } | { kind: 'failed'; reason: string } | null

interface FieldProps {
  row: Row
  field: TextField
  caption: string
  placeholder?: string
  error: string | undefined
  onChange: (field: TextField, value: string) => void
}

function Field({ row, field, caption, placeholder, error, onChange }: FieldProps) {
  const id = `pipeline-${row.key}-${field}`
  return (
    <label style={styles.field}>
      {caption}
      <input
        style={styles.input}
        aria-label={`${kindTitle(row)} ${caption.toLowerCase()}`}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        value={row[field]}
        placeholder={placeholder}
        onChange={(event) => onChange(field, event.target.value)}
        data-testid={id}
      />
      {error === undefined ? null : (
        <span id={`${id}-error`} role="alert" style={styles.error} data-testid={`${id}-error`}>
          {error}
        </span>
      )}
    </label>
  )
}

export interface PipelineEditorProps {
  /** The Project's root on the Machine the window shows. */
  root: string
  /** The name of the Linked machine the window shows; null — this Machine, where the Pipeline can be written. */
  linkedMachine: string | null
}

/** The editor over one Project's Pipeline. */
export function PipelineEditor({ root, linkedMachine }: PipelineEditorProps) {
  const [read, setRead] = useState<PipelineEditorRead | { error: string } | undefined>(undefined)
  const [rows, setRows] = useState<Row[]>([])
  const [adding, setAdding] = useState<StageKind>('ci')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, setBusy] = useState(false)
  /** Counts the reads: Reload asks for one more. */
  const [generation, setGeneration] = useState(0)
  const { snapshot } = usePipeline(root)

  useEffect(() => {
    let active = true
    void invoke('pipeline.read', { root }).then((result) => {
      // A later read, or another Project, has taken over.
      if (!active) return
      if (!result.ok) {
        setRead({ error: readableReason(result.error) })
        return
      }
      setRead(result.value)
      if (result.value.available) setRows(result.value.pipeline.map(rowOf))
    })
    return () => {
      active = false
    }
  }, [root, generation])

  if (read === undefined) return <p style={styles.lead}>Reading the Pipeline…</p>
  if ('error' in read) {
    return (
      <p style={styles.problem} role="alert" data-testid="pipeline-read-error">
        The Pipeline could not be read: {read.error}
      </p>
    )
  }
  if (!read.available) {
    return (
      <div data-testid="pipeline-too-old">
        <p style={styles.lead}>{HARNESS_TOO_OLD}</p>
        <HarnessStatus />
      </div>
    )
  }

  if (linkedMachine !== null) {
    return (
      <div data-testid="settings-pipeline">
        <p style={styles.lead} data-testid="pipeline-elsewhere">
          This Pipeline belongs to a Project of {linkedMachine}. Edit it in worfy on {linkedMachine}.
        </p>
        <ol style={styles.readOnly}>
          {read.pipeline.map((stage) => (
            <li key={stageId(stage)} data-testid="pipeline-readonly-stage">
              {stageLabel(stage)}
              {stage.stuck_after === undefined ? null : ` · stuck after ${stage.stuck_after}`}
              {stage.environment === undefined ? null : ` · ${stage.environment}`}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  const errors = new Map(rows.map((row) => [row.key, fieldErrors(row)]))
  const fieldsFine = [...errors.values()].every((found) => Object.keys(found).length === 0)
  const stages = rows.map(stageOf)
  const whole = fieldsFine ? pipelineSchema.safeParse(stages) : null
  const listErrors = whole === null || whole.success ? [] : [...new Set(whole.error.issues.map((issue) => issue.message))]
  const changed = JSON.stringify(stages) !== JSON.stringify(read.pipeline)
  const conflict = outcome?.kind === 'conflict'
  const canSave = changed && fieldsFine && listErrors.length === 0 && !busy && !conflict
  const addable = addableKinds(rows)
  const addKind = addable.includes(adding) ? adding : addable[0]
  const options: SelectOption<StageKind>[] = addable.map((kind) => ({ value: kind, label: kind === 'check' ? 'Check' : stageLabel({ kind }) }))

  const edit = (key: number, field: TextField, value: string): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }
  /** The Tickets in work that passed the Check `id` or stand on it: they have its marks (Q3). */
  const ticketsOn = (id: string): number => (snapshot?.tickets ?? []).filter((ticket) => inWork(ticket) && (ticket.stage === id || ticket.passed.includes(id))).length
  const remove = (row: Row): void => {
    const tickets = row.kind === 'check' && row.name !== '' ? ticketsOn(stageId(stageOf(row))) : 0
    if (tickets > 0) setConfirm({ kind: 'remove', key: row.key, title: kindTitle(row), tickets })
    else setRows((current) => current.filter((candidate) => candidate.key !== row.key))
  }
  const add = (): void => {
    if (addKind === undefined) return
    setRows((current) => {
      const next = [...current]
      next.splice(Math.max(next.length - 1, 0), 0, rowOf({ kind: addKind }))
      return next
    })
  }

  const write = async (pipeline: PipelineStage[] | null): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    const result = await invoke('pipeline.write', { root, expected: read.fingerprint, pipeline })
    setBusy(false)
    if (!result.ok) {
      setOutcome({ kind: 'failed', reason: readableReason(result.error) })
      return
    }
    const answer = result.value
    switch (answer.status) {
      case 'saved': {
        const now = pipeline ?? [...DEFAULT_PIPELINE]
        setRead({ available: true, custom: pipeline !== null, pipeline: now, fingerprint: answer.fingerprint })
        setRows(now.map(rowOf))
        setOutcome({ kind: 'saved', warning: answer.warning })
        return
      }
      case 'conflict':
        setOutcome({ kind: 'conflict' })
        return
      case 'invalid':
        setOutcome({ kind: 'invalid', reason: answer.reason })
        return
      case 'too-old':
        setRead({ available: false, reason: 'this Harness has no bin/profile-set' })
        return
    }
  }

  const reload = (): void => {
    setOutcome(null)
    setConfirm(null)
    setGeneration((current) => current + 1)
  }

  return (
    <div data-testid="settings-pipeline">
      <p style={styles.lead}>
        The Stages a Ticket of this Project goes through, from the catalogue: Queued first, Done last. {read.custom ? 'The Profile sets its own Pipeline.' : 'The default Pipeline.'}
      </p>
      <ol style={styles.list}>
        {rows.map((row, index) => {
          const found = errors.get(row.key) ?? {}
          const first = index === 1
          const last = index === rows.length - 2
          return (
            <li key={row.key} style={styles.row} data-testid="pipeline-stage" data-kind={row.kind}>
              <div style={styles.head}>
                <span style={styles.kind}>{kindTitle(row)}</span>
                {fixed(row) ? null : (
                  <>
                    <button type="button" className="w-action" aria-label={`Move ${kindTitle(row)} up`} disabled={first} onClick={() => setRows((current) => moved(current, index, index - 1))}>
                      ↑
                    </button>
                    <button type="button" className="w-action" aria-label={`Move ${kindTitle(row)} down`} disabled={last} onClick={() => setRows((current) => moved(current, index, index + 1))}>
                      ↓
                    </button>
                    <button type="button" className="w-action" aria-label={`Remove ${kindTitle(row)}`} onClick={() => remove(row)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
              <div style={styles.fields}>
                {row.kind === 'check' ? <Field row={row} field="name" caption="Name" placeholder="windows" error={found.name} onChange={(field, value) => edit(row.key, field, value)} /> : null}
                <Field row={row} field="label" caption="Label" placeholder={kindTitle(row)} error={found.label} onChange={(field, value) => edit(row.key, field, value)} />
                {row.kind === 'done' ? null : <Field row={row} field="stuck_after" caption="Stuck after" placeholder="e.g. 2h" error={found.stuck_after} onChange={(field, value) => edit(row.key, field, value)} />}
                {row.kind === 'deploy' ? <Field row={row} field="environment" caption="Environment" placeholder="production" error={found.environment} onChange={(field, value) => edit(row.key, field, value)} /> : null}
              </div>
            </li>
          )
        })}
      </ol>
      {listErrors.map((message) => (
        <p key={message} style={styles.problem} role="alert" data-testid="pipeline-list-error">
          {message}
        </p>
      ))}
      {addKind === undefined ? null : (
        <div style={styles.actions}>
          <Select aria-label="Stage to add" data-testid="pipeline-add-kind" value={addKind} options={options} onChange={setAdding} />
          <button type="button" className="w-action" onClick={add} data-testid="pipeline-add">
            Add
          </button>
        </div>
      )}
      <div style={styles.actions}>
        <button type="button" className="w-action w-action--primary" disabled={!canSave} aria-disabled={canSave ? undefined : 'true'} onClick={() => void write(stages)} data-testid="pipeline-save">
          Save
        </button>
        <button type="button" className="w-action" disabled={!read.custom || busy} onClick={() => setConfirm({ kind: 'reset' })} data-testid="pipeline-reset">
          Reset to default
        </button>
      </div>
      <p style={styles.note} data-testid="pipeline-recompute">
        {RECOMPUTE_NOTE}
      </p>
      {confirm === null ? null : (
        <div role="alertdialog" aria-label="Confirm" style={styles.confirm} data-testid="pipeline-confirm">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            {confirm.kind === 'reset'
              ? 'Reset the Pipeline to the default? The Profile loses its own Pipeline.'
              : `Remove ${confirm.title}? ${confirm.tickets} ${confirm.tickets === 1 ? 'Ticket has' : 'Tickets have'} its mark or stand on it.`}
          </p>
          <div style={styles.head}>
            <button
              type="button"
              className="w-action w-action--primary"
              onClick={() => {
                setConfirm(null)
                if (confirm.kind === 'reset') void write(null)
                else setRows((current) => current.filter((row) => row.key !== confirm.key))
              }}
              data-testid="pipeline-confirm-yes"
            >
              {confirm.kind === 'reset' ? 'Reset' : 'Remove'}
            </button>
            <button type="button" className="w-action" onClick={() => setConfirm(null)} data-testid="pipeline-confirm-no">
              Cancel
            </button>
          </div>
        </div>
      )}
      {outcome?.kind === 'saved' ? (
        outcome.warning === null ? (
          <p style={styles.note} role="status" data-testid="pipeline-saved">
            Saved.
          </p>
        ) : (
          <p style={styles.warning} role="status" data-testid="pipeline-commit-warning">
            Saved, but not committed in the Harness history: {outcome.warning}
          </p>
        )
      ) : null}
      {outcome?.kind === 'conflict' ? (
        <div style={styles.actions} role="alert" data-testid="pipeline-conflict">
          <span style={{ ...styles.problem, margin: 0 }}>{CHANGED_SINCE_READ}</span>
          <button type="button" className="w-action" onClick={reload} data-testid="pipeline-reload">
            Reload
          </button>
        </div>
      ) : null}
      {outcome?.kind === 'invalid' ? (
        <p style={styles.problem} role="alert" data-testid="pipeline-invalid">
          Not saved: {outcome.reason}
        </p>
      ) : null}
      {outcome?.kind === 'failed' ? (
        <p style={styles.problem} role="alert" data-testid="pipeline-failed">
          Not saved: {outcome.reason}
        </p>
      ) : null}
    </div>
  )
}

/** The section: the editor over the window's active Project. */
export default function PipelineSection() {
  const project = activeProject(useProjects())
  const machine = windowMachine()
  const machineName = useMachineName(machine)
  if (project === undefined) return <p style={styles.lead}>Open a Project to see its Pipeline.</p>
  return <PipelineEditor key={project.path} root={project.path} linkedMachine={machine === null ? null : (machineName ?? machine)} />
}

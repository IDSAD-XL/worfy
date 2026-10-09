import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  ACTION_LABELS,
  ACTIONS,
  PLACEHOLDER_DESCRIPTIONS,
  PLACEHOLDERS,
  templateError,
  type ActionTemplates,
} from '../../shared/projects/action-templates'
import { invoke, invokeOn } from '../ipc'
import { PrimaryButton } from '../theme/primitives'

export interface ProjectSettingsProps {
  project: { id: string; name: string }
  /**
   * The Machine of the Project (worfy-link ticket 09): null — this Machine, an id — a Linked
   * machine. Left out: the Machine the window shows.
   */
  machine?: string | null
  onClose: () => void
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.25)',
  },
  dialog: {
    width: 480,
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-node)',
    fontSize: 'var(--text-13)',
  },
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-15)', fontWeight: 600 },
  subtitle: { margin: '0 0 var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' },
  label: { fontWeight: 600 },
  input: {
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
  },
  error: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)' },
  hint: { color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  placeholders: { margin: '0 0 var(--space-4)', padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px var(--space-3)' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  secondary: {
    height: 'var(--row-height)',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 'var(--text-13)',
  },
} satisfies Record<string, CSSProperties>

/**
 * "Project settings…": the action templates of one Project (ticket 23 sends them). A template with
 * an unknown placeholder shows its error under the field and cannot be saved; main checks the same
 * schema again (projects.settings.set).
 */
export function ProjectSettings({ project, machine, onClose }: ProjectSettingsProps) {
  // The calls go to the Project's Machine.
  const call: typeof invoke = machine === undefined ? invoke : (channel, ...args) => invokeOn(machine, channel, ...args)
  const [templates, setTemplates] = useState<ActionTemplates>()
  const [failure, setFailure] = useState<string>()
  const [saving, setSaving] = useState(false)
  const titleId = useId()
  const fieldId = useId()
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const id = { id: project.id }
    void (machine === undefined ? invoke('projects.settings.get', id) : invokeOn(machine, 'projects.settings.get', id)).then((result) => {
      if (!active) return
      if (result.ok) setTemplates(result.value.actionTemplates)
      else setFailure(result.error)
    })
    return () => {
      active = false
    }
  }, [project.id, machine])

  const loaded = templates !== undefined
  useEffect(() => {
    if (loaded) firstField.current?.focus()
  }, [loaded])

  const errors = Object.fromEntries(ACTIONS.map((action) => [action, templates ? templateError(templates[action]) : undefined]))
  const invalid = ACTIONS.some((action) => errors[action] !== undefined)

  const save = async (): Promise<void> => {
    if (!templates || invalid) return
    setSaving(true)
    const result = await call('projects.settings.set', { id: project.id, settings: { actionTemplates: templates } })
    setSaving(false)
    if (result.ok) onClose()
    else setFailure(result.error)
  }

  // The defaults depend on the Harness on the machine (worfy-harness ticket 12): main says which.
  const resetToDefault = async (): Promise<void> => {
    const result = await call('projects.settings.defaults')
    if (result.ok) {
      setFailure(undefined)
      setTemplates(result.value.actionTemplates)
    } else setFailure(result.error)
  }

  return createPortal(
    <div
      style={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={styles.dialog}
        data-testid="project-settings"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id={titleId} style={styles.title}>
          Project settings
        </h2>
        <p style={styles.subtitle}>
          {project.name} · the message each action sends. Empty means the action is not configured.
        </p>

        {templates
          ? ACTIONS.map((action, index) => {
              const id = `${fieldId}-${action}`
              const error = errors[action]
              return (
                <div key={action} style={styles.field}>
                  <label htmlFor={id} style={styles.label}>
                    {ACTION_LABELS[action]}
                  </label>
                  <input
                    ref={index === 0 ? firstField : undefined}
                    id={id}
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    style={styles.input}
                    value={templates[action]}
                    placeholder="Not configured"
                    aria-invalid={error !== undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(event) => setTemplates({ ...templates, [action]: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void save()
                    }}
                  />
                  {error ? (
                    <span id={`${id}-error`} role="alert" style={styles.error}>
                      {error}
                    </span>
                  ) : null}
                </div>
              )
            })
          : !failure && <p style={styles.hint}>Loading…</p>}

        <p style={{ ...styles.hint, margin: '0 0 var(--space-1)' }}>Placeholders</p>
        <ul style={styles.placeholders} aria-label="Placeholders">
          {PLACEHOLDERS.map((name) => (
            <li key={name} style={{ display: 'contents' }}>
              <code className="w-mono">{`{${name}}`}</code>
              <span style={styles.hint}>{PLACEHOLDER_DESCRIPTIONS[name]}</span>
            </li>
          ))}
        </ul>

        {failure ? (
          <p role="alert" style={{ ...styles.error, margin: '0 0 var(--space-3)' }}>
            {failure}
          </p>
        ) : null}

        <div style={styles.actions}>
          <button type="button" style={styles.secondary} disabled={!templates} onClick={() => void resetToDefault()}>
            Reset to default
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.secondary} onClick={onClose}>
            Cancel
          </button>
          <PrimaryButton disabled={!templates || invalid || saving} onClick={() => void save()}>
            Save
          </PrimaryButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

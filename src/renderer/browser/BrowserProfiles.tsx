// The window «Browser profiles…» (worfy-browser ticket 03, the owner's decision 1): the Browser
// profiles of one Project — create, rename, delete, the list of origins and the flag «Available to
// Autopilot». It opens from the profile's name in a Browser frame's header, and from «Choose a
// profile». The profiles live in main (src/main/browser/profiles.ts); only the user changes them,
// and only here.
//
// Deleting a profile erases its cookies and logins. It is asked once more, naming how many Browsers
// of the Canvas use the profile (decision 3); those Browsers then show «Choose a profile».
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useStore, type InternalNode, type ReactFlowState } from '@xyflow/react'
import { readOrigins, type BrowserProfile } from '../../shared/browser/profiles'
import { BROWSER_KIND, browserProfileUsage } from '../canvas/nodes/browser-frame'
import type { CanvasFlowNode } from '../canvas/nodes'
import { invoke } from '../ipc'
import { useReadOnly } from '../projects/useProjects'
import { PrimaryButton } from '../theme/primitives'
import { useBrowserProfiles } from './profiles'

export interface BrowserProfilesProps {
  project: { id: string; name: string }
  /** The profile shown first; null — the first of the list. */
  selected: string | null
  onClose: () => void
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 520,
    // It takes the focus only so Escape reaches it; the ring would mark the whole window.
    outline: 'none',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    overflowY: 'auto',
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
  subtitle: { margin: '0 0 var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  list: { display: 'flex', flexDirection: 'column', gap: 2, margin: '0 0 var(--space-2)', padding: 0, listStyle: 'none' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%', textAlign: 'left' },
  muted: { color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  create: { display: 'flex', gap: 'var(--space-2)', margin: '0 0 var(--space-4)' },
  editor: { borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' },
  label: { fontWeight: 600 },
  input: {
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 'var(--text-13)',
    minWidth: 0,
  },
  origins: {
    minHeight: 72,
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
    resize: 'vertical',
  },
  check: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' },
  error: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  confirm: { margin: 'var(--space-3) 0 0', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-button)', border: '1px solid var(--blocked-ring)' },
  secondary: {
    height: 'var(--row-height)',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 'var(--text-13)',
  },
  danger: {
    height: 'var(--row-height)',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--blocked-ring)',
    background: 'var(--surface)',
    color: 'var(--blocked-text)',
    fontSize: 'var(--text-13)',
  },
} satisfies Record<string, CSSProperties>

/**
 * How many Browsers of the Canvas use each profile (browserProfileUsage), as one string so the
 * selector compares by value: every Browser Node, drawn or not.
 */
function usageKey(profiles: readonly BrowserProfile[] | undefined): (state: ReactFlowState) => string {
  return (state) => {
    const browsers: object[] = []
    for (const node of state.nodeLookup.values() as Iterable<InternalNode<CanvasFlowNode>>) {
      if (node.type === BROWSER_KIND) browsers.push(node.data.node.data)
    }
    return JSON.stringify(browserProfileUsage(browsers, profiles))
  }
}

const browsers = (count: number): string => (count === 1 ? '1 Browser' : `${count} Browsers`)

/** The editor of one profile: its name, origins and flag, Save, and Delete with its question. */
function ProfileEditor({ projectId, profile, usedBy, readOnly, onDeleted }: { projectId: string; profile: BrowserProfile; usedBy: number; readOnly: string | null; onDeleted: () => void }) {
  const [name, setName] = useState(profile.name)
  const [originsText, setOriginsText] = useState(profile.origins.join('\n'))
  const [autopilot, setAutopilot] = useState(profile.autopilot)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const nameId = useId()
  const originsId = useId()
  const { origins, error } = readOrigins(originsText.split('\n'))
  const nameError = name.trim() === '' ? 'A Browser profile needs a name' : undefined
  const changed = name.trim() !== profile.name || origins.join('\n') !== profile.origins.join('\n') || autopilot !== profile.autopilot
  const locked = readOnly !== null || busy

  const save = async (): Promise<void> => {
    if (locked || error !== undefined || nameError !== undefined || !changed) return
    setBusy(true)
    const result = await invoke('browser.profiles.update', { projectId, id: profile.id, name: name.trim(), origins, autopilot })
    setBusy(false)
    setFailure(result.ok ? undefined : result.error)
  }

  const remove = async (): Promise<void> => {
    if (locked) return
    setBusy(true)
    const result = await invoke('browser.profiles.delete', { projectId, id: profile.id })
    setBusy(false)
    setConfirming(false)
    if (result.ok) onDeleted()
    else setFailure(result.error)
  }

  return (
    <div style={styles.editor} data-testid="browser-profile-editor">
      <div style={styles.field}>
        <label htmlFor={nameId} style={styles.label}>
          Name
        </label>
        <input
          id={nameId}
          type="text"
          style={styles.input}
          value={name}
          spellCheck={false}
          autoComplete="off"
          readOnly={readOnly !== null}
          aria-invalid={nameError !== undefined}
          data-testid="browser-profile-name-input"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
        {nameError ? <span style={styles.error}>{nameError}</span> : null}
      </div>
      <div style={styles.field}>
        <label htmlFor={originsId} style={styles.label}>
          Origins
        </label>
        <textarea
          id={originsId}
          style={styles.origins}
          value={originsText}
          spellCheck={false}
          placeholder={'http://localhost:3000\nhttps://staging.example.com'}
          readOnly={readOnly !== null}
          aria-invalid={error !== undefined}
          data-testid="browser-profile-origins"
          onChange={(event) => setOriginsText(event.target.value)}
        />
        {error ? (
          <span role="alert" style={styles.error} data-testid="browser-profile-origins-error">
            {error}
          </span>
        ) : (
          <span style={styles.muted}>One per line, exactly scheme://host:port. The sites a Session may take this Browser profile to; empty is allowed.</span>
        )}
      </div>
      <label style={styles.check}>
        <input type="checkbox" checked={autopilot} disabled={readOnly !== null} data-testid="browser-profile-autopilot" onChange={(event) => setAutopilot(event.target.checked)} />
        Available to Autopilot
      </label>
      {failure ? (
        <p role="alert" style={{ ...styles.error, margin: '0 0 var(--space-3)' }}>
          {failure}
        </p>
      ) : null}
      <div style={styles.actions}>
        <button type="button" style={styles.danger} disabled={locked} title={readOnly ?? undefined} data-testid="browser-profile-delete" onClick={() => setConfirming(true)}>
          Delete…
        </button>
        <span style={{ flex: 1 }} />
        <PrimaryButton disabled={locked || !changed || error !== undefined || nameError !== undefined} onClick={() => void save()}>
          Save
        </PrimaryButton>
      </div>
      {confirming ? (
        <div style={styles.confirm} role="alertdialog" aria-label={`Delete ${profile.name}`} data-testid="browser-profile-delete-question">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            Delete "{profile.name}"? Its cookies and logins are erased.{' '}
            <span data-testid="browser-profile-delete-usage">
              {usedBy > 0 ? `${browsers(usedBy)} on this Canvas ${usedBy === 1 ? 'uses' : 'use'} it and will ask for another Browser profile.` : 'No Browser on this Canvas uses it.'}
            </span>
          </p>
          <div style={styles.actions}>
            <span style={{ flex: 1 }} />
            <button type="button" style={styles.secondary} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" style={styles.danger} disabled={locked} data-testid="browser-profile-delete-confirm" onClick={() => void remove()}>
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function BrowserProfiles({ project, selected, onClose }: BrowserProfilesProps) {
  const profiles = useBrowserProfiles(project.id)
  const usage = JSON.parse(useStore(usageKey(profiles))) as Record<string, number>
  const readOnly = useReadOnly()
  const [current, setCurrent] = useState<string | null>(selected)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState<string>()
  const titleId = useId()
  // The window takes the focus when it opens, so Escape closes it before anything is clicked.
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.focus()
  }, [])
  // A profile shown that goes away (deleted here or in another window) leaves the first one shown.
  const shown = profiles?.find((profile) => profile.id === current) ?? profiles?.[0]

  const create = async (): Promise<void> => {
    if (readOnly !== null || creating || newName.trim() === '') return
    setCreating(true)
    const result = await invoke('browser.profiles.create', { projectId: project.id, name: newName.trim() })
    setCreating(false)
    if (result.ok) {
      setNewName('')
      setFailure(undefined)
      setCurrent(result.value.id)
    } else setFailure(result.error)
  }

  // Inside a Browser frame on the Canvas: the window's own presses, keys and clicks are not the frame's.
  const own = { onClick: stop, onMouseDown: stop, onPointerDown: stop, onDoubleClick: stop, onContextMenu: stop, onKeyDown: stop, onWheel: stop }

  return createPortal(
    <div
      style={styles.backdrop}
      {...own}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={styles.dialog}
        data-testid="browser-profiles"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id={titleId} style={styles.title}>
          Browser profiles
        </h2>
        <p style={styles.subtitle}>{project.name} · each profile keeps its own cookies and logins. You log in yourself, in a Browser.</p>

        {profiles === undefined ? <p style={styles.muted}>Loading…</p> : null}
        <ul style={styles.list} aria-label="Browser profiles">
          {(profiles ?? []).map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                className="w-row"
                style={styles.row}
                aria-current={profile.id === shown?.id ? 'true' : undefined}
                data-testid="browser-profile-row"
                data-profile={profile.id}
                onClick={() => setCurrent(profile.id)}
              >
                <span style={{ fontWeight: profile.id === shown?.id ? 600 : 400 }}>{profile.name}</span>
                <span style={styles.muted}>{browsers(usage[profile.id] ?? 0)}</span>
              </button>
            </li>
          ))}
        </ul>
        {profiles?.length === 0 ? <p style={styles.muted}>No Browser profile yet. Create one to open a Browser.</p> : null}

        <div style={styles.create}>
          <input
            type="text"
            style={{ ...styles.input, flex: 1 }}
            value={newName}
            placeholder="New Browser profile, e.g. admin"
            aria-label="New Browser profile name"
            spellCheck={false}
            autoComplete="off"
            readOnly={readOnly !== null}
            data-testid="browser-profiles-new-name"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create()
            }}
          />
          <button type="button" style={styles.secondary} disabled={readOnly !== null || creating || newName.trim() === ''} title={readOnly ?? undefined} data-testid="browser-profiles-create" onClick={() => void create()}>
            Create
          </button>
        </div>
        {failure ? (
          <p role="alert" style={{ ...styles.error, margin: '0 0 var(--space-3)' }}>
            {failure}
          </p>
        ) : null}

        {shown !== undefined ? (
          <ProfileEditor
            key={`${shown.id} ${shown.name} ${shown.origins.join(' ')} ${String(shown.autopilot)}`}
            projectId={project.id}
            profile={shown}
            usedBy={usage[shown.id] ?? 0}
            readOnly={readOnly}
            onDeleted={() => setCurrent(null)}
          />
        ) : null}

        {readOnly !== null ? (
          <p className="w-read-only-note" style={{ margin: 'var(--space-3) 0 0' }}>
            {readOnly}
          </p>
        ) : null}

        <div style={{ ...styles.actions, marginTop: 'var(--space-4)' }}>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.secondary} data-testid="browser-profiles-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function stop(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

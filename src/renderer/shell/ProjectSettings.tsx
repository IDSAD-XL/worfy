import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  ACTION_LABELS,
  ACTIONS,
  PLACEHOLDER_DESCRIPTIONS,
  PLACEHOLDERS,
  templateError,
  SHIP_TICKET_VENDOR,
  type ActionTemplates,
  type TerminalShellSetting,
} from '../../shared/projects/action-templates'
import type { TeamReviewerState } from '../../shared/ipc/projects'
import { UNNAMED_VENDOR, VENDOR_IDS, vendorLabel, type VendorId } from '../../shared/vendors/vendor'
import { invoke, invokeOn, windowMachine } from '../ipc'
import { EditProfile } from '../projects/EditProfile'
import { useReadOnly } from '../projects/useProjects'
import { SettingSwitch } from '../settings/controls'
import { PrimaryButton } from '../theme/primitives'
import { Select } from '../theme/Select'

export interface ProjectSettingsProps {
  /** `path`, the repository root, opens "Edit profile"; without it the button is not shown. */
  project: { id: string; name: string; path?: string }
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
    // The sections may not fit a small window: the dialog scrolls instead of losing its buttons.
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
  subtitle: { margin: '0 0 var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' },
  label: { fontWeight: 600 },
  // A label with its switch at the row's end, as in Settings; the dialog's bold label and spacing.
  toggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' },
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
  folders: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  folder: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  // A long path wraps anywhere, so its end — the folder's own name — stays in view.
  folderPath: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--text-12)' },
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

/** The shells of the Machine of the Project, as terminal.shells answers. */
type ShellOptions = { id: TerminalShellSetting; label: string; found: boolean }[]

/** "Default vendor": a Vendor, or none — New session then lists Claude Code first (worfy-multi-vendor ticket 24). */
type VendorChoice = VendorId | 'none'

const VENDOR_OPTIONS: readonly { value: VendorChoice; label: string }[] = [
  { value: 'none', label: `None (${vendorLabel(UNNAMED_VENDOR)})` },
  ...VENDOR_IDS.map((vendor) => ({ value: vendor, label: vendorLabel(vendor) })),
]

/**
 * "Project settings…": the action templates of one Project (ticket 23 sends them). A template with
 * an unknown placeholder shows its error under the field and cannot be saved; main checks the same
 * schema again (projects.settings.set).
 *
 * On a Machine that has shells to choose from — Windows (worfy-windows ticket 10) — it also shows
 * the shell of the Project's Terminals. The choice applies to the next shell that starts: Restart,
 * or a new Terminal Node. Elsewhere there is no such field, and a saved choice is kept as it is.
 *
 * "Default vendor" (worfy-multi-vendor ticket 24): the Vendor "New session" lists first and a Session
 * started without a pick runs on, and the Vendor of the Project's Orchestrator from its next start
 * (ticket 37). "None" clears it, and Claude Code is then the default.
 *
 * "Team reviewer" (worfy-human-review ticket 09, spec Q6 (a)): the state of the Project's reviewer in
 * its team's voice, with "Build" ("Update" once built, ticket 10) and "Delete"; see TeamReviewerSection.
 *
 * "Product Session may also write here" (worfy-polish ticket 82): the folders outside the Product Session
 * folder where its writes go without a question, one row each with "Remove". «Always allow in <folder>»
 * on a Product Session's question adds them; a removal is sent with Save, and only then, so a Save of
 * the other fields never touches the list.
 *
 * "Read pull requests from GitHub" (worfy-pr-inbox ticket 03, spec decision Q10): the `prInbox` field, on by
 * default. Off, main runs no gh for the Project's PR inbox; it is sent with Save, and only when changed here.
 *
 * "Edit profile…" (worfy-polish ticket 78) opens the fields of the Project's Profile over this window
 * (EditProfile.tsx): they are the Harness's, written by its `bin/profile-set` on their own Save, not with
 * the settings of this window.
 */
export function ProjectSettings({ project, machine, onClose }: ProjectSettingsProps) {
  // The calls go to the Project's Machine.
  const call: typeof invoke = machine === undefined ? invoke : (channel, ...args) => invokeOn(machine, channel, ...args)
  const [templates, setTemplates] = useState<ActionTemplates>()
  const [terminalShell, setTerminalShell] = useState<TerminalShellSetting>()
  // The Vendor as saved (undefined: none), and as chosen in the dialog.
  const [savedVendor, setSavedVendor] = useState<VendorId>()
  const [vendor, setVendor] = useState<VendorChoice>('none')
  // «Product Session may also write here» as loaded, and as left after the removals in the dialog.
  const [loadedFolders, setLoadedFolders] = useState<readonly string[]>([])
  const [folders, setFolders] = useState<readonly string[]>([])
  // "Read pull requests from GitHub" as loaded, and as switched in the dialog: absent in settings.json reads as on.
  const [loadedInbox, setLoadedInbox] = useState(true)
  const [inbox, setInbox] = useState(true)
  // The fields as loaded: "Build" of the team reviewer closes the window only when none was edited since.
  const [loadedFields, setLoadedFields] = useState<string>()
  const [shells, setShells] = useState<ShellOptions>([])
  const [failure, setFailure] = useState<string>()
  const [saving, setSaving] = useState(false)
  // "Edit profile" is open over the window; the line its Save left.
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState<string>()
  // Focus goes back to "Edit profile…" when its dialog closes, so the keyboard stays where it was.
  const editProfileButton = useRef<HTMLButtonElement>(null)
  const closeProfile = (): void => {
    setEditingProfile(false)
    editProfileButton.current?.focus()
  }
  // A Project of a Linked machine that shares it read-only (worfy-link ticket 25): the settings show, Save is off.
  const readOnly = useReadOnly(machine === undefined ? windowMachine() : machine)
  const titleId = useId()
  const fieldId = useId()
  const shellId = useId()
  const vendorId = useId()
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const id = { id: project.id }
    void (machine === undefined ? invoke('projects.settings.get', id) : invokeOn(machine, 'projects.settings.get', id)).then((result) => {
      if (!active) return
      if (result.ok) {
        setTemplates(result.value.actionTemplates)
        setTerminalShell(result.value.terminalShell)
        setSavedVendor(result.value.defaultVendor)
        setVendor(result.value.defaultVendor ?? 'none')
        setLoadedFolders(result.value.productWriteFolders ?? [])
        setFolders(result.value.productWriteFolders ?? [])
        setLoadedInbox(result.value.prInbox ?? true)
        setInbox(result.value.prInbox ?? true)
        setLoadedFields(fieldsKey(result.value.actionTemplates, result.value.terminalShell, result.value.defaultVendor ?? 'none', result.value.productWriteFolders ?? [], result.value.prInbox ?? true))
      } else setFailure(result.error)
    })
    // No answer, or a failure, leaves the list empty: the field is not shown.
    void (machine === undefined ? invoke('terminal.shells') : invokeOn(machine, 'terminal.shells')).then((result) => {
      if (active && result.ok) setShells(result.value)
    })
    return () => {
      active = false
    }
  }, [project.id, machine])

  const loaded = templates !== undefined
  const edited = templates !== undefined && loadedFields !== undefined && fieldsKey(templates, terminalShell, vendor, folders, inbox) !== loadedFields
  useEffect(() => {
    if (loaded) firstField.current?.focus()
  }, [loaded])

  const errors = Object.fromEntries(ACTIONS.map((action) => [action, templates ? templateError(templates[action]) : undefined]))
  const invalid = ACTIONS.some((action) => errors[action] !== undefined)

  const save = async (): Promise<void> => {
    if (!templates || invalid || readOnly !== null) return
    setSaving(true)
    // The whole settings go back: the templates, and the shell when one is chosen or was saved before.
    // "Default vendor": a Vendor, or null to clear a saved one; nothing when none was saved or chosen,
    // so a Linked machine on a build from before the field takes the save too.
    const defaultVendor = vendor !== 'none' ? vendor : savedVendor !== undefined ? null : undefined
    // The folders removed here, not the list left: a folder «Always allow» added while the dialog stood open stays.
    const productWriteFoldersRemoved = loadedFolders.filter((folder) => !folders.includes(folder))
    const settings = {
      actionTemplates: templates,
      ...(terminalShell === undefined ? {} : { terminalShell }),
      ...(defaultVendor === undefined ? {} : { defaultVendor }),
      ...(productWriteFoldersRemoved.length === 0 ? {} : { productWriteFoldersRemoved }),
      // Only a change: a save that leaves the switch alone keeps what settings.json says.
      ...(inbox === loadedInbox ? {} : { prInbox: inbox }),
    }
    const result = await call('projects.settings.set', { id: project.id, settings })
    setSaving(false)
    if (result.ok) onClose()
    else setFailure(result.error)
  }

  // The defaults depend on the Harness on the machine (worfy-harness ticket 12): main says which.
  // They are the defaults of the action templates: the shell chosen for the Terminals stays.
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

        {templates && shells.length > 0 ? (
          <div style={styles.field}>
            <label htmlFor={shellId} style={styles.label}>
              Terminal shell
            </label>
            {/* Named by the label above; Esc on its open list closes the list alone, not this window. */}
            <Select<TerminalShellSetting>
              id={shellId}
              style={styles.input}
              value={terminalShell ?? 'powershell'}
              options={shells.map((shell) => ({ value: shell.id, label: shell.found ? shell.label : `${shell.label} — not found on this machine` }))}
              onChange={setTerminalShell}
              data-testid="project-settings-shell"
            />
            <span style={styles.hint}>Applies to the next shell: Restart a Terminal, or open a new one.</span>
          </div>
        ) : null}

        {templates ? (
          <div style={styles.field}>
            <label htmlFor={vendorId} style={styles.label}>
              Default vendor
            </label>
            {/* Named by the label above; Esc on its open list closes the list alone, not this window. */}
            <Select<VendorChoice> id={vendorId} style={styles.input} value={vendor} options={VENDOR_OPTIONS} onChange={setVendor} data-testid="project-settings-vendor" />
            <span style={styles.hint}>
              Listed first in New session. The Orchestrator runs on it from its next start: New Orchestrator Session, or the next start of worfy. Ship ticket runs on {vendorLabel(SHIP_TICKET_VENDOR)}{' '}
              whatever is chosen here.
            </span>
          </div>
        ) : null}

        {templates ? (
          <section style={styles.field} aria-label="Product Session may also write here" data-testid="product-write-folders">
            <span style={styles.label}>Product Session may also write here</span>
            {folders.length === 0 ? (
              <span style={styles.hint} data-testid="product-write-folders-empty">
                No folders yet.
              </span>
            ) : (
              <ul style={styles.folders}>
                {folders.map((folder) => (
                  <li key={folder} style={styles.folder} data-testid="product-write-folder">
                    <code className="w-mono" style={styles.folderPath} title={folder}>
                      {folder}
                    </code>
                    <button type="button" style={styles.secondary} aria-label={`Remove ${folder}`} disabled={readOnly !== null} onClick={() => setFolders(folders.filter((each) => each !== folder))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span style={styles.hint}>
              A Product Session writes outside its own folder only after it asks; "Always allow in" a folder adds it here, and it then writes there without asking. A removal applies on Save.
            </span>
          </section>
        ) : null}

        {templates ? (
          <section style={styles.field} aria-label="Pull requests" data-testid="project-settings-pr-inbox">
            <div style={styles.toggle}>
              <span style={styles.label}>Read pull requests from GitHub</span>
              <SettingSwitch label="Read pull requests from GitHub" checked={inbox} onChange={setInbox} disabled={readOnly !== null} title={readOnly ?? undefined} testId="project-settings-pr-inbox-switch" />
            </div>
            <span style={styles.hint}>
              The Pull requests view and its sidebar section: the open PRs and review requests of the Project&apos;s repositories, searched every 5 minutes. Off, worfy runs no gh for them.
            </span>
          </section>
        ) : null}

        {project.path === undefined ? null : (
          <section style={styles.field} aria-label="Profile" data-testid="project-settings-profile">
            <span style={styles.label}>Profile</span>
            <span style={styles.hint}>The Harness&apos;s profile of the Project: commands, ticket paths, review lenses, languages, worktrees.</span>
            <div style={styles.actions}>
              <button ref={editProfileButton} type="button" style={styles.secondary} onClick={() => setEditingProfile(true)}>
                Edit profile…
              </button>
            </div>
            {profileSaved === undefined ? null : (
              <span role="status" style={styles.hint} data-testid="project-settings-profile-saved">
                {profileSaved}
              </span>
            )}
          </section>
        )}

        <TeamReviewerSection projectId={project.id} machine={machine} readOnly={readOnly !== null} onBuilt={() => {
            if (edited) return false
            onClose()
            return true
          }}
        />

        <p style={{ ...styles.hint, margin: '0 0 var(--space-1)' }}>Placeholders</p>
        <ul style={styles.placeholders} aria-label="Placeholders">
          {PLACEHOLDERS.map((name) => (
            <li key={name} style={{ display: 'contents' }}>
              <code className="w-mono">{`{${name}}`}</code>
              <span style={styles.hint}>{PLACEHOLDER_DESCRIPTIONS[name]}</span>
            </li>
          ))}
        </ul>

        {readOnly !== null ? (
          <p className="w-read-only-note" style={{ margin: '0 0 var(--space-3)' }} data-testid="project-settings-read-only">
            {readOnly}
          </p>
        ) : null}

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
          <PrimaryButton disabled={!templates || invalid || saving || readOnly !== null} onClick={() => void save()}>
            Save
          </PrimaryButton>
        </div>
      </div>
      {editingProfile && project.path !== undefined ? (
        <EditProfile
          project={{ name: project.name, path: project.path }}
          machine={machine}
          readOnly={readOnly}
          onClose={closeProfile}
          onSaved={(warning) => {
            closeProfile()
            setProfileSaved(warning === null ? 'Profile saved.' : `Profile saved; ${warning}.`)
          }}
        />
      ) : null}
    </div>,
    document.body,
  )
}

/** The editable fields of the dialog as one string, to tell whether any was edited since the load. */
function fieldsKey(templates: ActionTemplates, terminalShell: TerminalShellSetting | undefined, vendor: VendorChoice, folders: readonly string[], inbox: boolean): string {
  return JSON.stringify([templates, terminalShell ?? null, vendor, folders, inbox])
}

/** A date as `YYYY-MM-DD` in the local time of the window. */
function localDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** The state line of "Team reviewer". */
function teamReviewerText(state: TeamReviewerState): string {
  switch (state.status) {
    case 'none':
      return 'Not built'
    case 'built':
      return state.pullRequests === null ? `Built ${localDate(state.builtAt)}` : `Built ${localDate(state.builtAt)}, ${state.pullRequests} PRs`
    case 'short':
      return `Too little history: ${state.substantive} of ${state.threshold}`
    case 'unavailable':
      return `Not available: ${state.reason}`
  }
}

interface TeamReviewerSectionProps {
  projectId: string
  /** As ProjectSettingsProps.machine: the calls go to the Project's Machine. */
  machine: string | null | undefined
  /** A Project of a Linked machine shared read-only: the state shows, the buttons do not. */
  readOnly: boolean
  /**
   * "Build" or "Update" started the Session: the dialog closes, so the new Session Node is in sight, and answers
   * true. A dialog with edits not saved stays open and answers false, so the edits are not lost.
   */
  onBuilt: () => boolean
}

/**
 * "Team reviewer" of Project settings (worfy-human-review ticket 09): the reviewer skill in the team's
 * voice that the generator /worfy:human-review-setup builds from the Project's pull request history
 * and keeps in the private folder of its Profile (projects.reviewer.get reads it). "Build" starts a new
 * Session with the generator; once built, "Update" (worfy-human-review ticket 10) starts it with
 * --refresh, which reads the pull requests since and shows the diff of the rules before it replaces
 * anything. "Delete" erases the private folder after a confirmation.
 */
function TeamReviewerSection({ projectId, machine, readOnly, onBuilt }: TeamReviewerSectionProps) {
  const call: typeof invoke = machine === undefined ? invoke : (channel, ...args) => invokeOn(machine, channel, ...args)
  const [state, setState] = useState<TeamReviewerState>()
  const [failure, setFailure] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    let active = true
    const id = { id: projectId }
    void (machine === undefined ? invoke('projects.reviewer.get', id) : invokeOn(machine, 'projects.reviewer.get', id)).then((result) => {
      if (!active) return
      if (result.ok) setState(result.value)
      else setFailure(result.error)
    })
    return () => {
      active = false
    }
  }, [projectId, machine])

  const build = async (): Promise<void> => {
    setBusy(true)
    const result = await call('projects.reviewer.build', state?.status === 'built' ? { id: projectId, refresh: true } : { id: projectId })
    setBusy(false)
    if (!result.ok) setFailure(result.error)
    else if (!onBuilt()) setStarted(true)
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    const result = await call('projects.reviewer.delete', { id: projectId })
    setBusy(false)
    setConfirming(false)
    if (result.ok) {
      setFailure(undefined)
      setState(result.value)
    } else setFailure(result.error)
  }

  const buttons = !readOnly && state !== undefined && state.status !== 'unavailable'
  return (
    <section style={styles.field} aria-label="Team reviewer" data-testid="team-reviewer">
      <span style={styles.label}>Team reviewer</span>
      <span data-testid="team-reviewer-state" data-status={state?.status}>
        {state === undefined ? (failure === undefined ? 'Loading…' : '') : teamReviewerText(state)}
      </span>
      <span style={styles.hint}>A review skill in your team&apos;s voice, built from the pull request history. Its files stay in the Profile folder on this machine.</span>
      {buttons && !confirming ? (
        <div style={styles.actions}>
          <button type="button" style={styles.secondary} disabled={busy} onClick={() => void build()}>
            {state.status === 'built' ? 'Update' : 'Build'}
          </button>
          <button type="button" style={styles.secondary} disabled={busy || state.status === 'none'} onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      ) : null}
      {buttons && confirming ? (
        <div style={styles.actions} role="group" aria-label="Delete the team reviewer">
          <span style={styles.hint}>Delete the team reviewer? Its files in the Profile folder are erased.</span>
          <button type="button" style={styles.secondary} disabled={busy} onClick={() => void remove()}>
            Delete
          </button>
          <button type="button" style={styles.secondary} disabled={busy} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : null}
      {started ? (
        <span role="status" style={styles.hint}>
          The Session has started on the Canvas. Save or Cancel your changes to see it.
        </span>
      ) : null}
      {failure !== undefined ? (
        <span role="alert" style={styles.error}>
          {failure}
        </span>
      ) : null}
    </section>
  )
}

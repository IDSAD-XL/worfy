import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import '../../canvas/actions/actions.css'
import type { LinkState } from '../../../shared/ipc/link'
import type { ConnectFolder, ProjectsState, ProjectView } from '../../../shared/ipc/projects'
import { invokeOn, readableReason, windowMachine } from '../../ipc'
import { useMachines } from '../../machines/useMachines'
import { ConnectProject } from '../../projects/ConnectProject'
import { FolderBrowser } from '../../projects/FolderBrowser'
import { readOnlyHint, writeAction } from '../../projects/read-only'
import { acceptMachineProjects, openProject, useProjectGroups, useProjects, type ProjectGroup } from '../../projects/useProjects'
import { ListRow, StatusChip } from '../../theme/primitives'
import { openFirstRun } from '../first-run-store'
import { ProjectSettings } from '../ProjectSettings'
import { SidebarSection } from '../SidebarSection'
import { MachineName } from './MachinesSection'

/** First section of the sidebar (design F). */
export const order = 10

const styles = {
  iconButton: {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-muted)',
    padding: 0,
  },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', overflowWrap: 'anywhere' },
  empty: { margin: '2px 8px', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  group: { marginTop: 'var(--space-1)' },
  groupHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 22, padding: '0 8px', fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  groupName: { flex: 1, minWidth: 0, display: 'flex' },
  unavailable: { border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-muted)' },
  menu: {
    position: 'fixed',
    zIndex: 90,
    minWidth: 180,
    padding: 'var(--space-1)',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
  },
} satisfies Record<string, CSSProperties>

type Message = { kind: 'notice' | 'error'; text: string }

const choiceStyles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 440,
    maxWidth: 'calc(100vw - 32px)',
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
  hint: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  list: { margin: 0, padding: 'var(--space-2) var(--space-3)', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  option: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    padding: 'var(--space-2) var(--space-3)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--surface)',
    color: 'var(--text)',
    font: 'inherit',
    textAlign: 'left',
  },
  optionOff: { color: 'var(--text-muted)', background: 'var(--surface-raised)' },
  optionName: { fontWeight: 600 },
  optionDetail: { fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  optionReason: { fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)' },
} satisfies Record<string, CSSProperties>

/** A Machine "Add project" can add a Project on, or why it cannot now. */
interface MachineOption {
  /** null — this Machine. */
  machine: string | null
  name: string
  /** Why it cannot be chosen; null when it can. */
  unavailable: string | null
}

/**
 * The Machines of the first step of "Add project" (worfy-link ticket 11): this one first, then the
 * Linked machines by name (the sidebar's groups). A Machine that is not online, or does not let
 * Linked machines work with its Projects, cannot be chosen, and says why.
 */
function machineOptions(groups: readonly ProjectGroup[], link: LinkState | undefined): MachineOption[] {
  return groups.map((group) => {
    if (group.machine === null) return { machine: null, name: group.name, unavailable: null }
    const view = link?.linked.find((machine) => machine.id === group.machine)
    let unavailable: string | null = null
    if (view?.certificateChanged === true) unavailable = `${group.name} has to be linked again: its certificate changed`
    else if (view?.state === 'sleeping') unavailable = `${group.name} is asleep`
    else if (group.state !== 'online') unavailable = `${group.name} is not online`
    else if (!group.sharing) unavailable = `${group.name} doesn't let Linked machines work with its Projects`
    else if (group.readOnly) unavailable = readOnlyHint(group.name)
    return { machine: group.machine, name: group.name, unavailable }
  })
}

interface MachineChoiceProps {
  options: readonly MachineOption[]
  onChoose: (option: MachineOption) => void
  onCancel: () => void
}

/** The first step of "Add project" when there are Linked machines: on which Machine. */
function MachineChoice({ options, onChoose, onCancel }: MachineChoiceProps) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.focus()
  }, [])
  return createPortal(
    <div
      style={choiceStyles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={choiceStyles.dialog}
        data-testid="add-project-machine"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div style={choiceStyles.header}>
          <h2 id={titleId} style={choiceStyles.title}>
            Add project
          </h2>
          <p style={choiceStyles.hint}>Choose the Machine the project&apos;s folder is on. The Project is added there.</p>
        </div>
        <ul style={choiceStyles.list} aria-label="Machines">
          {options.map((option) => (
            <li key={option.machine ?? ''}>
              <button
                type="button"
                className="w-row"
                style={{ ...choiceStyles.option, ...(option.unavailable === null ? {} : choiceStyles.optionOff), height: 'auto' }}
                disabled={option.unavailable !== null}
                aria-disabled={option.unavailable === null ? undefined : 'true'}
                data-testid="add-project-machine-option"
                data-machine-id={option.machine ?? undefined}
                onClick={() => option.unavailable === null && onChoose(option)}
              >
                <span style={choiceStyles.optionName}>
                  <MachineName name={option.name} />
                </span>
                {option.unavailable !== null ? (
                  <span style={choiceStyles.optionReason} data-testid="add-project-machine-reason">
                    {option.unavailable}
                  </span>
                ) : (
                  <span style={choiceStyles.optionDetail}>{option.machine === null ? 'This Machine: its own folder picker' : 'Browse its folders here'}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div style={choiceStyles.footer}>
          <button type="button" className="w-action" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const folderIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
)

interface MenuProps {
  x: number
  y: number
  /** The read-only hint of the row's Machine (worfy-link ticket 25): "Remove from list" is inactive. */
  readOnly: string | null
  onSettings: () => void
  onRemove: () => void
  onClose: () => void
}

/** The context menu of a Project row. Escape, a click elsewhere or leaving the menu closes it. */
function ProjectMenu({ x, y, readOnly, onSettings, onRemove, onClose }: MenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  // The latest onClose, so the effect below runs once per opening and not on every render.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
    const outside = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) close.current()
    }
    const blur = (): void => close.current()
    document.addEventListener('mousedown', outside)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('blur', blur)
    }
  }, [])

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Project"
      style={{ ...styles.menu, left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const items = [...(menu.current?.querySelectorAll('button') ?? [])]
          const current = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
          items[next]?.focus()
        }
      }}
    >
      <button type="button" role="menuitem" className="w-row" onClick={onSettings}>
        Project settings…
      </button>
      <button type="button" role="menuitem" className="w-row" {...writeAction(readOnly, onRemove)}>
        Remove from list
      </button>
    </div>
  )
}

/**
 * The state of a Machine in words, always with its colour (F-SPEC: a status colour never stands
 * alone). A Machine that shares its Projects read-only (worfy-link ticket 25) says so beside it.
 */
function GroupState({ group }: { group: ProjectGroup }) {
  if (group.state === 'this') return null
  if (group.state === 'online') {
    return (
      <>
        <StatusChip status="ready" label="Online" />
        {group.readOnly ? (
          <span className="w-chip w-read-only-chip" data-testid="machine-read-only" title={readOnlyHint(group.name)}>
            Read only
          </span>
        ) : null}
      </>
    )
  }
  return (
    <span className="w-chip" style={styles.unavailable}>
      Unavailable
    </span>
  )
}

interface RowsProps {
  group: Pick<ProjectGroup, 'machine' | 'projects' | 'selectedId'>
  onSelect: (project: ProjectView) => void
  onMenu: (project: ProjectView, x: number, y: number) => void
}

/** The Project rows of one Machine. */
function ProjectRows({ group, onSelect, onMenu }: RowsProps) {
  return (
    <ul style={styles.list} aria-label={group.machine === null ? 'Projects' : 'Projects of the Machine'}>
      {group.projects.map((project) => (
        <li
          key={project.id}
          data-testid="project-row"
          data-project-id={project.id}
          data-machine-id={group.machine ?? undefined}
          title={project.path}
          onContextMenu={(event) => {
            event.preventDefault()
            onMenu(project, event.clientX, event.clientY)
          }}
        >
          <ListRow
            label={<span style={{ fontWeight: 600 }}>{project.name}</span>}
            icon={folderIcon}
            trailing={<span className="w-mono">{project.branch ?? '—'}</span>}
            selected={project.id === group.selectedId}
            onSelect={() => onSelect(project)}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * The "Projects" section: every Project (one git repository each), the one the window shows
 * highlighted, its branch on the right. With Linked machines (worfy-link ticket 09) the Projects
 * are grouped by Machine — this one first, then the Linked machines by name, each with its state —
 * and a click on a Project of another Machine opens the window on that Machine. "Add project"
 * opens the system folder picker of this Machine; a folder the Harness already knows joins the
 * list at once, a new one opens the dialog that connects it (worfy-harness ticket 24,
 * ConnectProject.tsx), a folder of neither kind is refused here. With Linked machines it first asks
 * for the Machine (worfy-link ticket 11): a Linked machine's folder is chosen among its folders
 * inside worfy (FolderBrowser.tsx), every step runs on it, the Project is added there without
 * switching its active one, and this window opens it. The context menu of a row opens its
 * settings or removes it from the list (its data folder stays), on the row's Machine.
 */
export default function ProjectsSection() {
  const state = useProjects()
  const link = useMachines()
  const groups = useProjectGroups(link)
  const [message, setMessage] = useState<Message>()
  const [menu, setMenu] = useState<{ machine: string | null; project: ProjectView; x: number; y: number }>()
  const [settingsFor, setSettingsFor] = useState<{ machine: string | null; project: ProjectView }>()
  const [connecting, setConnecting] = useState<{ machine: string | null; machineName: string; folder: ConnectFolder; harnessHome: string }>()
  /** "Add project" before the folder: the Machine step, or the folders of a Linked machine. */
  const [picking, setPicking] = useState<{ kind: 'machine' } | { kind: 'browse'; machine: string; name: string }>()

  const fail = (error: string): void => setMessage({ kind: 'error', text: readableReason(error) })

  /**
   * A Project added on Machine `machine` (null — this Machine): the list, the notice, and the window
   * on it. Added here, it is this Machine's active Project: a window on a Linked machine comes back to
   * show it. Added on a Linked machine, its active Project stays; this window opens the new one there.
   */
  const added = async (machine: string | null, state: ProjectsState, project: ProjectView, notice: string | null): Promise<void> => {
    acceptMachineProjects(machine, state)
    if (notice) setMessage({ kind: 'notice', text: notice })
    if (machine === null && windowMachine() === null) return
    const failure = await openProject(machine, project.id)
    if (failure !== undefined) fail(failure)
  }

  /** The folder `path` of Machine `machine`: known to its Harness — added; new — the connect dialog. */
  const inspect = async (machine: string | null, machineName: string, path: string): Promise<void> => {
    const inspected = await invokeOn(machine, 'projects.connect.inspect', { path })
    if (!inspected.ok) return fail(inspected.error)
    const answer = inspected.value
    if (answer.status === 'rejected') return fail(answer.reason)
    if (answer.status === 'new') return setConnecting({ machine, machineName, folder: answer.folder, harnessHome: answer.harnessHome })
    await added(machine, answer.state, answer.project, answer.notice)
  }

  /** The folder on Machine `machine`: this Machine's system picker, or a Linked machine's folders inside worfy. */
  const pickOn = async (machine: string | null, machineName: string): Promise<void> => {
    setMessage(undefined)
    setConnecting(undefined)
    if (machine !== null) return setPicking({ kind: 'browse', machine, name: machineName })
    setPicking(undefined)
    const picked = await invokeOn(null, 'projects.pickFolder', { purpose: 'project' })
    if (!picked.ok) return fail(picked.error)
    if (picked.value.path === null) return
    await inspect(null, machineName, picked.value.path)
  }

  // With Linked machines the Machine comes first (worfy-link ticket 11); without them, this Machine's picker as before.
  const addProject = async (): Promise<void> => {
    setMessage(undefined)
    setConnecting(undefined)
    if (groups !== null && (link?.linked.length ?? 0) > 0) return setPicking({ kind: 'machine' })
    await pickOn(null, link?.machine?.name ?? 'This Machine')
  }

  const select = async (machine: string | null, project: ProjectView): Promise<void> => {
    setMessage(undefined)
    const failure = await openProject(machine, project.id)
    if (failure !== undefined) fail(failure)
  }

  const remove = async (machine: string | null, project: ProjectView): Promise<void> => {
    setMessage(undefined)
    const result = await invokeOn(machine, 'projects.remove', { id: project.id })
    if (result.ok) acceptMachineProjects(machine, result.value)
    else fail(result.error)
  }

  // The Machine of the row whose menu is open: its Projects may be read-only (worfy-link ticket 25).
  const menuGroup = menu === undefined ? undefined : groups?.find((group) => group.machine === menu.machine)

  const rowsOf = (group: Pick<ProjectGroup, 'machine' | 'projects' | 'selectedId'>) => (
    <ProjectRows
      group={group}
      onSelect={(project) => void select(group.machine, project)}
      onMenu={(project, x, y) => setMenu({ machine: group.machine, project, x, y })}
    />
  )

  return (
    <SidebarSection
      id="ProjectsSection"
      title="Projects"
      trailing={
        <button type="button" aria-label="Add project" title="Add project" style={styles.iconButton} onClick={() => void addProject()}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      }
      notice={
        message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            data-testid={`projects-${message.kind}`}
            style={{ ...styles.message, color: message.kind === 'error' ? 'var(--blocked-text)' : 'var(--text-secondary)' }}
          >
            {message.text}
          </p>
        ) : null
      }
      overlay={
        <>
          {menu ? (
            <ProjectMenu
              x={menu.x}
              y={menu.y}
              readOnly={menuGroup?.readOnly === true ? readOnlyHint(menuGroup.name) : null}
              onClose={() => setMenu(undefined)}
              onSettings={() => {
                setSettingsFor({ machine: menu.machine, project: menu.project })
                setMenu(undefined)
              }}
              onRemove={() => {
                setMenu(undefined)
                void remove(menu.machine, menu.project)
              }}
            />
          ) : null}

          {settingsFor ? <ProjectSettings project={settingsFor.project} machine={settingsFor.machine} onClose={() => setSettingsFor(undefined)} /> : null}

          {picking?.kind === 'machine' && groups !== null ? (
            <MachineChoice
              options={machineOptions(groups, link)}
              onCancel={() => setPicking(undefined)}
              onChoose={(option) => void pickOn(option.machine, option.name)}
            />
          ) : null}

          {picking?.kind === 'browse' ? (
            <FolderBrowser
              machine={picking.machine}
              machineName={picking.name}
              title="Add project"
              hint="Choose the folder of a git repository, or the folder above the repositories of one project."
              onCancel={() => setPicking(undefined)}
              onChoose={(path) => {
                setPicking(undefined)
                void inspect(picking.machine, picking.name, path)
              }}
            />
          ) : null}

          {connecting ? (
            <ConnectProject
              folder={connecting.folder}
              machine={connecting.machine}
              machineName={connecting.machineName}
              harnessHome={connecting.harnessHome}
              onClose={() => setConnecting(undefined)}
              onPickAnother={() => void pickOn(connecting.machine, connecting.machineName)}
              onFirstRun={() => {
                setConnecting(undefined)
                openFirstRun()
              }}
              onConnected={(connected) => {
                setConnecting(undefined)
                void added(connecting.machine, connected.state, connected.project, connected.notice)
              }}
            />
          ) : null}
        </>
      }
    >
      {groups === null ? (
        <>
          {state && state.projects.length === 0 ? <p style={styles.empty}>No projects yet</p> : null}
          {rowsOf({ machine: null, projects: state?.projects ?? [], selectedId: state?.activeId ?? null })}
        </>
      ) : (
        groups.map((group) => (
          <div
            key={group.machine ?? ''}
            style={styles.group}
            data-testid="machine-group"
            data-machine-id={group.machine ?? undefined}
            data-state={group.state}
            data-sharing={group.sharing ? 'yes' : 'no'}
          >
            <div style={styles.groupHeader}>
              <span style={styles.groupName}>
                <MachineName name={group.name} />
              </span>
              <GroupState group={group} />
            </div>
            {!group.sharing ? (
              <p style={styles.empty} data-testid="machine-not-sharing">
                {group.name} doesn&apos;t share its Projects
              </p>
            ) : group.error !== null ? (
              <p role="alert" style={{ ...styles.message, color: 'var(--blocked-text)' }}>
                {group.error}
              </p>
            ) : group.state !== 'unavailable' && group.projects.length === 0 ? (
              <p style={styles.empty}>No projects yet</p>
            ) : null}
            {rowsOf(group)}
          </div>
        ))
      )}
    </SidebarSection>
  )
}

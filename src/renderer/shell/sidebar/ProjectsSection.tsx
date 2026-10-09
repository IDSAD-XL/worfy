import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ConnectFolder, ProjectsState, ProjectView } from '../../../shared/ipc/projects'
import { invokeOn, windowMachine } from '../../ipc'
import { useMachines } from '../../machines/useMachines'
import { ConnectProject } from '../../projects/ConnectProject'
import { acceptMachineProjects, openProject, useProjectGroups, useProjects, type ProjectGroup } from '../../projects/useProjects'
import { ListRow, StatusChip } from '../../theme/primitives'
import { openFirstRun } from '../first-run-store'
import { ProjectSettings } from '../ProjectSettings'
import { MachineName } from './MachinesSection'

/** First section of the sidebar (design F). */
export const order = 10

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 24, padding: '0 4px 0 8px' },
  heading: { margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
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

const folderIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
)

interface MenuProps {
  x: number
  y: number
  onSettings: () => void
  onRemove: () => void
  onClose: () => void
}

/** The context menu of a Project row. Escape, a click elsewhere or leaving the menu closes it. */
function ProjectMenu({ x, y, onSettings, onRemove, onClose }: MenuProps) {
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
      <button type="button" role="menuitem" className="w-row" onClick={onRemove}>
        Remove from list
      </button>
    </div>
  )
}

/** The state of a Machine in words, always with its colour (F-SPEC: a status colour never stands alone). */
function GroupState({ group }: { group: ProjectGroup }) {
  if (group.state === 'this') return null
  if (group.state === 'online') return <StatusChip status="ready" label="Online" />
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
 * ConnectProject.tsx), a folder of neither kind is refused here. The context menu of a row opens
 * its settings or removes it from the list (its data folder stays), on the row's Machine.
 */
export default function ProjectsSection() {
  const state = useProjects()
  const link = useMachines()
  const groups = useProjectGroups(link)
  const [message, setMessage] = useState<Message>()
  const [menu, setMenu] = useState<{ machine: string | null; project: ProjectView; x: number; y: number }>()
  const [settingsFor, setSettingsFor] = useState<{ machine: string | null; project: ProjectView }>()
  const [connecting, setConnecting] = useState<{ folder: ConnectFolder; harnessHome: string }>()

  const fail = (error: string): void => setMessage({ kind: 'error', text: error })

  /** A Project added on this Machine: the list, the notice, and the window back on this Machine. */
  const added = async (state: ProjectsState, project: ProjectView, notice: string | null): Promise<void> => {
    acceptMachineProjects(null, state)
    if (notice) setMessage({ kind: 'notice', text: notice })
    // Added here, it is this Machine's active Project: a window on a Linked machine comes back to show it.
    if (windowMachine() !== null) {
      const failure = await openProject(null, project.id)
      if (failure !== undefined) fail(failure)
    }
  }

  // A Project is added on this Machine (a Linked machine's — worfy-link ticket 11).
  const addProject = async (): Promise<void> => {
    setMessage(undefined)
    setConnecting(undefined)
    const picked = await invokeOn(null, 'projects.pickFolder', { purpose: 'project' })
    if (!picked.ok) return fail(picked.error)
    if (picked.value.path === null) return
    const inspected = await invokeOn(null, 'projects.connect.inspect', { path: picked.value.path })
    if (!inspected.ok) return fail(inspected.error)
    const answer = inspected.value
    if (answer.status === 'rejected') return fail(answer.reason)
    if (answer.status === 'new') return setConnecting({ folder: answer.folder, harnessHome: answer.harnessHome })
    await added(answer.state, answer.project, answer.notice)
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

  const rowsOf = (group: Pick<ProjectGroup, 'machine' | 'projects' | 'selectedId'>) => (
    <ProjectRows
      group={group}
      onSelect={(project) => void select(group.machine, project)}
      onMenu={(project, x, y) => setMenu({ machine: group.machine, project, x, y })}
    />
  )

  return (
    <section aria-labelledby="sidebar-projects-heading">
      <div style={styles.header}>
        <h2 id="sidebar-projects-heading" style={styles.heading}>
          Projects
        </h2>
        <button type="button" aria-label="Add project" title="Add project" style={styles.iconButton} onClick={() => void addProject()}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>

      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          data-testid={`projects-${message.kind}`}
          style={{ ...styles.message, color: message.kind === 'error' ? 'var(--blocked-text)' : 'var(--text-secondary)' }}
        >
          {message.text}
        </p>
      ) : null}

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

      {menu ? (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
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

      {connecting ? (
        <ConnectProject
          folder={connecting.folder}
          harnessHome={connecting.harnessHome}
          onClose={() => setConnecting(undefined)}
          onPickAnother={() => void addProject()}
          onFirstRun={() => {
            setConnecting(undefined)
            openFirstRun()
          }}
          onConnected={(connected) => {
            setConnecting(undefined)
            void added(connected.state, connected.project, connected.notice)
          }}
        />
      ) : null}
    </section>
  )
}

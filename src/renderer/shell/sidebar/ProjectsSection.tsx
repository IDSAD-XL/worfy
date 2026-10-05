import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ProjectView } from '../../../shared/ipc/projects'
import { invoke } from '../../ipc'
import { acceptProjectsState, useProjects } from '../../projects/useProjects'
import { ListRow } from '../../theme/primitives'
import { ProjectSettings } from '../ProjectSettings'

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

/**
 * The "Projects" section: every Project (one git repository each), the active one highlighted,
 * its branch on the right. "Add project" opens the system folder picker; the context menu of a
 * row opens its settings or removes it from the list (its data folder stays).
 */
export default function ProjectsSection() {
  const state = useProjects()
  const [message, setMessage] = useState<Message>()
  const [menu, setMenu] = useState<{ project: ProjectView; x: number; y: number }>()
  const [settingsFor, setSettingsFor] = useState<ProjectView>()

  const fail = (error: string): void => setMessage({ kind: 'error', text: error })

  const addProject = async (): Promise<void> => {
    setMessage(undefined)
    const picked = await invoke('projects.pickFolder')
    if (!picked.ok) return fail(picked.error)
    if (picked.value.path === null) return
    const added = await invoke('projects.add', { path: picked.value.path })
    if (!added.ok) return fail(added.error)
    if (added.value.status === 'rejected') return fail(added.value.reason)
    acceptProjectsState(added.value.state)
    if (added.value.notice) setMessage({ kind: 'notice', text: added.value.notice })
  }

  const change = async (channel: 'projects.select' | 'projects.remove', id: string): Promise<void> => {
    setMessage(undefined)
    const result = await invoke(channel, { id })
    if (result.ok) acceptProjectsState(result.value)
    else fail(result.error)
  }

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

      {state && state.projects.length === 0 ? <p style={styles.empty}>No projects yet</p> : null}

      <ul style={styles.list} aria-label="Projects">
        {state?.projects.map((project) => (
          <li
            key={project.id}
            data-testid="project-row"
            data-project-id={project.id}
            title={project.path}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ project, x: event.clientX, y: event.clientY })
            }}
          >
            <ListRow
              label={<span style={{ fontWeight: 600 }}>{project.name}</span>}
              icon={folderIcon}
              trailing={<span className="w-mono">{project.branch ?? '—'}</span>}
              selected={project.id === state.activeId}
              onSelect={() => void change('projects.select', project.id)}
            />
          </li>
        ))}
      </ul>

      {menu ? (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          onSettings={() => {
            setSettingsFor(menu.project)
            setMenu(undefined)
          }}
          onRemove={() => {
            setMenu(undefined)
            void change('projects.remove', menu.project.id)
          }}
        />
      ) : null}

      {settingsFor ? <ProjectSettings project={settingsFor} onClose={() => setSettingsFor(undefined)} /> : null}
    </section>
  )
}

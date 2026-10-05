// The command palette (⌘K, ticket 31): the "Search or run…" field of the toolbar (design F) opens
// one field over the window; typing ranks the commands (commands.ts, find/search-index.ts), ↑/↓
// pick one, Enter runs it, Esc closes. A command that cannot run now ("Ship ticket" for a Ticket
// with an open blocker) stays in the list, inactive, with the reason as its tooltip — the same
// reason the button on the Canvas shows.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ActionState } from '../../shared/actions/render-template'
import type { ProjectView } from '../../shared/ipc/projects'
import { useRunWaveState, useShipTicketState } from '../canvas/actions/gates'
import { useLayout } from '../canvas/useLayout'
import { useClaudeHome } from '../claude-home/useClaudeHome'
import { useDocs } from '../docs/useDocs'
import { useCanvasRequests } from '../find/canvas-requests'
import { rankItems } from '../find/search-index'
import { activeProject, useProjects } from '../projects/useProjects'
import { useNavigation } from '../session/navigation'
import { useWorkflow } from '../workflow/useWorkflow'
import { buildCommands, type CommandGate, type PaletteCommand } from './commands'

/** Rows shown at most; the rest are reached by typing more. */
const SHOWN = 50

const styles = {
  // The toolbar's CSS draws the field (.w-toolbar__palette-hint); a button only needs its own font reset.
  trigger: { fontFamily: 'inherit', fontSize: 'var(--text-12)', lineHeight: '16px', whiteSpace: 'nowrap', textAlign: 'left', cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 100 },
  panel: {
    position: 'fixed',
    top: 'calc(var(--toolbar-height) + var(--space-2))',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(560px, calc(100vw - 32px))',
    maxHeight: 'min(440px, calc(100vh - var(--toolbar-height) - 32px))',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-popover)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
    overflow: 'hidden',
    zIndex: 101,
  },
  field: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', height: 40, padding: '0 var(--space-3)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' },
  input: { flex: 1, minWidth: 0, height: '100%', border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', font: 'inherit', fontSize: 'var(--text-13)' },
  list: { margin: 0, padding: 'var(--space-1)', listStyle: 'none', overflowY: 'auto' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    width: '100%',
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-13)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  active: { background: 'var(--selected)' },
  inactive: { color: 'var(--text-muted)', cursor: 'default' },
  title: { flex: 'none', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  detail: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  group: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  message: { margin: 0, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  problem: { margin: 0, padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--border)', fontSize: 'var(--text-12)', color: 'var(--blocked-text)', background: 'var(--blocked-bg)' },
} satisfies Record<string, CSSProperties>

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2l3.3 3.3" />
    </svg>
  )
}

interface RowProps {
  command: PaletteCommand
  id: string
  active: boolean
  onPick: (command: PaletteCommand) => void
  onHover: () => void
}

function RowButton({ command, id, active, onPick, onHover, state }: RowProps & { state: ActionState | null }) {
  const enabled = state === null || state.enabled
  const tooltip = state === null ? undefined : state.enabled ? state.text : state.reason
  return (
    <li role="presentation">
      <button
        id={id}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={active}
        aria-disabled={enabled ? 'false' : 'true'}
        data-testid="palette-option"
        data-command={command.id}
        data-active={active ? 'true' : 'false'}
        title={tooltip}
        style={{ ...styles.row, ...(active ? styles.active : null), ...(enabled ? null : styles.inactive) }}
        onMouseMove={onHover}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (enabled) onPick(command)
        }}
      >
        <span style={styles.title}>{command.title}</span>
        <span className="w-mono" style={styles.detail}>
          {command.detail ?? ''}
        </span>
        <span style={styles.group} data-testid="palette-option-note">
          {state !== null && !state.enabled ? state.reason : command.group}
        </span>
      </button>
    </li>
  )
}

// A gated row is active as its button on the Canvas is: the same hooks work it out.
function ShipTicketRow({ gate, ...props }: RowProps & { gate: Extract<CommandGate, { kind: 'ship-ticket' }> }) {
  return <RowButton {...props} state={useShipTicketState(gate.projectId, gate.ticket, gate.tickets)} />
}

function RunWaveRow({ gate, ...props }: RowProps & { gate: Extract<CommandGate, { kind: 'run-wave' }> }) {
  return <RowButton {...props} state={useRunWaveState(gate.projectId, gate.epic, gate.tickets)} />
}

function CommandRow(props: RowProps) {
  const { gate } = props.command
  if (gate === undefined) return <RowButton {...props} state={null} />
  return gate.kind === 'ship-ticket' ? <ShipTicketRow {...props} gate={gate} /> : <RunWaveRow {...props} gate={gate} />
}

interface BodyProps {
  commands: readonly PaletteCommand[]
  empty: string
  onClose: () => void
}

interface PanelProps {
  project: ProjectView
  projects: readonly ProjectView[]
  onClose: () => void
}

/** The palette of the active Project: every command reads what the window knows about it. */
function ProjectPalette({ project, projects, onClose }: PanelProps) {
  const view = useNavigation((state) => state.view)
  const tagFilter = useCanvasRequests((state) => state.tagFilter)
  const createItems = useCanvasRequests((state) => state.createItems)
  const { model } = useWorkflow(project.path)
  const { history } = useClaudeHome(project.path)
  const { state: docs } = useDocs(project.id)
  const layout = useLayout(project.id).state
  const commands = useMemo(
    () =>
      buildCommands({
        project,
        projects,
        view,
        model,
        layoutNodes: layout?.layout.nodes ?? [],
        history,
        adrs: docs?.adrs ?? [],
        tagFilter,
        createItems,
      }),
    [project, projects, view, model, layout, history, docs, tagFilter, createItems],
  )
  return <PaletteBody commands={commands} empty="Nothing matches" onClose={onClose} />
}

/** Without a Project only the view commands are left. */
function EmptyPalette({ projects, onClose }: Omit<PanelProps, 'project'>) {
  const view = useNavigation((state) => state.view)
  const commands = useMemo(
    () => buildCommands({ project: undefined, projects, view, model: undefined, layoutNodes: [], history: [], adrs: [], tagFilter: null, createItems: [] }),
    [projects, view],
  )
  return <PaletteBody commands={commands} empty="Add a project to get its commands" onClose={onClose} />
}

function PaletteBody({ commands, empty, onClose }: BodyProps) {
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const shown = useMemo(() => rankItems(commands, query, SHOWN), [commands, query])
  const current = Math.min(picked, Math.max(0, shown.length - 1))

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current, shown])

  const pick = useCallback(
    (command: PaletteCommand) => {
      if (running) return
      setProblem(null)
      const outcome = command.run()
      if (outcome === undefined) {
        onClose()
        return
      }
      setRunning(true)
      void outcome.then((failure) => {
        setRunning(false)
        if (failure === undefined) onClose()
        else setProblem(failure)
      })
    },
    [onClose, running],
  )

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (shown.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : shown.length - 1
      setPicked((current + step) % shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // The row decides: an inactive one ignores the click, as an inactive button does.
      list.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.click()
    }
  }

  const optionId = (index: number) => `${listId}-${index}`

  return createPortal(
    <>
      <div style={styles.backdrop} onMouseDown={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="Command palette" style={styles.panel} data-testid="command-palette">
        <div style={styles.field}>
          <SearchIcon />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown.length > 0 ? optionId(current) : undefined}
            aria-label="Search or run"
            placeholder="Search or run…"
            spellCheck={false}
            style={styles.input}
            data-testid="palette-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPicked(0)
              setProblem(null)
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="w-mono" style={styles.group}>
            esc
          </kbd>
        </div>
        {shown.length === 0 ? (
          <p style={styles.message}>{empty}</p>
        ) : (
          <ul ref={list} id={listId} role="listbox" aria-label="Commands" style={styles.list}>
            {shown.map((command, index) => (
              <CommandRow
                key={command.id}
                id={optionId(index)}
                command={command}
                active={index === current}
                onPick={pick}
                onHover={() => {
                  if (index !== current) setPicked(index)
                }}
              />
            ))}
          </ul>
        )}
        {problem !== null ? (
          <p role="alert" style={styles.problem} data-testid="palette-problem">
            {problem}
          </p>
        ) : null}
      </div>
    </>,
    document.body,
  )
}

/** The toolbar's "Search or run… ⌘K" field and the palette it opens. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const projects = useProjects()
  const project = activeProject(projects)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        className="w-toolbar__palette-hint"
        style={styles.trigger}
        title="Command palette"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="palette-trigger"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="w-toolbar__palette-text">Search or run…</span>
        <kbd className="w-mono">⌘K</kbd>
      </button>
      {open ? (
        project ? (
          <ProjectPalette key={project.id} project={project} projects={projects?.projects ?? []} onClose={close} />
        ) : (
          <EmptyPalette projects={projects?.projects ?? []} onClose={close} />
        )
      ) : null}
    </>
  )
}

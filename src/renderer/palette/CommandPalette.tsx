// The command palette (⌘K, ticket 31): the "Search or run…" field of the toolbar (design F) opens
// one field over the window; typing ranks the commands (commands.ts, find/search-index.ts), ↑/↓
// pick one, Enter runs it, Esc closes. A command that cannot run now ("Ship ticket" for a Ticket
// with an open blocker) stays in the list, inactive, with the reason as its tooltip — the same
// reason the button on the Canvas shows. The ranked rows are shown in groups (groups.ts), each under
// a heading with its name; ↑/↓ walk the rows across the groups.
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
import { groupRows } from './groups'

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
  // As tall as a result row. `flex: none`: otherwise, with a long list, the panel's column shrinks the field.
  field: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    gap: 'var(--space-2)',
    height: 'var(--row-height)',
    padding: '0 var(--space-3)',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-muted)',
  },
  // border-box keeps the browser's 1 px vertical padding inside the field's height.
  input: { flex: 1, minWidth: 0, height: '100%', boxSizing: 'border-box', border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', font: 'inherit', fontSize: 'var(--text-13)' },
  list: { margin: 0, padding: 'var(--space-1)', listStyle: 'none', overflowY: 'auto' },
  groupRows: { margin: 0, padding: 0, listStyle: 'none' },
  // As the section headings of the sidebar (shell/sidebar/*Section.tsx).
  heading: {
    padding: 'var(--space-1) var(--space-2)',
    fontSize: 'var(--text-11)',
    lineHeight: '14px',
    fontWeight: 600,
    color: 'var(--text-muted)',
    userSelect: 'none',
  },
  // As the separator of the Canvas menu (canvas/overlays/CanvasMenu.tsx).
  separator: { height: 1, margin: 'var(--space-1) 0', background: 'var(--border)' },
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
  note: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
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
  /** The first row of its group. */
  first: boolean
  active: boolean
  onPick: (command: PaletteCommand) => void
  onHover: () => void
}

function RowButton({ command, id, first, active, onPick, onHover, state }: RowProps & { state: ActionState | null }) {
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
        data-first={first ? 'true' : undefined}
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
        {state !== null && !state.enabled ? (
          <span style={styles.note} data-testid="palette-option-note">
            {state.reason}
          </span>
        ) : null}
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

/** The field and the grouped list over `commands`; exported for the tests of the list. */
export function PaletteBody({ commands, empty, onClose }: BodyProps) {
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  // Ranked and cut to SHOWN first, then grouped; `shown` is the rows in the order on screen, which
  // is the order ↑/↓ walk and the index `picked` counts in.
  const groups = useMemo(() => groupRows(rankItems(commands, query, SHOWN), (command) => command.group), [commands, query])
  const shown = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  const current = Math.min(picked, Math.max(0, shown.length - 1))

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[data-active="true"]')
    if (row === null || row === undefined) return
    // The first row of a group brings its heading into view too, so the group's name is never cut off.
    if (row.dataset['first'] === 'true') row.closest('[role="group"]')?.querySelector('[data-testid="palette-group-heading"]')?.scrollIntoView({ block: 'nearest' })
    row.scrollIntoView({ block: 'nearest' })
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
  // Where each group's rows start in `shown`.
  const starts = groups.map((_, groupIndex) => groups.slice(0, groupIndex).reduce((sum, group) => sum + group.rows.length, 0))

  return createPortal(
    <>
      <div style={styles.backdrop} onMouseDown={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="Command palette" style={styles.panel} data-testid="command-palette">
        <div style={styles.field} data-testid="palette-field">
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
          <kbd className="w-mono" style={styles.note}>
            esc
          </kbd>
        </div>
        {shown.length === 0 ? (
          <p style={styles.message}>{empty}</p>
        ) : (
          <ul ref={list} id={listId} role="listbox" aria-label="Commands" style={styles.list}>
            {groups.map((group, groupIndex) => {
              const headingId = `${listId}-group-${groupIndex}`
              const start = starts[groupIndex] ?? 0
              return (
                <li key={group.name} role="presentation">
                  <ul role="group" aria-labelledby={headingId} style={styles.groupRows} data-testid="palette-group" data-group={group.name}>
                    {groupIndex > 0 ? <li role="presentation" aria-hidden="true" style={styles.separator} data-testid="palette-group-separator" /> : null}
                    <li role="presentation" id={headingId} style={styles.heading} data-testid="palette-group-heading">
                      {group.name}
                    </li>
                    {group.rows.map((command, offset) => {
                      const index = start + offset
                      return (
                        <CommandRow
                          key={command.id}
                          id={optionId(index)}
                          command={command}
                          first={offset === 0}
                          active={index === current}
                          onPick={pick}
                          onHover={() => {
                            if (index !== current) setPicked(index)
                          }}
                        />
                      )
                    })}
                  </ul>
                </li>
              )
            })}
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

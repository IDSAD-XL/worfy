// The command palette (⌘K, ticket 31): the "Search or run…" field of the toolbar (design F) opens
// one field over the window; typing ranks the commands (commands.ts, find/search-index.ts), ↑/↓
// pick one, Enter runs it, Esc closes. A command that cannot run now ("Ship ticket" for a Ticket
// with an open blocker) stays in the list, inactive, with the reason as its tooltip — the same
// reason the button on the Canvas shows; on the read-only screen of a Linked machine a command that
// would change the Project is inactive the same way, with the read-only hint. The ranked rows are shown in groups (groups.ts), each under
// a heading with its name; ↑/↓ walk the rows across the groups.
//
// Below the commands, "In transcripts" lists the Project's Sessions whose conversation contains the
// query (`claudeHome.search`, worfy-polish ticket 10): Sessions of worfy and those started in a
// terminal or Claude Desktop alike. Picking one opens it in the Session view.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ActionState } from '../../shared/actions/render-template'
import { TRANSCRIPT_SEARCH, type TranscriptHit } from '../../shared/ipc/claude-home'
import type { ProjectView } from '../../shared/ipc/projects'
import { SHORTCUTS } from '../../shared/shortcuts'
import { useRunWaveState, useShipTicketState } from '../canvas/actions/gates'
import { useLayout } from '../canvas/useLayout'
import { sessionNodeId } from '../claude-home/session-nodes'
import { useClaudeHome } from '../claude-home/useClaudeHome'
import { useDocs } from '../docs/useDocs'
import { useCanvasRequests } from '../find/canvas-requests'
import { rankItems } from '../find/search-index'
import { invoke, readableReason, windowMachine } from '../ipc'
import { useGateQueue } from '../projects/useGateQueue'
import { activeProject, useProjects, useReadOnly } from '../projects/useProjects'
import { openSession, useNavigation } from '../session/navigation'
import { label, matches } from '../shortcuts/match'
import { useWorkflow } from '../workflow/useWorkflow'
import { buildCommands, forQuery, type CommandGate, type PaletteCommand } from './commands'
import { groupRows, type RowGroup } from './groups'

/** Rows shown at most; the rest are reached by typing more. */
const SHOWN = 50

/** The pause after the last keystroke before the transcripts are searched. */
export const TRANSCRIPT_SEARCH_DELAY_MS = 250

/** The group of the transcript hits, after the groups of the commands. */
export const TRANSCRIPTS_GROUP = 'In transcripts'

/** Characters of a snippet shown before its match; the row cuts the rest at its end. */
const SNIPPET_LEAD = 24

/** Lines of a wrapped title before it is cut with "…", as the title of a Ticket on the Canvas (TICKET_TITLE_LINES). */
const WRAPPED_TITLE_LINES = 3

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
  // A row without a detail: its title has the whole row.
  wholeTitle: { flex: 1, minWidth: 0, maxWidth: 'none' },
  // A Manual check row: the check is a sentence, so its title wraps onto up to WRAPPED_TITLE_LINES
  // lines, the last cut with "…", and the row grows with them; the tooltip has the rest.
  wrappedRow: { height: 'auto', minHeight: 'var(--row-height)', padding: 'var(--space-1) var(--space-2)' },
  wrappedTitle: {
    display: '-webkit-box',
    WebkitLineClamp: WRAPPED_TITLE_LINES,
    WebkitBoxOrient: 'vertical',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    lineHeight: '18px',
  },
  // A transcript row: the Session's title leaves most of the row to the snippet.
  sessionTitle: { maxWidth: '35%' },
  detail: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  note: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
  message: { margin: 0, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  // A line inside a group that is not a row: the state of the transcript search.
  status: { padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--text-muted)' },
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
  /** A transcript hit: the detail is prose, not an id; `hint` is its tooltip. */
  prose?: boolean | undefined
  hint?: string | undefined
  id: string
  /** The first row of its group. */
  first: boolean
  active: boolean
  onPick: (command: PaletteCommand) => void
  onHover: () => void
}

/** The group whose rows wrap their title onto WRAPPED_TITLE_LINES lines instead of cutting it at one. */
const WRAPPED_GROUP = 'Manual check'

/**
 * Whether the text of the element is cut on screen: a wrapped title has more lines than it shows, a
 * one-line title is wider than its box. Worked out again whenever the element changes size — the
 * window, the panel or the list getting narrower or wider — and when its text changes.
 */
function useCut<T extends HTMLElement>(text: string, wrapped: boolean) {
  const ref = useRef<T>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => setCut(wrapped ? element.scrollHeight > element.clientHeight : element.scrollWidth > element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, wrapped])
  return [ref, cut] as const
}

function RowButton({ command, prose, hint, id, first, active, onPick, onHover, state }: RowProps & { state: ActionState | null }) {
  const enabled = state === null || state.enabled
  const detail = command.detail ?? ''
  const wrapped = !prose && command.group === WRAPPED_GROUP
  const [titleRef, cut] = useCut<HTMLSpanElement>(command.title, wrapped)
  // A row without an action state has its title whole in the tooltip while the title is cut on
  // screen, unless the row brings its own tooltip (the snippet of a transcript hit).
  const tooltip = state === null ? (hint ?? (cut ? command.title : undefined)) : state.enabled ? state.text : state.reason
  const titleStyle: CSSProperties = {
    ...styles.title,
    ...(prose ? styles.sessionTitle : null),
    ...(detail === '' ? styles.wholeTitle : null),
    ...(wrapped ? styles.wrappedTitle : null),
  }
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
        style={{ ...styles.row, ...(wrapped ? styles.wrappedRow : null), ...(active ? styles.active : null), ...(enabled ? null : styles.inactive) }}
        onMouseMove={onHover}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (enabled) onPick(command)
        }}
      >
        <span ref={titleRef} style={titleStyle}>
          {command.title}
        </span>
        {detail !== '' ? (
          <span className={prose ? undefined : 'w-mono'} style={styles.detail}>
            {detail}
          </span>
        ) : null}
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
  const { gate, readOnly } = props.command
  // Before the gate: on a read-only screen the action cannot run whatever its own state is.
  if (readOnly !== undefined) return <RowButton {...props} state={{ enabled: false, reason: readOnly }} />
  if (gate === undefined) return <RowButton {...props} state={null} />
  return gate.kind === 'ship-ticket' ? <ShipTicketRow {...props} gate={gate} /> : <RunWaveRow {...props} gate={gate} />
}

/** Where the palette searches transcripts: the Project of the palette. */
export interface TranscriptSource {
  projectId: string
  projectRoot: string
}

/** The transcript search of the query in the field, as the palette shows it. */
type TranscriptSearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; hits: readonly TranscriptHit[]; limited: boolean }
  | { status: 'failed'; reason: string }

const IDLE: TranscriptSearchState = { status: 'idle' }
const SEARCHING: TranscriptSearchState = { status: 'searching' }

/** The query as main searches it: trimmed, inner whitespace collapsed. */
const searchedText = (query: string): string => query.trim().replace(/\s+/g, ' ')

/**
 * Searches the transcripts of `source` for `query` once the query has stood still for
 * TRANSCRIPT_SEARCH_DELAY_MS. Only the answer to the query in the field now is shown: an answer to
 * an older query is dropped when it arrives, and one that arrived before is not shown for a new query.
 */
function useTranscriptSearch(source: TranscriptSource | undefined, query: string): TranscriptSearchState {
  const root = source?.projectRoot
  const wanted = searchedText(query)
  const searched = root !== undefined && wanted.length >= TRANSCRIPT_SEARCH.minQuery && wanted.length <= TRANSCRIPT_SEARCH.maxQuery
  const [answer, setAnswer] = useState<{ root: string; query: string; state: TranscriptSearchState } | null>(null)
  useEffect(() => {
    if (!searched) return
    let current = true
    const settle = (state: TranscriptSearchState) => {
      if (current) setAnswer({ root, query: wanted, state })
    }
    const timer = setTimeout(() => {
      invoke('claudeHome.search', { projectRoot: root, query: wanted }).then(
        (result) => settle(result.ok ? { status: 'done', hits: result.value.hits, limited: result.value.limited } : { status: 'failed', reason: readableReason(result.error) }),
        (error: unknown) => settle({ status: 'failed', reason: error instanceof Error ? error.message : String(error) }),
      )
    }, TRANSCRIPT_SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [searched, root, wanted])
  if (!searched) return IDLE
  return answer !== null && answer.root === root && answer.query === wanted ? answer.state : SEARCHING
}

/** The part of `snippet` from a little before the match on, so the row shows the match. */
function fromMatch(snippet: string, query: string): string {
  const at = snippet.toLowerCase().indexOf(searchedText(query).toLowerCase())
  if (at <= SNIPPET_LEAD) return snippet
  return `…${snippet.slice(at - SNIPPET_LEAD).replace(/^\S*\s/, '')}`
}

const hitId = (sessionId: string): string => `transcript:${sessionId}`

/** A row of a transcript hit: picking it opens the Session read from its file in the Session view. */
function hitCommand(hit: TranscriptHit, source: TranscriptSource, query: string): PaletteCommand {
  return {
    id: hitId(hit.sessionId),
    // The row stands in its own group (TRANSCRIPTS_GROUP), whatever this says; it is a "go to".
    group: 'Go to',
    title: hit.title ?? hit.sessionId.slice(0, 8),
    detail: fromMatch(hit.snippet, query),
    run: () => {
      openSession({ nodeId: sessionNodeId(hit.sessionId), projectId: source.projectId, external: { sessionId: hit.sessionId } })
      return undefined
    },
  }
}

/** The line under the transcript hits, or null when there is nothing to say. */
function transcriptsNote(state: TranscriptSearchState): string | null {
  switch (state.status) {
    case 'searching':
      return 'Searching…'
    case 'failed':
      return `Could not search the transcripts: ${state.reason}`
    case 'done':
      return state.limited ? 'Older transcripts were not searched' : null
    case 'idle':
      return null
  }
}

interface BodyProps {
  commands: readonly PaletteCommand[]
  empty: string
  onClose: () => void
  /** Where to search transcripts; none — the palette has no "In transcripts" group. */
  transcripts?: TranscriptSource | undefined
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
  const readOnly = useReadOnly()
  // Read when the palette opens, on the window's Machine (worfy-windows ticket 17).
  const gateQueue = useGateQueue(windowMachine(), project.id)
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
        readOnly,
        gateQueue,
      }),
    [project, projects, view, model, layout, history, docs, tagFilter, createItems, readOnly, gateQueue],
  )
  const transcripts = useMemo(() => ({ projectId: project.id, projectRoot: project.path }), [project.id, project.path])
  return <PaletteBody commands={commands} empty="Nothing matches" onClose={onClose} transcripts={transcripts} />
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
export function PaletteBody({ commands, empty, onClose, transcripts }: BodyProps) {
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  // Ranked and cut to SHOWN first, then grouped; `shown` is the rows in the order on screen, which
  // is the order ↑/↓ walk and the index `picked` counts in. Rows for a query only (the manual
  // checks) are left out while the field is empty.
  const groups = useMemo(() => groupRows(rankItems(forQuery(commands, query), query, SHOWN), (command) => command.group), [commands, query])
  const shown = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  // The transcript hits come after the commands, in a group of their own; `rows` is every row on screen.
  const found = useTranscriptSearch(transcripts, query)
  const hits = useMemo(() => (found.status === 'done' && transcripts !== undefined ? found.hits.map((hit) => hitCommand(hit, transcripts, query)) : []), [found, transcripts, query])
  // The row shows the snippet from its match on; the tooltip has all of it.
  const snippets = useMemo(() => new Map(found.status === 'done' ? found.hits.map((hit) => [hitId(hit.sessionId), hit.snippet]) : []), [found])
  const note = transcriptsNote(found)
  const listed = useMemo<RowGroup<PaletteCommand, string>[]>(() => (hits.length > 0 || note !== null ? [...groups, { name: TRANSCRIPTS_GROUP, rows: hits }] : groups), [groups, hits, note])
  const rows = useMemo(() => [...shown, ...hits], [shown, hits])
  const current = Math.min(picked, Math.max(0, rows.length - 1))

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[data-active="true"]')
    if (row === null || row === undefined) return
    // The first row of a group brings its heading into view too, so the group's name is never cut off.
    if (row.dataset['first'] === 'true') row.closest('[role="group"]')?.querySelector('[data-testid="palette-group-heading"]')?.scrollIntoView({ block: 'nearest' })
    row.scrollIntoView({ block: 'nearest' })
  }, [current, rows])

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
      if (rows.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : rows.length - 1
      setPicked((current + step) % rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // The row decides: an inactive one ignores the click, as an inactive button does.
      list.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.click()
    }
  }

  const optionId = (index: number) => `${listId}-${index}`
  // Where each group's rows start in `shown`.
  const starts = listed.map((_, groupIndex) => listed.slice(0, groupIndex).reduce((sum, group) => sum + group.rows.length, 0))

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
            aria-activedescendant={rows.length > 0 ? optionId(current) : undefined}
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
        {listed.length === 0 ? (
          <p style={styles.message}>{empty}</p>
        ) : (
          <ul ref={list} id={listId} role="listbox" aria-label="Commands" style={styles.list}>
            {listed.map((group, groupIndex) => {
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
                      const props: RowProps = {
                        id: optionId(index),
                        command,
                        first: offset === 0,
                        active: index === current,
                        onPick: pick,
                        onHover: () => {
                          if (index !== current) setPicked(index)
                        },
                      }
                      return group.name === TRANSCRIPTS_GROUP ? (
                        <RowButton key={command.id} {...props} prose hint={snippets.get(command.id)} state={null} />
                      ) : (
                        <CommandRow key={command.id} {...props} />
                      )
                    })}
                    {group.name === TRANSCRIPTS_GROUP && note !== null ? (
                      <li role="presentation" style={styles.status} data-testid="palette-transcripts-note">
                        {note}
                      </li>
                    ) : null}
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
      // ⌘K on macOS, Ctrl+K elsewhere; on Windows Ctrl+K in a Terminal Node is the shell's (match.ts).
      if (!matches(event, SHORTCUTS.palette)) return
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
        <kbd className="w-mono">{label(SHORTCUTS.palette)}</kbd>
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

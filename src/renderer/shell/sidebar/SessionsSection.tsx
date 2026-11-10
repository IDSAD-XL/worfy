import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { LiveSession } from '../../../shared/ipc/claude-home'
import type { ProjectView } from '../../../shared/ipc/projects'
import { shownOnCanvas } from '../../../shared/layout/derived'
import { useOrchestratorView, useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { showNode } from '../../canvas/show-node'
import { useLayout } from '../../canvas/useLayout'
import { focusSessionNode } from '../../claude-home/focus'
import { sessionNodeId, sessionRow, worfySessionIds, worfySessions } from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { writeAction } from '../../projects/read-only'
import { pulseOf, useProjectPulse } from '../../projects/useProjectPulse'
import { activeProject, openProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { HistoryPopover } from '../../session/HistoryPopover'
import { nodeSession, openSession, setView, useNavigation } from '../../session/navigation'
import { NewSessionVendor } from '../../session/NewSessionVendor'
import { ensureProject, isRunning, useSessionNodeViews } from '../../session/node-sessions'
import { StatusChip } from '../../theme/primitives'
import { clearSessionRequest, forgetSessionRefusal, requestLive, requestSession, useSessionRequest } from '../session-request'
import { projectsInScope, setRailBadge, useSidebarScope } from '../sidebar-scope'
import { NoProjectSection, SidebarSection } from '../SidebarSection'

/**
 * The live Sessions of the Projects the Project switcher shows (worfy-polish ticket 99, sidebar-scope.ts),
 * wherever they were started (design F, sidebar «Sessions»): the open Project's, or — under «All» with more
 * than one Project — the open Project's first and then those of every other Project of the window's Machine
 * that has a live Session, each under its name, from the live state of the Projects
 * (projects/useProjectPulse.ts). A click on a Session of another Project opens that Project first, then the
 * Session once its Node is on the Canvas (requestSession).
 *
 * The open Project's rows: a Session worfy runs — the Orchestrator, a Session Node's — is «worfy», with the
 * name and state its Node shows (worfy-daily ticket 24, claude-home/session-nodes.ts, sessionRow); the
 * others are «terminal» or «desktop» by where Claude Code says they were started. Another Project's rows
 * say «terminal» or «desktop» alone, with the name the registry gives: its Canvas and its history are not
 * read here. "New session" (a new live Session Node in the open Project's root, ticket 18, on the Vendor
 * picked in session/NewSessionVendor.tsx, worfy-multi-vendor ticket 24), "Product Session" (named "New
 * Product Session", worfy-product-session ticket 06: a Session of kind `product` on Claude Code, with no
 * Vendor picker, opened in the Session view) and History (session/HistoryPopover.tsx) work with the open
 * Project. Its rail button counts the busy Sessions of the Projects shown, in the tone of work, as the
 * sidebar prototype does.
 */
export const order = 12
export const railTitle = 'Sessions'

export function RailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6" />
      <path d="M4.5 6l2 2-2 2M8 10h3.5" />
    </svg>
  )
}

const styles = {
  // The margin keeps room for a second digit before History: «All Projects» next to the heading gives way first
  // (sidebar-section.css, __scope) and would otherwise take every free pixel of the header.
  count: { fontSize: 'var(--text-11)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginRight: 6 },
  action: {
    flex: 'none',
    padding: '0 2px',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  // The name of a Project above its Sessions, as in the Epics section.
  project: { padding: '6px 8px 2px', fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--text-muted)', overflowWrap: 'anywhere' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    height: 'var(--row-height)',
    padding: '0 8px',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-13)',
    textAlign: 'left',
  },
  // The buttons of the actions row, as `.newbtns` of the sidebar prototype: they share the row.
  newButton: {
    flex: '1 1 auto',
    minWidth: 0,
    height: 26,
    // The prototype's buttons have no padding of their own; 4 px keep a label off the border.
    padding: '0 4px',
    boxSizing: 'border-box',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--surface)',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  primary: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--primary-text)', fontWeight: 600 },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  source: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

/** Asks main for the Orchestrator's view, so its row has its state even before its Node is drawn. */
function FollowOrchestrator({ nodeId }: { nodeId: string }) {
  useOrchestratorView(nodeId)
  return null
}

interface SessionsProps {
  project: ProjectView
  /** The other Projects of the switcher's answer, in the order of the Projects section; none under one Project. */
  others: readonly ProjectView[]
}

function Sessions({ project, others }: SessionsProps) {
  const { live, history, error } = useClaudeHome(project.path)
  const layout = useLayout(project.id).state
  const orchestrators = useOrchestratorViews()
  const sessionNodes = useSessionNodeViews()
  useEffect(() => ensureProject(project.id), [project.id])
  const nodes = layout?.layout.nodes
  const orchestratorNode = nodes?.find((node) => node.kind === 'orchestrator')
  const worfy = useMemo(
    () =>
      worfySessions({ nodes: nodes ?? [], orchestrators: Object.values(orchestrators), sessionNodes: Object.values(sessionNodes), projectId: project.id, history }),
    [nodes, orchestrators, sessionNodes, project.id, history],
  )
  const worfyIds = useMemo(() => worfySessionIds(nodes ?? [], [...worfy.keys()]), [nodes, worfy])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [vendorOpen, setVendorOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Why a Session of this Project asked from another one was not opened (the request below).
  const refusal = useSessionRequest((state) => (state.refusal !== null && state.refusal.projectId === project.id ? state.refusal.text : null))
  useEffect(() => forgetSessionRefusal, [])
  const sayNothing = () => {
    setProblem(null)
    forgetSessionRefusal()
  }
  const said = problem ?? refusal
  // On a read-only screen (worfy-link ticket 25) "New session" is inactive, saying why.
  const readOnly = useReadOnly()
  const pulse = useProjectPulse()
  // The other Projects that have a live Session, with them.
  const elsewhere = others.flatMap((other) => {
    const own = pulseOf(pulse, other.id)?.live ?? []
    return own.length > 0 ? [{ project: other, live: own }] : []
  })
  // A Project inside this one (its own repository in a folder of this one) has its Sessions in this Project's
  // registry answer too; shown under its own name, they are not listed or counted here again.
  const elsewhereIds = new Set(elsewhere.flatMap((each) => each.live.map((session) => session.sessionId)))
  const ownLive = live?.filter((session) => !elsewhereIds.has(session.sessionId))
  const named = others.length > 0

  const newSession = async (vendor: string | undefined) => {
    setVendorOpen(false)
    sayNothing()
    const result = await invoke('sessions.new', { projectId: project.id, ...(vendor === undefined ? {} : { vendor }) })
    if (!result.ok) {
      setProblem(result.error)
      return
    }
    setView('canvas')
    focusSessionNode(project.id, result.value.nodeId)
  }

  // No Vendor to pick: a Product Session runs on Claude Code only, and main refuses any other. Its
  // Session view is where it is worked with, so it opens there at once (as the palette's command does).
  const newProductSession = async () => {
    setVendorOpen(false)
    sayNothing()
    const result = await invoke('sessions.new', { projectId: project.id, kind: 'product' })
    if (!result.ok) {
      setProblem(result.error)
      return
    }
    openSession({ nodeId: result.value.nodeId, projectId: project.id })
  }

  // The Node of a Session: the one that names it (worfy's own, e.g. the Orchestrator), else its Session Node.
  const nodeOf = (sessionId: string) => layout?.layout.nodes.find((node) => node.data.sessionId === sessionId) ?? layout?.layout.nodes.find((node) => node.id === sessionNodeId(sessionId))

  // Where the user is (worfy-polish ticket 44): in the Session view the row shows its Session there,
  // as a double click on its Node would; on the Canvas it centres the Node.
  const open = (sessionId: string) => {
    const node = nodeOf(sessionId)
    if (!node) return
    if (useNavigation.getState().view !== 'session') setView('canvas')
    // An archived or hidden Node comes back first, as one step ⌘Z undoes (canvas/show-node.ts).
    void showNode(project.id, node).then(() => {
      // Read after main's answer: a user who went to the Canvas meanwhile is not taken back.
      const view = useNavigation.getState().view
      const opens = view === 'session' ? nodeSession(node, project.id, isRunning(sessionNodes[node.id])) : null
      if (opens !== null) {
        openSession(opens)
        return
      }
      // A Node with no Session to show goes to the Canvas, as before.
      if (view === 'session') setView('canvas')
      focusSessionNode(project.id, node.id)
    })
  }

  // A click on a Session of another Project, now that it is open: carried out once its Node is known.
  const request = useSessionRequest((state) => state.request)
  const requested = request !== null && request.projectId === project.id ? request : null
  const requestedNode = requested === null ? undefined : nodeOf(requested.sessionId)
  useEffect(() => {
    if (requested === null) return
    if (!requestLive(requested.at, Date.now())) {
      clearSessionRequest()
      return
    }
    if (requestedNode === undefined) return
    // A hidden or archived Node would come back first, which a read-only screen does not do: as on an own row.
    if (readOnly !== null && !shownOnCanvas(requestedNode)) {
      clearSessionRequest({ projectId: project.id, text: readOnly })
      return
    }
    clearSessionRequest()
    open(requested.sessionId)
    // `open` reads the Layout of this render, which holds `requestedNode`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, requestedNode])

  // The buttons of the prototype's Sessions panel, in a row under the header: "New session", the
  // primary one, and "Product Session" — a Session apart from the development Sessions of the list.
  const actions = (
    <>
      <button
        type="button"
        style={{ ...styles.newButton, ...styles.primary }}
        data-testid="sidebar-new-session"
        aria-haspopup="menu"
        aria-expanded={vendorOpen}
        // The picker closes on a press outside it: this button toggles it instead.
        onMouseDown={(event) => event.stopPropagation()}
        {...writeAction(readOnly, () => setVendorOpen((open) => !open), "A new Session in the Project's root, on the Vendor you pick")}
      >
        New session
      </button>
      <button
        type="button"
        style={styles.newButton}
        aria-label="New Product Session"
        data-testid="sidebar-new-product-session"
        {...writeAction(readOnly, () => void newProductSession(), "A new Product Session: the Product owner's advisor, on Claude Code")}
      >
        Product Session
      </button>
    </>
  )

  // A Session of another Project: that Project opens, then its section opens the Session (requestSession).
  const openElsewhere = (other: ProjectView, sessionId: string) => {
    sayNothing()
    // Asked first: the other Project's section may mount before the answer below comes.
    requestSession(other.id, sessionId)
    void openProject(windowMachine(), other.id).then((refused) => {
      if (refused === undefined) return
      clearSessionRequest()
      setProblem(`${other.name} could not be opened: ${readableReason(refused)}`)
    })
  }

  let body = null
  if (error !== undefined) body = <p style={styles.message}>The Sessions could not be read: {readableReason(error)}</p>
  else if (ownLive !== undefined && ownLive.length > 0)
    body = (
      <ul style={styles.list}>
        {ownLive.map((session) => {
          const title = session.name ?? history.find((each) => each.sessionId === session.sessionId)?.title ?? `Session ${session.sessionId.slice(0, 8)}`
          const row = sessionRow(session, worfyIds, worfy, title)
          // An archived or hidden Node would come back first: a change of the Project, which a read-only screen does not make.
          const node = nodeOf(session.sessionId)
          const shows = node !== undefined && !shownOnCanvas(node)
          return (
            <li key={session.sessionId}>
              <button
                type="button"
                className="w-row"
                style={styles.row}
                data-testid="sidebar-session"
                data-session-id={session.sessionId}
                data-source={row.source}
                {...writeAction(shows ? readOnly : null, () => open(session.sessionId), `${row.name} — ${session.cwd}`)}
              >
                <span style={styles.name} data-testid="sidebar-session-name">
                  {row.name}
                </span>
                <span style={styles.source} data-testid="sidebar-session-source">
                  {row.source}
                </span>
                <StatusChip status={row.chip.status} label={row.chip.label} />
              </button>
            </li>
          )
        })}
      </ul>
    )
  const liveShown = (ownLive?.length ?? 0) + elsewhere.reduce((sum, each) => sum + each.live.length, 0)

  return (
    <SidebarSection
      id="SessionsSection"
      title="Sessions"
      scope="filtered"
      meta={
        <span style={styles.count} data-testid="sidebar-sessions-live">
          {liveShown} live
        </span>
      }
      trailing={
        <button type="button" style={styles.action} data-testid="sidebar-history" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
          History
        </button>
      }
      actions={actions}
      notice={
        said !== null ? (
          <p style={styles.message} role="alert">
            {said}
          </p>
        ) : null
      }
      overlay={
        <>
          {orchestratorNode ? <FollowOrchestrator nodeId={orchestratorNode.id} /> : null}
          {/* Placed against the section, under its header: it opens over a collapsed section too. */}
          {historyOpen ? <HistoryPopover project={project} onClose={() => setHistoryOpen(false)} /> : null}
          {vendorOpen ? <NewSessionVendor projectId={project.id} onPick={(vendor) => void newSession(vendor)} onClose={() => setVendorOpen(false)} /> : null}
        </>
      }
    >
      <div data-testid="sidebar-sessions-project" data-project={project.id}>
        {named ? (
          <div style={styles.project} title={project.path}>
            {project.name}
          </div>
        ) : null}
        {body}
      </div>
      {elsewhere.map((each) => (
        <OtherSessions key={each.project.id} project={each.project} live={each.live} onOpen={openElsewhere} />
      ))}
    </SidebarSection>
  )
}

interface OtherSessionsProps {
  project: ProjectView
  live: readonly LiveSession[]
  onOpen: (project: ProjectView, sessionId: string) => void
}

/**
 * The live Sessions of a Project that is not open, under its name: the name the registry gives each (else
 * «Session <id>»), where it was started and its state. Its Canvas is not read, so a Session worfy runs there
 * is not told from one started in a terminal until that Project is open.
 */
function OtherSessions({ project, live, onOpen }: OtherSessionsProps) {
  return (
    <div data-testid="sidebar-sessions-project" data-project={project.id}>
      <div style={styles.project} title={project.path}>
        {project.name}
      </div>
      <ul style={styles.list}>
        {live.map((session) => {
          const row = sessionRow(session, NONE, NO_WORFY, session.name ?? `Session ${session.sessionId.slice(0, 8)}`)
          return (
            <li key={session.sessionId}>
              <button
                type="button"
                className="w-row"
                style={styles.row}
                data-testid="sidebar-session"
                data-session-id={session.sessionId}
                data-source={row.source}
                data-project={project.id}
                title={`${row.name} — ${project.name}, ${session.cwd}`}
                onClick={() => onOpen(project, session.sessionId)}
              >
                <span style={styles.name} data-testid="sidebar-session-name">
                  {row.name}
                </span>
                <span style={styles.source} data-testid="sidebar-session-source">
                  {row.source}
                </span>
                <StatusChip status={row.chip.status} label={row.chip.label} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const NONE: ReadonlySet<string> = new Set()
const NO_WORFY: ReadonlyMap<string, never> = new Map<string, never>()

/** The busy Sessions of the Projects the switcher shows, on the rail button: in the tone of work, as in the prototype. */
function useBusyBadge(projects: readonly ProjectView[]): void {
  const pulse = useProjectPulse()
  const busy = projects.reduce((sum, project) => sum + (pulseOf(pulse, project.id)?.busy ?? 0), 0)
  useEffect(() => {
    setRailBadge('SessionsSection', busy > 0 ? { tone: 'working', count: busy, label: `${busy} busy` } : undefined)
    return () => setRailBadge('SessionsSection', undefined)
  }, [busy])
}

export default function SessionsSection() {
  const state = useProjects()
  const project = activeProject(state)
  const scope = useSidebarScope((store) => store.scope)
  const shown = projectsInScope(state?.projects ?? [], scope, project?.id)
  useBusyBadge(shown)
  if (!project) return <NoProjectSection id="SessionsSection" title="Sessions" what="Sessions" />
  // The open Project first, then the others in the order of the Projects section.
  const others = shown.filter((each) => each.id !== project.id)
  return <Sessions key={project.id} project={project} others={others} />
}

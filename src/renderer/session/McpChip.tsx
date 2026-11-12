import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { McpServerAction, McpServerRow, McpServerSource } from '../../shared/agent/mcp-status'
import { failureReason } from '../../shared/ipc/channels'
import { useOrchestratorViews } from '../canvas/nodes/orchestrator-view'
import { invoke, subscribe } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useProjects, useReadOnly } from '../projects/useProjects'
import { StatusChip, type Status } from '../theme/primitives'
import { showToast } from '../toast/toasts'
import { useSessionNodeViews } from './node-sessions'
import { mcpCount } from './header-facts'
import { acceptMcpServers, pickUpMcp, useLatestMcp, useSessionMcp } from './store'
import './mcp-chip.css'

// The chip «MCP n/m» of the Session header and its popover (worfy-mcp-live ticket 04; spec worfy-mcp-live,
// Q2 and the first decision taken without the owner). n is the servers that are connected, m every server of the Session
// but those not allowed in the Project. The chip takes the blocked colours, with its warning icon, while
// a server failed or needs auth, and is not drawn while main has no rows (store.ts, useSessionMcp).
//
// A click opens the popover under the chip and asks main for the rows with `pickUp` (worfy-mcp-live
// ticket 03): main may take in a server allowed since the Session started, between turns of an attended
// Session only. The popover holds a row per server — its name, status, number of tools, error
// and source — and a button for each action main put in the row. main builds the rows and decides the
// actions (src/shared/agent/mcp-status.ts); this file only draws them and sends a click to
// `agent.mcpAction`, whatever the Vendor. The servers not allowed in the Project stand in a group of
// their own under the others, with a line on how to allow a claude.ai connector the group may not list
// (ticket 05). While an action runs its row's buttons wait; a refusal — main's, or a call that failed on
// the way — is a toast and stays written in its row until the next action there, so a failed Allow is never
// a silent click (the toast goes away in seconds). In the
// Session Autopilot runs (the Orchestrator while a run of its Project goes on), Allow says it takes
// effect from the next Wave: the set of servers is fixed for a Wave.
//
// Project settings show the same status beside each name of the Profile's MCP list (EditProfile.tsx,
// McpProfileStatus): the rows of the newest Session of the Project on this Machine.

/** What the person reads for each status. */
const STATUS_LABELS: Readonly<Record<McpServerRow['status'], string>> = {
  connected: 'connected',
  failed: 'failed',
  'needs-auth': 'needs auth',
  pending: 'pending',
  disabled: 'disabled',
  'not-allowed': 'not allowed',
  'not-started': 'not started',
}

/** The status chip of a status; disabled and not allowed are neutral, with no icon. Not started warns as failed does. */
const STATUS_CHIPS: Readonly<Partial<Record<McpServerRow['status'], Status>>> = {
  connected: 'ready',
  failed: 'blocked',
  'needs-auth': 'blocked',
  pending: 'working',
  'not-started': 'blocked',
}

/** What the person reads for each source. */
const SOURCE_LABELS: Readonly<Record<McpServerSource, string>> = {
  claudeai: 'claude.ai',
  user: 'user config',
  project: 'Project',
  worfy: 'worfy',
}

/** The button of each action. */
const ACTION_LABELS: Readonly<Record<McpServerAction, string>> = {
  reconnect: 'Reconnect',
  'turn-off': 'Turn off for this Session',
  'turn-on': 'Turn on',
  allow: 'Allow',
  'sign-in': 'Sign in',
  restart: 'Restart Session with the same conversation',
}

/**
 * Under the servers not allowed (worfy-mcp-live ticket 05; spec, Q11): main finds them with a query of Claude
 * Code that may not list the claude.ai connectors, so a connector missing here is allowed by its name.
 */
export const CONNECTOR_HINT = 'A claude.ai connector missing here: add its name to MCP servers in Project settings (Edit profile).'

/** The gap between the chip and its popover. */
const POPOVER_GAP = 4
/** The popover keeps this far from the window's edges. */
const WINDOW_MARGIN = 8

/** The chip's tooltip: the count in words, what is wrong (failed, needs auth, not started), and the servers not allowed. */
function chipTitle(rows: readonly McpServerRow[]): string {
  const { connected, total } = mcpCount(rows)
  const failed = rows.filter((row) => row.status === 'failed').length
  const auth = rows.filter((row) => row.status === 'needs-auth').length
  const notStarted = rows.filter((row) => row.status === 'not-started').length
  const wrong = [failed > 0 ? `${failed} failed` : null, auth > 0 ? `${auth} needs auth` : null, notStarted > 0 ? `${notStarted} not started` : null].filter((part) => part !== null)
  const notAllowed = rows.length - total
  return `${connected} of ${total} MCP servers connected${wrong.length > 0 ? `: ${wrong.join(', ')}` : ''}${notAllowed > 0 ? `. ${notAllowed} more not allowed in this Project` : ''}`
}

/** The status of one server as a chip, with its word. */
export function McpStatusChip({ status }: { status: McpServerRow['status'] }) {
  const chip = STATUS_CHIPS[status]
  return chip === undefined ? <span className="w-chip w-chip--open">{STATUS_LABELS[status]}</span> : <StatusChip status={chip} label={STATUS_LABELS[status]} />
}

function WarningIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2l6 10.6H2z" />
      <path d="M8 6.5v3M8 11.2v.1" />
    </svg>
  )
}

interface RowProps {
  row: McpServerRow
  autopilot: boolean
  /** The action of this row that runs now; null: none. */
  running: McpServerAction | null
  /** Why the last action on this row failed; null: it did not, or none ran. */
  failure: string | null
  readOnly: string | null
  onAction: (row: McpServerRow, action: McpServerAction) => void
}

function ServerRow({ row, autopilot, running, failure, readOnly, onAction }: RowProps) {
  const source = SOURCE_LABELS[row.source]
  const note = autopilot && row.actions.includes('allow') ? 'Allow takes effect from the next Wave' : null
  return (
    <li className="w-mcp__row" data-testid="mcp-row" data-name={row.name} data-status={row.status}>
      <div className="w-mcp__line">
        <span className="w-mcp__name w-mono" title={row.name}>
          {row.name}
        </span>
        <span data-testid="mcp-row-status">
          <McpStatusChip status={row.status} />
        </span>
        {row.tools === null ? null : (
          <span className="w-mcp__tools w-mono" data-testid="mcp-row-tools">
            {row.tools === 1 ? '1 tool' : `${row.tools} tools`}
          </span>
        )}
        <span className="w-mcp__source" data-testid="mcp-row-source" title={row.sourceWord === null ? `Source: ${source}` : `${source} (${row.sourceWord})`}>
          {source}
        </span>
        <span className="w-mcp__spacer" />
        {row.actions.map((action) => {
          const waiting = running !== null
          return (
            <button
              key={action}
              type="button"
              className={`w-action${action === 'allow' ? ' w-action--primary' : ''}`}
              data-action={action}
              aria-busy={running === action ? 'true' : undefined}
              {...(waiting
                ? { onClick: () => undefined, 'aria-disabled': 'true' as const, title: `${ACTION_LABELS[running]} ${row.name}…` }
                : writeAction(readOnly, () => onAction(row, action)))}
            >
              {ACTION_LABELS[action]}
            </button>
          )
        })}
      </div>
      {row.error === null ? null : (
        <p className="w-mcp__error" data-testid="mcp-row-error">
          {row.error}
        </p>
      )}
      {failure === null ? null : (
        <p className="w-mcp__error" data-testid="mcp-row-action-error" role="alert">
          {failure}
        </p>
      )}
      {note === null ? null : (
        <p className="w-mcp__note" data-testid="mcp-row-note">
          {note}
        </p>
      )}
    </li>
  )
}

export interface McpChipProps {
  /** The live Session the actions go to. */
  sessionId: string | null
  /** The Session's servers as main has them; null: no data. */
  rows: readonly McpServerRow[] | null
  /** The Session runs for Autopilot: an Allow takes effect from the next Wave. */
  autopilot: boolean
}

/** The chip and its popover; nothing without rows. */
export function McpChip({ sessionId, rows, autopilot }: McpChipProps) {
  const readOnly = useReadOnly()
  /** Where the open popover stands; null while it is closed. */
  const [place, setPlace] = useState<CSSProperties | null>(null)
  /** The action running on each server, by name. */
  const [running, setRunning] = useState<Readonly<Record<string, McpServerAction>>>({})
  /** Why the last action on each server failed, by name; kept in the row after its toast is gone. */
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({})
  const runningNow = useRef(new Set<string>())
  const chip = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)

  const close = useCallback((focus: boolean) => {
    setPlace(null)
    if (focus) chip.current?.focus()
  }, [])

  // Once the popover shows: it moves left as far as the window's right edge makes it, and takes the focus.
  useLayoutEffect(() => {
    const element = popover.current
    if (place === null || element === null) return
    const box = element.getBoundingClientRect()
    const furthest = window.innerWidth - box.width - WINDOW_MARGIN
    if (box.left > furthest) element.style.left = `${Math.max(WINDOW_MARGIN, furthest)}px`
    element.focus()
  }, [place])

  // A press outside, a resize and the window losing focus close the popover.
  useEffect(() => {
    if (place === null) return
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target !== null && (popover.current?.contains(target) === true || chip.current?.contains(target) === true)) return
      close(false)
    }
    const away = (): void => close(false)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', away)
    window.addEventListener('blur', away)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('blur', away)
    }
  }, [place, close])

  const act = (row: McpServerRow, action: McpServerAction): void => {
    if (sessionId === null || runningNow.current.has(row.name)) return
    runningNow.current.add(row.name)
    setRunning((now) => ({ ...now, [row.name]: action }))
    const failed = (reason: string | null): void => {
      setFailures((now) => {
        const next = { ...now }
        if (reason === null) delete next[row.name]
        else next[row.name] = `${ACTION_LABELS[action]} failed: ${reason}`
        return next
      })
      if (reason !== null) showToast({ kind: 'error', key: `mcp:${sessionId}:${row.name}`, testId: 'mcp-action-error', text: `${ACTION_LABELS[action]} ${row.name}: ${reason}` })
    }
    void invoke('agent.mcpAction', { sessionId, name: row.name, action })
      .then((result) => {
        if (!result.ok) return failed(failureReason('agent.mcpAction', result.error))
        if (result.value.servers !== null) acceptMcpServers(sessionId, result.value.servers)
        failed(result.value.error)
      })
      .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        runningNow.current.delete(row.name)
        setRunning((now) => {
          const next = { ...now }
          delete next[row.name]
          return next
        })
      })
  }

  if (rows === null || rows.length === 0) return null
  const { connected, total, warn } = mcpCount(rows)
  const title = chipTitle(rows)
  const allowed = rows.filter((row) => row.status !== 'not-allowed')
  const notAllowed = rows.filter((row) => row.status === 'not-allowed')
  const draw = (row: McpServerRow) => (
    <ServerRow key={row.name} row={row} autopilot={autopilot} running={running[row.name] ?? null} failure={failures[row.name] ?? null} readOnly={readOnly} onAction={act} />
  )

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return
    // Taken here: the input field does not interrupt the turn on it (MessageInput.tsx, defaultPrevented).
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }

  return (
    <>
      <button
        ref={chip}
        type="button"
        className={`w-mcp-chip${warn ? ' w-mcp-chip--warn' : ''}`}
        data-testid="session-mcp"
        data-warn={warn ? 'true' : undefined}
        aria-haspopup="dialog"
        aria-expanded={place !== null}
        aria-label={`MCP servers: ${title}`}
        title={title}
        onClick={() => {
          if (place !== null) return close(false)
          const rect = chip.current?.getBoundingClientRect()
          if (rect !== undefined) setPlace({ position: 'fixed', left: rect.left, top: rect.bottom + POPOVER_GAP })
          // The person looks at the servers now: main may take in one allowed since the Session started (ticket 03).
          if (sessionId !== null) void pickUpMcp(sessionId)
        }}
      >
        {warn ? <WarningIcon /> : null}
        <span className="w-mcp-chip__label">MCP</span>
        <span className="w-mcp-chip__count w-mono" data-testid="session-mcp-count">
          {connected}/{total}
        </span>
      </button>
      {place === null
        ? null
        : createPortal(
            <div ref={popover} role="dialog" aria-label="MCP servers" tabIndex={-1} className="w-mcp" style={place} data-testid="session-mcp-popover" onKeyDown={onKey}>
              <div className="w-mcp__head">
                <span className="w-mcp__title">MCP servers</span>
                <span className="w-mcp__summary w-mono">
                  {connected}/{total} connected
                </span>
              </div>
              <ul className="w-mcp__list">{allowed.map(draw)}</ul>
              {notAllowed.length === 0 ? null : (
                <section className="w-mcp__group" data-testid="mcp-not-allowed" aria-label="Not allowed in this Project">
                  <h2 className="w-mcp__heading">Not allowed in this Project</h2>
                  <ul className="w-mcp__list">{notAllowed.map(draw)}</ul>
                  <p className="w-mcp__note" data-testid="mcp-connector-hint">
                    {CONNECTOR_HINT}
                  </p>
                </section>
              )}
            </div>,
            document.body,
          )}
    </>
  )
}

/**
 * Whether Autopilot runs over Project `projectId` now (its state is not `stopped`): then its Orchestrator
 * runs unattended. Asks nothing while `projectId` is null.
 */
function useAutopilotRuns(projectId: string | null): boolean {
  const [state, setState] = useState<{ projectId: string; revision: number; runs: boolean } | null>(null)
  useEffect(() => {
    if (projectId === null) return
    let current = true
    const take = (next: { projectId: string; revision: number; status: string }): void => {
      if (!current || next.projectId !== projectId) return
      setState((known) => (known !== null && known.projectId === projectId && known.revision > next.revision ? known : { projectId, revision: next.revision, runs: next.status !== 'stopped' }))
    }
    const off = subscribe('autopilot.changed', take)
    void invoke('autopilot.state', { projectId }).then((result) => {
      if (result.ok) take(result.value)
      else console.warn(`autopilot.state ${projectId} failed:`, result.error)
    })
    return () => {
      current = false
      off()
    }
  }, [projectId])
  return state !== null && state.projectId === projectId && state.runs
}

/** The chip of a Session view: its rows from the store; `orchestrator` — the Session Autopilot runs in. */
export function SessionMcpChip({ sessionId, projectId, orchestrator }: { sessionId: string | null; projectId: string; orchestrator: boolean }) {
  const rows = useSessionMcp(sessionId)
  const autopilot = useAutopilotRuns(orchestrator && rows !== null && rows.some((row) => row.actions.includes('allow')) ? projectId : null)
  // Keyed by the Session: the view shows another Session in the same panel, and an action running on a
  // server of the one before must not hold the button of a server of the same name here, nor its popover stay open.
  return <McpChip key={sessionId ?? ''} sessionId={sessionId} rows={rows} autopilot={autopilot} />
}

/**
 * The MCP servers of the newest Session of the Project at `path` on this Machine — its Orchestrator or a
 * Session Node — as this window got them; null when it has none.
 */
function useProjectMcp(path: string): readonly McpServerRow[] | null {
  const projectId = useProjects()?.projects.find((project) => project.path === path)?.id
  const orchestrators = useOrchestratorViews()
  const nodes = useSessionNodeViews()
  const sessionIds = useMemo(() => {
    if (projectId === undefined) return []
    const views = [...Object.values(orchestrators), ...Object.values(nodes)].filter((view) => view.projectId === projectId)
    return views.flatMap((view) => (view.sessionId === null ? [] : [view.sessionId]))
  }, [projectId, orchestrators, nodes])
  return useLatestMcp(sessionIds)
}

/**
 * The status of each name of a Profile's MCP list (`mcp.allowed`), by the newest Session of the Project
 * on this Machine; nothing without one. A name that Session does not have shows without a status.
 */
export function McpProfileStatus({ path, names }: { path: string; names: unknown }) {
  const rows = useProjectMcp(path)
  if (rows === null || !Array.isArray(names) || names.length === 0) return null
  return (
    <ul className="w-mcp-profile" data-testid="profile-mcp-status" aria-label="Status in the last Session">
      {names
        .filter((name): name is string => typeof name === 'string')
        .map((name) => {
          const row = rows.find((each) => each.name === name)
          return (
            <li key={name} className="w-mcp-profile__item" data-name={name} data-status={row?.status}>
              <span className="w-mono">{name}</span>
              {row === undefined ? null : <McpStatusChip status={row.status} />}
            </li>
          )
        })}
    </ul>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { mcpShownName, type McpServerAction, type McpServerRow, type McpServerSource } from '../../shared/agent/mcp-status'
import { failureReason, type IpcResult } from '../../shared/ipc/channels'
import { useOrchestratorViews } from '../canvas/nodes/orchestrator-view'
import { invoke, subscribe } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useProjects, useReadOnly } from '../projects/useProjects'
import { Button } from '../theme/Button'
import { Tooltip } from '../theme/kit/Tooltip'
import { StatusChip, type Status } from '../theme/primitives'
import { showToast } from '../toast/toasts'
import { useSessionNodeViews } from './node-sessions'
import { mcpCount } from './header-facts'
import { acceptMcpServers, pickUpMcp, useLatestMcp, useSessionMcp } from './store'
import './mcp-chip.css'

// The chip «MCP n/m» of a Session and its popover (worfy-mcp-live ticket 04; spec worfy-mcp-live,
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
// Ticket 09 (owner 2026-11-12): the chip stands in the bar under the input field, beside the context meter
// (composer/McpServers.tsx), no longer in the Session header, so its popover opens upward, over the field,
// and keeps inside the window. The group «Not allowed in this Project» has «Allow all» in its heading while
// it holds two rows offering Allow or more (one row has its own Allow): one call, `agent.mcpAllowAll`, puts
// every name on the Profile's list and restarts the Session once. While it runs, those rows' buttons wait,
// and it waits while any action of the popover runs; its refusal is a toast and stays written under the
// heading until the next Allow all, as a row's does. worfy's own servers offer no Turn off for this Session
// (main, ticket 09); their other actions (Reconnect, Sign in) stay.
//
// Ticket 10 (owner 2026-11-12, Q8–Q10): the rows «not started» stand in a group of their own, between the
// Session's servers and «Not allowed in this Project». Its heading says once why they are there and has one
// «Restart Session» — the same Restart a row of theirs offered, with the same conversation, as its tooltip says;
// its rows have no button and no error line. A row's name is shown whole and wraps rather than being cut; a
// claude.ai connector drops the «claude.ai » its source column says (mcpShownName), and the full name is the
// name's tooltip. «Allow all» is the one primary button of the popover; a row's Allow is the secondary Button.
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
  restart: 'Restart Session',
}

/**
 * Under the servers not allowed (worfy-mcp-live ticket 05; spec, Q11): main finds them with a query of Claude
 * Code that may not list the claude.ai connectors, so a connector missing here is allowed by its name.
 */
export const CONNECTOR_HINT = 'A claude.ai connector missing here: add its name to MCP servers in Project settings (Edit profile).'

/** The button in the heading of the group «Not allowed in this Project» (ticket 09). */
export const ALLOW_ALL_LABEL = 'Allow all'

/** The tooltip of «Restart Session» in the heading of the group «not started» (ticket 10). */
export const RESTART_HINT = 'Restarts the Session with the same conversation, so Claude Code starts again with the list'

/** The tooltip of a group's button while another action of the popover runs. */
const WAIT_HINT = 'Wait for the action that runs now'

/** The heading of the group «not started» (ticket 10): why its `count` servers are there. */
function notStartedReason(count: number): string {
  return `Allowed in this Project, but Claude Code did not start ${count === 1 ? 'it' : 'them'} in this Session.`
}

/** The gap between the chip and its popover. */
const POPOVER_GAP = 4
/** The popover keeps this far from the window's edges. */
const WINDOW_MARGIN = 8
/** The tallest the popover grows (its rows scroll past it), as mcp-chip.css had it; and the least it shrinks to. */
const POPOVER_MAX_HEIGHT = 480
const POPOVER_MIN_HEIGHT = 120

/**
 * Where the popover stands for a chip at `rect` (ticket 09): its bottom POPOVER_GAP over the chip, which is in
 * the bar under the input field, and its height no more than the room above the chip.
 */
function popoverPlace(rect: DOMRect): CSSProperties {
  return {
    position: 'fixed',
    left: rect.left,
    bottom: window.innerHeight - rect.top + POPOVER_GAP,
    maxHeight: Math.min(POPOVER_MAX_HEIGHT, Math.max(POPOVER_MIN_HEIGHT, rect.top - POPOVER_GAP - WINDOW_MARGIN)),
  }
}

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
  /** A row of the group «not started» (ticket 10): its heading has the reason and the Restart, so the row has neither. */
  grouped?: boolean
}

function ServerRow({ row, autopilot, running, failure, readOnly, onAction, grouped = false }: RowProps) {
  const source = SOURCE_LABELS[row.source]
  const note = autopilot && row.actions.includes('allow') ? 'Allow takes effect from the next Wave' : null
  return (
    <li className="w-mcp__row" data-testid="mcp-row" data-name={row.name} data-status={row.status}>
      <div className="w-mcp__line">
        <Tooltip label={row.name}>
          <span className="w-mcp__name w-mono" data-testid="mcp-row-name">
            {mcpShownName(row)}
          </span>
        </Tooltip>
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
        {(grouped ? [] : row.actions).map((action) => {
          const props = {
            'data-action': action,
            'aria-busy': running === action ? ('true' as const) : undefined,
            ...(running !== null
              ? { onClick: () => undefined, 'aria-disabled': 'true' as const, title: `${ACTION_LABELS[running]} ${row.name}…` }
              : writeAction(readOnly, () => onAction(row, action))),
          }
          // Allow is the secondary Button (ticket 10): the one primary button of the popover is «Allow all».
          return action === 'allow' ? (
            <Button key={action} className="w-mcp__allow" {...props}>
              {ACTION_LABELS[action]}
            </Button>
          ) : (
            <button key={action} type="button" className="w-action" {...props}>
              {ACTION_LABELS[action]}
            </button>
          )
        })}
      </div>
      {row.error === null || grouped ? null : (
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

interface AllowAllProps {
  /** The names of the group's rows that offer Allow. */
  names: readonly string[]
  /** Allow all of these names runs now. */
  running: boolean
  /** An action of the popover runs now: the button waits. */
  waiting: boolean
  readOnly: string | null
  onAllowAll: (names: readonly string[]) => void
}

/**
 * «Allow all» in the heading of the group «Not allowed in this Project» (ticket 09): the primary Button, the one of
 * the popover (ticket 10).
 */
function AllowAllButton({ names, running, waiting, readOnly, onAllowAll }: AllowAllProps) {
  return (
    <Button
      variant="primary"
      className="w-mcp__group-button"
      data-testid="mcp-allow-all"
      aria-busy={running ? 'true' : undefined}
      {...(waiting
        ? { onClick: () => undefined, 'aria-disabled': 'true' as const, title: running ? `${ALLOW_ALL_LABEL}…` : WAIT_HINT }
        : writeAction(readOnly, () => onAllowAll(names), `Put ${names.length} servers on the Project's list and restart the Session once`))}
    >
      {ALLOW_ALL_LABEL}
    </Button>
  )
}

interface RestartProps {
  /** The row whose Restart the button sends: any row of the group restarts the same Session. */
  name: string
  /** The Restart runs now. */
  running: boolean
  /** An action of the popover runs now: the button waits. */
  waiting: boolean
  readOnly: string | null
  onRestart: (name: string) => void
}

/**
 * «Restart Session» in the heading of the group «not started» (ticket 10): the secondary Button, its tooltip the
 * kit's. On a read-only screen the tooltip is writeAction's hint of why it is inactive, as on every write action.
 */
function RestartButton({ name, running, waiting, readOnly, onRestart }: RestartProps) {
  const button = (
    <Button
      className="w-mcp__group-button"
      data-testid="mcp-restart"
      aria-busy={running ? 'true' : undefined}
      {...(waiting ? { onClick: () => undefined, 'aria-disabled': 'true' as const } : writeAction(readOnly, () => onRestart(name)))}
    >
      {ACTION_LABELS.restart}
    </Button>
  )
  if (readOnly !== null && !waiting) return button
  return <Tooltip label={running ? `${ACTION_LABELS.restart}…` : waiting ? WAIT_HINT : RESTART_HINT}>{button}</Tooltip>
}

/** What a group's heading runs (McpChip, runGroup). */
interface GroupRun {
  /** The rows the call is for: they wait while it runs. */
  names: readonly string[]
  /** The action each of those rows waits on. */
  action: McpServerAction
  /** The button's label, the start of its toast and of its failure line. */
  label: string
  /** The channel of the call, whose name main may put before a refusal. */
  channel: 'agent.mcpAllowAll' | 'agent.mcpAction'
  call: (sessionId: string) => Promise<IpcResult<{ servers: McpServerRow[] | null; error: string | null }>>
  setFailure: (failure: string | null) => void
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
  /** Why the last Allow all failed; kept under the group's heading after its toast is gone. */
  const [allowAllFailure, setAllowAllFailure] = useState<string | null>(null)
  /** Why the last Restart Session of the group «not started» failed; kept under its heading as Allow all's is. */
  const [restartFailure, setRestartFailure] = useState<string | null>(null)
  const runningNow = useRef(new Set<string>())
  const chip = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)

  const close = useCallback((focus: boolean) => {
    setPlace(null)
    if (focus) chip.current?.focus()
  }, [])

  // Once the popover shows: it moves left as far as the window's right edge makes it, and takes the focus.
  // Its bottom stands over the chip and its height stops at the window's top (popoverPlace).
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

  /**
   * An action of a group's heading (Allow all, ticket 09; Restart Session, ticket 10): one call for the rows `names`,
   * which wait meanwhile as for an action of their own; it starts only while nothing else of the popover runs. Its
   * refusal is a toast and stays written under the heading (`setFailure`) until its next answer.
   */
  const runGroup = (group: GroupRun): void => {
    const { names, action, label, channel, call, setFailure } = group
    if (sessionId === null || names.length === 0 || runningNow.current.size > 0) return
    for (const name of names) runningNow.current.add(name)
    setRunning((now) => ({ ...now, ...Object.fromEntries(names.map((name) => [name, action])) }))
    const failed = (reason: string | null): void => {
      setFailure(reason === null ? null : `${label} failed: ${reason}`)
      if (reason !== null) showToast({ kind: 'error', key: `mcp:${sessionId}:${action}-group`, testId: 'mcp-action-error', text: `${label}: ${reason}` })
    }
    void call(sessionId)
      .then((result) => {
        if (!result.ok) return failed(failureReason(channel, result.error))
        if (result.value.servers !== null) acceptMcpServers(sessionId, result.value.servers)
        failed(result.value.error)
      })
      .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        for (const name of names) runningNow.current.delete(name)
        setRunning((now) => {
          const next = { ...now }
          for (const name of names) delete next[name]
          return next
        })
      })
  }

  /** Allow all (ticket 09): every name of `names` in one call; the rows wait meanwhile, as for their own Allow. */
  const allowAll = (names: readonly string[]): void =>
    runGroup({ names, action: 'allow', label: ALLOW_ALL_LABEL, channel: 'agent.mcpAllowAll', call: (id) => invoke('agent.mcpAllowAll', { sessionId: id, names: [...names] }), setFailure: setAllowAllFailure })

  /**
   * Restart Session of the group «not started» (ticket 10): the Restart a row of the group offers, sent once, by the
   * name of the row `name`; every row of the group waits meanwhile.
   */
  const restartAll = (names: readonly string[], name: string): void =>
    runGroup({ names, action: 'restart', label: ACTION_LABELS.restart, channel: 'agent.mcpAction', call: (id) => invoke('agent.mcpAction', { sessionId: id, name, action: 'restart' }), setFailure: setRestartFailure })

  if (rows === null || rows.length === 0) return null
  const { connected, total, warn } = mcpCount(rows)
  const title = chipTitle(rows)
  const allowed = rows.filter((row) => row.status !== 'not-allowed' && row.status !== 'not-started')
  const notStarted = rows.filter((row) => row.status === 'not-started')
  const notAllowed = rows.filter((row) => row.status === 'not-allowed')
  /** The row whose Restart the group's button sends: none in a Session no person acts on (main offers no Restart there). */
  const restartable = notStarted.find((row) => row.actions.includes('restart'))
  const notStartedNames = notStarted.map((row) => row.name)
  /** The names Allow all puts on the list: the group's rows that offer Allow. With one, its own Allow does it. */
  const allowable = notAllowed.filter((row) => row.actions.includes('allow')).map((row) => row.name)
  const busy = Object.keys(running).length > 0
  const draw = (row: McpServerRow) => (
    <ServerRow key={row.name} row={row} autopilot={autopilot} running={running[row.name] ?? null} failure={failures[row.name] ?? null} readOnly={readOnly} onAction={act} grouped={row.status === 'not-started'} />
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
          if (rect !== undefined) setPlace(popoverPlace(rect))
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
              {notStarted.length === 0 ? null : (
                <section className="w-mcp__group" data-testid="mcp-not-started" aria-label="Not started in this Session">
                  <div className="w-mcp__group-head">
                    <h2 className="w-mcp__heading w-mcp__heading--reason">{notStartedReason(notStarted.length)}</h2>
                    {restartable === undefined ? null : (
                      <RestartButton
                        name={restartable.name}
                        running={notStartedNames.every((name) => running[name] === 'restart')}
                        waiting={busy}
                        readOnly={readOnly}
                        onRestart={(name) => restartAll(notStartedNames, name)}
                      />
                    )}
                  </div>
                  {restartFailure === null ? null : (
                    <p className="w-mcp__error w-mcp__group-error" data-testid="mcp-restart-error" role="alert">
                      {restartFailure}
                    </p>
                  )}
                  <ul className="w-mcp__list">{notStarted.map(draw)}</ul>
                </section>
              )}
              {notAllowed.length === 0 ? null : (
                <section className="w-mcp__group" data-testid="mcp-not-allowed" aria-label="Not allowed in this Project">
                  <div className="w-mcp__group-head">
                    <h2 className="w-mcp__heading">Not allowed in this Project</h2>
                    {allowable.length < 2 ? null : (
                      <AllowAllButton names={allowable} running={allowable.every((name) => running[name] === 'allow')} waiting={busy} readOnly={readOnly} onAllowAll={allowAll} />
                    )}
                  </div>
                  {allowAllFailure === null ? null : (
                    <p className="w-mcp__error w-mcp__group-error" data-testid="mcp-allow-all-error" role="alert">
                      {allowAllFailure}
                    </p>
                  )}
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

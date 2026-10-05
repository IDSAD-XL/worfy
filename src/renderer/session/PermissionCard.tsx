import { useMemo, useState } from 'react'
import type { AgentEvent, PermissionDecision } from '../../shared/agent/events'
import { invoke } from '../ipc'
import { useSessionLog } from './store'

// A permission request in the transcript (ticket 21, BRIEF.md Screen 2): the tool, its input — a
// Bash command monospaced and whole — and Allow / Always allow / Deny. The answer goes to main
// with `agent.permission`; once the request is resolved (answered here, or refused by Interrupt or
// by closing the Session) the card says how and its buttons are gone. "Always allow" covers the
// tool until the end of this Session only (src/main/agent/permissions.ts).

export type PermissionRequestEvent = Extract<AgentEvent, { type: 'permission_request' }>
type Resolution = Extract<AgentEvent, { type: 'permission_resolved' }>['decision']

export interface PermissionCardProps {
  request: PermissionRequestEvent
  /** The live Session the request belongs to. */
  sessionId: string | null
}

const RESOLVED: Record<Resolution, string> = {
  allow: 'Allowed',
  always_allow: 'Always allowed in this Session',
  deny: 'Denied',
  cancelled: 'Cancelled',
}

/** What a request's input shows: the command of Bash, the input as JSON for other tools. */
function permissionInputText(toolName: string, input: unknown): string {
  if (toolName === 'Bash' && typeof input === 'object' && input !== null) {
    const command = (input as Record<string, unknown>).command
    if (typeof command === 'string') return command
  }
  return JSON.stringify(input, null, 2) ?? String(input)
}

/** How a request was resolved, from the Session's events; null while it is open. */
function useResolution(sessionId: string | null, requestId: string): Resolution | null {
  const { events } = useSessionLog(sessionId)
  return useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'permission_resolved' && event.requestId === requestId) return event.decision
    }
    return null
  }, [events, requestId])
}

export function PermissionCard({ request, sessionId }: PermissionCardProps) {
  const resolution = useResolution(sessionId, request.requestId)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const description = request.description ?? request.title
  const bash = request.toolName === 'Bash'

  const answer = async (decision: PermissionDecision): Promise<void> => {
    if (sessionId === null) return
    setSending(true)
    setProblem(null)
    const result = await invoke('agent.permission', { sessionId, requestId: request.requestId, decision })
    setSending(false)
    if (!result.ok) setProblem(result.error)
    else if (!result.value.answered) setProblem('This request is no longer open')
  }

  const open = resolution === null && sessionId !== null
  return (
    <div className="w-tr__row" data-testid="permission-card" data-request-id={request.requestId} data-resolution={resolution ?? 'open'}>
      <div className="w-tr__who w-mono w-tr__who--assistant">ask</div>
      <div className="w-tr__body">
        <div className="w-permission" data-open={open}>
          <div className="w-permission__head">
            <span className="w-permission__title">Permission request</span>
            <span className="w-permission__tool w-mono" data-testid="permission-tool">
              {request.toolName}
            </span>
          </div>
          {description !== null ? <div className="w-permission__description">{description}</div> : null}
          <pre className={`w-permission__input w-mono${bash ? ' w-permission__input--command' : ''}`} data-testid="permission-input">
            {permissionInputText(request.toolName, request.input)}
          </pre>
          {request.blockedPath !== null ? (
            <div className="w-permission__note w-mono" data-testid="permission-blocked-path">
              {request.blockedPath}
            </div>
          ) : null}
          {open ? (
            <div className="w-permission__actions">
              {/* The primary action's look (theme/primitives.tsx, PrimaryButton), with a test id. */}
              <button type="button" className="w-primary" data-testid="permission-allow" disabled={sending} onClick={() => void answer('allow')}>
                Allow
              </button>
              {request.alwaysAllow ? (
                <button type="button" className="w-permission__button" data-testid="permission-always-allow" disabled={sending} onClick={() => void answer('always_allow')} title={`Allow ${request.toolName} until this Session ends`}>
                  Always allow
                </button>
              ) : null}
              <button type="button" className="w-permission__button w-permission__button--deny" data-testid="permission-deny" disabled={sending} onClick={() => void answer('deny')}>
                Deny
              </button>
            </div>
          ) : (
            <div className="w-permission__resolved w-mono" data-testid="permission-resolution">
              {resolution === null ? 'Not answered' : RESOLVED[resolution]}
            </div>
          )}
          {problem !== null ? (
            <div className="w-permission__problem" role="alert">
              {problem}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

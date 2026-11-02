import { useMemo, useState } from 'react'
import type { AgentEvent, PermissionOption, PermissionOptionKind } from '../../shared/agent/events'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { useSessionLog } from './store'

// A permission request in the transcript (ticket 21, BRIEF.md Screen 2): what is asked about, its
// input — a Bash command monospaced and whole — and a button per option the Vendor offers, in its
// order (worfy-multi-vendor ticket 14; Claude: Allow / Always allow / Deny). The answer — the
// option's id — goes to main with `agent.permission`; once the request is resolved (answered here,
// or refused by Interrupt or by closing the Session) the card says how and its buttons are gone. An
// option of kind `allow_always` covers the subject until the end of this Session only
// (src/main/agent/permissions.ts).

export type PermissionRequestEvent = Extract<AgentEvent, { type: 'permission_request' }>
/** The id of the option picked, or `cancelled`. */
type Resolution = Extract<AgentEvent, { type: 'permission_resolved' }>['decision']

export interface PermissionCardProps {
  request: PermissionRequestEvent
  /** The live Session the request belongs to. */
  sessionId: string | null
}

/** What the card says once an option of each kind was picked. */
const RESOLVED: Record<PermissionOptionKind, string> = {
  allow: 'Allowed',
  allow_always: 'Always allowed in this Session',
  deny: 'Denied',
}

/** How a button of each kind looks, and its test id. */
const BUTTON: Record<PermissionOptionKind, { className: string; testId: string }> = {
  // The primary action's look (theme/primitives.tsx, PrimaryButton).
  allow: { className: 'w-primary', testId: 'permission-allow' },
  allow_always: { className: 'w-permission__button', testId: 'permission-always-allow' },
  deny: { className: 'w-permission__button w-permission__button--deny', testId: 'permission-deny' },
}

/** What the card says of a resolution: by the kind of the option picked, its label for an option it does not know. */
function resolutionText(options: readonly PermissionOption[], resolution: Resolution): string {
  if (resolution === 'cancelled') return 'Cancelled'
  const option = options.find((each) => each.id === resolution)
  return option === undefined ? resolution : RESOLVED[option.kind]
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
  // On a read-only screen (worfy-link ticket 25) the request shows; answering it is inactive.
  const readOnly = useReadOnly()
  const description = request.description ?? request.title
  const bash = request.toolName === 'Bash'

  const answer = async (optionId: string): Promise<void> => {
    if (sessionId === null) return
    setSending(true)
    setProblem(null)
    const result = await invoke('agent.permission', { sessionId, requestId: request.requestId, decision: optionId })
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
              {request.subject}
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
              {request.options.map((option) => (
                <button key={option.id} type="button" className={BUTTON[option.kind].className} data-testid={BUTTON[option.kind].testId} data-option-id={option.id}
                  disabled={sending}
                  {...writeAction(readOnly, () => void answer(option.id), option.kind === 'allow_always' ? `Allow ${request.subject} until this Session ends` : undefined)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="w-permission__resolved w-mono" data-testid="permission-resolution">
              {resolution === null ? 'Not answered' : resolutionText(request.options, resolution)}
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

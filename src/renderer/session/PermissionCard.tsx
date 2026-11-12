import { useMemo, useState } from 'react'
import type { AgentEvent, PermissionOptionKind } from '../../shared/agent/events'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { Button } from '../theme/Button'
import { useSessionLog } from './store'

// A permission request in the transcript (ticket 21, BRIEF.md Screen 2): what is asked about, its
// input — a Bash command monospaced and whole — and a button per option the Vendor offers, in its
// order (worfy-multi-vendor ticket 14; Claude: Allow / Always allow / Deny; Codex: Accept, Accept for
// this Session, Decline, Decline and stop the turn). The input is read by its shape, not by the
// Vendor (ticket 25): one that names a command and the folder it runs in shows the command whole and
// the folder under it; one that lists file changes shows the files, one per line. The answer — the
// option's id — goes to main with `agent.permission`; once the request is resolved (answered here,
// or refused by Interrupt or by closing the Session) the card says how and its buttons are gone. An
// option of kind `allow_always` covers the subject until the end of this Session only
// (src/main/agent/permissions.ts) — except on a Product Session's write outside its folder
// (`productWrite`, worfy-polish ticket 82), where it is «Always allow in <folder>»: the folder goes to
// the Project's list in Project settings, and the card says so.

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

/** The Button variant of each kind, and its test id. */
const BUTTON: Record<PermissionOptionKind, { variant: 'primary' | 'secondary' | 'danger'; testId: string }> = {
  allow: { variant: 'primary', testId: 'permission-allow' },
  allow_always: { variant: 'secondary', testId: 'permission-always-allow' },
  deny: { variant: 'danger', testId: 'permission-deny' },
}

/**
 * What the card says of a resolution: by the kind of the option picked, its label for an option it does
 * not know; the folder of a Product Session's write outside its folder for its `allow_always`.
 */
function resolutionText(request: PermissionRequestEvent, resolution: Resolution): string {
  if (resolution === 'cancelled') return 'Cancelled'
  const option = request.options.find((each) => each.id === resolution)
  if (option === undefined) return resolution
  return option.kind === 'allow_always' && request.productWrite !== undefined ? `Always allowed in ${request.productWrite.folder}` : RESOLVED[option.kind]
}

/** The tooltip of an `allow_always` button: until the Session ends, or for good in a Product Session's folder. */
function alwaysTooltip(request: PermissionRequestEvent): string {
  return request.productWrite === undefined
    ? `Allow ${request.subject} until this Session ends`
    : `Product Session may write in ${request.productWrite.folder} from now on; remove the folder in Project settings`
}

const fields = (input: unknown): Record<string, unknown> | null => (typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null)

/**
 * The command a request would run, and the folder it runs in: Bash's command (no folder), or the
 * command of an input that names its folder (`cwd`, a string or null); null for any other request.
 */
function commandOf(toolName: string, input: unknown): { command: string; cwd: string | null } | null {
  const record = fields(input)
  if (record === null || typeof record.command !== 'string') return null
  if (toolName === 'Bash') return { command: record.command, cwd: null }
  if (!('cwd' in record) || (record.cwd !== null && typeof record.cwd !== 'string')) return null
  return { command: record.command, cwd: typeof record.cwd === 'string' && record.cwd !== '' ? record.cwd : null }
}

/** The files a request would change, in its order: an input whose `changes` each name a `path`; null for any other request. */
function filesOf(input: unknown): string[] | null {
  const changes = fields(input)?.changes
  if (!Array.isArray(changes) || changes.length === 0) return null
  const paths = changes.map((change) => fields(change)?.path)
  return paths.every((path): path is string => typeof path === 'string') ? paths : null
}

/** What a request's input shows: the command whole, the files one per line, else the input as JSON. */
function permissionInputText(toolName: string, input: unknown): string {
  const command = commandOf(toolName, input)
  if (command !== null) return command.command
  const files = filesOf(input)
  if (files !== null) return files.join('\n')
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
  const command = commandOf(request.toolName, request.input)

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
          <pre className={`w-permission__input w-mono${command !== null ? ' w-permission__input--command' : ''}`} data-testid="permission-input">
            {permissionInputText(request.toolName, request.input)}
          </pre>
          {command?.cwd != null ? (
            <div className="w-permission__note w-mono" data-testid="permission-cwd" title="The folder the command runs in">
              in {command.cwd}
            </div>
          ) : null}
          {request.blockedPath !== null ? (
            <div className="w-permission__note w-mono" data-testid="permission-blocked-path">
              {request.blockedPath}
            </div>
          ) : null}
          {open ? (
            <div className="w-permission__actions">
              {request.options.map((option) => (
                <Button
                  key={option.id}
                  variant={BUTTON[option.kind].variant}
                  className={option.kind === 'allow_always' && request.productWrite !== undefined ? 'w-permission__button--folder' : undefined}
                  data-testid={BUTTON[option.kind].testId}
                  data-option-id={option.id}
                  disabled={sending}
                  {...writeAction(readOnly, () => void answer(option.id), option.kind === 'allow_always' ? alwaysTooltip(request) : undefined)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : (
            <div className="w-permission__resolved w-mono" data-testid="permission-resolution">
              {resolution === null ? 'Not answered' : resolutionText(request, resolution)}
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

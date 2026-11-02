// Codex's approvals as worfy's permission requests (worfy-multi-vendor ticket 20; spec of the epic,
// the neutral events). The app-server asks before a command (`item/commandExecution/requestApproval`) and before a
// file change (`item/fileChange/requestApproval`) with a server→client request; the Codex SessionHandle
// (session.ts) opens it on the Session's gate (src/main/agent/permissions.ts) as a `permission_request`
// with Codex's own four answers and sends the picked one back as the request's `decision`.
//
// The option ids are Codex's decisions themselves and the same on every request: the gate answers a
// later request of the same subject with a remembered `allow_always` id without looking at the options
// the request offers (permissions.ts, ask()), so an id must mean the same thing on every request.
import type { PermissionOption } from '../../../shared/agent/events'
import type { PermissionAsk } from '../session'
import type { ServerRequest } from './protocol/ts/ServerRequest'
import type { ThreadItem } from './protocol/ts/v2/ThreadItem'

/** The decisions worfy sends back; both kinds of approval take each of them. */
export const CODEX_DECISIONS = ['accept', 'acceptForSession', 'decline', 'cancel'] as const
export type CodexDecision = (typeof CODEX_DECISIONS)[number]

/**
 * The answers Codex offers, in the order the card shows them: this once; this and the same again until
 * the Session ends; no, and the turn goes on; no, and the turn stops.
 */
export const CODEX_APPROVAL_OPTIONS: readonly PermissionOption[] = [
  { id: 'accept', label: 'Accept', kind: 'allow' },
  { id: 'acceptForSession', label: 'Accept for this Session', kind: 'allow_always' },
  { id: 'decline', label: 'Decline', kind: 'deny' },
  { id: 'cancel', label: 'Decline and stop the turn', kind: 'deny' },
]

/** What Codex reads, in the item's status, when an unattended Session declined its request. */
export const UNATTENDED_DECLINED_MESSAGE =
  'This Session runs unattended (worfy Autopilot): no one is there to answer an approval request, so Codex\'s request is declined.'

/** The two approval requests worfy answers. */
export type CodexApprovalRequest = Extract<ServerRequest, { method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval' }>

export function isApprovalRequest(request: ServerRequest): request is CodexApprovalRequest {
  return request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval'
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

/**
 * The permission request of an approval, without its signal. `item`: the item the request is about, as
 * `item/started` gave it — a file change request names no file itself, its item does.
 * - a command: the subject is the command; the input its command and folder;
 * - a file change: the subject is the files, in the order the item lists them; the input the changes.
 */
export function approvalAsk(request: CodexApprovalRequest, item: ThreadItem | undefined): Omit<PermissionAsk, 'signal'> {
  const common = {
    toolUseId: request.params.itemId,
    description: text(request.params.reason),
    suggestions: [],
    options: CODEX_APPROVAL_OPTIONS.map((option) => ({ ...option })),
  }
  if (request.method === 'item/commandExecution/requestApproval') {
    const command = text(request.params.command) ?? (item?.type === 'commandExecution' ? text(item.command) : null)
    const cwd = text(request.params.cwd) ?? (item?.type === 'commandExecution' ? text(item.cwd) : null)
    return {
      ...common,
      subject: command ?? 'a command',
      toolName: 'commandExecution',
      input: { command, cwd },
      title: 'Codex wants to run a command',
      blockedPath: null,
    }
  }
  const changes = item?.type === 'fileChange' && Array.isArray(item.changes) ? item.changes : []
  const paths = changes.map((change) => change.path)
  return {
    ...common,
    subject: paths.length > 0 ? paths.join(', ') : 'file changes',
    toolName: 'fileChange',
    input: { changes },
    title: 'Codex wants to change files',
    blockedPath: text(request.params.grantRoot),
  }
}

/** The decision for the option picked: null (the request was cancelled) is `cancel`; an id Codex does not offer, `decline`. */
export function decisionOf(picked: string | null): CodexDecision {
  if (picked === null) return 'cancel'
  return (CODEX_DECISIONS as readonly string[]).includes(picked) ? (picked as CodexDecision) : 'decline'
}

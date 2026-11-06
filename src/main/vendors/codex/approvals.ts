// Codex's approvals as worfy's permission requests (worfy-multi-vendor ticket 20; spec of the epic,
// the neutral events). The app-server asks before a command (`item/commandExecution/requestApproval`) and before a
// file change (`item/fileChange/requestApproval`) with a server→client request; the Codex SessionHandle
// (session.ts) opens it on the Session's gate (src/main/agent/permissions.ts) as a `permission_request`
// with Codex's own four answers and sends the picked one back as the request's `decision`.
//
// The option ids are Codex's decisions themselves and the same on every request: the gate answers a
// later request of the same subject with a remembered `allow_always` id without looking at the options
// the request offers (permissions.ts, ask()), so an id must mean the same thing on every request.
//
// An unattended Session at Auto-approval Shadow or On asks the approval policy instead (worfy-auto-approve
// ticket 05): policyRequestOf turns an approval into the policy's request. Codex's answer carries no text
// (`{decision}` only: protocol/ts/v2/CommandExecutionRequestApprovalResponse.ts,
// FileChangeRequestApprovalResponse.ts), so the hint of a refusal reaches the Journal only, never the model.
import type { PermissionOption } from '../../../shared/agent/events'
import type { ApprovalRequest, Decision } from '../../agent/auto-approve/policy'
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

/**
 * The answers of an approval worfy cannot name: without "Accept for this Session". The gate remembers an
 * `allow_always` answer by its subject (permissions.ts, answer()), and the subject of such an approval
 * says nothing about what it allows: remembered, it would let through whatever later request comes
 * without a name.
 */
export const CODEX_UNNAMED_APPROVAL_OPTIONS: readonly PermissionOption[] = CODEX_APPROVAL_OPTIONS.filter((option) => option.kind !== 'allow_always')

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
 * One whose command or files neither the request nor its item names (an item worfy never saw) is named by
 * its item's id, so no subject the gate remembered answers it, and is offered no answer for the Session.
 */
export function approvalAsk(request: CodexApprovalRequest, item: ThreadItem | undefined): Omit<PermissionAsk, 'signal'> {
  const common = {
    toolUseId: request.params.itemId,
    description: text(request.params.reason),
    suggestions: [],
  }
  const options = (named: boolean) => (named ? CODEX_APPROVAL_OPTIONS : CODEX_UNNAMED_APPROVAL_OPTIONS).map((option) => ({ ...option }))
  if (request.method === 'item/commandExecution/requestApproval') {
    const command = text(request.params.command) ?? (item?.type === 'commandExecution' ? text(item.command) : null)
    const cwd = text(request.params.cwd) ?? (item?.type === 'commandExecution' ? text(item.cwd) : null)
    return {
      ...common,
      subject: command ?? `a command (item ${request.params.itemId})`,
      options: options(command !== null),
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
    subject: paths.length > 0 ? paths.join(', ') : `file changes (item ${request.params.itemId})`,
    options: options(paths.length > 0),
    toolName: 'fileChange',
    input: { changes },
    title: 'Codex wants to change files',
    blockedPath: text(request.params.grantRoot),
  }
}

/**
 * The login shell Codex wraps a command in, as it names it: `<shell> -lc <script>` (or `-c`), the shell zsh, bash or
 * sh by name or in a folder of the system the agent cannot write, the script one quoted word. Codex runs the shell
 * with the script as one argument and shows the command joined with quotes (test/fixtures/codex-messages/turn.jsonl:
 * `/bin/zsh -lc 'cat README.md'`).
 */
const CODEX_SHELL = /^(?:(?:\/usr\/local|\/opt\/homebrew|\/usr)?\/bin\/)?(zsh|bash|sh) -l?c (["'].*)$/s
/** A `$` or a backquote no backslash escapes. */
const UNESCAPED_EXPANSION = /(?<!\\)(?:\\\\)*[$`]/

/**
 * The command the policy judges for Codex's `command`: its login-shell wrapper as `<shell> -c <script>`, so the
 * script is read by the shell grammar's own `-c` rules (shell.ts: one unglobbed script word, a refusal when ZDOTDIR,
 * BASH_ENV or ENV is set). `-l` makes the shell read the owner's login profile first; the agent cannot write it (it is
 * outside every root), so `-lc` is judged as `-c`. Any other form stays as it is, and the policy does not approve it:
 * another shell or folder, other options, a second word after the script (the grammar refuses it). A double-quoted
 * script with an unescaped `$` or backquote stays as well: the grammar would expand it in the outer word, Codex does not.
 */
export function codexScript(command: string): string {
  const match = CODEX_SHELL.exec(command)
  if (match === null) return command
  const [, shell, script] = match as unknown as [string, string, string]
  if (script.startsWith('"') && UNESCAPED_EXPANSION.test(script)) return command
  return `${shell} -c ${script}`
}

/** Names of the environment a secret is kept under. */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i

/**
 * The environment a request is judged in: the app-server's without the variables named like secrets (GH_TOKEN, the
 * MCP token WORFY_MCP_TOKEN, any *_KEY). Codex's `shell_environment_policy` may leave them out of the command's shell,
 * so their values cannot be known there: a command that names one is not judged, and no value of one reaches the
 * journal.
 */
export function judgedEnvironment(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_NAME.test(name)))
}

/** An approval in the terms of the approval policy (policyRequestOf). */
export interface CodexPolicyRequest {
  request: ApprovalRequest
  /** The folder the command runs in, as Codex names it; for a file change, null (the Session's folder is used). */
  cwd: string | null
  /** The folder the request asks writes under for the rest of the Session (FileChangeRequestApprovalParams.grantRoot). */
  grantRoot: string | null
}

/**
 * What the approval policy judges of an approval (worfy-auto-approve ticket 05), from its permission request `ask`:
 * - a command: `commandExecution` with its command (its login-shell wrapper as `-c`: codexScript) and folder. Input to a command that runs (`kind` writeStdin) and a
 *   request for network access (`networkApprovalContext`) are no command the policy can read: they go under their own
 *   tool names, which the policy parks as unknown;
 * - a file change: `fileChange` with a path for each change, each `move_path` (an update that renames writes there
 *   too) and the grantRoot, so every place the change may write is judged.
 */
export function policyRequestOf(request: CodexApprovalRequest, ask: Omit<PermissionAsk, 'signal'>): CodexPolicyRequest {
  const input = ask.input as Record<string, unknown>
  if (request.method === 'item/commandExecution/requestApproval') {
    const { kind, networkApprovalContext } = request.params as { kind?: unknown; networkApprovalContext?: unknown }
    const tool = kind !== undefined && kind !== 'command' ? 'writeStdin' : networkApprovalContext !== undefined && networkApprovalContext !== null ? 'networkAccess' : 'commandExecution'
    const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : null
    const command = input['command']
    return { request: { tool, input: { command: typeof command === 'string' ? codexScript(command) : command, cwd } }, cwd, grantRoot: null }
  }
  const grantRoot = text(request.params.grantRoot)
  const changes = Array.isArray(input['changes']) ? (input['changes'] as unknown[]) : []
  const paths = changes.flatMap((change) => {
    const { path, kind } = (typeof change === 'object' && change !== null ? change : {}) as { path?: unknown; kind?: { move_path?: unknown } }
    return [{ path }, ...(typeof kind?.move_path === 'string' ? [{ path: kind.move_path }] : [])]
  })
  return { request: { tool: 'fileChange', input: { changes: [...paths, ...(grantRoot === null ? [] : [{ path: grantRoot }])] } }, cwd: null, grantRoot }
}

/**
 * The decision on a request with a grantRoot: never allow. Codex would take the root for the rest of the Session (its
 * schema says it is unclear whether it does today), and the policy answers one request at a time; so an allowed one is
 * parked for the owner (rule `grant-root`), and a refused one stays refused.
 */
export function withGrantRoot(decision: Decision, grantRoot: string | null): Decision {
  return grantRoot !== null && decision.outcome === 'allow' ? { outcome: 'park', rule: 'grant-root', hint: null, targets: decision.targets } : decision
}

/** The decision for the option picked: null (the request was cancelled) is `cancel`; an id Codex does not offer, `decline`. */
export function decisionOf(picked: string | null): CodexDecision {
  if (picked === null) return 'cancel'
  return (CODEX_DECISIONS as readonly string[]).includes(picked) ? (picked as CodexDecision) : 'decline'
}

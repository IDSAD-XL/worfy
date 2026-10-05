// Permission requests of one Session (ticket 21). A new Session runs in bypassPermissions and is
// never asked; once the user picks another permission mode (ticket 19), Claude Code calls
// canUseTool before a tool it may not run on its own. The gate turns each call into a
// `permission_request` event and waits for the user's answer from the transcript (`agent.permission`):
//
// - "Allow" (`allow`): this one call runs, with its input unchanged;
// - "Always allow" (`always_allow`): this call runs, and so does every later call of the same tool
//   in this Session, without asking. The list lives here, in main's memory, on the Session's own
//   gate: it is never written to a settings file, never given to another Session, and a Session
//   started again (a restart of worfy, Resume) starts with an empty one;
// - "Deny" (`deny`): the call does not run, and the model is told the user refused.
//
// No answer ever passes `updatedPermissions`: the suggestions Claude Code offers write to
// settings files (`localSettings`, `projectSettings`, `userSettings`) or switch the mode
// (`setMode`), and its own `session` layer may outlive a resume (ticket 06, question 8, not
// checked), so worfy applies none of them and keeps its own list instead.
//
// A request nobody answered is refused when the turn is interrupted, when the Session closes or
// its Claude Code dies (cancelAll), and when Claude Code aborts it itself (the call's signal).
import { randomUUID } from 'node:crypto'
import type { AgentEvent, PermissionDecision } from '../../shared/agent/events'

/** What the model reads when the user pressed "Deny". */
export const DENIED_MESSAGE = 'The user denied this tool call in worfy.'
/** What the model reads when the request was dropped: the turn was interrupted or the Session closed. */
export const CANCELLED_MESSAGE = 'The permission request was cancelled: the user interrupted the turn or closed the Session.'

/** The options of canUseTool that worfy reads (SDK 0.3.289, test/fixtures/sdk-messages/can-use-tool.json). */
export interface PermissionRequestOptions {
  signal: AbortSignal
  suggestions?: readonly unknown[] | undefined
  toolUseID?: string | undefined
  title?: string | undefined
  description?: string | undefined
  blockedPath?: string | undefined
  /** Claude Code says the request must not offer a lasting "don't ask again". */
  suppressAlwaysAllowRule?: boolean | undefined
}

/** The answer canUseTool gives Claude Code; a subset of the SDK's PermissionResult. */
export type PermissionAnswer = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string; interrupt?: boolean }

/** canUseTool as a Session hands it to the query (options.ts passes it to the SDK). */
export type CanUseToolHandler = (toolName: string, input: Record<string, unknown>, options: PermissionRequestOptions) => Promise<PermissionAnswer>

interface Pending {
  toolName: string
  input: Record<string, unknown>
  alwaysAllow: boolean
  settle(answer: PermissionAnswer, decision: PermissionDecision | 'cancelled'): void
}

const CANCELLED: PermissionAnswer = { behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true }

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

/** What a suggestion is and where it would write; for display only. */
function suggestionSummaries(suggestions: readonly unknown[] | undefined): { type: string; destination: string | null }[] {
  return (suggestions ?? []).flatMap((each) => {
    if (typeof each !== 'object' || each === null) return []
    const { type, destination } = each as Record<string, unknown>
    return typeof type === 'string' ? [{ type, destination: typeof destination === 'string' ? destination : null }] : []
  })
}

export class PermissionGate {
  /** Tools the user answered "Always allow" in this Session. */
  private readonly allowed = new Set<string>()
  private readonly open = new Map<string, Pending>()

  /**
   * `emit` gets the request and resolution events; `changed` is called with the number of open
   * requests each time it changes, so the Session can show `needs_permission`.
   */
  constructor(
    private readonly emit: (event: AgentEvent) => void,
    private readonly changed: (pending: number) => void,
  ) {}

  /** Open requests. */
  get pending(): number {
    return this.open.size
  }

  /** The tools "Always allow" covers in this Session. */
  alwaysAllowed(): string[] {
    return [...this.allowed]
  }

  readonly canUseTool: CanUseToolHandler = (toolName, input, options) => {
    if (this.allowed.has(toolName)) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    if (options.signal.aborted) return Promise.resolve(CANCELLED)
    const requestId = randomUUID()
    const alwaysAllow = options.suppressAlwaysAllowRule !== true
    return new Promise<PermissionAnswer>((resolve) => {
      const onAbort = () => this.settle(requestId, CANCELLED, 'cancelled')
      this.open.set(requestId, {
        toolName,
        input,
        alwaysAllow,
        settle: (answer, decision) => {
          options.signal.removeEventListener('abort', onAbort)
          this.emit({ type: 'permission_resolved', requestId, decision })
          resolve(answer)
        },
      })
      options.signal.addEventListener('abort', onAbort, { once: true })
      this.emit({
        type: 'permission_request',
        requestId,
        toolName,
        toolUseId: text(options.toolUseID),
        input,
        title: text(options.title),
        description: text(options.description),
        blockedPath: text(options.blockedPath),
        alwaysAllow,
        suggestions: suggestionSummaries(options.suggestions),
      })
      this.changed(this.open.size)
    })
  }

  /**
   * The user's answer to an open request; false when the request is no longer open (answered,
   * cancelled, or never made). "Always allow" on a request that does not offer it throws.
   */
  answer(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.open.get(requestId)
    if (pending === undefined) return false
    if (decision === 'always_allow' && !pending.alwaysAllow) throw new Error('This request does not offer "Always allow"')
    if (decision === 'always_allow') this.allowed.add(pending.toolName)
    const answer: PermissionAnswer = decision === 'deny' ? { behavior: 'deny', message: DENIED_MESSAGE } : { behavior: 'allow', updatedInput: pending.input }
    this.settle(requestId, answer, decision)
    return true
  }

  /** Refuses every open request: the turn was interrupted, or the Session is closing or died. */
  cancelAll(): void {
    for (const requestId of [...this.open.keys()]) this.settle(requestId, CANCELLED, 'cancelled')
  }

  private settle(requestId: string, answer: PermissionAnswer, decision: PermissionDecision | 'cancelled'): void {
    const pending = this.open.get(requestId)
    if (pending === undefined) return
    this.open.delete(requestId)
    pending.settle(answer, decision)
    this.changed(this.open.size)
  }
}

// Permission requests of one Session (ticket 21), in worfy's neutral terms (worfy-multi-vendor
// ticket 14, ADR-0094 item 2). A Vendor's driver turns its agent's request into a `PermissionAsk`
// with the options the Vendor offers — Claude Code's canUseTool becomes Allow / Always allow / Deny
// (src/main/vendors/claude/session.ts) — and the gate opens it as a `permission_request` event and
// waits for the user's answer from the transcript (`agent.permission`: the id of an option):
//
// - an option of kind `allow` lets this one request through;
// - an option of kind `allow_always` lets it through, and every later request of the same subject in
//   this Session without asking (Claude: "Always allow", the subject is the tool); requests of the
//   same subject already open are answered with it too. The list lives here, in main's memory, on
//   the Session's own gate: it is never written to a settings file, never given to another Session,
//   and a Session started again (a restart of worfy, Resume) starts with an empty one. A crash of
//   the agent does not end the Session: the process the next send starts (session.ts, begin())
//   keeps the list, as the card's "until this Session ends" says;
// - an option of kind `deny` refuses it; the driver tells its agent the user refused.
//
// A request nobody answered is cancelled when the turn is interrupted, when the Session closes or
// its agent dies (cancelAll), and when the Vendor withdraws it itself (the request's signal).
//
// Questions with answer options (Claude Code's AskUserQuestion tool, worfy-ui ticket 17) come the
// same way: the gate opens them as a `question_request` instead and waits for `answerQuestion`;
// "Decline" declines them. A question never offers "Always allow", and an `allow_always` answer to
// another request never answers one. Interrupt, close and the Vendor's own withdrawal cancel it like
// any request.
//
// An unattended Session (worfy-daily ticket 02, session-settings.ts) reaches the gate only with a
// parked request (worfy-auto-approve ticket 07, src/main/agent/auto-approve/park.ts): one the approval
// policy left to the owner in On; every other request its driver answers at once (SessionStart.unattended).
// A parked request answers one tool call only: the `allow_always` list neither answers it nor is
// answered by it, and releaseParked (a stop of the run) cancels the parked requests alone.
import { randomUUID } from 'node:crypto'
import type { AgentEvent, PermissionOption } from '../../shared/agent/events'
import { formatAnswers, type Question, type QuestionPick } from '../../shared/agent/questions'
import type { PermissionAsk, PermissionAsker, QuestionAsk, QuestionReply } from '../vendors/session'

// shortcut: Claude Code's canUseTool types stay importable from here for their importers (options.ts,
// fake-query.ts, src/main/projects/connect.ts); redo when worfy-multi-vendor ticket 16 moves those
// files into the Claude driver.
export type { CanUseToolHandler, PermissionAnswer, PermissionRequestOptions } from './session/types'

/** How an open request ended: an option picked, questions answered or declined, or cancelled. */
type Outcome = { kind: 'option'; id: string } | { kind: 'answers'; answers: Record<string, string> } | { kind: 'declined' } | { kind: 'cancelled' }

interface Pending {
  subject: string
  /** A request the approval policy parked for the owner. */
  parked: boolean
  options: readonly PermissionOption[]
  /** The questions of a question request; null for a permission request. */
  questions: Question[] | null
  settle(outcome: Outcome): void
}

const CANCELLED: Outcome = { kind: 'cancelled' }

export class PermissionGate implements PermissionAsker {
  /** Subjects the user answered with an `allow_always` option in this Session, and that option's id. */
  private readonly remembered = new Map<string, string>()
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

  /** The subjects (Claude: tools) an `allow_always` answer covers in this Session. */
  alwaysAllowed(): string[] {
    return [...this.remembered.keys()]
  }

  readonly ask = (request: PermissionAsk): Promise<string | null> => {
    const parked = request.parked !== undefined
    const remembered = parked ? undefined : this.remembered.get(request.subject)
    if (remembered !== undefined) return Promise.resolve(remembered)
    const { signal } = request
    if (signal.aborted) return Promise.resolve(null)
    const requestId = randomUUID()
    return new Promise<string | null>((resolve) => {
      const onAbort = () => this.settle(requestId, CANCELLED)
      this.open.set(requestId, {
        subject: request.subject,
        parked,
        options: request.options,
        questions: null,
        settle: (outcome) => {
          signal.removeEventListener('abort', onAbort)
          const picked = outcome.kind === 'option' ? outcome.id : null
          this.emit({ type: 'permission_resolved', requestId, decision: picked ?? 'cancelled' })
          resolve(picked)
        },
      })
      signal.addEventListener('abort', onAbort, { once: true })
      this.emit({
        type: 'permission_request',
        requestId,
        subject: request.subject,
        toolName: request.toolName,
        toolUseId: request.toolUseId,
        input: request.input,
        title: request.title,
        description: request.description,
        blockedPath: request.blockedPath,
        suggestions: request.suggestions,
        options: request.options.map((option) => ({ ...option })),
        ...(request.parked === undefined ? {} : { parked: { rule: request.parked.rule, targets: [...request.parked.targets] } }),
      })
      this.changed(this.open.size)
    })
  }

  readonly askQuestions = (request: QuestionAsk): Promise<QuestionReply> => {
    const { signal, questions } = request
    if (signal.aborted) return Promise.resolve({ outcome: 'cancelled' })
    const requestId = randomUUID()
    return new Promise<QuestionReply>((resolve) => {
      const onAbort = () => this.settle(requestId, CANCELLED)
      this.open.set(requestId, {
        subject: '',
        parked: false,
        options: [],
        questions,
        settle: (outcome) => {
          signal.removeEventListener('abort', onAbort)
          const reply: QuestionReply =
            outcome.kind === 'answers' ? { outcome: 'answered', answers: outcome.answers } : outcome.kind === 'declined' ? { outcome: 'declined' } : { outcome: 'cancelled' }
          this.emit({ type: 'question_resolved', requestId, outcome: reply.outcome, answers: reply.outcome === 'answered' ? reply.answers : {} })
          resolve(reply)
        },
      })
      signal.addEventListener('abort', onAbort, { once: true })
      this.emit({ type: 'question_request', requestId, toolUseId: request.toolUseId, questions })
      this.changed(this.open.size)
    })
  }

  /**
   * The user's answer to an open request: the id of one of its options. False when the request is
   * no longer open (answered, cancelled, or never made). An option the request does not offer
   * throws, and so does a question, leaving the request open.
   */
  answer(requestId: string, optionId: string): boolean {
    const pending = this.open.get(requestId)
    if (pending === undefined) return false
    if (pending.questions !== null) throw new Error('This request is a question: answer it with its options')
    const option = pending.options.find((each) => each.id === optionId)
    if (option === undefined) throw new Error(`This request does not offer "${optionId}"`)
    this.settle(requestId, { kind: 'option', id: optionId })
    if (option.kind === 'allow_always') {
      this.remembered.set(pending.subject, optionId)
      // Other requests of the same subject already open (parallel Subagents) are covered too: a new
      // request of it would go through without asking, so these do not wait for an answer either.
      for (const [otherId, other] of [...this.open]) {
        if (other.questions === null && !other.parked && other.subject === pending.subject) this.settle(otherId, { kind: 'option', id: optionId })
      }
    }
    return true
  }

  /**
   * The user's answer to an open question request: one pick per question, in the questions' order,
   * or null for "Decline". False when the request is no longer open. Throws, leaving the request
   * open, for a request that is no question and for picks that do not answer every question with
   * its own options (formatAnswers).
   */
  answerQuestion(requestId: string, picks: readonly QuestionPick[] | null): boolean {
    const pending = this.open.get(requestId)
    if (pending === undefined) return false
    if (pending.questions === null) throw new Error('This request is not a question')
    if (picks === null) {
      this.settle(requestId, { kind: 'declined' })
      return true
    }
    this.settle(requestId, { kind: 'answers', answers: formatAnswers(pending.questions, picks) })
    return true
  }

  /** Cancels the parked requests alone: the run that parked them is stopping (orchestrator.ts, setUnattended). */
  releaseParked(): void {
    for (const [requestId, pending] of [...this.open]) {
      if (pending.parked) this.settle(requestId, CANCELLED)
    }
  }

  /** Cancels every open request: the turn was interrupted, or the Session is closing or died. */
  cancelAll(): void {
    for (const requestId of [...this.open.keys()]) this.settle(requestId, CANCELLED)
  }

  private settle(requestId: string, outcome: Outcome): void {
    const pending = this.open.get(requestId)
    if (pending === undefined) return
    this.open.delete(requestId)
    pending.settle(outcome)
    this.changed(this.open.size)
  }
}

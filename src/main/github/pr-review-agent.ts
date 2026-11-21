// Agent review of someone else's PR (worfy-pr-review ticket 08): a Session writes the whole review draft — comments on
// lines, the summary, a suggested verdict — and the person reads, changes and submits it in worfy (ADR-0105).
//
// - Start (`prReview.agentReview`): a new Session Node of the Project on Claude Code whose first message is the Team
//   reviewer of the Project (`/human-review`, its skill built in the private folder, ADR-0102) or, without one, the
//   review lenses of `/worfy:code-review`, with the rule of the draft (agentReviewText). Before that message the draft —
//   created on the PR's head when there is none — gets `agent: { sessionId, state: 'writing' }` on disk: the Session
//   writes only through harness/bin/pr-review-draft, which refuses without a draft. `fill: 'add'` (Ask the agent to add
//   comments) runs over the person's draft; `'new'` is refused over one, and any start while an Agent review of the PR
//   still writes.
// - While the Session writes, main watches the draft file and sends `prReview.changed` on each change, so the view
//   shows the agent's comments as they come. The watch reads the draft every AGENT_POLL_MS and compares it with the last
//   one it saw, the first read before the Session's first word: one file for the length of a review, and it does not
//   depend on the file events of the OS. Not a poll of the file's stat (chokidar `usePolling`, fs.watchFile): that poll
//   takes its first state from a stat that runs later, on the thread pool, and a write landing before it was never seen.
//   It ends when the draft says the agent is done or stopped, when the Session's turn ends (the draft is then marked
//   done) or the Session closes (stopped), and on Stop.
// - Stop and Take over (`prReview.stopAgent`): the Session is halted — its turn interrupted, its queue held — and the
//   draft is marked `stopped`, keeping what the agent wrote. bin/pr-review-draft refuses a stopped review.
// Nothing here reaches GitHub; the Session's own writes there are refused by the skill's text and the guard hook.
import { existsSync } from 'node:fs'
import type { SessionState } from '../../shared/agent/events'
import { submitPending, TEXTS_LOCKED, type PrReviewDraftAnswer, type ReviewDraft } from '../../shared/ipc/pr-review'
import { AGENT_REVIEW_VENDOR, agentReviewText } from '../../shared/projects/action-templates'
import type { VendorId } from '../../shared/vendors/vendor'
import type { Session } from '../agent/session'
import { privateFolder, reviewerSkill } from '../projects/review-offer'
import type { PrReviewDrafts } from './pr-review-draft'

/** How often the draft file and the Session are looked at while an Agent review writes. */
export const AGENT_POLL_MS = 500

/** What a Session of an Agent review needs: its first message, its stop, its state. */
export type AgentSession = Pick<Session, 'send' | 'halt' | 'state'>

export interface PrReviewAgentDeps {
  drafts: Pick<PrReviewDrafts, 'draft' | 'setAgent'>
  /** The Project's Profile folder (readProfileFolder): the Team reviewer lies in its private folder. */
  profileDir: (root: string) => Promise<{ dir: string | null; reason: string | null }>
  /** "New session" on Claude Code: a new Session Node of the Project (src/main/agent/node-sessions.ts). */
  sessions: { create(projectId: string, near: undefined, vendor: VendorId): { nodeId: string; sessionId: string } }
  /** The app's live Sessions; throws for an id that is not live. */
  registry: { get(sessionId: string): AgentSession }
  /** The draft of `repo`#`number` changed: `prReview.changed` to every window. */
  changed: (input: { projectId: string; repo: string; number: number }) => void
  pollMs?: number
  warn?: (message: string) => void
}

export interface AgentReviewStart {
  projectId: string
  root: string
  repo: string
  number: number
  head: string
  fill: 'new' | 'add'
}

interface Watch {
  timer: ReturnType<typeof setInterval> | null
  /** The draft as the watch last saw it (JSON), null before a first read: another one is a change. */
  seen: string | null
  sessionId: string
  /** The Session was seen in a turn: back to idle, the turn is over. */
  turned: boolean
  ending: boolean
}

const keyOf = (root: string, repo: string, pr: number): string => `${root}\0${repo.toLowerCase()}#${pr}`
const IN_TURN: ReadonlySet<SessionState> = new Set(['busy', 'needs_permission'])

export class PrReviewAgent {
  private readonly watches = new Map<string, Watch>()
  private readonly starting = new Set<string>()
  private readonly warn: (message: string) => void

  constructor(private readonly deps: PrReviewAgentDeps) {
    this.warn = deps.warn ?? ((message) => console.warn(message))
  }

  /** Starts an Agent review of `repo`#`number`; throws, with the reason, and starts nothing on a refusal. */
  async start(input: AgentReviewStart): Promise<{ nodeId: string; sessionId: string; text: string; draft: ReviewDraft }> {
    const { projectId, root, repo, number, head, fill } = input
    const key = keyOf(root, repo, number)
    // Taken before the first await: two clicks that arrive together do not both start a Session.
    if (this.starting.has(key)) throw new Error(`Agent review of ${repo}#${number} is starting already`)
    this.starting.add(key)
    try {
      const current = await this.deps.drafts.draft(root, repo, number)
      if (current.draft === null && current.problem !== null) throw new Error(current.problem)
      const draft = current.draft
      if (draft !== null && draft.state !== 'draft') throw new Error(`This review is ${draft.state}: it is not changed any more`)
      // A Submit that may be on GitHub keeps the texts that went: the agent would change them.
      if (draft !== null && submitPending(draft)) throw new Error(TEXTS_LOCKED)
      if (draft?.agent?.state === 'writing' && this.live(draft.agent.sessionId)) throw new Error(`Agent review is writing the review of ${repo}#${number} already: Stop it first`)
      if (fill === 'new' && draft !== null && (draft.payload.comments.length > 0 || draft.payload.body !== '')) throw new Error('This pull request has a review draft already: Ask the agent to add comments to it')
      const teamReviewer = await this.teamReviewer(root)
      const view = this.deps.sessions.create(projectId, undefined, AGENT_REVIEW_VENDOR)
      const marked = await this.deps.drafts.setAgent(root, repo, number, { head, agent: { sessionId: view.sessionId, state: 'writing' } })
      // Nothing is sent then: the Session Node stays, idle, and the person may close it.
      if (marked.problem !== null || marked.draft === null) throw new Error(`Agent review did not start: ${marked.problem ?? 'the draft was not written'}`)
      // The commit of the draft, not `head`: after a push since the draft started they differ, and the script reads the
      // commented lines at the draft's commit.
      const text = agentReviewText({ teamReviewer, repo, pr: number, fill, head: marked.draft.anchoredOn ?? marked.draft.startedOn })
      await this.follow({ projectId, root, repo, number }, view.sessionId)
      this.deps.registry.get(view.sessionId).send(text)
      this.deps.changed({ projectId, repo, number })
      return { nodeId: view.nodeId, sessionId: view.sessionId, text, draft: marked.draft }
    } finally {
      this.starting.delete(key)
    }
  }

  /** Stop and Take over: the Session halted, the draft `stopped` with what the agent wrote. Refused without an Agent review. */
  async stop(input: { projectId: string; root: string; repo: string; number: number }): Promise<PrReviewDraftAnswer> {
    const { projectId, root, repo, number } = input
    const current = await this.deps.drafts.draft(root, repo, number)
    const agent = current.draft?.agent
    if (agent === undefined) throw new Error(current.problem ?? `No Agent review writes the review of ${repo}#${number}`)
    await this.end(keyOf(root, repo, number))
    try {
      await this.deps.registry.get(agent.sessionId).halt()
    } catch {
      // The Session is gone already (its Node closed): nothing to stop.
    }
    const answer = await this.deps.drafts.setAgent(root, repo, number, { agent: { sessionId: agent.sessionId, state: 'stopped' } })
    if (answer.problem !== null && answer.draft === null) throw new Error(answer.problem)
    this.deps.changed({ projectId, repo, number })
    return answer
  }

  /** How many drafts are watched now. */
  watching(): number {
    return this.watches.size
  }

  /** Every watch ends: worfy quits. The drafts stay as they are. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.watches.keys()].map((key) => this.end(key)))
  }

  // ── inside ──────────────────────────────────────────────────────────────

  private async teamReviewer(root: string): Promise<boolean> {
    const folder = await this.deps.profileDir(root)
    return folder.dir !== null && existsSync(reviewerSkill(privateFolder(folder.dir)))
  }

  private live(sessionId: string): boolean {
    try {
      return this.deps.registry.get(sessionId).state !== 'closed'
    } catch {
      return false
    }
  }

  /** Watches the draft file of the review the Session `sessionId` writes. */
  private async follow(pull: { projectId: string; root: string; repo: string; number: number }, sessionId: string): Promise<void> {
    const key = keyOf(pull.root, pull.repo, pull.number)
    await this.end(key)
    const entry: Watch = { sessionId, turned: false, ending: false, seen: null, timer: null }
    this.watches.set(key, entry)
    // Before the Session's first word: what it writes afterwards differs from this first state.
    const first = await this.deps.drafts.draft(pull.root, pull.repo, pull.number)
    if (this.watches.get(key) !== entry) return
    if (first.draft !== null || first.problem === null) entry.seen = JSON.stringify(first.draft)
    entry.timer = setInterval(() => void this.look(key, pull, entry), this.deps.pollMs ?? AGENT_POLL_MS)
    entry.timer.unref?.()
  }

  /** Ends the watch when the review is over: the draft says so, or the Session's turn ended or it closed. */
  private async look(key: string, pull: { projectId: string; root: string; repo: string; number: number }, entry: Watch): Promise<void> {
    try {
      await this.lookNow(key, pull, entry)
    } catch (error) {
      this.warn(`[pr-review] the Agent review of ${pull.repo}#${pull.number} was not looked at: ${String(error)}`)
    }
  }

  private async lookNow(key: string, pull: { projectId: string; root: string; repo: string; number: number }, entry: Watch): Promise<void> {
    if (this.watches.get(key) !== entry || entry.ending) return
    let state: SessionState | null = null
    try {
      state = this.deps.registry.get(entry.sessionId).state
    } catch {
      // Gone: its Node closed.
    }
    if (state !== null && IN_TURN.has(state)) entry.turned = true
    const over = state === null || state === 'closed' || state === 'error' ? 'stopped' : entry.turned && state === 'idle' ? 'done' : null
    const { draft, problem } = await this.deps.drafts.draft(pull.root, pull.repo, pull.number)
    if (this.watches.get(key) !== entry || entry.ending) return
    if (draft === null && problem !== null) {
      // Not read this time (a file being replaced, a disk busy for a moment): the next look reads it — while the
      // Session writes. Once it is over, the draft cannot be marked: the watch ends as it is.
      if (over === null) return
      this.warn(`[pr-review] the Agent review of ${pull.repo}#${pull.number} is over, its draft was not marked ${over}: ${problem}`)
      await this.end(key)
      return
    }
    const seen = JSON.stringify(draft)
    if (seen !== entry.seen) {
      entry.seen = seen
      this.deps.changed({ projectId: pull.projectId, repo: pull.repo, number: pull.number })
    }
    const mine = draft?.agent?.sessionId === entry.sessionId
    if (!mine || draft?.agent?.state !== 'writing' || draft.state !== 'draft') {
      await this.end(key)
      return
    }
    if (over === null) return
    entry.ending = true
    await this.deps.drafts.setAgent(pull.root, pull.repo, pull.number, { agent: { sessionId: entry.sessionId, state: over } })
    await this.end(key)
    this.deps.changed({ projectId: pull.projectId, repo: pull.repo, number: pull.number })
  }

  private async end(key: string): Promise<void> {
    const entry = this.watches.get(key)
    if (entry === undefined) return
    this.watches.delete(key)
    if (entry.timer !== null) clearInterval(entry.timer)
  }
}

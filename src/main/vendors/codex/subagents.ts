// The Subagents of a Codex Session on the Canvas (worfy-multi-vendor ticket 34). Codex keeps each Subagent
// as a thread of its own: `parentThreadId` names the thread that spawned it, `agentNickname` and
// `agentRole` what the model named it, and `source` ({ subAgent: … }) why it exists. The tree is read
// from Codex's app-server, as the history part reads a Session (history.ts), in one short-lived process:
//
// - `thread/read {includeTurns: true}` of the Session's thread: its items say how each of its Subagents
//   is doing — `subAgentActivity` (started, interacted, completed, interrupted) and the agent states of a
//   `collabAgentToolCall` (running, completed, errored, interrupted…), the latest last;
// - `thread/list` of the Subagent sources, the newest first, page by page until a page reaches threads
//   created before the Session: the threads whose chain of parents leads to the Session are its tree;
// - `thread/read` of each shown Subagent that spawned Subagents of its own, for their statuses.
//
// The service children Codex starts by itself — a review, a compaction, the memory consolidation, the
// guardian — are not shown, and neither is anything under them. A Subagent whose thread ended in a
// system error is `error`; one still running when the Session's last turn was interrupted is
// `interrupted`. Codex keeps no transcript worfy reads for a Subagent, so its Node opens none.
//
// The `claudeHome.subagents` channel (src/main/ipc/claude-home.ts) answers this tree for a Codex Session of
// the Project — one the last list of the Project's Codex Sessions named (sessions-on-canvas.ts), so no
// Codex starts for a Claude Session. worfy writes nothing into CODEX_HOME (ADR-0005).
import { existsSync } from 'node:fs'
import { flattenSubagents, summaryLine, type SubagentInfo, type SubagentStatus } from '../../../shared/transcript/subagents'
import { findVerdict } from '../../../shared/workflow/verdict.mjs'
import { appCodexStarter, CODEX_ASK_TIMEOUT_MS, codexHomeOf, withCodex, type CodexAsk, type StartCodex } from './account'
import { THREAD_PAGE, THREAD_PAGES } from './history'
import type { CollabAgentStatus } from './protocol/ts/v2/CollabAgentStatus'
import type { Thread } from './protocol/ts/v2/Thread'
import type { ThreadItem } from './protocol/ts/v2/ThreadItem'
import type { ThreadListResponse } from './protocol/ts/v2/ThreadListResponse'
import type { ThreadReadResponse } from './protocol/ts/v2/ThreadReadResponse'
import type { ThreadSourceKind } from './protocol/ts/v2/ThreadSourceKind'
import type { CodexSessions } from './sessions-on-canvas'

/** The sources of the Subagents' threads `thread/list` is asked for. */
export const SUBAGENT_SOURCE_KINDS: readonly ThreadSourceKind[] = ['subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther']

/** The children Codex starts by itself, by their source; none of them, nor anything under them, is shown. */
const SERVICE_SOURCES: ReadonlySet<string> = new Set(['review', 'compact', 'memory_consolidation', 'guardian'])

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What the `source` of a Subagent's thread says of it; `{ subAgent: … }` in the protocol. */
function subAgentOf(thread: Thread): unknown {
  const source: unknown = thread.source
  return isObject(source) ? source.subAgent : undefined
}

/** A child Codex started by itself: a review, a compaction, the memory consolidation or the guardian. */
export function isServiceChild(thread: Thread): boolean {
  const source = subAgentOf(thread)
  if (typeof source === 'string') return SERVICE_SOURCES.has(source)
  return isObject(source) && typeof source.other === 'string' && SERVICE_SOURCES.has(source.other)
}

/** The thread that spawned `thread`: `parentThreadId`, else the parent its spawn source names. */
function parentOf(thread: Thread): string | null {
  if (typeof thread.parentThreadId === 'string' && thread.parentThreadId !== '') return thread.parentThreadId
  const source = subAgentOf(thread)
  const spawn = isObject(source) && isObject(source.thread_spawn) ? source.thread_spawn : undefined
  return typeof spawn?.parent_thread_id === 'string' ? spawn.parent_thread_id : null
}

/** What the items of a parent thread say about one of its Subagents, the latest last. */
interface Seen {
  status: SubagentStatus
  /** When it started, ms. */
  startedAt: number | null
  /** When it last ended, ms; null while it runs. */
  endedAt: number | null
  model: string | null
  /** Its answer, from a collab call's agent state. */
  message: string | null
}

const STATUS_OF_COLLAB: Readonly<Record<CollabAgentStatus, SubagentStatus>> = {
  pendingInit: 'running',
  running: 'running',
  interrupted: 'interrupted',
  completed: 'done',
  shutdown: 'done',
  errored: 'error',
  notFound: 'error',
}

const STATUS_OF_ACTIVITY: Readonly<Record<string, SubagentStatus>> = { started: 'running', interacted: 'running', completed: 'done', interrupted: 'interrupted' }

const atOf = (item: ThreadItem): number | null => (typeof item.completedAtMs === 'number' ? item.completedAtMs : typeof item.startedAtMs === 'number' ? item.startedAtMs : null)

/** Notes the status `status` of the Subagent `agent` at `at`; a start time is kept from the first one. */
function note(seen: Map<string, Seen>, agent: string, status: SubagentStatus, at: number | null, extra: { model?: string | null; message?: string | null; started?: boolean } = {}): void {
  const known = seen.get(agent) ?? { status, startedAt: null, endedAt: null, model: null, message: null }
  known.status = status
  if (extra.started === true && known.startedAt === null) known.startedAt = at
  known.endedAt = status === 'running' ? null : at
  if (extra.model) known.model = extra.model
  if (extra.message) known.message = extra.message
  seen.set(agent, known)
}

/** What the items of a parent thread say about its Subagents, by the Subagent's thread id. */
function seenIn(items: readonly ThreadItem[], seen: Map<string, Seen> = new Map()): Map<string, Seen> {
  for (const item of items) {
    if (item.type === 'subAgentActivity') {
      const status = STATUS_OF_ACTIVITY[item.kind]
      if (status !== undefined) note(seen, item.agentThreadId, status, atOf(item), { model: item.model, started: item.kind === 'started' })
    } else if (item.type === 'collabAgentToolCall') {
      for (const [agent, state] of Object.entries(item.agentsStates)) {
        const status = state === undefined ? undefined : STATUS_OF_COLLAB[state.status]
        if (status !== undefined) note(seen, agent, status, atOf(item), { message: state?.message ?? null, started: item.tool === 'spawnAgent' })
      }
      // A spawn that failed names the Subagent it did not start.
      if (item.tool === 'spawnAgent' && item.status === 'failed') for (const agent of item.receiverThreadIds) note(seen, agent, 'error', atOf(item))
    }
  }
  return seen
}

const itemsOf = (thread: Thread): ThreadItem[] => (thread.turns ?? []).flatMap((turn) => turn.items)

/** The last turn of the thread was interrupted: a Subagent it left running was cut off with it. */
const lastTurnInterrupted = (thread: Thread): boolean => thread.turns?.at(-1)?.status === 'interrupted'

const byStart = (a: SubagentInfo, b: SubagentInfo): number =>
  (a.startedAt ?? Number.POSITIVE_INFINITY) - (b.startedAt ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id)

/**
 * The Subagent tree of the Codex Session `root` (read with its turns): each thread of `threads` whose
 * chain of parents leads to `root` without passing a service child, by start time. `items` holds the
 * items of each shown Subagent that spawned Subagents of its own (its `thread/read`), for their statuses.
 */
export function codexSubagentTree(root: Thread, threads: readonly Thread[], items: ReadonlyMap<string, readonly ThreadItem[]>): SubagentInfo[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const shown = new Set<string>()
  // A thread is shown when every step up its chain of parents is a shown thread, up to the Session.
  const reaches = (thread: Thread): boolean => {
    for (let step: Thread | undefined = thread, seen = new Set<string>(); step !== undefined; ) {
      if (seen.has(step.id) || isServiceChild(step)) return false
      seen.add(step.id)
      const parent = parentOf(step)
      if (parent === root.id) return true
      step = parent === null ? undefined : byId.get(parent)
    }
    return false
  }
  for (const thread of threads) if (thread.id !== root.id && reaches(thread)) shown.add(thread.id)

  const seen = seenIn(itemsOf(root))
  for (const [parent, list] of items) if (shown.has(parent)) seenIn(list, seen)
  const cutOff = lastTurnInterrupted(root)

  const infos = new Map<string, SubagentInfo>()
  for (const childId of shown) {
    const thread = byId.get(childId) as Thread
    const known = seen.get(childId)
    let status: SubagentStatus = known?.status ?? (thread.status.type === 'active' ? 'running' : 'done')
    if (thread.status.type === 'systemError') status = 'error'
    else if (status === 'running' && cutOff && parentOf(thread) === root.id) status = 'interrupted'
    const startedAt = known?.startedAt ?? thread.createdAt * 1000
    const endedAt = status === 'running' ? null : (known?.status === status ? known.endedAt : null) ?? thread.updatedAt * 1000
    // A reviewer's verdict is its first line that starts with VERIFIED or REJECTED (src/shared/workflow/verdict.mjs):
    // a lead-in before it is dropped from the summary too.
    const found = findVerdict(known?.message ?? null)
    const summary = summaryLine(found?.text ?? known?.message ?? null)
    infos.set(childId, {
      id: `agent:${childId}`,
      agentId: childId,
      toolUseId: null,
      parentAgentId: null,
      name: thread.agentNickname ?? null,
      subagentType: thread.agentRole ?? null,
      model: known?.model ?? thread.model ?? null,
      description: summaryLine(thread.preview),
      status,
      // A Codex Subagent runs beside its parent, which waits for it with a tool of its own.
      background: true,
      startedAt,
      durationMs: endedAt === null ? null : Math.max(0, endedAt - startedAt),
      summary,
      verdict: found?.verdict ?? null,
      depth: 1,
      transcript: false,
      children: [],
    })
  }
  const roots: SubagentInfo[] = []
  for (const [childId, info] of infos) {
    const parent = parentOf(byId.get(childId) as Thread)
    const parentInfo = parent === null ? undefined : infos.get(parent)
    if (parentInfo === undefined) roots.push(info)
    else {
      info.parentAgentId = parentInfo.agentId
      parentInfo.children.push(info)
    }
  }
  const settle = (list: SubagentInfo[], depth: number): void => {
    list.sort(byStart)
    for (const info of list) {
      info.depth = depth
      settle(info.children, depth + 1)
    }
  }
  settle(roots, 1)
  return roots
}

/** The Subagent threads that may belong to `root`: those created since it, newest first, at most THREAD_PAGES pages. */
async function subagentThreads(ask: CodexAsk, root: Thread): Promise<Thread[]> {
  const all: Thread[] = []
  let cursor: string | null = null
  for (let page = 0; page < THREAD_PAGES; page++) {
    const answer: ThreadListResponse = await ask.request<ThreadListResponse, 'thread/list'>(
      'thread/list',
      { limit: THREAD_PAGE, sortKey: 'created_at', sortDirection: 'desc', sourceKinds: [...SUBAGENT_SOURCE_KINDS], ...(cursor === null ? {} : { cursor }) },
      CODEX_ASK_TIMEOUT_MS,
    )
    all.push(...answer.data)
    cursor = answer.nextCursor ?? null
    // A Subagent is created after its Session: a page that reaches older threads is the last one needed.
    if (cursor === null || answer.data.some((thread) => thread.createdAt < root.createdAt)) break
  }
  return all
}

const read = (ask: CodexAsk, threadId: string): Promise<Thread> =>
  ask.request<ThreadReadResponse, 'thread/read'>('thread/read', { threadId, includeTurns: true }, CODEX_ASK_TIMEOUT_MS).then((answer) => answer.thread)

/** How worfy reads the Subagent tree of a Codex Session. */
export interface CodexSubagentsPart {
  /** The tree of the Session's thread `threadId`; rejects when Codex cannot be asked. */
  tree(threadId: string): Promise<SubagentInfo[]>
}

export interface CodexSubagentsOptions {
  /** appCodexStarter by default; tests start the fake. */
  start?: StartCodex
  /** The folder Codex keeps its threads in; codexHomeOf() by default. */
  codexHome?: () => string
}

/** The Subagent trees of Codex Sessions, each read in one short-lived app-server. */
export function codexSubagentsPart(options: CodexSubagentsOptions = {}): CodexSubagentsPart {
  const start = options.start ?? appCodexStarter
  const codexHome = options.codexHome ?? (() => codexHomeOf())
  return {
    async tree(threadId) {
      if (!existsSync(codexHome())) return []
      return withCodex(start, undefined, async (ask) => {
        const root = await read(ask, threadId)
        const threads = await subagentThreads(ask, root)
        const tree = codexSubagentTree(root, threads, new Map())
        // Those that spawned Subagents of their own: their items tell how those are doing.
        const parents = flattenSubagents(tree).flatMap((info) => (info.children.length > 0 && info.agentId !== null ? [info.agentId] : []))
        if (parents.length === 0) return tree
        const items = new Map<string, ThreadItem[]>()
        for (const parent of parents) items.set(parent, itemsOf(await read(ask, parent)))
        return codexSubagentTree(root, threads, items)
      })
    },
  }
}

/**
 * The Subagent trees of the Project's Codex Sessions for `claudeHome.subagents`: only of a thread the last
 * list of the Project's Codex Sessions named, so a Claude Session never starts a Codex. Two asks of one
 * Session at once share one read. A Codex that fails keeps the last tree of the Session (and says so once
 * in the log); before any tree there is none.
 */
export class CodexSubagentsOnCanvas {
  private readonly last = new Map<string, SubagentInfo[]>()
  private readonly asking = new Map<string, Promise<SubagentInfo[] | null>>()
  private failure: string | undefined

  constructor(
    private readonly sessions: Pick<CodexSessions, 'cached'>,
    private readonly part: CodexSubagentsPart,
    private readonly log: (message: string, cause: unknown) => void = (message, cause) => console.warn(message, cause),
  ) {}

  /** The tree of the Project's Codex Session `threadId`; null for a thread the Project's Codex list does not name, or before any tree. */
  tree(root: string, threadId: string): Promise<SubagentInfo[] | null> {
    if (!this.sessions.cached(root).some((session) => session.id === threadId)) return Promise.resolve(null)
    const running = this.asking.get(threadId)
    if (running !== undefined) return running
    const asked = this.part.tree(threadId).then(
      (tree) => {
        this.last.set(threadId, tree)
        this.failure = undefined
        return tree
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error)
        if (this.failure !== reason) this.log(`[codex] could not read the Subagents of thread ${threadId}`, error)
        this.failure = reason
        return this.last.get(threadId) ?? null
      },
    )
    const settled = asked.finally(() => this.asking.delete(threadId))
    this.asking.set(threadId, settled)
    return settled
  }
}

/** What `claudeHome.subagents` uses of the Codex Subagents. */
export type CodexSubagents = Pick<CodexSubagentsOnCanvas, 'tree'>

/** For a caller without Codex (tests of the Claude part): no Codex Session has a tree. */
export const NO_CODEX_SUBAGENTS: CodexSubagents = { tree: () => Promise.resolve(null) }

/** The app's Codex Subagents over its Codex Sessions (sessions-on-canvas.ts, appCodexSessions). */
export function appCodexSubagents(sessions: Pick<CodexSessions, 'cached'>): CodexSubagentsOnCanvas {
  return new CodexSubagentsOnCanvas(sessions, codexSubagentsPart())
}

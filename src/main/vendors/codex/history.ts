// The history part of the Codex driver (ADR-0094 item 2; worfy-multi-vendor ticket 22): the past
// threads of a Project's folder and their transcripts, from Codex's app-server, not from its rollout
// files (ticket 05). Each ask starts its own short-lived `codex app-server`, as the account part does
// (account.ts), and closes it after the answer: a list is asked with no Session open.
//
// - list(cwd): `thread/list` of the interactive sources (the terminal, `codex exec`, the app-server
//   clients, worfy among them), without the archived threads and the Subagents' ones, the newest first,
//   page by page. A thread is the Project's when its folder is the Project's folder or inside it
//   (isInsidePath, as for Claude's transcripts): on Windows the comparison takes either separator and
//   ignores case. So the folder is compared here, not by Codex's `cwd` filter, which matches a path
//   exactly. The origin comes from `originator`: worfy starts its threads with clientInfo.name
//   "worfy" (app-server.ts), any other names a terminal or another app.
// - read(id): `thread/read {includeTurns: true}`; Codex finds the thread by its id, so `cwd` is not
//   used (spec, "Decided without the owner", item 13). Its items become worfy's transcript entries
//   through the translation of a live Session (items.ts, ticket 20); the user's messages become the
//   notices a Claude transcript gives for them, and the items about Subagents (spawn_agent,
//   send_message, followup_task, wait, subAgentActivity) the `subagent` events of a Claude transcript
//   (ticket 40: the Flight Recorder reads a Codex Run's agents from them). Each entry has its item's time.
//
// worfy writes nothing into CODEX_HOME (ADR-0005): it only looks whether the folder exists, and no
// Codex is started when it does not: such a Codex has no threads.
import { existsSync } from 'node:fs'
import type { AgentEvent } from '../../../shared/agent/events'
import type { TranscriptEntry } from '../../../shared/transcript/parse'
import { isInsidePath, oneLineTitle } from '../../claude-home/registry'
import type { HistoryPart, HistorySession } from '../history'
import { appCodexStarter, CODEX_ASK_TIMEOUT_MS, codexHomeOf, withCodex, type StartCodex } from './account'
import { CodexItems } from './items'
import type { CollabAgentStatus } from './protocol/ts/v2/CollabAgentStatus'
import type { CollabAgentTool } from './protocol/ts/v2/CollabAgentTool'
import type { Thread } from './protocol/ts/v2/Thread'
import type { ThreadItem } from './protocol/ts/v2/ThreadItem'
import type { ThreadListResponse } from './protocol/ts/v2/ThreadListResponse'
import type { ThreadReadResponse } from './protocol/ts/v2/ThreadReadResponse'
import type { ThreadSourceKind } from './protocol/ts/v2/ThreadSourceKind'
import type { Turn } from './protocol/ts/v2/Turn'

/** The sources a person starts a thread from; the Subagents' threads (`subAgent*`) are not Sessions of their own. */
export const HISTORY_SOURCE_KINDS: readonly ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer']

/** The threads one page of `thread/list` asks for. */
export const THREAD_PAGE = 100

/**
 * How many pages of `thread/list` a list reads at most.
 * shortcut: a Project's threads past the newest THREAD_PAGE × THREAD_PAGES of every folder are not
 * listed, redo with Codex's own `cwd` filter once it matches a folder by prefix and case.
 */
export const THREAD_PAGES = 20

/** The `originator` of the threads worfy starts (clientInfo.name of app-server.ts). */
const WORFY_ORIGINATOR = 'worfy'

/** Where a thread was started: in worfy, outside it, or null when Codex did not record it. */
function originOf(thread: Thread): HistorySession['origin'] {
  if (typeof thread.originator !== 'string' || thread.originator === '') return null
  return thread.originator === WORFY_ORIGINATOR ? 'worfy' : 'external'
}

/**
 * The name a thread shows: its own, else its first message; null when it has neither. On one line
 * and cut to the length of a Claude Session's title (oneLineTitle): Codex's preview is the whole
 * first message, which would stretch every list that shows it (worfy-polish ticket 51).
 */
function titleOf(thread: Thread): string | null {
  const name = typeof thread.name === 'string' ? thread.name.trim() : ''
  if (name !== '') return oneLineTitle(name)
  const preview = typeof thread.preview === 'string' ? thread.preview.trim() : ''
  return preview === '' ? null : oneLineTitle(preview)
}

/**
 * The past Sessions among `threads` whose folder is `root` or inside it, by the rules of `platform`,
 * both paths in NFC (macOS hands out a name in NFD as often as in NFC).
 */
export function codexHistorySessions(threads: readonly Thread[], root: string, platform: NodeJS.Platform = process.platform): HistorySession[] {
  return threads.flatMap((thread) => {
    if (typeof thread.cwd !== 'string' || !isInsidePath(thread.cwd.normalize('NFC'), root.normalize('NFC'), platform)) return []
    return [{ id: thread.id, cwd: thread.cwd, title: titleOf(thread), updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt * 1000 : null, origin: originOf(thread) }]
  })
}

/** The text of a user's message: its text parts, and a skill it called by its `$name`. */
function userText(item: Extract<ThreadItem, { type: 'userMessage' }>): string {
  return item.content
    .flatMap((input) => {
      if (input.type === 'text') return [input.text]
      if (input.type === 'skill' && !item.content.some((each) => each.type === 'text' && each.text.includes(`$${input.name}`))) return [`$${input.name}`]
      return []
    })
    .join('\n')
}

const isoOf = (seconds: number | null | undefined): string | undefined => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : undefined)
const isoOfMs = (ms: number | null | undefined): string | undefined => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined)

type SubagentEvent = Extract<AgentEvent, { type: 'subagent' }>

/** The name the model gave a Subagent: the last part of its agent path (`/root/impl_40` → `impl_40`). */
const agentName = (path: string): string | null => path.split('/').filter((part) => part !== '').at(-1) ?? null

/** How a Subagent's state ends, in the words of a task-notification (`completed`, `failed`, `stopped`); null while it works. */
const ENDED_AS: Readonly<Record<CollabAgentStatus, string | null>> = {
  pendingInit: null,
  running: null,
  completed: 'completed',
  shutdown: 'completed',
  errored: 'failed',
  notFound: 'failed',
  interrupted: 'stopped',
}

/** The collab tools that set a Subagent working again (send_message, followup_task…). */
const RESUMING_TOOLS: ReadonlySet<CollabAgentTool> = new Set(['sendMessage', 'followupTask', 'sendInput', 'resumeAgent'])

const subagentEvent = (phase: SubagentEvent['phase'], taskId: string, toolUseId: string, fields: Partial<Pick<SubagentEvent, 'description' | 'status' | 'summary' | 'result'>> = {}): SubagentEvent => ({
  type: 'subagent',
  phase,
  taskId,
  toolUseId,
  description: fields.description ?? null,
  subagentType: null,
  status: fields.status ?? null,
  summary: fields.summary ?? null,
  ...(fields.result === undefined ? {} : { result: fields.result }),
})

/**
 * What an item of a parent thread says of its Subagents (worfy-multi-vendor ticket 40), as the
 * `subagent` events a Claude transcript gives for its agents: `started` when one is spawned or set
 * working again (send_message, followup_task), `finished` when it ends, each at its own time. A
 * `subAgentActivity` names the agent by the last part of its path; a `wait` or `closeAgent` gives the
 * states the Subagents ended in, with their answers. A spawn that failed is a start and a failed end,
 * with the state's message as the reason; one that names no thread stands for its Subagent by the
 * call's id, so the attempt still shows. Null for an item of another type.
 */
function subagentEvents(item: ThreadItem): { at: number | null | undefined; event: SubagentEvent }[] | null {
  if (item.type === 'subAgentActivity') {
    const description = agentName(item.agentPath)
    const ended = item.kind === 'completed' ? 'completed' : item.kind === 'interrupted' ? 'stopped' : null
    const event = ended === null ? subagentEvent('started', item.agentThreadId, item.id, { description }) : subagentEvent('finished', item.agentThreadId, item.id, { description, status: ended })
    return [{ at: item.startedAtMs, event }]
  }
  if (item.type !== 'collabAgentToolCall') return null
  const started = item.startedAtMs
  const done = item.completedAtMs ?? item.startedAtMs
  if (item.status === 'failed') {
    if (item.tool !== 'spawnAgent') return []
    const agents = item.receiverThreadIds.length > 0 ? item.receiverThreadIds : [item.id]
    return agents.flatMap((agent) => [
      { at: started, event: subagentEvent('started', agent, item.id) },
      { at: done, event: subagentEvent('finished', agent, item.id, { status: 'failed', summary: item.agentsStates[agent]?.message ?? null }) },
    ])
  }
  if (item.tool === 'spawnAgent' || RESUMING_TOOLS.has(item.tool)) return item.receiverThreadIds.map((agent) => ({ at: started, event: subagentEvent('started', agent, item.id) }))
  if (item.tool === 'interruptAgent') return item.receiverThreadIds.map((agent) => ({ at: done, event: subagentEvent('finished', agent, item.id, { status: 'stopped' }) }))
  if (item.tool !== 'wait' && item.tool !== 'closeAgent') return []
  return Object.entries(item.agentsStates).flatMap(([agent, state]) => {
    const status = state === undefined ? null : ENDED_AS[state.status]
    return status === null || state === undefined ? [] : [{ at: done, event: subagentEvent('finished', agent, item.id, { status, result: state.message }) }]
  })
}

/**
 * The transcript entries of a thread read with its turns: per item, the events a live Session gives
 * when the item completes (items.ts), each with the item's id and the item's own time — its start for
 * a message of the user and a tool call, its end for the rest — else the time its turn started. The
 * items about Subagents give `subagent` events (subagentEvents), which the Flight Recorder builds an
 * agent's spans from (worfy-multi-vendor ticket 40).
 */
export function codexTranscript(thread: Thread): TranscriptEntry[] {
  // Only item/completed goes in: the context is asked for a turn's init and result, which a read never gives.
  const items = new CodexItems({ threadId: () => thread.id, cwd: () => thread.cwd, version: () => thread.cliVersion, model: () => thread.model ?? '', preset: () => '' })
  return (thread.turns ?? []).flatMap((turn: Turn) => {
    const turnStart = isoOf(turn.startedAt)
    const entry = (item: ThreadItem, event: AgentEvent, ms: number | null | undefined): TranscriptEntry => {
      const timestamp = isoOfMs(ms) ?? turnStart
      return { uuid: item.id, ...(timestamp === undefined ? {} : { timestamp }), sidechain: false, event }
    }
    return turn.items.flatMap((item) => {
      if (item.type === 'userMessage') return [entry(item, { type: 'notice', kind: 'user', text: userText(item) }, item.startedAtMs)]
      const ofSubagents = subagentEvents(item)
      if (ofSubagents !== null) return ofSubagents.map(({ at, event }) => entry(item, event, at))
      const events = items.take({ method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item, completedAtMs: 0 } })
      return events.map((event) => entry(item, event, event.type === 'tool_use' ? item.startedAtMs : (item.completedAtMs ?? item.startedAtMs)))
    })
  })
}

export interface CodexHistoryOptions {
  /** appCodexStarter by default; tests start the fake. */
  start?: StartCodex
  /** The folder Codex keeps its threads in; codexHomeOf() by default. */
  codexHome?: () => string
  /** The rules paths compare by; process.platform by default. */
  platform?: NodeJS.Platform
}

/** The history part of the Codex driver over `options`. */
export function codexHistoryPart(options: CodexHistoryOptions = {}): HistoryPart {
  const start = options.start ?? appCodexStarter
  const codexHome = options.codexHome ?? (() => codexHomeOf())
  const platform = options.platform ?? process.platform
  return {
    async list(cwd) {
      if (!existsSync(codexHome())) return []
      const threads = await withCodex(start, undefined, async (ask) => {
        const all: Thread[] = []
        let cursor: string | null = null
        for (let page = 0; page < THREAD_PAGES; page++) {
          const answer: ThreadListResponse = await ask.request<ThreadListResponse, 'thread/list'>(
            'thread/list',
            { limit: THREAD_PAGE, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: [...HISTORY_SOURCE_KINDS], archived: false, ...(cursor === null ? {} : { cursor }) },
            CODEX_ASK_TIMEOUT_MS,
          )
          all.push(...answer.data)
          cursor = answer.nextCursor ?? null
          if (cursor === null) break
        }
        return all
      })
      return codexHistorySessions(threads, cwd, platform)
    },
    async read(id) {
      if (!existsSync(codexHome())) throw new Error(`Codex has no thread ${id}: it has no home folder`)
      const answer = await withCodex(start, undefined, (ask) => ask.request<ThreadReadResponse, 'thread/read'>('thread/read', { threadId: id, includeTurns: true }, CODEX_ASK_TIMEOUT_MS))
      return codexTranscript(answer.thread)
    },
  }
}

/** The history part of the app's Codex driver. */
export const codexHistory: HistoryPart = codexHistoryPart()

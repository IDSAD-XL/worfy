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
//   notices a Claude transcript gives for them.
//
// worfy writes nothing into CODEX_HOME (ADR-0005): it only looks whether the folder exists, and no
// Codex is started when it does not: such a Codex has no threads.
import { existsSync } from 'node:fs'
import type { AgentEvent } from '../../../shared/agent/events'
import type { TranscriptEntry } from '../../../shared/transcript/parse'
import { isInsidePath } from '../../claude-home/registry'
import type { HistoryPart, HistorySession } from '../history'
import { appCodexStarter, CODEX_ASK_TIMEOUT_MS, codexHomeOf, withCodex, type StartCodex } from './account'
import { CodexItems } from './items'
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

/** The name a thread shows: its own, else its first message; null when it has neither. */
function titleOf(thread: Thread): string | null {
  const name = typeof thread.name === 'string' ? thread.name.trim() : ''
  if (name !== '') return name
  const preview = typeof thread.preview === 'string' ? thread.preview.trim() : ''
  return preview === '' ? null : preview
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

/**
 * The transcript entries of a thread read with its turns: per item, the events a live Session gives
 * when the item completes (items.ts), each with the item's id and the time its turn started.
 */
export function codexTranscript(thread: Thread): TranscriptEntry[] {
  // Only item/completed goes in: the context is asked for a turn's init and result, which a read never gives.
  const items = new CodexItems({ threadId: () => thread.id, cwd: () => thread.cwd, version: () => thread.cliVersion, model: () => thread.model ?? '', preset: () => '' })
  return (thread.turns ?? []).flatMap((turn: Turn) => {
    const timestamp = isoOf(turn.startedAt)
    return turn.items.flatMap((item) => {
      const events: AgentEvent[] =
        item.type === 'userMessage'
          ? [{ type: 'notice', kind: 'user', text: userText(item) }]
          : items.take({ method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item, completedAtMs: 0 } })
      return events.map((event) => ({ uuid: item.id, ...(timestamp === undefined ? {} : { timestamp }), sidechain: false, event }))
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
